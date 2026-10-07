#!/usr/bin/env node
"use strict";

// Imports a slice of a real pickup-game path as a Noname TFC Bootcamp ghost.
//
// The Bootcamp plugin plays 'pug' ghosts as moving targets in defensive drills
// (live-target waves) for the route they're attached to. Pug paths are
// position-only: in game they play back as a moving puppet rather than a bot
// replaying inputs.
//
// Usage:
//   node scripts/importBootcampPugPath.js --match <matchId> --round <n> \
//     --steamid <STEAM_x:y:z> --from <ms> --to <ms> --route <bootcamp route id> \
//     [--tier <0-4>] [--name <label>] [--dry-run]
//
// --from/--to are round times in milliseconds (players.csv time_ms). The route
// gives the map and is where the ghost shows up in game; the path's class is
// read from the replay.

const { spawn } = require("node:child_process");
const readline = require("node:readline");
const config = require("../src/config");
const { getPickupPool, closePickupPool } = require("../src/db/pickupMariadb");
const { getSpeedrunPool, closeSpeedrunPool } = require("../src/db/mariadb");
const { PickupStorage } = require("../src/pickup/storage");

const CHUNK_CHARS = 14000;       // matches BC_CHUNK_CHARS in the plugin
const MAX_FRAMES = 3600;         // matches BC_TRK_MAX_POS in the plugin
const MAX_SPAN_MS = 120000;

function parseArgs(argv) {
  const args = { dryRun: false, tier: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case "--match": args.matchId = value; i += 1; break;
      case "--round": args.round = Number(value); i += 1; break;
      case "--steamid": args.steamid = value; i += 1; break;
      case "--from": args.fromMs = Number(value); i += 1; break;
      case "--to": args.toMs = Number(value); i += 1; break;
      case "--route": args.routeId = Number(value); i += 1; break;
      case "--tier": args.tier = Number(value); i += 1; break;
      case "--name": args.name = value; i += 1; break;
      case "--dry-run": args.dryRun = true; break;
      default: throw new Error(`Unknown argument: ${key}`);
    }
  }
  const missing = ["matchId", "round", "steamid", "fromMs", "toMs", "routeId"].filter(k => args[k] == null || args[k] === "");
  if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
  if (!Number.isInteger(args.round) || args.round < 1) throw new Error("--round must be a positive integer");
  if (!/^STEAM_\d:\d:\d+$/i.test(args.steamid)) throw new Error("--steamid must look like STEAM_0:1:12345");
  if (!Number.isFinite(args.fromMs) || !Number.isFinite(args.toMs) || args.toMs <= args.fromMs) throw new Error("--to must be after --from");
  if (args.toMs - args.fromMs > MAX_SPAN_MS) throw new Error(`Slices are limited to ${MAX_SPAN_MS / 1000}s`);
  if (!Number.isInteger(args.routeId) || args.routeId < 1) throw new Error("--route must be a Bootcamp route id");
  if (!Number.isInteger(args.tier) || args.tier < 0 || args.tier > 4) throw new Error("--tier must be 0-4");
  return args;
}

async function readMember(archivePath, member, consume) {
  const child = spawn("tar", ["--zstd", "-xOf", archivePath, member], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
  const complete = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${stderr}`))));
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

// Frames for one session between fromMs and toMs, times rebased to 0.
async function readPath(stream, sessionId, fromMs, toMs) {
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const wanted = ["time_ms", "session_id", "alive", "class", "buttons", "x", "y", "z", "pitch", "yaw", "roll"];
  let idx = null;
  const frames = [];
  let classId = 0;
  try {
    for await (const raw of lines) {
      const line = raw.replace(/\r$/, "");
      if (!idx) {
        const header = line.replace(/^\uFEFF/, "").split(",").map(s => s.trim().toLowerCase());
        idx = Object.fromEntries(wanted.map(name => [name, header.indexOf(name)]));
        const missing = wanted.filter(name => idx[name] < 0);
        if (missing.length) throw new Error(`players.csv is missing ${missing.join(", ")}`);
        continue;
      }
      if (!line) continue;
      const f = line.split(",");
      if (Number(f[idx.session_id]) !== sessionId) continue;
      const t = Number(f[idx.time_ms]);
      if (t < fromMs) continue;
      if (t > toMs) break;
      if (Number(f[idx.alive]) !== 1) {
        if (frames.length) break; // died: end the slice here
        continue;
      }
      const frame = {
        t: (t - fromMs) / 1000,
        x: Number(f[idx.x]), y: Number(f[idx.y]), z: Number(f[idx.z]),
        pitch: Number(f[idx.pitch]), yaw: Number(f[idx.yaw]), roll: Number(f[idx.roll]),
        buttons: Math.trunc(Number(f[idx.buttons]) || 0)
      };
      if (![frame.t, frame.x, frame.y, frame.z, frame.pitch, frame.yaw, frame.roll].every(Number.isFinite)) continue;
      if (!classId) classId = Number(f[idx.class]) || 0;
      frames.push(frame);
    }
  } finally {
    lines.close();
  }
  return { frames, classId };
}

// Thin evenly to the plugin's frame cap.
function thin(frames) {
  if (frames.length <= MAX_FRAMES) return frames;
  const step = frames.length / MAX_FRAMES;
  const out = [];
  for (let i = 0; i < MAX_FRAMES; i += 1) out.push(frames[Math.floor(i * step)]);
  out[out.length - 1] = frames[frames.length - 1];
  return out;
}

function medianInterval(frames) {
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) gaps.push(frames[i].t - frames[i - 1].t);
  gaps.sort((a, b) => a - b);
  return gaps.length ? Math.max(0.005, gaps[Math.floor(gaps.length / 2)]) : 0.02;
}

// Same line format and chunking as the plugin's recorder.
function chunkFrames(frames) {
  const chunks = [];
  let current = "";
  for (const f of frames) {
    const line = `${f.t.toFixed(3)},${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)},${f.pitch.toFixed(1)},${f.yaw.toFixed(1)},${f.roll.toFixed(1)},${f.buttons},-;\n`;
    if (current.length + line.length >= CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    current += line;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  config.validatePickupConfiguration();
  const pickup = getPickupPool(config);
  const storage = new PickupStorage(config.PICKUP_STORAGE_PATH, { publicRoot: config.PUBLIC_DIR });
  const speedrun = getSpeedrunPool();

  try {
    const [routes] = await speedrun.execute("SELECT id, map, name FROM bootcamp_routes WHERE id = ?", [args.routeId]);
    if (!routes.length) throw new Error(`Bootcamp route ${args.routeId} not found`);
    const route = routes[0];

    const [artifacts] = await pickup.execute(`
      SELECT a.storage_key, r.id AS round_pk, r.map
        FROM pickup_artifacts a
        JOIN pickup_rounds r ON r.id = a.round_pk
        JOIN pickup_matches m ON m.id = r.match_pk
       WHERE m.match_id = ? AND r.round_number = ?
         AND a.artifact_kind = 'round_replay' AND a.status = 'verified' AND a.is_primary = 1
       LIMIT 1`, [args.matchId, args.round]);
    if (!artifacts.length) throw new Error("No verified replay for that match and round");
    const artifact = artifacts[0];
    if (String(artifact.map).toLowerCase() !== String(route.map).toLowerCase())
      throw new Error(`The replay is on ${artifact.map} but route ${route.id} is on ${route.map}`);

    const [sessions] = await pickup.execute(`
      SELECT rp.session_id, p.steamid, p.current_name AS name
        FROM pickup_round_players rp
        JOIN pickup_players p ON p.id = rp.player_pk
       WHERE rp.round_pk = ? AND p.steamid = ?`, [artifact.round_pk, args.steamid]);
    if (!sessions.length) throw new Error(`${args.steamid} did not play that round`);

    let best = { frames: [], classId: 0 };
    for (const session of sessions) {
      const result = await readMember(storage.artifactPath(artifact.storage_key), "players.csv",
        stream => readPath(stream, Number(session.session_id), args.fromMs, args.toMs));
      if (result.frames.length > best.frames.length) best = { ...result, name: session.name };
    }
    if (best.frames.length < 2) throw new Error("No living frames for that player in that window");

    const frames = thin(best.frames);
    const chunks = chunkFrames(frames);
    const timeMs = Math.round(frames[frames.length - 1].t * 1000);
    const label = (args.name || `pug ${args.matchId} r${args.round} ${best.name || args.steamid}`).slice(0, 64);
    console.log(`${label}: ${frames.length} frames over ${(timeMs / 1000).toFixed(2)}s, class ${best.classId}, ${chunks.length} chunks → route ${route.id} (${route.name})`);
    if (args.dryRun) return;

    const conn = await speedrun.getConnection();
    try {
      await conn.beginTransaction();
      const [insert] = await conn.execute(
        `INSERT INTO bootcamp_ghosts (map, route_id, class_id, steamid, player_name, kind, time_ms, frame_interval,
                                      pos_frames, input_frames, tier_tag, is_complete)
         VALUES (?, ?, ?, ?, ?, 'pug', ?, ?, ?, 0, ?, 0)`,
        [route.map, route.id, best.classId, args.steamid, label, timeMs, medianInterval(frames), frames.length, args.tier]
      );
      const ghostId = insert.insertId;
      for (let i = 0; i < chunks.length; i += 1) {
        await conn.execute("INSERT INTO bootcamp_ghost_chunks (ghost_id, track, chunk_id, data) VALUES (?, 'pos', ?, ?)",
          [ghostId, i, chunks[i]]);
      }
      await conn.execute("UPDATE bootcamp_ghosts SET is_complete = 1 WHERE id = ?", [ghostId]);
      await conn.commit();
      console.log(`Saved Bootcamp ghost ${ghostId}. Watch it at /speedrun-replay.html?bootcampGhostId=${ghostId}`);
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
  } finally {
    await closePickupPool();
    await closeSpeedrunPool();
  }
}

main().catch(error => {
  console.error("Bootcamp pug import failed:", error.message || error);
  process.exitCode = 1;
});
