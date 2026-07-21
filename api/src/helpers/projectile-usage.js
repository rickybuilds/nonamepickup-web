"use strict";

const PROJECTILE_USAGE_FIELDS = [
  "rocket_launcher_shots",
  "pipe_launcher_shots",
  "grenade_launcher_shots",
  "gren1_used",
  "gren2_used"
];

function projectileUsageField(frame) {
  const classname = String(frame?.classname || "").trim().toLowerCase();
  const model = String(frame?.model || "").trim().toLowerCase();
  const identity = `${classname} ${model}`;

  // MIRV bomblets are spawned by one MIRV use and must not be counted as
  // additional grenades.
  if (identity.includes("mirvbomblet") || identity.includes("bomblet")) return null;

  if (identity.includes("rpg_rocket") || identity.includes("rpgrocket")) {
    return "rocket_launcher_shots";
  }
  if (classname.includes("gl_pipebomb") || classname === "pipebomb") {
    return "pipe_launcher_shots";
  }
  if (classname.includes("gl_grenade")) {
    return "grenade_launcher_shots";
  }

  if (
    identity.includes("concussiongrenade") ||
    identity.includes("conc_grenade") ||
    identity.includes("nailgrenade") ||
    identity.includes("ngrenade") ||
    identity.includes("mirvgrenade") ||
    identity.includes("mirv_grenade") ||
    identity.includes("napalmgrenade") ||
    identity.includes("napalm.mdl") ||
    identity.includes("gasgrenade") ||
    identity.includes("empgrenade")
  ) {
    return "gren2_used";
  }

  if (
    identity.includes("normalgrenade") ||
    identity.includes("w_grenade") ||
    identity.includes("caltrop")
  ) {
    return "gren1_used";
  }

  return null;
}

function replayTimingWindow(frames, timeMs, finishZone) {
  if (!Array.isArray(frames) || !frames.length) return null;

  const fallbackStart = frames.find(frame => Number(frame?.t) >= 0) || frames[0];
  const fallback = {
    startTime: Number(fallbackStart?.t),
    endTime: Number(frames[frames.length - 1]?.t),
    source: "frame-zero"
  };
  const duration = Number(timeMs) / 1000;
  const finish = finishZone?.position;
  if (
    !Number.isFinite(fallback.startTime) ||
    !Number.isFinite(fallback.endTime) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !finish
  ) {
    return fallback;
  }

  const finishX = Number(finish.x);
  const finishY = Number(finish.y);
  if (!Number.isFinite(finishX) || !Number.isFinite(finishY)) return fallback;

  const firstTime = Number(frames[0]?.t);
  const lastTime = Number(frames[frames.length - 1]?.t);
  const radius = Math.max(1, Number(finishZone?.radius) || 64);
  const eligible = frames.filter(frame => {
    const time = Number(frame?.t);
    return Number.isFinite(time) && time - duration >= firstTime - 0.05;
  });
  if (!eligible.length) return fallback;

  const distanceSq = frame => {
    const dx = Number(frame?.x) - finishX;
    const dy = Number(frame?.y) - finishY;
    return dx * dx + dy * dy;
  };
  const firstInsideIndex = eligible.findIndex(frame => distanceSq(frame) <= radius * radius);
  let finishFrame = null;
  if (firstInsideIndex >= 0) {
    finishFrame = eligible[firstInsideIndex];
    for (let index = firstInsideIndex + 1; index < eligible.length; index += 1) {
      const frame = eligible[index];
      if (distanceSq(frame) > radius * radius) break;
      if (distanceSq(frame) < distanceSq(finishFrame)) finishFrame = frame;
    }
  } else {
    finishFrame = eligible.reduce((closest, frame) => (
      !closest || distanceSq(frame) < distanceSq(closest) ? frame : closest
    ), null);
  }

  const endTime = Number(finishFrame?.t);
  const startTime = endTime - duration;
  if (!Number.isFinite(startTime) || startTime < firstTime - 0.05 || endTime > lastTime + 0.05) {
    return fallback;
  }
  return { startTime, endTime, source: "official-time" };
}

function summarizeProjectileUsage(frames, timing = null) {
  const usage = Object.fromEntries(PROJECTILE_USAGE_FIELDS.map(field => [field, 0]));
  const projectiles = new Map();

  for (const frame of Array.isArray(frames) ? frames : []) {
    const projectileId = Number(frame?.projectileId);
    const state = Number(frame?.state);
    if (!Number.isFinite(projectileId)) continue;
    const field = projectileUsageField(frame);
    if (!field) continue;

    const time = Number(frame?.t);
    if (!Number.isFinite(time)) continue;
    const existing = projectiles.get(projectileId) || {
      field,
      firstActiveTime: null,
      firstRemovalTime: null
    };
    if (state === 0) {
      if (existing.firstRemovalTime == null || time < existing.firstRemovalTime) existing.firstRemovalTime = time;
    } else if (existing.firstActiveTime == null || time < existing.firstActiveTime) {
      existing.firstActiveTime = time;
    }
    projectiles.set(projectileId, existing);
  }

  for (const projectile of projectiles.values()) {
    const isGrenade = projectile.field === "gren1_used" || projectile.field === "gren2_used";
    const eventTime = isGrenade
      ? projectile.firstRemovalTime ?? projectile.firstActiveTime
      : projectile.firstActiveTime ?? projectile.firstRemovalTime;
    if (!Number.isFinite(eventTime)) continue;
    if (
      timing &&
      (eventTime < Number(timing.startTime) - 0.001 || eventTime > Number(timing.endTime) + 0.001)
    ) {
      continue;
    }
    usage[projectile.field] += 1;
  }

  return usage;
}

module.exports = {
  PROJECTILE_USAGE_FIELDS,
  projectileUsageField,
  replayTimingWindow,
  summarizeProjectileUsage
};
