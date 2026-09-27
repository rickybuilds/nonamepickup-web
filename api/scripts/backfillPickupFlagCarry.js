#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const readline = require("node:readline");
const config = require("../src/config");
const { getPickupPool, closePickupPool } = require("../src/db/pickupMariadb");
const { PickupStorage } = require("../src/pickup/storage");
const { createFlagCarryAccumulator, measureCarryDistances, recordedFlagCarries, summarizeFlagCarries } = require("../src/pickup/flagCarry");

const OBJECTIVE_HEADER = "snapshot,time_ms,objective_id,state,carrier_session,solid,effects,x,y,z,yaw";

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
    let sawHeader = false;
    try {
      for await (const line of lines) {
        if (!sawHeader) {
          if (line.replace(/\r$/, "") !== OBJECTIVE_HEADER) throw new Error("Unexpected objectives.csv header");
          sawHeader = true;
          continue;
        }
        if (!line) continue;
        const fields = line.replace(/\r$/, "").split(",");
        if (fields.length !== 11) throw new Error("Invalid objectives.csv row");
        carry.add({ time_ms: fields[1], objective_id: fields[2], carrier_session: fields[4] });
      }
      if (!sawHeader) throw new Error("Empty objectives.csv");
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
  const storage = new PickupStorage(config.PICKUP_STORAGE_PATH, { publicRoot: config.PUBLIC_DIR });
  try {
    await storage.ensureReady();
    const [artifacts] = await pool.execute(`
      SELECT a.id AS artifact_id, a.storage_key, r.id AS round_pk
      FROM pickup_artifacts a
      JOIN pickup_rounds r ON r.id = a.round_pk
      WHERE a.artifact_kind = 'round_replay' AND a.status = 'verified'
        AND a.is_primary = 1 AND r.flag_carry_processed_at IS NULL
      ORDER BY a.id
    `);
    let completed = 0;
    for (const artifact of artifacts) {
      const archivePath = storage.artifactPath(artifact.storage_key);
      const { carries, summaries } = await readCarryFromArchive(archivePath);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [sessions] = await connection.execute(
          "SELECT session_id FROM pickup_round_players WHERE round_pk = ?",
          [artifact.round_pk]
        );
        for (const session of sessions) {
          const summary = summaries.get(Number(session.session_id));
          await connection.execute(`
            UPDATE pickup_round_players
            SET flag_carry_ms = ?, flag_carry_count = ?, flag_carry_distance_units = ?
            WHERE round_pk = ? AND session_id = ?
          `, [summary?.milliseconds || 0, summary?.carries || 0,
            summary?.distanceUnits || 0, artifact.round_pk, session.session_id]);
        }
        for (const carry of carries) {
          await connection.execute(`
            INSERT INTO pickup_flag_carries
              (round_pk, session_id, objective_id, carry_number, start_ms, end_ms, distance_units)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE session_id = VALUES(session_id),
              start_ms = VALUES(start_ms), end_ms = VALUES(end_ms),
              distance_units = VALUES(distance_units)
          `, [artifact.round_pk, carry.sessionId, carry.objectiveId, carry.carryNumber,
            carry.startMs, carry.endMs, carry.distanceUnits]);
        }
        await connection.execute(
          "UPDATE pickup_rounds SET flag_carry_processed_at = NOW(3) WHERE id = ?",
          [artifact.round_pk]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      completed += 1;
      console.log(`Processed artifact ${artifact.artifact_id} (${completed}/${artifacts.length})`);
    }
    console.log(`Flag carry backfill complete: ${completed} rounds`);
  } finally {
    await closePickupPool();
  }
}

main().catch(error => {
  console.error("Flag carry backfill failed:", error);
  process.exitCode = 1;
});
