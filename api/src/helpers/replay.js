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

// Projectile frames: time,id,state,owner,classname,model,x,y,z,pitch,yaw,roll,vx,vy,vz;
function parseProjectileFrames(serialized) {
  return String(serialized || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const cols = part.split(",");
      if (cols.length < 15) return null;

      const time = Number(cols[0]?.trim());
      const projectileId = Number(cols[1]?.trim());
      const state = Number(cols[2]?.trim());
      const owner = Number(cols[3]?.trim());
      const classname = String(cols[4] || "").trim();
      const model = String(cols[5] || "").trim();
      const x = Number(cols[6]?.trim());
      const y = Number(cols[7]?.trim());
      const z = Number(cols[8]?.trim());
      const pitch = Number(cols[9]?.trim());
      const yaw = Number(cols[10]?.trim());
      const roll = Number(cols[11]?.trim());
      const vx = Number(cols[12]?.trim());
      const vy = Number(cols[13]?.trim());
      const vz = Number(cols[14]?.trim());

      if (
        !Number.isFinite(time) ||
        !Number.isFinite(projectileId) ||
        !Number.isFinite(state) ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z)
      ) {
        return null;
      }

      return {
        t: time,
        projectileId: Math.trunc(projectileId),
        state: Math.trunc(state),
        owner: Number.isFinite(owner) ? Math.trunc(owner) : null,
        classname,
        model,
        x,
        y,
        z,
        pitch: Number.isFinite(pitch) ? pitch : 0,
        yaw: Number.isFinite(yaw) ? yaw : 0,
        roll: Number.isFinite(roll) ? roll : 0,
        vx: Number.isFinite(vx) ? vx : 0,
        vy: Number.isFinite(vy) ? vy : 0,
        vz: Number.isFinite(vz) ? vz : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.t - b.t) || (a.projectileId - b.projectileId) || (b.state - a.state));
}

function inferFrameInterval(frames) {
  if (!Array.isArray(frames) || frames.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < frames.length; i += 1) {
    const delta = frames[i].t - frames[i - 1].t;
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  if (!deltas.length) return null;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

module.exports = {
  joinReplayChunks,
  normalizeFrameChunk,
  optionalViewmodel,
  parseReplayFrames,
  parseProjectileFrames,
  inferFrameInterval
};
