"use strict";
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env"), quiet: true });
const { config } = require("../src/hltv/config");
const { Registry } = require("../src/hltv/registry");
const { upstreamConfig, queueRun } = require("../src/hltv/upstream");
try {
  if (!config().enabled || !upstreamConfig().enabled) throw new Error("Enable HLTV_REGISTRY_ENABLED and HLTV_UPSTREAM_ENABLED after installing upstream");
  if (process.argv.length !== 4 || process.argv[2] !== "--match" || !/^[A-Za-z0-9_-]{1,80}$/.test(process.argv[3])) throw new Error("Usage: node scripts/analyzeHltvDemo.js --match MATCH_ID");
  const registry = new Registry(config());
  try {
    const demos = registry.db.prepare("SELECT id,server FROM hltv_demos d WHERE match_id=? AND file_status='available' AND NOT EXISTS(SELECT 1 FROM hltv_source_recoveries c WHERE c.original_demo_id=d.id)").all(process.argv[3]);
    if (!demos.length) throw new Error("No available registered demos for this match");
    console.log(JSON.stringify({ match_id: process.argv[3], queued: demos.map(d => ({ demo_id: d.id, server: d.server, ...queueRun(registry, d.id, "local-admin") })),
      next: "Run hltv-worker.js or wait for its five-minute cron. Original files are held for review." }));
  } finally { registry.close(); }
} catch (error) { console.error("[HLTV upstream queue]", error.message); process.exitCode = 1; }
