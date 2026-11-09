"use strict";

const readline = require("node:readline");

// A position is only an estimate: use the last living sample before an explicit
// death and require that the objective timeline still identifies this carrier.
async function locateFlagDeaths(stream, deaths, carries, maxAgeMs) {
  const candidates = deaths.filter(d => Number.isSafeInteger(d.timeMs) && d.sessionId > 0).map(d => ({
    ...d, carry: carries.find(c => c.sessionId === d.sessionId && c.startMs <= d.timeMs && d.timeMs < c.endMs)
  })).filter(d => d.carry);
  const bySession = new Map();
  for (const death of candidates) {
    const rows = bySession.get(death.sessionId) || [];
    rows.push({ ...death, position: null });
    bySession.set(death.sessionId, rows);
  }
  if (!bySession.size) { stream.resume(); return []; }
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let indexes;
  for await (const line of lines) {
    if (!indexes) {
      const header = line.replace(/^\uFEFF/, "").replace(/\r$/, "").split(",");
      indexes = ["time_ms", "session_id", "alive", "x", "y", "z"].map(x => header.indexOf(x));
      if (indexes.includes(-1)) throw new Error("Invalid player timeline header");
      continue;
    }
    if (!line) continue;
    const fields = line.split(",");
    const [time, session, alive, x, y, z] = indexes.map(i => Number(fields[i]));
    if (alive !== 1 || ![time, session, x, y, z].every(Number.isFinite)) continue;
    for (const death of bySession.get(session) || []) {
      if (time >= death.carry.startMs && time <= death.timeMs && death.timeMs - time <= maxAgeMs &&
          (!death.position || time > death.position.timeMs)) death.position = { timeMs: time, x, y, z };
    }
  }
  return [...bySession.values()].flat().filter(death => death.position);
}

function flagObjectiveIds(definitions, models) {
  return new Set(definitions.filter(row => {
    const model = models.get(Number(row.model_id)) || row.model || "";
    return /flag/i.test([row.classname, row.targetname, model].join(" "));
  }).map(row => Number(row.objective_id)));
}
function confirmedDeathCandidates(scene, events, definitions, flagIds, age) {
  const entities = new Set(definitions.filter(row => flagIds.has(Number(row.objective_id))).map(row => Number(row.entity)));
  const seen = new Set();
  return scene.filter(row => row.event === "death").map(row => ({
    sessionId: Number(row.target_session), timeMs: Number(row.time_ms)
  })).filter(death => {
    const key = death.sessionId + ":" + death.timeMs;
    if (seen.has(key)) return false;
    seen.add(key);
    return !events.some(event => {
      const time = Number(event.time_ms);
      if (time > death.timeMs || death.timeMs - time > age) return false;
      const type = String(event.event).toLowerCase();
      const samePlayer = Number(event.actor_session) === death.sessionId;
      const sameFlag = entities.has(Number(event.entity));
      return (samePlayer && (/flag_release/.test(type) || (/capture|capped/.test(type) && /flag|goal|ctf/.test(type)))) ||
        (sameFlag && /flag_entity_(dropped|base)/.test(type));
    });
  });
}
module.exports = { locateFlagDeaths, flagObjectiveIds, confirmedDeathCandidates };
