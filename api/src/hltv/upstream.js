"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { spawn } = require("child_process");
const { Storage } = require("./storage");
const { activeRelease } = require("./upstreamRelease");
function upstreamConfig(env = process.env) {
  const memoryBytes = Number(env.HLTV_UPSTREAM_MEMORY_BYTES || 2147483648);
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes < 268435456 || memoryBytes > 4294967296) throw new Error("Invalid HLTV_UPSTREAM_MEMORY_BYTES");
  return { enabled: env.HLTV_UPSTREAM_ENABLED === "true", root: env.HLTV_UPSTREAM_ROOT || "/opt/noname-hltv-tools",
    python: env.HLTV_UPSTREAM_PYTHON || "python3", logsRoot: env.HLTV_PARSER_LOG_ROOT || "/var/lib/noname-parser", memoryBytes,
    statisticsEnabled: env.HLTV_STATISTICS_ENABLED === "true", statisticsAutoCollect:env.HLTV_STATISTICS_AUTO_COLLECT === "true",assetsRoot: env.HLTV_ASSETS_ROOT || "/srv/noname-hltv-assets",
    gapReviewEnabled:env.HLTV_AIM_GAP_REVIEW_ENABLED === "true",aimReview:require("./aimReviewPolicy").aimReviewConfig(env) };
}
function resolveBinary(bin) {
  const candidates = path.isAbsolute(bin) ? [bin] : (process.env.PATH || "").split(path.delimiter).map(dir => path.join(dir, bin));
  for (const candidate of candidates) { try { fs.accessSync(candidate, fs.constants.X_OK); return fs.realpathSync(candidate); } catch {} }
  throw new Error("upstream_executable_unavailable");
}
function sandboxCommand(bin, args, directory, memoryBytes = 2147483648) {
  if (process.platform !== "linux") throw new Error("upstream_worker_requires_linux_systemd");
  return { bin: "systemd-run", args: ["--quiet", "--pipe", "--wait", "--collect", "--service-type=exec",
    "--uid=" + process.getuid(), "--property=MemoryMax=" + memoryBytes, "--property=MemorySwapMax=0",
    "--property=RuntimeMaxSec=180", "--property=TimeoutStopSec=5", "--property=TasksMax=16", "--property=CPUQuota=100%",
    "--property=NoNewPrivileges=yes", "--property=PrivateNetwork=yes", "--property=PrivateTmp=yes",
    "--property=ProtectSystem=strict", "--property=ReadWritePaths=" + directory,
    "--", resolveBinary(bin), ...args] };
}
function cleanupScratch(registry, runId) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error("Invalid scratch identity");
  const cache = path.join(registry.storage.root, "cache"), directory = path.join(cache, "ghosty-" + runId);
  if (!fs.existsSync(directory)) return;
  if (fs.realpathSync(cache) !== cache || fs.realpathSync(directory) !== directory || fs.lstatSync(directory).isSymbolicLink()) throw new Error("Unsafe scratch directory");
  const allowed = new Set(["meta.json.gz", "data.bin.gz", "matched-log.json", "assets.bin", "statistics.json"]);
  for (const name of fs.readdirSync(directory)) {
    if (!allowed.has(name)) continue;
    const target = path.join(directory, name), stat = fs.lstatSync(target);
    if (stat.isFile() && !stat.isSymbolicLink()) fs.unlinkSync(target);
  }
  if (!fs.readdirSync(directory).length) fs.rmdirSync(directory);
}
function reapScratch(registry) {
  const cache = path.join(registry.storage.root, "cache");
  if (!fs.existsSync(cache)) return;
  if (fs.realpathSync(cache) !== cache) throw new Error("Unsafe cache directory");
  for (const entry of fs.readdirSync(cache, { withFileTypes: true })) {
    const match = /^ghosty-([a-f0-9-]{36})$/.exec(entry.name);
    if (!match || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const row = registry.db.prepare("SELECT status FROM hltv_upstream_runs WHERE id=?").get(match[1]);
    if (row && ["complete", "failed"].includes(row.status)) cleanupScratch(registry, match[1]);
  }
}
function queueRun(registry, demoId, actor) {
  return registry.db.transaction(() => {
    const demo = registry.get(demoId);
    if (!["available", "deleting"].includes(demo.file_status)) throw new Error("Demo unavailable");
    registry.storage.resolve(demo.storage_key);
    const existing = registry.db.prepare("SELECT id,status FROM hltv_upstream_runs WHERE demo_id=? AND status IN ('queued','processing')").get(demoId);
    if (existing) return existing;
    if (demo.file_status === "deleting") registry.db.prepare("UPDATE hltv_demos SET file_status='available' WHERE id=?").run(demoId);
    const id = crypto.randomUUID(), hold = registry.hold(demoId, "Ghosty upstream analysis " + id, actor);
    registry.db.prepare("INSERT INTO hltv_upstream_runs(id,demo_id,hold_id,status,requested_by,created_at) VALUES(?,?,?,'queued',?,?)").run(id, demoId, hold, actor, Date.now());
    registry.audit(demoId, actor, "upstream_queued", { run_id: id });
    return { id, status: "queued" };
  }).immediate();
}
function child(bin, args, input, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const processEnv = { PATH: process.env.PATH || "", SYSTEMROOT: process.env.SYSTEMROOT || "", LANG: "C.UTF-8" };
    const worker = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: processEnv });
    let stdout = [], size = 0, error = "", failed = false;
    const timer = setTimeout(() => { failed = true; worker.kill("SIGKILL"); }, timeout);
    worker.stdout.on("data", bytes => { size += bytes.length; if (size > 2 * 1024 * 1024) { failed = true; worker.kill("SIGKILL"); } else stdout.push(bytes); });
    worker.stderr.on("data", bytes => { error = (error + bytes.toString()).slice(-2000); });
    worker.on("error", error => { clearTimeout(timer); reject(error); });
    worker.stdin.on("error", () => {});
    worker.on("close", code => {
      clearTimeout(timer);
      if (failed || code !== 0) return reject(new Error(failed ? "upstream_resource_limit" : "upstream_process_failed: " + (error || Buffer.concat(stdout).toString("utf8").slice(0, 1000))));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString("utf8"))); } catch { reject(new Error("invalid_upstream_output")); }
    });
    worker.stdin.end(input ? JSON.stringify(input) : "");
  });
}
async function runPending(registry, options) {
  if (options.runId != null && !/^[a-f0-9-]{36}$/.test(options.runId)) throw new Error("Invalid upstream run ID");
  if (!options.enabled) return { enabled: false, processed: 0 };
  // Startup recovery never treats interrupted work as a successful result.
  registry.db.transaction(() => {
    registry.db.prepare("UPDATE hltv_upstream_runs SET status='failed',finished_at=?,error_code='worker_interrupted' WHERE status='processing' AND COALESCE((SELECT touched_at FROM hltv_upstream_heartbeats h WHERE h.run_id=hltv_upstream_runs.id),started_at)<?")
      .run(Date.now(), Date.now() - 600000);
  }).immediate();
  reapScratch(registry);
  const {queueAutomaticStatistics,releaseStatisticsLeases}=require("./statisticsQueue");
  releaseStatisticsLeases(registry);
  if (!options.runId) queueAutomaticStatistics(registry,options);
  const run = registry.db.transaction(() => {
    if (registry.db.prepare("SELECT 1 FROM hltv_upstream_runs WHERE status='processing'").get()) return null;
    const run = registry.db.prepare("SELECT * FROM hltv_upstream_runs WHERE status='queued' AND (?=1 OR requested_by<>'statistics-scheduler') AND (? IS NULL OR id=?) ORDER BY created_at,id LIMIT 1").get(Number(options.statisticsEnabled===true), options.runId || null, options.runId || null);
    if (run) registry.db.prepare("UPDATE hltv_upstream_runs SET status='processing',started_at=? WHERE id=?").run(Date.now(), run.id);
    return run;
  }).immediate();
  if (!run) return { enabled: true, processed: 0, ...(options.runId ? {run_id:options.runId,reason:"requested_run_not_queued_or_worker_busy"} : {}) };
  const touch=()=>registry.db.prepare("INSERT INTO hltv_upstream_heartbeats(run_id,touched_at) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET touched_at=excluded.touched_at").run(run.id,Date.now());
  touch();
  const heartbeat=setInterval(()=>{try{touch();}catch(error){console.error("[HLTV upstream] heartbeat deferred:",error.code||error.name);}},60000);
  heartbeat.unref();
  let directory;
  try {
    if (registry.storage.freeBytes() < registry.minFreeBytes) throw new Error("insufficient_storage_headroom");
    if (process.platform === "linux") {
      const available = Number(/^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync("/proc/meminfo", "utf8"))?.[1]) * 1024;
      if (!Number.isFinite(available) || available < (options.memoryBytes || 2147483648) + 268435456) throw new Error("insufficient_memory_headroom");
    }
    const release = activeRelease(options.root), demo = registry.get(run.demo_id);
    if (demo.file_status !== "available") throw new Error("demo_unavailable");
    const source = registry.storage.verify(demo);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(demo.match_id)) throw new Error("invalid_match_identity");
    const logs = new Storage(options.logsRoot, { readonly: true });
    const logDir = path.join(logs.root, demo.match_id);
    const logManifest = logs.resolve(demo.match_id + "/manifest.json", ".json");
    const logResult = logs.resolve(demo.match_id + "/result.json", ".json");
    if (fs.statSync(logManifest).size > 65536) throw new Error("invalid_parser_log_manifest");
    const logNames = JSON.parse(fs.readFileSync(logManifest, "utf8")).logs;
    if (!Array.isArray(logNames) || logNames.length < 1 || logNames.length > 2 || !logNames.every((name, i) => name === `round-${i + 1}.log`)) throw new Error("invalid_parser_log_manifest");
    for (const name of logNames) logs.resolve(demo.match_id + "/" + name, ".log");
    const cache = path.join(registry.storage.root, "cache");
    fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(cache) !== cache) throw new Error("unsafe_cache_root");
    directory = path.join(cache, "ghosty-" + run.id); fs.mkdirSync(directory, { mode: 0o700 });
    registry.db.prepare("UPDATE hltv_upstream_runs SET upstream_sha=? WHERE id=?").run(release.sha, run.id);
    const pythonCommand = sandboxCommand(options.python, ["-I", path.join(__dirname, "upstream_bridge.py")], directory, options.memoryBytes);
    const matched = await child(pythonCommand.bin, pythonCommand.args, {
      upstream_root: release.root, demo_path: source.path, demo_sha256: demo.sha256,
      max_demo_bytes: registry.storage.maxBytes, match_id: demo.match_id, map: demo.map,
      log_dir: logDir, log_manifest: logManifest, log_result: logResult, output_dir: directory,
      memory_bytes: options.memoryBytes || 2147483648,
    });
    if (matched.status !== "matched") {
      const error = new Error(matched.status === "ambiguous" ? "ambiguous_log_pairing" : "no_verified_log_pairing");
      error.diagnostics = { upstream_sha: release.sha, candidates: matched.candidates, accepted_rounds: matched.accepted_rounds };
      throw error;
    }
    const heapMiB = Math.floor((options.memoryBytes || 2147483648) / 2097152);
    const nodeCommand = sandboxCommand(process.execPath, ["--max-old-space-size=" + heapMiB, path.join(__dirname, "upstream_conc.js"), release.root, directory], directory, options.memoryBytes);
    const estimate = await child(nodeCommand.bin, nodeCommand.args);
    let statistics;
    if(options.statisticsEnabled){
      const assets=new Storage(options.assetsRoot,{readonly:true,publicRoot:path.resolve(__dirname,"../../..")});
      const conversion=sandboxCommand(options.python,["-I",path.join(__dirname,"upstream_assets.py")],directory,options.memoryBytes);
      await child(conversion.bin,conversion.args,{upstream_root:release.root,assets_root:assets.root,output_dir:directory});
      const comparison=sandboxCommand(process.execPath,["--max-old-space-size="+heapMiB,path.join(__dirname,"upstream_statistics.js"),release.root,directory],directory,options.memoryBytes);
      await child(comparison.bin,comparison.args);
      const resultFile=path.join(directory,"statistics.json");
      if(fs.statSync(resultFile).size>16777216)throw new Error("statistics_result_too_large");
      statistics=JSON.parse(fs.readFileSync(resultFile,"utf8"));
    }
    const result = { ...estimate, upstream_sha: release.sha, source: "ghostile/goldsrc-hltv-tools", pairing: matched,
      demo_sha256: demo.sha256, match_id: demo.match_id, demo_id: demo.id, anomaly_detection: "not_implemented", viewer: "not_integrated" };
    const serialized = JSON.stringify(result);
    if (serialized.length > 2 * 1024 * 1024) throw new Error("result_too_large");
    registry.storage.verify(demo);
    registry.db.transaction(() => {
      const committed = registry.db.prepare("UPDATE hltv_upstream_runs SET status='complete',finished_at=?,result_json=?,error_code=NULL WHERE id=? AND status='processing'").run(Date.now(), serialized, run.id);
      if (committed.changes !== 1) throw new Error("upstream_run_lease_lost");
      if(statistics){
        const stored=require("./playerStatistics").storeStatistics(registry,{id:run.id,demo,upstream_sha:release.sha,pairing:matched},statistics);
        require("./concWindows").recordWindowCounts(registry,stored.id,statistics,estimate.windows);
        require("./gapReview").evaluateGapReview(registry,{...stored,demo_id:demo.id,upstream_sha:release.sha,log_round:matched.log_round,
          groups:statistics.groups.map(group=>({...group,player_name:group.name}))},{...options.aimReview,enabled:options.gapReviewEnabled||options.aimReview?.alertsEnabled});
      }
      // This is an explicit reviewer request. Preserve originals until the
      // reviewer has inspected the result and deliberately releases the hold.
      registry.audit(demo.id, "upstream-worker", "upstream_complete", { run_id: run.id, upstream_sha: release.sha, log_round: matched.log_round, log_sha256: matched.log_sha256 });
    }).immediate();
    return { enabled: true, processed: 1, status: "complete", run_id: run.id };
  } catch (error) {
    console.error("[HLTV upstream]", run.id, error.message);
    const known=["ambiguous_log_pairing","no_verified_log_pairing","insufficient_storage_headroom","missing_map_asset","missing_or_invalid_player_model","no_server_player_models","missing_private_asset","asset_checksum_mismatch","unsupported_upstream_scanner","upstream_scanner_incomplete","upstream_scanner_timeout","too_many_scanner_findings","statistics_input_too_large","upstream_resource_limit"];
    const code=known.find(value=>error.message===value||error.message.includes("upstream_process_failed: "+value))||"upstream_failed";
    registry.db.prepare("UPDATE hltv_upstream_runs SET status='failed',finished_at=?,error_code=?,result_json=? WHERE id=?").run(Date.now(), code, error.diagnostics ? JSON.stringify(error.diagnostics) : null, run.id);
    registry.audit(run.demo_id, "upstream-worker", "upstream_failed", { run_id: run.id, error_code: code });
    // Failure keeps the explicit hold for an administrator to inspect/release.
    return { enabled: true, processed: 1, status: "failed", run_id: run.id, error_code: code };
  } finally {
    clearInterval(heartbeat);
    releaseStatisticsLeases(registry);
    if (directory) {
      try { cleanupScratch(registry, run.id); } catch (error) { console.error("[HLTV upstream] scratch cleanup deferred:", error.message); }
    }
  }
}
module.exports = { upstreamConfig, queueRun, runPending, child, reapScratch, sandboxCommand };
