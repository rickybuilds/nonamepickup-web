"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createHash } = require("node:crypto");
const { gunzipSync } = require("node:zlib");
const { convertRound, hashFile } = require("./gameDetailsPilot");

function verifyImportedRound(destination, job, revision = null) {
  const db = new Database(destination, { readonly: true, fileMustExist: true });
  let row;
  try {
    if (db.pragma("application_id", { simple: true }) !== 1195656268 || db.pragma("user_version", { simple: true }) !== 1) throw new Error("Invalid details database schema");
    db.transaction(() => {
      row = db.prepare(`SELECT r.id,r.revision,r.source_sha256,r.map,p.payload_sha256,length(p.payload) AS bytes
        FROM detail_rounds r JOIN detail_packages p ON p.round_id=r.id WHERE r.match_id=? AND r.round_number=?
        AND p.format='game-details-pilot-v1' AND p.encoding='json+gzip'
        ORDER BY r.id DESC LIMIT 1`).get(job.match_id, job.round_number);
      if (!row || row.source_sha256 !== job.source_sha256 || (revision && revision !== row.revision) || row.bytes < 1 || row.bytes > 64 * 1024 * 1024) throw new Error("Matching active details package is missing");
      row.payload = db.prepare("SELECT payload FROM detail_packages WHERE round_id=?").get(row.id).payload;
    })();
  } finally { db.close(); }
  if (createHash("sha256").update(row.payload).digest("hex") !== row.payload_sha256) throw new Error("Details package checksum mismatch");
  const data = JSON.parse(gunzipSync(row.payload, { maxOutputLength: 128 * 1024 * 1024 }));
  if (data.format !== "game-details-pilot-v1" || data.source?.sha256 !== job.source_sha256 || data.source?.manifest?.match_id !== job.match_id ||
      data.source.manifest.round !== job.round_number || data.source.manifest.schema_version !== job.schema_version ||
      data.source.manifest.complete !== true || data.source.manifest.write_error !== false ||
      data.playback?.matchId !== job.match_id || data.playback.round !== job.round_number ||
      data.playback.sha256 !== job.source_sha256 || data.playback.map !== row.map || data.playback.version !== 2 || data.playback.stride !== 10 ||
      !Array.isArray(data.playback.players) || !data.playback.players.length || !Array.isArray(data.playback.events)) {
    throw new Error("Details package identity/format mismatch");
  }
  return { revision: row.revision, schema: data.source.manifest.schema_version };
}

async function runQueuedImports({ queue, storage, destination, elo, limit = 4, logger = console, shouldStop = () => false }) {
  const result = { imported: 0, unchanged: 0, failed: 0 };
  for (const job of queue.due(limit)) {
    if (shouldStop()) break;
    queue.attempting(job.artifact_id);
    try {
      // Historical imports may already contain this exact source. Verify the
      // package first so those jobs never need to open or hash the archive.
      let existing;
      try { existing = verifyImportedRound(destination, job); }
      catch { /* Missing or invalid packages must be imported/repaired below. */ }
      if (existing) {
        queue.success(job, existing.revision);
        result.unchanged++;
        logger.log(`[game-details] ${job.match_id}/${job.round_number}: already stored/verified; archive skipped`);
        continue;
      }
      const converted = await convertRound({ archive: storage.artifactPath(job.storage_key), destination,
        match: job.match_id, round: job.round_number, elo, skipExisting: true, log: text => logger.log(text) });
      const verified = verifyImportedRound(destination, job, converted.revision);
      queue.success(job, verified.revision);
      result[converted.skipped ? "unchanged" : "imported"]++;
      logger.log(`[game-details] ${job.match_id}/${job.round_number}: ${converted.skipped ? "unchanged/verified" : "imported/verified"}`);
    } catch (error) {
      queue.failure(job, error); result.failed++;
      logger.error(`[game-details] ${job.match_id}/${job.round_number}: retry in 15 minutes: ${error.message}`);
    }
  }
  return result;
}

function verifyMapIndexes(elo, job) {
  const db = new Database(elo, { readonly: true, fileMustExist: true });
  try {
    const tables = ["pickup_flag_carry_rounds"];
    if (job.schema_version >= 6) tables.push("pickup_kill_rounds", "pickup_flag_death_rounds");
    for (const table of tables) {
      const row = db.prepare(`SELECT artifact_sha256 FROM ${table} WHERE match_id=? AND round_number=?`).get(job.match_id, job.round_number);
      if (row?.artifact_sha256 !== job.source_sha256) throw new Error(`Required ELO index missing or mismatched: ${table}`);
    }
  } finally { db.close(); }
}

async function pruneArchives({ queue, storage, destination, elo, retentionDays = 14, dryRun = true, logger = console, shouldStop = () => false }) {
  if (!Number.isInteger(retentionDays) || retentionDays < 14) throw new Error("Archive retention must be at least 14 days");
  const result = { eligible: 0, deleted: 0, blocked: 0 };
  const root = await fs.realpath(storage.artifacts);
  for (const job of queue.expired(retentionDays)) {
    if (shouldStop()) break;
    try {
      const databaseBefore = await fs.stat(destination);
      verifyImportedRound(destination, job);
      verifyMapIndexes(elo, job);
      const archive = storage.artifactPath(job.storage_key);
      if (path.basename(path.dirname(archive)) !== job.match_id ||
          !new RegExp(`^round-0*${job.round_number}-${job.source_sha256}\\.tar\\.zst$`).test(path.basename(archive))) throw new Error("Archive path identity mismatch");
      let info;
      try { info = await fs.lstat(archive); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        logger.log(`[game-details cleanup] ${job.match_id}/${job.round_number}: already missing; database verified`);
        if (!dryRun) queue.deleted(job.artifact_id);
        continue;
      }
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Archive is not a regular file");
      const realFile = await fs.realpath(archive);
      if (!realFile.startsWith(root + path.sep)) throw new Error("Archive resolves outside artifact storage");
      if (await hashFile(realFile) !== job.source_sha256) throw new Error("Archive checksum mismatch; retained for review");
      const databaseAfter = await fs.stat(destination), finalFile = await fs.lstat(realFile);
      if (databaseBefore.ino !== databaseAfter.ino || databaseBefore.size !== databaseAfter.size || databaseBefore.mtimeMs !== databaseAfter.mtimeMs ||
          finalFile.ino !== info.ino || finalFile.size !== info.size || finalFile.mtimeMs !== info.mtimeMs || !finalFile.isFile()) throw new Error("Database/archive changed during verification");
      result.eligible++;
      logger.log(`[game-details cleanup] ${dryRun ? "would delete" : "deleting"}: ${realFile}`);
      if (!dryRun) { await fs.unlink(realFile); queue.deleted(job.artifact_id); result.deleted++; }
    } catch (error) {
      result.blocked++;
      if (!dryRun) queue.cleanupBlocked(job.artifact_id, error);
      logger.error(`[game-details cleanup] ${job.match_id}/${job.round_number}: retained: ${error.message}`);
    }
  }
  return result;
}

module.exports = { verifyImportedRound, runQueuedImports, pruneArchives };
