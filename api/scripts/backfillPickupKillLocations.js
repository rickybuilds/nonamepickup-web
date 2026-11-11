#!/usr/bin/env node
"use strict";
// Match the API's environment even when invoked from the repository root.
// Existing process environment values still take precedence over the file.
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true });
const config = require("../src/config");
const { createDatabase } = require("../src/db");
const { getPickupPool, closePickupPool } = require("../src/db/pickupMariadb");
const { PickupStorage } = require("../src/pickup/storage");
const { locateKills } = require("../src/pickup/killLocations");
const { createKillLocationStore } = require("../src/pickup/killLocationStore");
const { parseCsv } = require("../src/pickup/csv");
const { member, readText, retrySqliteBusy } = require("./backfillPickupFlagDeaths");

async function main() {
  const missing = ["PICKUP_DB_USER", "PICKUP_DB_PASSWORD", "PICKUP_STORAGE_PATH"]
    .filter(key => !config[key]);
  if (missing.length) {
    throw new Error(`Missing kill backfill configuration: ${missing.join(", ")}. Configure api/.env or run with the API's environment. PICKUP_UPLOAD_TOKEN is not needed for this backfill.`);
  }
  const pool = getPickupPool(config);
  const db = await retrySqliteBusy("Opening elo.db", () => createDatabase(config.ELO_DB, config.ANALYTICS_RETENTION_DAYS));
  const store = createKillLocationStore(db);
  const storage = new PickupStorage(config.PICKUP_STORAGE_PATH, { publicRoot: config.PUBLIC_DIR });
  try {
    await storage.ensureReady();
    const [artifacts] = await pool.execute(`SELECT a.id,a.storage_key,a.sha256,r.id AS round_pk,
      r.round_number,r.map,r.schema_version,r.sample_interval_ms,m.match_id FROM pickup_artifacts a
      JOIN pickup_rounds r ON r.id=a.round_pk JOIN pickup_matches m ON m.id=r.match_pk
      WHERE a.artifact_kind='round_replay' AND a.status='verified' AND a.is_primary=1 AND r.status='complete'
      ORDER BY a.id`);
    let completed = 0, skipped = 0;
    const pending = [];
    for (const artifact of artifacts) {
      if (Number(artifact.schema_version) < 6 || await retrySqliteBusy(`Checking artifact ${artifact.id}`, () =>
        store.hasRound(artifact.match_id, artifact.round_number, String(artifact.sha256)))) { skipped++; continue; }
      pending.push(artifact);
    }
    console.log(`Kill location backfill: ${artifacts.length} verified complete artifacts, ${pending.length} remaining, ${skipped} unchanged or unsupported.`);
    if (process.argv.includes("--status")) return;
    for (const [index, artifact] of pending.entries()) {
      const path = storage.artifactPath(artifact.storage_key);
      const scene = parseCsv(await member(path, "scene_events.csv", readText), "scene_events");
      const events = parseCsv(await member(path, "events.csv", readText), "events");
      const entities = parseCsv(await member(path, "entity_defs.csv", readText), "entity_definitions");
      const kills = await member(path, "players.csv", stream => locateKills(stream, scene,
        Math.min(2000, Math.ceil(Number(artifact.sample_interval_ms) * 2)), { events, entities }));
      const [sessions] = await pool.execute(`SELECT rp.session_id,p.steamid,p.current_name
        FROM pickup_round_players rp JOIN pickup_players p ON p.id=rp.player_pk WHERE rp.round_pk=?`, [artifact.round_pk]);
      const saved = await retrySqliteBusy(`Saving artifact ${artifact.id}`, () => store.saveRound({
        matchId: artifact.match_id, round: Number(artifact.round_number), map: artifact.map,
        sha256: String(artifact.sha256), kills,
        roster: sessions.map(session => ({ sessionIndex: session.session_id, steamId: session.steamid, playerName: session.current_name }))
      }));
      const progress = `[${index + 1}/${pending.length} · ${pending.length - index - 1} remaining]`;
      if (!saved) {
        skipped++;
        console.log(`${progress} Artifact ${artifact.id} already indexed; skipped.`);
      } else {
        completed++;
        console.log(`${progress} Indexed artifact ${artifact.id}: ${kills.length} enemy kill locations`);
      }
    }
    console.log(`Kill location backfill complete: ${completed} processed, ${skipped} unchanged or unsupported.`);
  } finally { db.close(); await closePickupPool(); }
}
main().catch(error => { console.error("Kill location backfill failed:", error); process.exitCode = 1; });
