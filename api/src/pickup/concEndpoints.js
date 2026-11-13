"use strict";

// Removal rows may contain a cleared entity origin. Prefer a recent active
// projectile sample; otherwise retain an explicit owner-position estimate.
function createConcEndpointCollector(definitions, sampleIntervalMs = 100, players = []) {
  const owners = new Map(definitions.filter(row => /conc/i.test(`${row.classname || ""} ${row.model || ""}`))
    .map(row => [Number(row.projectile_id), Number(row.owner_session)]));
  const active = new Map(), endpoints = new Map();
  const byId = new Map(players.map(player => [player.id, player]));
  const maxGap = Math.max(250, Number(sampleIntervalMs) * 2 || 250);
  function ownerPosition(owner, time) {
    const frames = byId.get(owner)?.frames;
    if (!Array.isArray(frames)) return null;
    let low = 0, high = Math.floor(frames.length / 10);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (frames[middle * 10] <= time) low = middle + 1;
      else high = middle;
    }
    if (!low) return null;
    const index = (low - 1) * 10;
    const [x, y, z] = frames.slice(index + 1, index + 4);
    if (time - frames[index] > maxGap || frames[index + 5] !== 1 ||
        ![x, y, z].every(Number.isFinite) || x === 0 && y === 0 && z === 0) return null;
    return { x, y, z };
  }
  return {
    consume({ id, time, state, x, y, z }) {
      if (!owners.has(id) || !Number.isFinite(time) || time < 0) return;
      if (state === 1) {
        if ([x, y, z].every(Number.isFinite) && (x !== 0 || y !== 0 || z !== 0)) active.set(id, { time, x, y, z });
        return;
      }
      if (state !== 0 || endpoints.has(id)) return;
      const previous = active.get(id);
      active.delete(id);
      const recorded = previous && time >= previous.time && time - previous.time <= maxGap;
      const point = recorded ? previous : ownerPosition(owners.get(id), time);
      if (!point) return;
      endpoints.set(id, { time, type: "conc-endpoint", projectileId: id, owner: owners.get(id),
        x: point.x, y: point.y, z: point.z, positionSource: recorded ? "last-active-projectile" : "owner-sample" });
    },
    events: () => [...endpoints.values()]
  };
}

function concEndpointsFromTracks(definitions, track, sampleIntervalMs, players) {
  if (!Array.isArray(track?.fields) || !Number.isInteger(track.stride) || track.stride !== track.fields.length || !track.stride || !track.tracks) return null;
  const fields = ["time_ms", "state", "x", "y", "z"].map(field => track.fields.indexOf(field));
  if (fields.some(index => index < 0)) return null;
  const collector = createConcEndpointCollector(definitions, sampleIntervalMs, players);
  for (const [id, frames] of Object.entries(track.tracks)) {
    if (!Array.isArray(frames) || frames.length % track.stride) return null;
    for (let offset = 0; offset < frames.length; offset += track.stride) {
      const [time, state, x, y, z] = fields.map(index => frames[offset + index]);
      collector.consume({ id: Number(id), time, state, x, y, z });
    }
  }
  return collector.events();
}

module.exports = { createConcEndpointCollector, concEndpointsFromTracks };
