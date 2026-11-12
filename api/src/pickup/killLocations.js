"use strict";
const readline = require("node:readline");

// Scene death IDs connect the lethal event to its authoritative weapon notice.
// Only use a recent living sample, never a corpse or a later respawn position.
function weaponText(value) {
  const text = String(value || "").trim();
  return /[a-z]/i.test(text) && !/^(?:unknown|player|worldspawn)$/i.test(text) ? text : "";
}

function weaponNoticeText(value) {
  const text = String(value || '').trim();
  if (/^[1-9]\d?$/.test(text) && Number(text) <= 29) return `weapon-${Number(text)}`;
  return weaponText(text);
}

function weaponResolver(scene, events, entities) {
  const eventDeaths = new Map();
  for (const event of events) {
    if (event.event !== "death" || !weaponNoticeText(event.text)) continue;
    const key = Number(event.actor_session) + ":" + Number(event.target_session);
    if (!eventDeaths.has(key)) eventDeaths.set(key, []);
    eventDeaths.get(key).push({ ...event, weapon: weaponNoticeText(event.text) });
  }
  const removed = new Map(scene.filter(row => row.event === "entity_remove" && row.object_stream === "entity")
    .map(row => [Number(row.object_id), Number(row.time_ms)]));
  const byEdict = new Map();
  for (const entity of entities) {
    const edict = Number(entity.entity);
    if (!byEdict.has(edict)) byEdict.set(edict, []);
    byEdict.get(edict).push(entity);
  }
  return row => {
    const time = Number(row.time_ms);
    const matches = (eventDeaths.get(Number(row.actor_session) + ":" + Number(row.target_session)) || [])
      .filter(event => Math.abs(Number(event.time_ms) - time) <= 100);
    const names = new Set(matches.map(event => event.weapon).filter(Boolean));
    if (names.size === 1) return [...names][0];
    // death.text is an edict, NOT a weapon ID. Resolve only an unambiguous,
    // living entity generation owned by this attacker; never map edict 10
    // to weapon 10 or guess from the attacker's currently held weapon.
    if (!/^\d+$/.test(String(row.text || "").trim())) return "unknown";
    const candidates = (byEdict.get(Number(row.text)) || []).filter(entity =>
      Number(entity.spawned_ms) <= time && (removed.get(Number(entity.entity_id)) ?? Infinity) >= time &&
      Number(entity.owner_session) === Number(row.actor_session) && weaponText(entity.classname) &&
      /^(?:tf_|weapon_|building_|sentrygun$|dispenser$)/i.test(entity.classname));
    return candidates.length === 1 ? candidates[0].classname : "unknown";
  };
}

async function locateKills(stream, scene, maxAgeMs, { events = [], entities = [] } = {}) {
  const notices = new Map(scene.filter(row => row.event === "death_notice")
    .map(row => [Number(row.object_id), weaponNoticeText(row.text)]));
  const resolveWeapon = weaponResolver(scene, events, entities);
  const bySession = new Map();
  const seen = new Set();
  for (const row of scene) {
    if (row.event !== "death") continue;
    const sessionId = Number(row.target_session), attackerSession = Number(row.actor_session);
    const timeMs = Number(row.time_ms), key = sessionId + ":" + timeMs;
    if (!Number.isSafeInteger(timeMs) || timeMs < 0 || sessionId <= 0 || attackerSession <= 0 ||
        sessionId === attackerSession || seen.has(key)) continue;
    seen.add(key);
    const death = { sessionId, attackerSession, timeMs,
      weapon: notices.get(Number(row.object_id)) || resolveWeapon(row),
      position: null, attackerTeam: null, victimTeam: null };
    for (const session of [sessionId, attackerSession]) {
      if (!bySession.has(session)) bySession.set(session, []);
      bySession.get(session).push(death);
    }
  }
  if (!bySession.size) { stream.resume(); return []; }
  for (const deaths of bySession.values()) deaths.sort((a, b) => a.timeMs - b.timeMs);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let indexes;
  for await (const line of lines) {
    if (!indexes) {
      const header = line.replace(/^\uFEFF/, "").replace(/\r$/, "").split(",");
      indexes = ["time_ms", "session_id", "alive", "team", "x", "y", "z"].map(key => header.indexOf(key));
      if (indexes.includes(-1)) throw new Error("Invalid kill location timeline header");
      continue;
    }
    if (!line) continue;
    const fields = line.split(",");
    const [time, session, alive, team, x, y, z] = indexes.map(index => Number(fields[index]));
    if (![time, session, team, x, y, z].every(Number.isFinite)) continue;
    const candidates = bySession.get(session) || [];
    let low = 0, high = candidates.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (candidates[middle].timeMs < time) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < candidates.length && candidates[index].timeMs - time <= maxAgeMs; index++) {
      const death = candidates[index];
      if (session === death.attackerSession && (!death.attackerSample || time >= death.attackerSample)) {
        death.attackerTeam = team;
        death.attackerSample = time;
      }
      if (session === death.sessionId && alive === 1 && (!death.position || time >= death.position.timeMs)) {
        death.position = { timeMs: time, x, y, z };
        death.victimTeam = team;
      }
    }
  }
  return [...bySession.entries()].flatMap(([session, deaths]) => deaths.filter(death =>
    death.sessionId === session && death.position && [1, 2].includes(death.attackerTeam) &&
    [1, 2].includes(death.victimTeam) && death.attackerTeam !== death.victimTeam));
}

module.exports = { locateKills };
