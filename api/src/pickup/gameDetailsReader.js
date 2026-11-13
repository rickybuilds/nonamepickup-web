"use strict";

const Database = require("better-sqlite3");
const { createHash } = require("node:crypto");
const { gunzip, gzip } = require("node:zlib");
const { promisify } = require("node:util");
const { VERSION } = require("./tacticalPlayback");

const decode = promisify(gunzip), encode = promisify(gzip);
const MAX_STORED_BYTES = 64 * 1024 * 1024;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function createGameDetailsReader(filename) {
  const cache = new Map(), pending = new Map();
  let cacheBytes = 0;

  async function read(matchId, round) {
    if (!filename) return null;
    let db, row, payload;
    try {
      // No persistent handle: replacing an offline-built database does not leave
      // this process reading the old inode. Never create a missing database.
      db = new Database(filename, { readonly: true, fileMustExist: true });
      if (db.pragma("application_id", { simple: true }) !== 1195656268 ||
          db.pragma("user_version", { simple: true }) !== 1) throw new Error("Unsupported game-details schema");
      db.transaction(() => {
        row = db.prepare(`SELECT r.id,r.revision,r.source_sha256,r.map,p.payload_sha256,
          length(p.payload) AS bytes FROM detail_rounds r JOIN detail_packages p ON p.round_id=r.id
          WHERE r.match_id=? AND r.round_number=? AND p.format='game-details-pilot-v1'
            AND p.encoding='json+gzip' ORDER BY r.id DESC LIMIT 1`).get(matchId, round);
        if (!row) return;
        if (!/^[a-f0-9]{64}$/.test(row.revision) || !/^[a-f0-9]{64}$/.test(row.source_sha256) ||
            !/^[a-f0-9]{64}$/.test(row.payload_sha256) || row.bytes < 1 || row.bytes > MAX_STORED_BYTES) {
          throw new Error("Invalid game-details package metadata");
        }
        const key = `${matchId}:${round}:${row.revision}:${row.payload_sha256}`;
        if (!cache.has(key) && !pending.has(key)) {
          payload = db.prepare("SELECT payload FROM detail_packages WHERE round_id=?").get(row.id).payload;
        }
      })();
    } catch (error) {
      if (error.code === "SQLITE_CANTOPEN" || error.code === "ENOENT") return null;
      throw error;
    } finally { db?.close(); }
    if (!row) return null;
    const key = `${matchId}:${round}:${row.revision}:${row.payload_sha256}`;
    if (cache.has(key)) {
      const result = cache.get(key);
      cache.delete(key); cache.set(key, result);
      return result;
    }
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      if (!Buffer.isBuffer(payload) || hash(payload) !== row.payload_sha256) throw new Error("Game-details package checksum mismatch");
      const source = JSON.parse((await decode(payload, { maxOutputLength: MAX_DECODED_BYTES })).toString("utf8"));
      const playback = source.playback;
      if (source.format !== "game-details-pilot-v1" || source.source?.sha256 !== row.source_sha256 ||
          source.source?.manifest?.match_id !== matchId || source.source.manifest.round !== round ||
          playback?.version !== VERSION || playback.stride !== 10 || playback.matchId !== matchId ||
          playback.round !== round || playback.sha256 !== row.source_sha256 || playback.map !== row.map ||
          !Array.isArray(playback.players) || !playback.players.length || !Array.isArray(playback.events)) {
        throw new Error("Invalid game-details playback identity or format");
      }
      // The package also contains private companion analytics, raw CSVs and
      // conversion metadata. Only the embedded public playback leaves this reader.
      const result = { gzip: await encode(JSON.stringify(playback)),
        etag: `"tactical-db-v${VERSION}-${row.revision}-${row.payload_sha256}"` };
      if (result.gzip.length <= MAX_CACHE_BYTES) {
        while (cache.size >= MAX_CACHE_ENTRIES || cacheBytes + result.gzip.length > MAX_CACHE_BYTES) {
          const first = cache.keys().next().value;
          cacheBytes -= cache.get(first).gzip.length; cache.delete(first);
        }
        cache.set(key, result); cacheBytes += result.gzip.length;
      }
      return result;
    })();
    pending.set(key, work);
    try { return await work; }
    finally { pending.delete(key); }
  }

  function available(matchId, round) {
    if (!filename) return null;
    let db;
    try {
      db = new Database(filename, { readonly: true, fileMustExist: true });
      if (db.pragma("application_id", { simple: true }) !== 1195656268 ||
          db.pragma("user_version", { simple: true }) !== 1) return null;
      return db.prepare(`SELECT r.map FROM detail_rounds r JOIN detail_packages p ON p.round_id=r.id
        WHERE r.match_id=? AND r.round_number=? AND p.format='game-details-pilot-v1'
        AND p.encoding='json+gzip' AND length(p.payload)>0 AND length(p.payload)<=?
        ORDER BY r.id DESC LIMIT 1`).get(matchId, round, MAX_STORED_BYTES) || null;
    } catch (error) {
      if (error.code === "SQLITE_CANTOPEN" || error.code === "ENOENT") return null;
      throw error;
    } finally { db?.close(); }
  }

  return { read, available };
}

module.exports = { createGameDetailsReader };
