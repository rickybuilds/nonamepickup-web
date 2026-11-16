"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
function ingestPending(registry) {
  const root = path.join(registry.storage.root, "incoming");
  if (!fs.existsSync(root)) return { registered: 0, failed: 0 };
  const summary = { registered: 0, failed: 0, deferred: 0 };
  for (const dir of fs.readdirSync(root, { withFileTypes: true }).slice(0, 10000)) {
    if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
    const key = `incoming/${dir.name}/ready.json`;
    let digest;
    try {
      const file = registry.storage.resolve(key, ".json");
      if (fs.statSync(file).size > 65536) throw new Error("Manifest too large");
      const bytes = fs.readFileSync(file);
      digest = crypto.createHash("sha256").update(key).update(bytes).digest("hex");
      const receipt = registry.db.prepare("SELECT * FROM hltv_manifests WHERE digest=?").get(digest);
      if (receipt?.status === "complete" || receipt?.attempts >= 12 || receipt?.next_attempt > Date.now()) { summary.deferred++; continue; }
      registry.ingest(JSON.parse(bytes));
      registry.db.prepare("INSERT INTO hltv_manifests(digest,storage_key,status) VALUES(?,?,'complete') ON CONFLICT(digest) DO UPDATE SET status='complete',error=NULL").run(digest, key);
      summary.registered++;
    } catch (error) {
      if (error.code === "ENOENT") continue; // Partial download has no completed manifest yet.
      summary.failed++;
      if (digest) registry.db.prepare(`INSERT INTO hltv_manifests(digest,storage_key,status,attempts,next_attempt,error) VALUES(?,?,'failed',1,?,?)
        ON CONFLICT(digest) DO UPDATE SET attempts=attempts+1,next_attempt=excluded.next_attempt,error=excluded.error`).run(digest, key, Date.now() + 300000, error.message);
      console.error("[HLTV ingestion] manifest deferred:", dir.name, error.code || error.name);
    }
  }
  return summary;
}
function capacityCheck(registry) {
  const summary = registry.summary();
  if (summary.low_disk) registry.db.prepare("INSERT OR IGNORE INTO hltv_alerts(id,kind,created_at) VALUES(?,'storage_low_disk',?)")
    .run(`storage-low-${new Date().toISOString().slice(0, 10)}`, Date.now());
  return summary;
}
module.exports = { ingestPending, capacityCheck };
