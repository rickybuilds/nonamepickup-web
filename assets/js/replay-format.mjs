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

function firstParam(query, names) {
  for (const name of names) {
    const value = query.get(name);
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

export function replayApiPath(query) {
  const runId = firstParam(query, ["runId", "run_id", "run"]);
  if (runId) {
    if (!/^\d+$/.test(runId) || Number(runId) <= 0) throw new Error("Invalid replay runId.");
    return `/api/speedruns/replay/run/${encodeURIComponent(runId)}`;
  }

  const map = firstParam(query, ["map", "mapName", "m"]);
  const classId = firstParam(query, ["classId", "class", "class_id", "cls", "c"]);
  const steamid = firstParam(query, ["steamid", "steamId", "steam_id", "steam"]);
  if (!map || !classId || !steamid) {
    const missing = [!map ? "map" : "", !classId ? "classId" : "", !steamid ? "steamid" : ""]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Missing replay query params: ${missing}.`);
  }
  return `/api/speedruns/replay/${encodeURIComponent(map)}/${encodeURIComponent(classId)}/${encodeURIComponent(steamid)}`;
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

/**
 * Some recordings contain only a projectile's terminal state. Add one short,
 * velocity-based sample so the web replay can still show what detonated. Full
 * projectile tracks are returned untouched.
 */
export function expandEventOnlyProjectiles(frames, leadSeconds = 0.35) {
  if (!Array.isArray(frames)) return [];

  const idsWithFlightSamples = new Set(
    frames
      .filter(frame => Number(frame?.state) !== 0)
      .map(frame => Number(frame?.projectileId))
      .filter(Number.isFinite)
  );

  return frames.flatMap(frame => {
    const projectileId = Number(frame?.projectileId);
    const time = Number(frame?.t);
    if (Number(frame?.state) !== 0 || idsWithFlightSamples.has(projectileId) || !Number.isFinite(time)) {
      return [frame];
    }

    const lead = Math.min(Math.max(0, Number(leadSeconds) || 0), Math.max(0, time));
    const velocity = [frame?.vx, frame?.vy, frame?.vz].map(Number);
    const position = [frame?.x, frame?.y, frame?.z].map(Number);
    if (!lead || velocity.some(value => !Number.isFinite(value)) || position.some(value => !Number.isFinite(value))) {
      return [frame];
    }

    return [{
      ...frame,
      t: time - lead,
      state: 1,
      x: position[0] - (velocity[0] * lead),
      y: position[1] - (velocity[1] * lead),
      z: position[2] - (velocity[2] * lead),
      synthetic: true
    }, frame];
  });
}
