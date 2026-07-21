"use strict";

function normalizeFrameChunk(value) {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function joinReplayChunks(chunks) {
  return (chunks || []).map(normalizeFrameChunk).join("");
}

function optionalViewmodel(value) {
  if (value == null) return null;
  const viewmodel = String(value).trim();
  return !viewmodel || viewmodel === "-" ? null : viewmodel;
}

function parseReplayFrames(serialized) {
  return String(serialized || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const cols = part.split(",");
      if (cols.length < 8) return null;

      // Only the original movement columns are numeric. Newer recordings append
      // a weapon viewmodel path in column nine, and future columns are ignored.
      const movement = cols.slice(0, 8).map(value => Number(value.trim()));
      if (movement.some(value => !Number.isFinite(value))) return null;

      return {
        t: movement[0],
        x: movement[1],
        y: movement[2],
        z: movement[3],
        pitch: movement[4],
        yaw: movement[5],
        roll: movement[6],
        buttons: Math.trunc(movement[7]),
        viewmodel: optionalViewmodel(cols[8])
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

module.exports = {
  joinReplayChunks,
  normalizeFrameChunk,
  optionalViewmodel,
  parseReplayFrames
};
