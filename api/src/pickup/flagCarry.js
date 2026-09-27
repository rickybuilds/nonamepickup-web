"use strict";

const readline = require("node:readline");

const TFC_UNITS_PER_METER = 76;

function createFlagCarryAccumulator() {
  const objectives = new Map();
  const carries = [];

  function closeCarry(objectiveId, objective, endMs) {
    if (!objective.carrier) return;
    objective.carryNumber += 1;
    carries.push({
      objectiveId,
      carryNumber: objective.carryNumber,
      sessionId: objective.carrier,
      startMs: objective.start,
      endMs: Math.max(objective.start, endMs),
      distanceUnits: 0
    });
  }

  return {
    add(row) {
      const objectiveId = Number(row.objective_id);
      const time = Number(row.time_ms);
      const carrier = Number(row.carrier_session) || 0;
      if (!Number.isSafeInteger(objectiveId) || !Number.isSafeInteger(time) ||
          !Number.isSafeInteger(carrier) || time < 0 || carrier < 0) {
        throw new Error("Invalid objective carry row");
      }
      const previous = objectives.get(objectiveId);
      if (previous && previous.carrier !== carrier) closeCarry(objectiveId, previous, time);
      objectives.set(objectiveId, {
        carrier,
        start: previous && previous.carrier === carrier ? previous.start : time,
        last: time,
        carryNumber: previous?.carryNumber || 0
      });
    },
    finish() {
      for (const [objectiveId, objective] of objectives) {
        closeCarry(objectiveId, objective, objective.last);
      }
      return carries.sort((a, b) => a.startMs - b.startMs || a.objectiveId - b.objectiveId);
    }
  };
}

function segmentPoint(previous, current, time) {
  const span = current.time - previous.time;
  const mix = span > 0 ? Math.min(1, Math.max(0, (time - previous.time) / span)) : 0;
  return [0, 1, 2].map(index =>
    previous.position[index] + (current.position[index] - previous.position[index]) * mix
  );
}

async function measureCarryDistances(stream, carries) {
  const bySession = new Map();
  for (const carry of carries) {
    const list = bySession.get(carry.sessionId) || [];
    list.push(carry);
    bySession.set(carry.sessionId, list);
  }
  for (const list of bySession.values()) list.sort((a, b) => a.startMs - b.startMs);
  const states = new Map();
  const seenSessions = new Set();
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let indexes = null;
  try {
    for await (const line of lines) {
      if (!header) {
        header = line.replace(/\r$/, "").split(",");
        indexes = ["time_ms", "session_id", "x", "y", "z"].map(name => header.indexOf(name));
        if (indexes.includes(-1)) throw new Error("Invalid players.csv header");
        continue;
      }
      if (!line) continue;
      const fields = line.replace(/\r$/, "").split(",");
      const sessionId = Number(fields[indexes[1]]);
      const sessionCarries = bySession.get(sessionId);
      if (!sessionCarries) continue;
      const current = {
        time: Number(fields[indexes[0]]),
        position: [Number(fields[indexes[2]]), Number(fields[indexes[3]]), Number(fields[indexes[4]])]
      };
      if (!Number.isFinite(current.time) || current.position.some(value => !Number.isFinite(value))) {
        throw new Error("Invalid player position");
      }
      seenSessions.add(sessionId);
      const state = states.get(sessionId) || {
        firstTime: current.time, previous: null, nextCarry: 0, active: []
      };
      const previous = state.previous;
      if (previous) {
        while (state.nextCarry < sessionCarries.length &&
               sessionCarries[state.nextCarry].startMs <= current.time) {
          state.active.push(sessionCarries[state.nextCarry]);
          state.nextCarry += 1;
        }
        state.active = state.active.filter(carry => {
          if (carry.startMs >= state.firstTime && carry.endMs > previous.time) {
            const from = Math.max(carry.startMs, previous.time);
            const to = Math.min(carry.endMs, current.time);
            if (to > from) {
              const start = segmentPoint(previous, current, from);
              const end = segmentPoint(previous, current, to);
              carry.distanceUnits += Math.hypot(
                end[0] - start[0], end[1] - start[1], end[2] - start[2]
              );
            }
          }
          return carry.endMs > current.time;
        });
      }
      state.previous = current;
      states.set(sessionId, state);
    }
  } finally {
    lines.close();
  }
  if (!header) throw new Error("Empty players.csv");
  return seenSessions;
}

function summarizeFlagCarries(carries) {
  const summaries = new Map();
  for (const carry of carries) {
    const summary = summaries.get(carry.sessionId) || { milliseconds: 0, carries: 0, distanceUnits: 0 };
    summary.milliseconds += carry.endMs - carry.startMs;
    summary.carries += 1;
    summary.distanceUnits += carry.distanceUnits;
    summaries.set(carry.sessionId, summary);
  }
  return summaries;
}

function recordedFlagCarries(carries, seenSessions) {
  const carryNumbers = new Map();
  return carries.filter(carry => seenSessions.has(carry.sessionId)).map(carry => {
    const next = (carryNumbers.get(carry.objectiveId) || 0) + 1;
    carryNumbers.set(carry.objectiveId, next);
    return { ...carry, carryNumber: next };
  });
}

module.exports = {
  TFC_UNITS_PER_METER,
  createFlagCarryAccumulator,
  measureCarryDistances,
  recordedFlagCarries,
  summarizeFlagCarries
};
