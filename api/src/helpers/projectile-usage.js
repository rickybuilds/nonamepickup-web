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

function summarizeProjectileUsage(frames) {
  const usage = Object.fromEntries(PROJECTILE_USAGE_FIELDS.map(field => [field, 0]));
  const projectiles = new Map();

  for (const frame of Array.isArray(frames) ? frames : []) {
    const projectileId = Number(frame?.projectileId);
    const state = Number(frame?.state);
    if (!Number.isFinite(projectileId)) continue;
    const field = projectileUsageField(frame);
    if (!field) continue;

    const existing = projectiles.get(projectileId) || { field, hasActiveFrame: false };
    existing.hasActiveFrame ||= state !== 0;
    projectiles.set(projectileId, existing);
  }

  const activeByField = Object.fromEntries(PROJECTILE_USAGE_FIELDS.map(field => [field, 0]));
  const removalOnlyByField = Object.fromEntries(PROJECTILE_USAGE_FIELDS.map(field => [field, 0]));
  for (const projectile of projectiles.values()) {
    const bucket = projectile.hasActiveFrame ? activeByField : removalOnlyByField;
    bucket[projectile.field] += 1;
  }

  // Replay formats differ by recorder version. New captures contain continuous
  // active frames; older captures may contain only one removal/detonation event.
  // Prefer active tracks when present for a type, otherwise use the event-only
  // representation so legitimate older runs are not undercounted.
  for (const field of PROJECTILE_USAGE_FIELDS) {
    usage[field] = activeByField[field] || removalOnlyByField[field];
  }

  return usage;
}

module.exports = {
  PROJECTILE_USAGE_FIELDS,
  projectileUsageField,
  summarizeProjectileUsage
};
