#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
const config = require("../src/config");
const { getPickupPool, closePickupPool } = require("../src/db/pickupMariadb");
const { PickupStorage } = require("../src/pickup/storage");
const { openGameDetailsQueue } = require("../src/pickup/gameDetailsQueue");
const { runQueuedImports, pruneArchives } = require("../src/pickup/gameDetailsMaintenance");

function verifyLegacyViewerRetired(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port,
      path: "/api/pickup-replays/viewer/retention-check/1/files/roster.csv", timeout: 5000 }, response => {
      let body = "";
      response.on("data", chunk => {
        body += chunk.toString("utf8");
        if (body.length > 16384) request.destroy(new Error("Unexpected legacy viewer probe response"));
      });
      response.on("error", reject);
      response.on("end", () => {
        let data;
        try { data = JSON.parse(body); } catch { reject(new Error("Cannot verify legacy viewer retirement")); return; }
        if (response.statusCode !== 410 || data?.error !== "legacy_replay_retired") {
          reject(new Error("Running API has not retired the legacy file viewer; archives retained"));
        } else resolve();
      });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Legacy viewer retirement check timed out")));
  });
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!["--help", "--status", "--dry-run", "--prune", "--limit"].includes(key) || Object.hasOwn(options, key)) throw new Error("Invalid/duplicate arguments; use --help");
    if (key === "--limit") {
      if (!/^[1-9]\d?$/.test(args[i + 1] || "")) throw new Error("--limit requires 1–99");
      options[key] = Number(args[++i]);
    } else options[key] = true;
  }
  if (options["--help"]) {
    console.log("Usage: node api/scripts/maintainGameDetails.js [--limit 4] [--prune] | --status | --dry-run");
    console.log("Server cron worker: discover recent complete uploads, import/refresh due rounds, retry failures. Run under the same flock lock for every invocation.");
    console.log("--dry-run only verifies/lists expired cleanup candidates; it does not import or delete. --status only reads queue state.");
    console.log("Actual --prune requires GAME_DETAILS_ARCHIVE_DELETE=true and PICKUP_LEGACY_REPLAY_ENABLED=false. Defaults to retaining archives.");
    return;
  }
  const readonly = !!(options["--status"] || options["--dry-run"]);
  if (readonly && (options["--prune"] || options["--limit"] || (options["--status"] && options["--dry-run"]))) throw new Error("Use status/dry-run separately from importing/pruning");
  const dbPaths = [config.ELO_DB, config.GAME_DETAILS_DB, config.GAME_DETAILS_QUEUE_DB].map(file => {
    const resolved = path.resolve(file);
    return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  });
  if (new Set(dbPaths).size !== dbPaths.length) throw new Error("ELO, details and queue database paths must differ");
  if (readonly && !fs.existsSync(config.GAME_DETAILS_QUEUE_DB)) {
    console.log("No maintenance queue yet. Importing/pruning has not run.");
    return;
  }
  const queue = openGameDetailsQueue(config.GAME_DETAILS_QUEUE_DB, { readonly });
  let stopping = false;
  const stop = () => { stopping = true; console.log("[game-details] stopping after active work completes"); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    if (options["--status"]) {
      console.log(JSON.stringify({ queue: config.GAME_DETAILS_QUEUE_DB, details: config.GAME_DETAILS_DB,
        retentionDays: config.GAME_DETAILS_RETENTION_DAYS, deletionEnabled: config.GAME_DETAILS_ARCHIVE_DELETE,
        legacyViewerEnabled: config.PICKUP_LEGACY_REPLAY_ENABLED, summary: queue.summary(),
        recentErrors: queue.db.prepare(`SELECT match_id,round_number,state,attempts,last_error
          FROM game_detail_jobs WHERE last_error IS NOT NULL ORDER BY artifact_id DESC LIMIT 20`).all() }, null, 2));
      return;
    }
    if (!config.PICKUP_STORAGE_PATH) throw new Error("Missing PICKUP_STORAGE_PATH in api/.env");
    const storage = new PickupStorage(config.PICKUP_STORAGE_PATH, { publicRoot: config.PUBLIC_DIR });
    const cleanup = dryRun => pruneArchives({ queue, storage, destination: config.GAME_DETAILS_DB,
      elo: config.ELO_DB, retentionDays: config.GAME_DETAILS_RETENTION_DAYS, dryRun, shouldStop: () => stopping });
    if (options["--dry-run"]) { console.log(JSON.stringify(await cleanup(true))); return; }
    if (!config.PICKUP_DB_USER || !config.PICKUP_DB_PASSWORD) throw new Error("Missing pickup MariaDB credentials in api/.env");
    await storage.ensureReady();
    const cutoff = Math.floor(Date.now() / 1000) - config.GAME_DETAILS_CATCHUP_DAYS * 86400;
    const [artifacts] = await getPickupPool(config).execute(`SELECT a.id,a.storage_key,a.sha256,
      UNIX_TIMESTAMP(a.verified_at) AS verified_epoch,r.round_number,r.schema_version,m.match_id
      FROM pickup_artifacts a JOIN pickup_rounds r ON r.id=a.round_pk
      JOIN pickup_matches m ON m.id=r.match_pk WHERE a.artifact_kind='round_replay'
      AND a.status='verified' AND a.is_primary=1 AND r.status='complete'
      AND a.verified_at>=FROM_UNIXTIME(?) ORDER BY a.id`, [cutoff]);
    let enqueued = 0, rejected = 0;
    for (const artifact of artifacts) {
      if (stopping) break;
      try { enqueued += queue.enqueue(artifact); }
      catch (error) { rejected++; console.error(`[game-details] artifact ${artifact.id} not queued: ${error.message}`); }
    }
    console.log(`[game-details] ${enqueued} new rounds queued, ${rejected} rejected; catch-up ${config.GAME_DETAILS_CATCHUP_DAYS} days`);
    const result = await runQueuedImports({ queue, storage, destination: config.GAME_DETAILS_DB,
      elo: config.ELO_DB, limit: options["--limit"] || 4, shouldStop: () => stopping });
    console.log("[game-details] imports:", JSON.stringify(result));
    if (options["--prune"] && !stopping) {
      if (!config.GAME_DETAILS_ARCHIVE_DELETE || config.PICKUP_LEGACY_REPLAY_ENABLED) {
        console.log("[game-details] cleanup disabled: requires deletion enabled and legacy file viewer disabled");
      } else {
        await verifyLegacyViewerRetired(config.PORT);
        const pruned = await cleanup(false);
        console.log("[game-details] cleanup:", JSON.stringify(pruned));
        if (pruned.blocked) process.exitCode = 1;
      }
    }
    if (result.failed || rejected) process.exitCode = 1;
    if (stopping) process.exitCode = 130;
  } finally {
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    queue.close();
    await closePickupPool();
  }
}

main().catch(error => { console.error("[game-details] maintenance failed:", error.message); process.exitCode = 1; });
