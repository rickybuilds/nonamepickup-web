"use strict";
const path = require("node:path");
const readline = require("node:readline");
const { parseCsv, normalizeRoster } = require("./csv");
const { createConcEndpointCollector } = require("./concEndpoints");
const VERSION = 2;
const STRIDE = 10; // time,x,y,z,yaw,alive,health,armor,class,team
function playbackPath(root, sha) {
  if (!/^[a-f0-9]{64}$/i.test(sha)) throw new Error("Invalid replay hash");
  return path.join(root, "tactical", `v${VERSION}-${sha}.json.gz`);
}
async function numericRows(stream, consume) {
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headers;
  for await (const line of lines) {
    if (!headers) { headers = line.replace(/^\uFEFF/, "").replace(/\r$/, "").split(","); continue; }
    if (!line) continue;
    // Numeric columns precede v7's optional quoted inventory fields.
    const cells = line.split(",");
    consume(key => Number(cells[headers.indexOf(key)]));
  }
}
async function buildPlayback({ metadata, text, stream, indexedKills = [] }) {
  const roster = normalizeRoster(parseCsv(await text("roster.csv"), "roster"));
  const players = roster.map(player => ({ id: player.sessionIndex, name: player.playerName,
    steamId: player.steamId, frames: [], lives: [] }));
  const byId = new Map(players.map(player => [player.id, player]));
  const openLives = new Map();
  let durationMs = metadata.durationMs;
  await stream("players.csv", input => numericRows(input, get => {
    const player = byId.get(get("session_id"));
    if (!player) return;
    const frame = ["time_ms", "x", "y", "z", "yaw", "alive", "health", "armor", "class", "team"].map(get);
    if (!frame.every(Number.isFinite)) return;
    const time = frame[0], previousTime = player.frames.at(-STRIDE);
    if (previousTime != null && time < previousTime) return;
    durationMs = Math.max(durationMs, time);
    const alive = frame[5] === 1;
    let life = openLives.get(player.id);
    if (life && time - life.lastSample > Math.max(2000, metadata.sampleIntervalMs * 4)) {
      life.endMs = life.lastSample; life.endReason = "recording gap"; openLives.delete(player.id); life = null;
    }
    if (alive && !life) {
      life = { number: player.lives.length + 1, startMs: time, endMs: null,
        endReason: "recording ended", lastSample: time, kills: 0 };
      player.lives.push(life); openLives.set(player.id, life);
    }
    if (life) {
      life.lastSample = time;
      if (!alive) { life.endMs = time; life.endReason = "death"; openLives.delete(player.id); }
    }
    const last = player.frames.length - STRIDE;
    // Keep 10 Hz movement plus every health/class/team/alive transition.
    // The original recording can be 50 Hz; browsers need not download all of it.
    if (last < 0 || time - player.frames[last] >= 100 || [5, 6, 7, 8, 9].some(field => frame[field] !== player.frames[last + field])) {
      player.frames.push(...frame);
    }
  }));
  for (const player of players) for (const life of player.lives) {
    if (life.endMs == null) life.endMs = life.lastSample;
    delete life.lastSample;
  }
  const scene = metadata.files.sceneEvents ? parseCsv(await text("scene_events.csv"), "scene_events") : [];
  const notices = new Map(scene.filter(row => row.event === "death_notice").map(row => [row.object_id, row.text]));
  const known = new Map(indexedKills.map(kill => [kill.session_id + ":" + kill.time_ms, kill.weapon]));
  const seen = new Set();
  function teamAt(id, time) {
    const frames = byId.get(id)?.frames || [];
    let low = 0, high = frames.length / STRIDE;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (frames[middle * STRIDE] <= time) low = middle + 1; else high = middle; }
    return low ? frames[(low - 1) * STRIDE + 9] : 0;
  }
  const events = scene.filter(row => row.event === "death").flatMap(row => {
    const time = Number(row.time_ms), victim = Number(row.target_session), attacker = Number(row.actor_session);
    const key = victim + ":" + time;
    if (seen.has(key)) return [];
    seen.add(key);
    const player = byId.get(attacker);
    const life = player?.lives.find(item => time >= item.startMs && time <= item.endMs);
    const attackerTeam = teamAt(attacker, time), victimTeam = teamAt(victim, time);
    const teamKill = attacker !== victim && attackerTeam > 0 && attackerTeam === victimTeam;
    if (life && attacker !== victim && attackerTeam > 0 && victimTeam > 0 && !teamKill) life.kills++;
    return [{ time, type: "death", victim, attacker, teamKill, weapon: known.get(key) || notices.get(row.object_id) || "" }];
  });
  if (!scene.length) {
    for (const player of players) for (const life of player.lives) if (life.endReason === "death") {
      events.push({ time: life.endMs, type: "death", victim: player.id, attacker: 0, weapon: "" });
    }
  }
  const definitions = parseCsv(await text("projectile_defs.csv"), "projectiles");
  const concs = createConcEndpointCollector(definitions, metadata.sampleIntervalMs);
  if (definitions.some(row => /conc/i.test(`${row.classname || ""} ${row.model || ""}`))) {
    await stream("projectiles.csv", input => numericRows(input, get => concs.consume({
      id: get("projectile_id"), time: get("time_ms"), state: get("state"), x: get("x"), y: get("y"), z: get("z")
    })));
  }
  events.push(...concs.events());
  const models = metadata.files.renderModels ? parseCsv(await text("render_models.csv"), "models") : [];
  const modelPaths = new Map(models.map(row => [Number(row.model_id), row.path]));
  const objectives = parseCsv(await text("objective_defs.csv"), "objectives");
  const flags = objectives.filter(row => /flag/i.test([row.classname, row.targetname,
    row.model || modelPaths.get(Number(row.model_id)) || ""].join(" "))).map((row, index) => ({
    id: Number(row.objective_id), name: `Flag ${index + 1}`, frames: []
  }));
  const flagsById = new Map(flags.map(flag => [flag.id, flag]));
  if (flags.length) await stream("objectives.csv", input => numericRows(input, get => {
    const flag = flagsById.get(get("objective_id"));
    if (!flag) return;
    const frame = ["time_ms", "x", "y", "z", "state", "carrier_session"].map(get);
    if (!frame.every(Number.isFinite)) return;
    const last = flag.frames.length - 6;
    if (last >= 0 && frame[0] < flag.frames[last]) return;
    if (last < 0 || frame[0] - flag.frames[last] >= 100 || frame[4] !== flag.frames[last + 4] || frame[5] !== flag.frames[last + 5]) flag.frames.push(...frame);
  }));
  events.sort((a, b) => a.time - b.time);
  return { version: VERSION, matchId: metadata.matchId, round: metadata.round, map: metadata.map,
    sha256: metadata.sha256, durationMs, sampleIntervalMs: Math.max(100, metadata.sampleIntervalMs), sourceSampleIntervalMs: metadata.sampleIntervalMs, stride: STRIDE,
    frameFields: ["time", "x", "y", "z", "yaw", "alive", "health", "armor", "class", "team"],
    players: players.filter(player => player.frames.length), events, flags,
    notes: ["Movement and health are sampled. Gaps and respawns are not interpolated.",
      "Conc rings mark recorded projectile removal endpoints, not verified detonations. Handheld concs without a projectile are not inferred."] };
}
module.exports = { VERSION, playbackPath, buildPlayback };
