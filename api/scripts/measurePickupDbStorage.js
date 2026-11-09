#!/usr/bin/env node
"use strict";

// One-game sizing probe. It copies the existing compressed archives into a
// uniquely named scratch table and verifies them; it never changes the files.
const crypto = require("node:crypto");
const fs = require("node:fs");
const config = require("../src/config");
const { getPickupPool, closePickupPool } = require("../src/db/pickupMariadb");
const { PickupStorage } = require("../src/pickup/storage");

const MAX_SAMPLE_BYTES = 128 * 1024 * 1024;
const RESERVED_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const mib = bytes => (Number(bytes) / 1048576).toFixed(2);
const gib = bytes => (Number(bytes) / 1073741824).toFixed(2);

async function main() {
  const matchId = String(process.argv[2] || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(matchId)) {
    throw new Error("Usage: node scripts/measurePickupDbStorage.js MATCH_ID");
  }
  if (!config.PICKUP_STORAGE_PATH) throw new Error("PICKUP_STORAGE_PATH is not configured");
  if (!["127.0.0.1", "::1", "localhost"].includes(String(config.PICKUP_DB_HOST).toLowerCase())) {
    throw new Error("The sizing probe requires local MariaDB so it can check the correct filesystem's free space");
  }

  const pool = getPickupPool(config);
  let connection;
  let tableCreated = false;
  const table = "replay_sizing_" + crypto.randomBytes(8).toString("hex");
  // The identifier is generated locally from a fixed prefix and hex bytes.
  const tableSql = "`" + table + "`";
  try {
    connection = await pool.getConnection();
    const [environment] = await connection.query(
      "SELECT DATABASE() AS db_name, @@datadir AS data_dir, @@max_allowed_packet AS max_packet"
    );
    const settings = environment[0];
    if (!settings?.db_name || !settings.data_dir) throw new Error("Could not determine MariaDB database or data directory");

    const [artifacts] = await connection.execute(`
      SELECT a.id, a.storage_key, a.sha256, a.byte_size, r.round_number
      FROM pickup_artifacts a
      JOIN pickup_rounds r ON r.id=a.round_pk
      JOIN pickup_matches m ON m.id=r.match_pk
      WHERE m.match_id=? AND a.artifact_kind='round_replay'
        AND a.status='verified' AND a.is_primary=1 AND r.status='complete'
      ORDER BY r.round_number
    `, [matchId]);
    if (artifacts.length < 2) throw new Error("This match has fewer than two verified complete round archives; choose a complete game");
    const sampleBytes = artifacts.reduce((sum, row) => sum + Number(row.byte_size), 0);
    if (!Number.isSafeInteger(sampleBytes) || sampleBytes <= 0 || sampleBytes > MAX_SAMPLE_BYTES) {
      throw new Error("Sample exceeds the 128 MiB sizing limit; choose a smaller game");
    }

    // Refuse to run without enough room for the sample, temporary overhead,
    // and an additional 2 GiB reserve on the MariaDB data filesystem.
    let space;
    try { space = fs.statfsSync(String(settings.data_dir), { bigint: true }); }
    catch (error) { throw new Error("Cannot check free space on the MariaDB data filesystem: " + error.message); }
    const freeBytes = Number(space.bavail * space.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes < RESERVED_FREE_BYTES + sampleBytes * 3) {
      throw new Error("Insufficient free space on the MariaDB data filesystem for this sizing probe and its reserve");
    }
    const chunkSize = Math.min(256 * 1024, Math.floor(Number(settings.max_packet) / 2));
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 16384) throw new Error("MariaDB max_allowed_packet is too small for the sizing probe");

    const storage = new PickupStorage(config.PICKUP_STORAGE_PATH, { publicRoot: config.PUBLIC_DIR });
    const [totals] = await connection.query(`
      SELECT COUNT(*) AS rounds, COUNT(DISTINCT m.id) AS games, COALESCE(SUM(a.byte_size),0) AS bytes
      FROM pickup_artifacts a
      JOIN pickup_rounds r ON r.id=a.round_pk
      JOIN pickup_matches m ON m.id=r.match_pk
      WHERE a.artifact_kind='round_replay' AND a.status='verified' AND a.is_primary=1 AND r.status='complete'
    `);
    console.log(`Sample: ${matchId}, ${artifacts.length} verified rounds, ${mib(sampleBytes)} MiB compressed`);
    console.log(`MariaDB filesystem free before copy: ${gib(freeBytes)} GiB`);
    console.log(`Creating isolated sizing table ${table} in ${settings.db_name}; it will be removed afterward.`);
    await connection.query(`CREATE TABLE ${tableSql} (
      artifact_id BIGINT UNSIGNED NOT NULL, chunk_number INT UNSIGNED NOT NULL,
      payload MEDIUMBLOB NOT NULL, PRIMARY KEY (artifact_id, chunk_number)
    ) ENGINE=InnoDB`);
    tableCreated = true;

    let transactionOpen = false;
    try {
      await connection.beginTransaction();
      transactionOpen = true;
      for (const artifact of artifacts) {
        const sourceHash = crypto.createHash("sha256");
        let count = 0, bytes = 0;
        const source = fs.createReadStream(storage.artifactPath(artifact.storage_key), { highWaterMark: chunkSize });
        for await (const chunk of source) {
          sourceHash.update(chunk);
          bytes += chunk.length;
          await connection.execute(`INSERT INTO ${tableSql} (artifact_id, chunk_number, payload) VALUES (?, ?, ?)`,
            [artifact.id, count++, chunk]);
        }
        if (bytes !== Number(artifact.byte_size) || sourceHash.digest("hex") !== String(artifact.sha256).toLowerCase()) {
          throw new Error(`Round ${artifact.round_number}: archive size or SHA-256 does not match its recorded metadata`);
        }
      }
      await connection.commit();
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) await connection.rollback().catch(() => {});
      throw error;
    }

    for (const artifact of artifacts) {
      const hash = crypto.createHash("sha256");
      let sequence = 0, bytes = 0;
      while (true) {
        const [rows] = await connection.execute(`SELECT payload FROM ${tableSql} WHERE artifact_id=? AND chunk_number=?`,
          [artifact.id, sequence]);
        if (!rows.length) break;
        const chunk = rows[0].payload;
        hash.update(chunk);
        bytes += chunk.length;
        sequence++;
      }
      if (bytes !== Number(artifact.byte_size) || hash.digest("hex") !== String(artifact.sha256).toLowerCase()) {
        throw new Error(`Round ${artifact.round_number}: database readback did not match the original archive`);
      }
      console.log(`Round ${artifact.round_number}: ${mib(bytes)} MiB copied and SHA-256 matched on readback`);
    }

    await connection.query(`ANALYZE TABLE ${tableSql}`);
    const [rows] = await connection.execute(`SELECT DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes
      FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [settings.db_name, table]);
    if (!rows.length) throw new Error("MariaDB did not return sizing information for the scratch table");
    const dataBytes = Number(rows[0].data_bytes), indexBytes = Number(rows[0].index_bytes);
    const allocated = dataBytes + indexBytes;
    if (!Number.isFinite(allocated) || allocated <= 0) throw new Error("MariaDB returned an invalid table size");
    const total = totals[0];
    const compressedTotal = Number(total.bytes);
    const estimated = compressedTotal * allocated / sampleBytes;
    console.log(`Sample table data: ${mib(dataBytes)} MiB; indexes: ${mib(indexBytes)} MiB; total: ${mib(allocated)} MiB`);
    console.log(`Verified completed archives: ${Number(total.games)} games, ${Number(total.rounds)} rounds, ${gib(compressedTotal)} GiB compressed`);
    console.log(`Rough data-and-index estimate at this sample's ratio: ${gib(estimated)} GiB`);
    console.log("Estimate excludes database logs, backups, staging space and future growth; a single game may not be representative.");
    console.log("This measures compressed archive bytes in database chunks, not individually SQL-queryable CSV rows.");
  } finally {
    if (connection && tableCreated) {
      try { await connection.query(`DROP TABLE ${tableSql}`); console.log(`Removed sizing table ${table}.`); }
      catch (error) { console.error(`Could not remove sizing table ${table}; ask an administrator to remove that table.`, error.message); }
    }
    if (connection) connection.release();
    await closePickupPool();
  }
}

main().catch(error => { console.error("Sizing failed:", error.message); process.exitCode = 1; });
