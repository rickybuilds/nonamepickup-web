"use strict";
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env"), quiet: true });
const fs = require("fs");
const { config } = require("../src/hltv/config");
const { Registry } = require("../src/hltv/registry");
const { ingestPending, capacityCheck } = require("../src/hltv/worker");
const { upstreamConfig, runPending } = require("../src/hltv/upstream");
async function main() {
const cfg = config();
if (!cfg.enabled) { console.log("HLTV registry disabled; no work performed"); return; }
const registry = new Registry(cfg);
try {
  const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
  const manifest = arg("--manifest");
  const runId = arg("--run");
  if (process.argv.includes("--run") && (!runId || !/^[a-f0-9-]{36}$/.test(runId) || manifest)) throw new Error("Usage: hltv-worker.js --run RUN_UUID (cannot combine with --manifest)");
  if (runId) {
    // Targeted verification does not ingest other matches or run global cleanup.
    console.log(JSON.stringify({upstream:await runPending(registry,{...upstreamConfig(),runId})}));
    return;
  }
  if (manifest) {
    const input = JSON.parse(fs.readFileSync(manifest, "utf8"));
    // Local-only backfill: input references already-owned files, never fetches bytes.
    if (process.argv.includes("--apply")) console.log(JSON.stringify(registry.ingest(input).map(d => ({ id: d.id, match_id: d.match_id }))));
    else {
      for (const demo of input.demos) registry.storage.inspect(demo.storage_key);
      console.log(JSON.stringify({ dry_run: true, demos: input.demos.length, match_id: input.match_id }));
    }
  } else {
    const ingestion = ingestPending(registry), upstream = await runPending(registry, upstreamConfig());
    console.log(JSON.stringify({ ingestion, upstream, storage: capacityCheck(registry),
      cleanup: registry.cleanup({ enabled: cfg.cleanupEnabled, dryRun: cfg.dryRun }) }));
  }
} finally { registry.close(); }
}
main().catch(error => { console.error("[HLTV worker]", error.message); process.exitCode = 1; });
