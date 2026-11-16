"use strict";
const path = require("path");
function config(env = process.env) {
  const number = (key, fallback) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid ${key}`);
    return n;
  };
  return { enabled: env.HLTV_REGISTRY_ENABLED === "true", root: env.HLTV_STORAGE_ROOT,
    database: env.HLTV_REGISTRY_DB, publicRoot: path.resolve(env.PUBLIC_DIR || path.join(__dirname, "../../..")),
    maxBytes: number("HLTV_MAX_DEMO_BYTES", 268435456), minFreeBytes: number("HLTV_MIN_DISK_FREE_BYTES", 10737418240),
    cleanupEnabled: env.HLTV_CLEANUP_ENABLED === "true", dryRun: env.HLTV_CLEANUP_DRY_RUN !== "false" };
}
module.exports = { config };
