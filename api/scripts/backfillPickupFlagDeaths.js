#!/usr/bin/env node
"use strict";
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const config = require("../src/config");
const { createDatabase } = require("../src/db");
const { getPickupPool, closePickupPool } = require("../src/db/pickupMariadb");
const { PickupStorage } = require("../src/pickup/storage");
const { createFlagCarryAccumulator } = require("../src/pickup/flagCarry");
const { locateFlagDeaths, flagObjectiveIds, confirmedDeathCandidates } = require("../src/pickup/flagDeaths");
const { createFlagDeathStore } = require("../src/pickup/flagDeathStore");
const { parseCsv } = require("../src/pickup/csv");

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function retrySqliteBusy(label, action) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return action();
    } catch (error) {
      if (!/^SQLITE_(BUSY|LOCKED)(_|$)/.test(String(error.code || "")) || attempt === 12) throw error;
      const delayMs = Math.min(attempt * 1000, 10000);
      console.warn(label + ": SQLite is busy; retrying in " + (delayMs / 1000) + "s (" + attempt + "/12)");
      await sleep(delayMs);
    }
  }
}

async function member(path, name, consume) {
  const child = spawn("tar", ["--zstd", "-xOf", path, name], { stdio: ["ignore", "pipe", "pipe"] });
  let errors = "";
  child.stderr.on("data", c => { errors = (errors + c).slice(-2000); });
  const finished = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${errors}`)));
  });
  try { const result = await consume(child.stdout); await finished; return result; }
  catch (error) { child.kill(); await finished.catch(() => {}); throw error; }
}
async function readText(stream) {
  let text = "";
  for await (const chunk of stream) {
    text += chunk.toString("utf8");
    if (text.length > 128 * 1024 * 1024) throw new Error("Replay event stream is too large");
  }
  return text;
}
async function processArchive(path, intervalMs) {
  const carries = await member(path, "objectives.csv", async stream => {
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const acc = createFlagCarryAccumulator(); let header;
    for await (const line of lines) {
      if (!header) { header = line.replace(/^\uFEFF/, "").replace(/\r$/, "").split(","); continue; }
      if (!line) continue;
      const cells = line.split(",");
      acc.add({ time_ms: cells[header.indexOf("time_ms")], objective_id: cells[header.indexOf("objective_id")], carrier_session: cells[header.indexOf("carrier_session")] });
    }
    return acc.finish();
  });
  if (!carries.length) return [];
  const defs = parseCsv(await member(path, "objective_defs.csv", readText), "objective_defs");
  const render = parseCsv(await member(path, "render_models.csv", readText), "render_models");
  const flags = flagObjectiveIds(defs, new Map(render.map(row => [Number(row.model_id), row.path])));
  const flagCarries = carries.filter(carry => flags.has(carry.objectiveId));
  if (!flagCarries.length) return [];
  const scene = parseCsv(await member(path, "scene_events.csv", readText), "scene_events");
  const events = parseCsv(await member(path, "events.csv", readText), "events");
  const age = Math.min(2000, Math.ceil(intervalMs * 2));
  const deaths = confirmedDeathCandidates(scene, events, defs, flags, age);
  return member(path, "players.csv", stream => locateFlagDeaths(stream, deaths, flagCarries, age));
}
async function main() {
  config.validatePickupConfiguration();
  const pool = getPickupPool(config);
  const db = await retrySqliteBusy("Opening elo.db", () =>
    createDatabase(config.ELO_DB, config.ANALYTICS_RETENTION_DAYS));
  const store = createFlagDeathStore(db);
  const storage = new PickupStorage(config.PICKUP_STORAGE_PATH, { publicRoot: config.PUBLIC_DIR });
  try {
    await storage.ensureReady();
    const [artifacts] = await pool.execute(`SELECT a.id, a.storage_key, a.sha256, r.id AS round_pk, r.round_number,
      r.map, r.schema_version, r.sample_interval_ms, m.match_id FROM pickup_artifacts a
      JOIN pickup_rounds r ON r.id=a.round_pk JOIN pickup_matches m ON m.id=r.match_pk
      WHERE a.artifact_kind='round_replay' AND a.status='verified' AND a.is_primary=1 AND r.status='complete'
      ORDER BY a.id`);
    let completed = 0, skipped = 0;
    for (const a of artifacts) {
      if (await retrySqliteBusy(`Checking artifact ${a.id}`, () =>
        store.hasRound(a.match_id, a.round_number, String(a.sha256)))) { skipped++; continue; }
      if (Number(a.schema_version) < 6) { skipped++; continue; }
      const deaths = await processArchive(storage.artifactPath(a.storage_key), Number(a.sample_interval_ms));
      const [sessions] = await pool.execute(`SELECT rp.session_id, p.steamid, p.current_name FROM pickup_round_players rp
        JOIN pickup_players p ON p.id=rp.player_pk WHERE rp.round_pk=?`, [a.round_pk]);
      const round = { matchId: a.match_id, round: Number(a.round_number), map: a.map, sha256: String(a.sha256),
        roster: sessions.map(s => ({ sessionIndex: s.session_id, steamId: s.steamid, playerName: s.current_name })), deaths };
      const saved = await retrySqliteBusy(`Saving artifact ${a.id}`, () => store.saveRound(round));
      if (!saved) { skipped++; continue; }
      console.log(`Indexed artifact ${a.id}: ${deaths.length} flag-carrier deaths`); completed++;
    }
    console.log(`Flag death backfill complete: ${completed} processed, ${skipped} unchanged.`);
  } finally { db.close(); await closePickupPool(); }
}
main().catch(error => { console.error("Flag death backfill failed:", error); process.exitCode = 1; });
