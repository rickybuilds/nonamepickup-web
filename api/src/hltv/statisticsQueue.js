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
    const candidates=registry.db.prepare(`SELECT d.*, j.demo_id AS previous_job,
      CASE WHEN r.error_code='no_verified_log_pairing' THEN json_extract(r.result_json,'$.log_count') END AS previous_log_count
      FROM hltv_demos d LEFT JOIN hltv_statistics_jobs j ON j.demo_id=d.id
      LEFT JOIN hltv_upstream_runs r ON r.id=j.run_id WHERE d.file_status='available'
      AND NOT EXISTS(SELECT 1 FROM hltv_source_recoveries c WHERE c.original_demo_id=d.id)
      AND (j.demo_id IS NULL OR (r.error_code='no_verified_log_pairing' AND json_extract(r.result_json,'$.log_count')=1))
      AND NOT EXISTS(SELECT 1 FROM hltv_statistics_observations o WHERE o.demo_sha256=d.sha256)
      AND NOT EXISTS(SELECT 1 FROM hltv_upstream_runs r WHERE r.demo_id=d.id AND r.status IN ('queued','processing'))
      ORDER BY d.recorded_at DESC,d.id`).iterate();
    let demo, reason;
    for (const candidate of candidates) {
      reason = demoSkipReason(registry, candidate);
      if (!reason || candidate.previous_job) {
        try {
          const {logCount}=resolveParserLogs(options.logsRoot, candidate.match_id);
          if (candidate.previous_job && logCount <= candidate.previous_log_count) continue;
        }
        catch (error) {
          // Missing inputs can arrive on a later worker pass. The worker still reports invalid inputs.
          if (error.code === "ENOENT" || candidate.previous_job) continue;
        }
      }
      demo = candidate;
      break;
    }
    if(!demo)return null;
    if(reason){registry.db.prepare(`INSERT INTO hltv_statistics_jobs(demo_id,created_at,skip_reason) VALUES(?,?,?)
      ON CONFLICT(demo_id) DO UPDATE SET run_id=NULL,created_at=excluded.created_at,skip_reason=excluded.skip_reason`).run(demo.id,Date.now(),reason);return {skipped:demo.id,reason};}
    const run=queueRun(registry,demo.id,"statistics-scheduler");
    registry.db.prepare(`INSERT INTO hltv_statistics_jobs(demo_id,run_id,created_at) VALUES(?,?,?)
      ON CONFLICT(demo_id) DO UPDATE SET run_id=excluded.run_id,created_at=excluded.created_at,skip_reason=NULL`).run(demo.id,run.id,Date.now());
    return run;
  }).immediate();
}
module.exports={queueAutomaticStatistics,releaseStatisticsLeases};
