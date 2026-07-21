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
  const countedProjectileIds = new Set();

  for (const frame of Array.isArray(frames) ? frames : []) {
    const projectileId = Number(frame?.projectileId);
    const state = Number(frame?.state);
    if (!Number.isFinite(projectileId) || state === 0 || countedProjectileIds.has(projectileId)) continue;

    countedProjectileIds.add(projectileId);
    const field = projectileUsageField(frame);
    if (field) usage[field] += 1;
  }

  return usage;
}

module.exports = {
  PROJECTILE_USAGE_FIELDS,
  projectileUsageField,
  summarizeProjectileUsage
};
