"use strict";
const fs=require("fs");
function releaseStatisticsLeases(registry){
  // Only automatic processing leases end automatically; human evidence holds are never released here.
  registry.db.prepare(`UPDATE hltv_holds SET released_at=?,released_by='statistics-worker',release_reason='Automatic statistics processing finished; normal retention applies'
    WHERE released_at IS NULL AND id IN (SELECT r.hold_id FROM hltv_statistics_jobs j JOIN hltv_upstream_runs r ON r.id=j.run_id
    WHERE r.status IN ('complete','failed') AND r.requested_by='statistics-scheduler')`).run(Date.now());
}
function demoSkipReason(registry, demo) {
  try {
    const fd = fs.openSync(registry.storage.resolve(demo.storage_key), "r");
    try {
      const header = Buffer.alloc(544), stat = fs.fstatSync(fd);
      if (fs.readSync(fd, header, 0, 544, 0) !== 544 || header.subarray(0, 6).toString() !== "HLDEMO") return "invalid_demo_header";
      const offset = header.readInt32LE(540), count = Buffer.alloc(4);
      if (offset < 544 || offset + 4 > stat.size || fs.readSync(fd, count, 0, 4, offset) !== 4) return "unfinalized_demo";
      const entries = count.readInt32LE(0);
      if (entries < 1 || entries > 1024 || offset + 4 + entries * 92 > stat.size) return "unfinalized_demo";
    } finally { fs.closeSync(fd); }
  } catch { return "unavailable_source"; }
  return null;
}
function queueAutomaticStatistics(registry,options){
  if(!options.enabled||!options.statisticsEnabled||!options.statisticsAutoCollect)return null;
  const {queueRun, resolveParserLogs}=require("./upstream");
  return registry.db.transaction(()=>{
    const candidates=registry.db.prepare(`SELECT d.* FROM hltv_demos d WHERE d.file_status='available'
      AND NOT EXISTS(SELECT 1 FROM hltv_source_recoveries c WHERE c.original_demo_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM hltv_statistics_jobs j WHERE j.demo_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM hltv_statistics_observations o WHERE o.demo_sha256=d.sha256)
      AND NOT EXISTS(SELECT 1 FROM hltv_upstream_runs r WHERE r.demo_id=d.id AND r.status IN ('queued','processing'))
      ORDER BY d.recorded_at DESC,d.id`).iterate();
    let demo, reason;
    for (const candidate of candidates) {
      reason = demoSkipReason(registry, candidate);
      if (!reason) {
        try { resolveParserLogs(options.logsRoot, candidate.match_id); }
        catch (error) {
          // Missing inputs can arrive on a later worker pass. The worker still reports invalid inputs.
          if (error.code === "ENOENT") continue;
        }
      }
      demo = candidate;
      break;
    }
    if(!demo)return null;
    if(reason){registry.db.prepare("INSERT INTO hltv_statistics_jobs(demo_id,created_at,skip_reason) VALUES(?,?,?)").run(demo.id,Date.now(),reason);return {skipped:demo.id,reason};}
    const run=queueRun(registry,demo.id,"statistics-scheduler");
    registry.db.prepare("INSERT INTO hltv_statistics_jobs(demo_id,run_id,created_at) VALUES(?,?,?)").run(demo.id,run.id,Date.now());
    return run;
  }).immediate();
}
module.exports={queueAutomaticStatistics,releaseStatisticsLeases};
