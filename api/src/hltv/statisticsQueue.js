"use strict";
const fs=require("fs");
function releaseStatisticsLeases(registry){
  // Only automatic processing leases end automatically; human evidence holds are never released here.
  registry.db.prepare(`UPDATE hltv_holds SET released_at=?,released_by='statistics-worker',release_reason='Automatic statistics processing finished; normal retention applies'
    WHERE released_at IS NULL AND id IN (SELECT r.hold_id FROM hltv_statistics_jobs j JOIN hltv_upstream_runs r ON r.id=j.run_id
    WHERE r.status IN ('complete','failed') AND r.requested_by='statistics-scheduler')`).run(Date.now());
}
function queueAutomaticStatistics(registry,options){
  if(!options.enabled||!options.statisticsEnabled||!options.statisticsAutoCollect)return null;
  return registry.db.transaction(()=>{
    const demo=registry.db.prepare(`SELECT d.* FROM hltv_demos d WHERE d.file_status='available'
      AND NOT EXISTS(SELECT 1 FROM hltv_statistics_jobs j WHERE j.demo_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM hltv_statistics_observations o WHERE o.demo_sha256=d.sha256)
      AND NOT EXISTS(SELECT 1 FROM hltv_upstream_runs r WHERE r.demo_id=d.id AND r.status IN ('queued','processing'))
      ORDER BY d.recorded_at DESC,d.id LIMIT 1`).get();
    if(!demo)return null;
    let reason;
    try{
      const filename=registry.storage.resolve(demo.storage_key),fd=fs.openSync(filename,"r");
      try{
        const header=Buffer.alloc(544),stat=fs.fstatSync(fd);
        if(fs.readSync(fd,header,0,544,0)!==544||header.subarray(0,6).toString()!=="HLDEMO")reason="invalid_demo_header";
        else{
          const offset=header.readInt32LE(540),count=Buffer.alloc(4);
          if(offset<544||offset+4>stat.size||fs.readSync(fd,count,0,4,offset)!==4)reason="unfinalized_demo";
          else{const n=count.readInt32LE(0);if(n<1||n>1024||offset+4+n*92>stat.size)reason="unfinalized_demo";}
        }
      }finally{fs.closeSync(fd);}
    }catch{reason="unavailable_source";}
    if(reason){registry.db.prepare("INSERT INTO hltv_statistics_jobs(demo_id,created_at,skip_reason) VALUES(?,?,?)").run(demo.id,Date.now(),reason);return {skipped:demo.id,reason};}
    const run=require("./upstream").queueRun(registry,demo.id,"statistics-scheduler");
    registry.db.prepare("INSERT INTO hltv_statistics_jobs(demo_id,run_id,created_at) VALUES(?,?,?)").run(demo.id,run.id,Date.now());
    return run;
  }).immediate();
}
module.exports={queueAutomaticStatistics,releaseStatisticsLeases};
