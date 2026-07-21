/**
 * @typedef {Object} ReplayFrame
 * @property {number} t
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} pitch
 * @property {number} yaw
 * @property {number} roll
 * @property {number} buttons
 * @property {string|null} viewmodel
 */

function optionalViewmodel(value) {
  if (value == null) return null;
  const viewmodel = String(value).trim();
  return !viewmodel || viewmodel === "-" ? null : viewmodel;
}

function frameColumns(frame) {
  if (typeof frame === "string") return frame.replace(/;\s*$/, "").split(",");
  if (Array.isArray(frame)) return frame;
  return null;
}

/** @returns {ReplayFrame|null} */
export function decodeReplayFrame(frame) {
  const cols = frameColumns(frame);
  const values = cols
    ? cols.slice(0, 8).map(value => Number(String(value).trim()))
    : [frame?.t, frame?.x, frame?.y, frame?.z, frame?.pitch, frame?.yaw, frame?.roll, frame?.buttons].map(Number);

  if (values.length < 8 || values.some(value => !Number.isFinite(value))) return null;

  return {
    t: values[0],
    x: values[1],
    y: values[2],
    z: values[3],
    pitch: values[4],
    yaw: values[5],
    roll: values[6],
    buttons: Math.trunc(values[7]),
    viewmodel: optionalViewmodel(cols ? cols[8] : frame?.viewmodel)
  };
}

/** @returns {ReplayFrame[]} */
export function decodeReplayFrames(frames) {
  if (typeof frames === "string") {
    return frames.split(";").map(part => part.trim()).filter(Boolean).map(decodeReplayFrame).filter(Boolean);
  }
  if (!Array.isArray(frames)) return [];
  return frames.map(decodeReplayFrame).filter(Boolean);
}

// Returns the earliest recorded event for each projectile. This intentionally
// includes terminal-only events, which newer grenade recordings can emit.
export function firstProjectileFrames(frames) {
  if (!Array.isArray(frames)) return [];
  const seen = new Set();
  return [...frames]
    .filter(frame => Number.isFinite(Number(frame?.t)) && Number.isFinite(Number(frame?.projectileId)))
    .sort((a, b) => (Number(a.t) - Number(b.t)) || (Number(a.projectileId) - Number(b.projectileId)) || (Number(b.state) - Number(a.state)))
    .filter(frame => {
      const projectileId = Number(frame.projectileId);
      if (seen.has(projectileId)) return false;
      seen.add(projectileId);
      return true;
    });
}
