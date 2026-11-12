#!/usr/bin/env node
"use strict";
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true });
const fs = require("node:fs/promises");
const path = require("node:path");
const { gzipSync } = require("node:zlib");
const config = require("../src/config");
const { getPickupPool, closePickupPool } = require("../src/db/pickupMariadb");
const { PickupStorage } = require("../src/pickup/storage");
const { PickupReplayViewer } = require("../src/pickup/viewer");
const { buildPlayback, playbackPath } = require("../src/pickup/tacticalPlayback");
const { member, readText } = require("./backfillPickupFlagDeaths");
const Database = require("better-sqlite3");
async function main() {
  const match = process.argv[2] || "HDPVET";
  if (!/^[a-z0-9_-]{1,64}$/i.test(match)) throw new Error("Invalid match ID");
  for (const key of ["PICKUP_DB_USER", "PICKUP_DB_PASSWORD", "PICKUP_STORAGE_PATH"]) if (!config[key]) throw new Error(`Missing ${key} in api/.env`);
  const pool = getPickupPool(config);
  const storage = new PickupStorage(config.PICKUP_STORAGE_PATH, { publicRoot: config.PUBLIC_DIR });
  const viewer = new PickupReplayViewer({ pool, storage });
  let db;
  try {
    await storage.ensureReady();
    const [rounds] = await pool.execute(`SELECT r.round_number FROM pickup_rounds r JOIN pickup_matches m ON m.id=r.match_pk
      WHERE m.match_id=? AND r.status='complete' ORDER BY r.round_number`, [match]);
    if (!rounds.length) throw new Error("No complete recorded rounds for " + match);
    db = new Database(config.ELO_DB, { readonly: true, fileMustExist: true });
    for (const row of rounds) {
      const round = Number(row.round_number), metadata = await viewer.metadata(match, round);
      const artifact = await viewer.artifact(match, round);
      const archive = storage.artifactPath(artifact.storage_key);
      const destination = playbackPath(storage.root, metadata.sha256);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const realDir = await fs.realpath(path.dirname(destination)), realRoot = await fs.realpath(storage.root);
      if (!realDir.startsWith(realRoot + path.sep)) throw new Error("Unsafe tactical cache directory");
      const indexedKills = db.prepare("SELECT session_id,time_ms,weapon FROM pickup_kill_locations WHERE match_id=? AND round_number=?").all(match, round);
      console.log(`Preparing ${match} round ${round} · ${metadata.map}…`);
      const playback = await buildPlayback({ metadata, indexedKills,
        text: file => member(archive, file, readText), stream: (file, consume) => member(archive, file, consume) });
      const compressed = gzipSync(JSON.stringify(playback));
      const temporary = destination + "." + process.pid + ".tmp";
      await fs.writeFile(temporary, compressed, { mode: 0o600 });
      await fs.rename(temporary, destination);
      console.log(`Ready: ${playback.players.length} players, ${playback.events.length} events, ${(compressed.length / 1024 / 1024).toFixed(2)} MB compressed`);
    }
    console.log(`Open /round-playback.html?match=${encodeURIComponent(match)}&round=${Number(rounds[0].round_number)}`);
  } finally { db?.close(); await closePickupPool(); }
}
main().catch(error => { console.error("Tactical preparation failed:", error); process.exitCode = 1; });
