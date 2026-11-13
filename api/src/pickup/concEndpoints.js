"use strict";

// Removal rows may contain a cleared entity origin. Effects belong at the last
// recent, active projectile sample, never at an invented owner/player position.
function createConcEndpointCollector(definitions, sampleIntervalMs = 100) {
  const owners = new Map(definitions.filter(row => /conc/i.test(`${row.classname || ""} ${row.model || ""}`))
    .map(row => [Number(row.projectile_id), Number(row.owner_session)]));
  const active = new Map(), endpoints = new Map();
  const maxGap = Math.max(250, Number(sampleIntervalMs) * 2 || 250);
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
      if (!previous || time < previous.time || time - previous.time > maxGap) return;
      endpoints.set(id, { time, type: "conc-endpoint", projectileId: id, owner: owners.get(id),
        x: previous.x, y: previous.y, z: previous.z, positionSource: "last-active-projectile" });
    },
    events: () => [...endpoints.values()]
  };
}

function concEndpointsFromTracks(definitions, track, sampleIntervalMs) {
  if (!Array.isArray(track?.fields) || !Number.isInteger(track.stride) || track.stride !== track.fields.length || !track.stride || !track.tracks) return null;
  const fields = ["time_ms", "state", "x", "y", "z"].map(field => track.fields.indexOf(field));
  if (fields.some(index => index < 0)) return null;
  const collector = createConcEndpointCollector(definitions, sampleIntervalMs);
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
