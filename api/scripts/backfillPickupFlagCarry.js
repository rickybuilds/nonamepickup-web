#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const readline = require("node:readline");
const config = require("../src/config");
const { createDatabase } = require("../src/db");
const { getPickupPool, closePickupPool } = require("../src/db/pickupMariadb");
const { PickupStorage } = require("../src/pickup/storage");
const { createFlagCarryAccumulator, measureCarryDistances, recordedFlagCarries, summarizeFlagCarries } = require("../src/pickup/flagCarry");
const { createFlagCarryStore } = require("../src/pickup/flagCarryStore");

async function readMember(archivePath, member, consume) {
  const child = spawn("tar", ["--zstd", "-xOf", archivePath, member], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
  const complete = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${stderr}`)));
  });
  try {
    const result = await consume(child.stdout);
    await complete;
    return result;
  } catch (error) {
    child.kill();
    await complete.catch(() => {});
    throw error;
  }
}

async function readCarryFromArchive(archivePath) {
  const carries = await readMember(archivePath, "objectives.csv", async stream => {
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const carry = createFlagCarryAccumulator();
    let headers = null;
    let indexes = null;
    try {
      for await (const line of lines) {
        if (!headers) {
          headers = line.replace(/^\uFEFF/, "").replace(/\r$/, "").split(",")
            .map(name => name.trim().toLowerCase());
          indexes = ["time_ms", "objective_id", "carrier_session"]
            .map(name => headers.indexOf(name));
          if (indexes.includes(-1)) {
            throw new Error(`Unsupported objectives.csv header: ${headers.join(",")}`);
          }
          continue;
        }
        if (!line) continue;
        const fields = line.replace(/\r$/, "").split(",");
        if (fields.length !== headers.length) throw new Error("Invalid objectives.csv row");
        carry.add({
          time_ms: fields[indexes[0]],
          objective_id: fields[indexes[1]],
          carrier_session: fields[indexes[2]]
        });
      }
      if (!headers) throw new Error("Empty objectives.csv");
      return carry.finish();
    } finally {
      lines.close();
    }
  });
  const seenSessions = carries.length
    ? await readMember(archivePath, "players.csv", stream =>
      measureCarryDistances(stream, carries))
    : new Set();
  const recordedCarries = recordedFlagCarries(carries, seenSessions);
  return { carries: recordedCarries, summaries: summarizeFlagCarries(recordedCarries) };
}

async function main() {
  config.validatePickupConfiguration();
  const pool = getPickupPool(config);
  const db = createDatabase(config.ELO_DB, config.ANALYTICS_RETENTION_DAYS);
  const flagCarryStore = createFlagCarryStore(db);
  const storage = new PickupStorage(config.PICKUP_STORAGE_PATH, { publicRoot: config.PUBLIC_DIR });
  try {
    await storage.ensureReady();
    const [artifacts] = await pool.execute(`
      SELECT a.id AS artifact_id, a.storage_key, a.sha256, r.id AS round_pk,
             r.round_number, r.map, UNIX_TIMESTAMP(r.started_at) AS started_at_epoch,
             m.match_id
      FROM pickup_artifacts a
      JOIN pickup_rounds r ON r.id = a.round_pk
      JOIN pickup_matches m ON m.id = r.match_pk
      WHERE a.artifact_kind = 'round_replay' AND a.status = 'verified'
        AND a.is_primary = 1 AND r.status = 'complete'
      ORDER BY a.id
    `);
    let completed = 0;
    for (const artifact of artifacts) {
      const sha256 = String(artifact.sha256);
      if (flagCarryStore.hasRound(artifact.match_id, artifact.round_number, sha256)) continue;
      const archivePath = storage.artifactPath(artifact.storage_key);
      const { carries, summaries } = await readCarryFromArchive(archivePath);
      const [sessions] = await pool.execute(`
        SELECT rp.session_id AS session_index, p.steamid AS steam_id
        FROM pickup_round_players rp
        JOIN pickup_players p ON p.id = rp.player_pk
        WHERE rp.round_pk = ?
      `, [artifact.round_pk]);
      flagCarryStore.saveRound({
        matchId: artifact.match_id,
        round: artifact.round_number,
        map: artifact.map,
        startedAtEpoch: Number(artifact.started_at_epoch),
        sha256,
        roster: sessions.map(session => ({
          sessionIndex: Number(session.session_index), steamId: session.steam_id
        })),
        flagCarryBySession: summaries,
        flagCarries: carries
      });
      completed += 1;
      console.log(`Processed artifact ${artifact.artifact_id} (${completed}/${artifacts.length})`);
    }
    console.log(`Flag carry backfill complete: ${completed} rounds`);
  } finally {
    db.close();
    await closePickupPool();
  }
}

main().catch(error => {
  console.error("Flag carry backfill failed:", error);
  process.exitCode = 1;
});
