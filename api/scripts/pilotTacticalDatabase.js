#!/usr/bin/env node
"use strict";
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true });
const fs = require("node:fs/promises");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const Database = require("better-sqlite3");
const config = require("../src/config");
const { VERSION, playbackPath } = require("../src/pickup/tacticalPlayback");
const size = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MiB (${bytes.toLocaleString()} bytes)`;

async function main() {
  const match = process.argv[2] || "HDPVET", roundText = process.argv[3] || "1";
  if (!/^[a-z0-9_-]{1,64}$/i.test(match) || !/^[1-9]\d{0,3}$/.test(roundText)) throw new Error("Usage: node api/scripts/pilotTacticalDatabase.js MATCH ROUND");
  if (!config.PICKUP_STORAGE_PATH) throw new Error("Missing PICKUP_STORAGE_PATH in api/.env");
  const round = Number(roundText), sourcePath = path.resolve(config.ELO_DB);
  const destination = path.join(path.dirname(sourcePath), `elo.tactical-pilot-${match}-r${round}.db`);
  let source, pilot;
  try {
    source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const indexed = source.prepare("SELECT artifact_sha256 FROM pickup_kill_rounds WHERE match_id=? AND round_number=?").get(match, round);
    if (!indexed) throw new Error("This round is not in the kill index. Prepare/index it before the storage pilot.");
    const file = playbackPath(config.PICKUP_STORAGE_PATH, String(indexed.artifact_sha256));
    const fileStat = await fs.stat(file).catch(error => {
      if (error.code === "ENOENT") throw new Error(`Prepared playback missing. First run: node api/scripts/prepareTacticalPlayback.js ${match}`);
      throw error;
    });
    if (fileStat.size > 64 * 1024 * 1024) throw new Error("Prepared package exceeds this pilot's 64 MiB size limit");
    const compressed = await fs.readFile(file);
    const decoded = gunzipSync(compressed, { maxOutputLength: 128 * 1024 * 1024 });
    const playback = JSON.parse(decoded.toString("utf8"));
    if (playback.version !== VERSION || playback.matchId !== match || playback.round !== round ||
        playback.sha256 !== String(indexed.artifact_sha256)) throw new Error("Prepared playback identity does not match the indexed round");
    const sourceBytes = source.pragma("page_count", { simple: true }) * source.pragma("page_size", { simple: true });
    if (fs.statfs) {
      const disk = await fs.statfs(path.dirname(destination));
      if (disk.bavail * disk.bsize < sourceBytes + compressed.length + 64 * 1024 * 1024) {
        throw new Error("Not enough free disk space for a separate full database copy");
      }
    }
    console.log(`Source database (read-only): ${sourcePath}`);
    console.log(`Trial copy: ${destination}`);
    console.log(`Round: ${match} / ${round}`);
    console.log(`Prepared gzip package: ${size(compressed.length)}`);
    console.log(`Uncompressed playback JSON: ${size(decoded.length)}`);
    // Reserve the exact destination exclusively; never overwrite an existing pilot.
    const reserved = await fs.open(destination, "wx", 0o600);
    await reserved.close();
    console.log("Creating consistent SQLite backup; large databases can take a while…");
    await source.backup(destination);
    source.close(); source = null;
    pilot = new Database(destination, { fileMustExist: true });
    pilot.pragma("journal_mode = DELETE");
    const before = (await fs.stat(destination)).size;
    const freeBefore = pilot.pragma("freelist_count", { simple: true });
    pilot.transaction(() => {
      pilot.exec(`CREATE TABLE IF NOT EXISTS tactical_playback_packages (
        match_id TEXT NOT NULL,round_number INTEGER NOT NULL,artifact_sha256 TEXT NOT NULL,
        format_version INTEGER NOT NULL,encoding TEXT NOT NULL,payload BLOB NOT NULL,
        created_at INTEGER NOT NULL,PRIMARY KEY(match_id,round_number)
      )`);
      pilot.prepare(`INSERT INTO tactical_playback_packages
        (match_id,round_number,artifact_sha256,format_version,encoding,payload,created_at)
        VALUES(?,?,?,?,?,?,?)`).run(match, round, playback.sha256, VERSION, "json+gzip", compressed, Math.floor(Date.now() / 1000));
    })();
    const stored = pilot.prepare("SELECT payload FROM tactical_playback_packages WHERE match_id=? AND round_number=?").get(match, round).payload;
    if (!Buffer.from(stored).equals(compressed)) throw new Error("Stored playback differs from the prepared package");
    const after = (await fs.stat(destination)).size;
    const freeAfter = pilot.pragma("freelist_count", { simple: true });
    console.log(`Trial DB before: ${size(before)}`);
    console.log(`Trial DB after:  ${size(after)}`);
    console.log(`File growth:    ${size(after - before)}`);
    console.log(`Free SQLite pages: ${freeBefore} before → ${freeAfter} after (existing free pages can absorb part of the package)`);
    console.log("Stored gzip bytes verified against the prepared file. Live elo.db was not modified.");
    console.log("The website still uses prepared files; this is a storage comparison only. The trial copy contains the full database and should stay private.");
  } finally { pilot?.close(); source?.close(); }
}
main().catch(error => {
  console.error("Tactical database pilot failed:", error.message);
  if (error.code === "EEXIST") console.error("The trial database already exists; it was not overwritten.");
  process.exitCode = 1;
});
