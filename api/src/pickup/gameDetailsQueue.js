"use strict";

const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");
const APPLICATION_ID = 0x47445131;

function openGameDetailsQueue(filename, { readonly = false } = {}) {
  if (!readonly) fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename, { readonly, fileMustExist: readonly });
  try {
    db.pragma("busy_timeout = 5000");
    const id = db.pragma("application_id", { simple: true });
    if (id === APPLICATION_ID && ![1, 2].includes(db.pragma("user_version", { simple: true }))) throw new Error("Unsupported game-details queue version");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (id !== APPLICATION_ID && (readonly || id !== 0 || tables.length)) throw new Error("Not a game-details queue database");
    if (!readonly) db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS game_detail_jobs (
      artifact_id INTEGER PRIMARY KEY, match_id TEXT NOT NULL, round_number INTEGER NOT NULL,
      source_sha256 TEXT NOT NULL, storage_key TEXT NOT NULL, schema_version INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', first_seen INTEGER NOT NULL, uploaded_at INTEGER NOT NULL,
      first_imported_at INTEGER, last_verified_at INTEGER, revision TEXT,
      refresh_stage INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, archive_deleted_at INTEGER,
      cleanup_retry_after INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS game_detail_jobs_due ON game_detail_jobs(next_attempt,state);
      PRAGMA application_id=${APPLICATION_ID};`);
      if (!db.prepare("PRAGMA table_info(game_detail_jobs)").all().some(column => column.name === "cleanup_retry_after")) {
        db.exec("ALTER TABLE game_detail_jobs ADD COLUMN cleanup_retry_after INTEGER NOT NULL DEFAULT 0");
      }
      db.pragma("user_version = 2");
      // Retire refreshes scheduled by older workers; verified jobs are complete.
      db.exec("UPDATE game_detail_jobs SET next_attempt=0 WHERE state='ready' AND next_attempt<>0");
    })();
    if (![1, 2].includes(db.pragma("user_version", { simple: true }))) throw new Error("Unsupported game-details queue version");
    const hasCleanupRetry = db.prepare("PRAGMA table_info(game_detail_jobs)").all().some(column => column.name === "cleanup_retry_after");
    const enqueue = db.prepare(`INSERT INTO game_detail_jobs
      (artifact_id,match_id,round_number,source_sha256,storage_key,schema_version,first_seen,uploaded_at,next_attempt)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(artifact_id) DO NOTHING`);
    const summary = () => db.prepare(`SELECT state,COUNT(*) AS rounds,
      SUM(archive_deleted_at IS NOT NULL) AS archives_deleted, MIN(next_attempt) AS next_attempt
      FROM game_detail_jobs GROUP BY state`).all();
    return { db, close: () => db.close(), summary,
      enqueue(artifact, now = Math.floor(Date.now() / 1000)) {
        const id = Number(artifact.id), round = Number(artifact.round_number), schema = Number(artifact.schema_version);
        const sha = String(artifact.sha256), match = String(artifact.match_id), key = String(artifact.storage_key);
        if (!Number.isSafeInteger(id) || id < 1 || !/^[a-z0-9_-]{1,64}$/i.test(match) ||
            !Number.isInteger(round) || round < 1 || round > 9999 || !/^[a-f0-9]{64}$/.test(sha) ||
            !Number.isInteger(schema) || schema < 2 || schema > 7 || !key.endsWith(`-${sha}.tar.zst`)) throw new Error("Invalid completed artifact identity");
        const existing = db.prepare("SELECT source_sha256,match_id,round_number FROM game_detail_jobs WHERE artifact_id=?").get(id);
        if (existing && (existing.source_sha256 !== sha || existing.match_id !== match || existing.round_number !== round)) throw new Error("Artifact ID changed identity");
        const uploaded = Number(artifact.verified_epoch);
        const uploadedAt = Number.isFinite(uploaded) && uploaded > 0 ? Math.floor(uploaded) : now;
        return enqueue.run(id, match, round, sha, key, schema, now,
          uploadedAt, Math.max(now, uploadedAt + 30)).changes;
      },
      due(limit, now = Math.floor(Date.now() / 1000)) {
        return db.prepare(`SELECT * FROM game_detail_jobs WHERE archive_deleted_at IS NULL
          AND state IN ('pending','retry') AND next_attempt>0 AND next_attempt<=?
          ORDER BY CASE WHEN uploaded_at>=? AND first_imported_at IS NULL THEN 0
            WHEN first_imported_at IS NOT NULL THEN 1 ELSE 2 END, next_attempt,artifact_id DESC LIMIT ?`).all(now, now - 86400, limit);
      },
      attempting(id) { db.prepare("UPDATE game_detail_jobs SET attempts=attempts+1 WHERE artifact_id=?").run(id); },
      success(job, revision, now = Math.floor(Date.now() / 1000)) {
        db.prepare(`UPDATE game_detail_jobs SET state='ready',first_imported_at=COALESCE(first_imported_at,?),
          last_verified_at=?,revision=?,next_attempt=0,last_error=NULL
          WHERE artifact_id=?`).run(now, now, revision, job.artifact_id);
      },
      failure(job, error, now = Math.floor(Date.now() / 1000)) {
        db.prepare("UPDATE game_detail_jobs SET state='retry',next_attempt=?,last_error=? WHERE artifact_id=?")
          .run(now + 900, String(error.message || error).slice(0, 2000), job.artifact_id);
      },
      expired(days, now = Math.floor(Date.now() / 1000)) {
        if (!Number.isInteger(days) || days < 14) throw new Error("Archive retention must be at least 14 days");
        return db.prepare(`SELECT * FROM game_detail_jobs WHERE state='ready' AND archive_deleted_at IS NULL
          AND first_imported_at<=? AND next_attempt=0 AND ${hasCleanupRetry ? "cleanup_retry_after" : "0"}<=?
          ORDER BY first_imported_at LIMIT 100`).all(now - days * 86400, now);
      },
      deleted(id, now = Math.floor(Date.now() / 1000)) { db.prepare("UPDATE game_detail_jobs SET archive_deleted_at=?,last_error=NULL WHERE artifact_id=?").run(now, id); },
      cleanupBlocked(id, error) {
        db.prepare("UPDATE game_detail_jobs SET last_error=?,cleanup_retry_after=? WHERE artifact_id=?")
          .run(String(error.message || error).slice(0, 2000), Math.floor(Date.now() / 1000) + 86400, id);
      }
    };
  } catch (error) { db.close(); throw error; }
}

module.exports = { openGameDetailsQueue };
