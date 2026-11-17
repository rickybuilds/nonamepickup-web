"use strict";
// Count original upstream windows containing eligible strict-hit-evidence firing; never estimate new windows.
const groupKey=row=>JSON.stringify([row.steam_id,row.class_id,row.weapon]);
function countConcWindows(statistics,windows){
  const result=new Map(),byPlayer=new Map();
  for(const [index,window] of windows.entries()){
    if(!Number.isFinite(window.time_seconds)||!Number.isFinite(window.end_seconds))continue;
    const key=JSON.stringify([window.player_steam_id,window.class_id]);
    if(!byPlayer.has(key))byPlayer.set(key,[]);byPlayer.get(key).push({...window,index});
  }
  for(const entries of byPlayer.values())entries.sort((a,b)=>a.time_seconds-b.time_seconds);
  for(const group of statistics.groups.filter(row=>row.state==="conc"))result.set(groupKey(group),{expected:group.evidence_eligible,seen:0,windows:new Set(),unknown:false});
  for(const shot of statistics.shots){
    if(shot.state!=="conc"||shot.visibility!=="visible"||shot.evidence?.includedInPercentage!==true)continue;
    const row=result.get(groupKey(shot));if(!row)continue;row.seen++;
    const entries=byPlayer.get(JSON.stringify([shot.steam_id,shot.class_id]))||[];
    let low=0,high=entries.length;
    while(low<high){const middle=(low+high)>>1;if(entries[middle].time_seconds<=shot.time_seconds)low=middle+1;else high=middle;}
    const window=entries[low-1];
    if(!window||shot.time_seconds>=window.end_seconds||!Number.isFinite(shot.time_seconds))row.unknown=true;
    else row.windows.add(window.index);
  }
  return new Map([...result].map(([key,row])=>[key,row.unknown||row.seen!==row.expected?null:row.windows.size]));
}
function recordWindowCounts(registry,observationId,statistics,windows){
  const observation=registry.db.prepare("SELECT payload_sha256,run_id FROM hltv_statistics_observations WHERE id=?").get(observationId);
  if(!observation)throw new Error("statistics_observation_missing");
  const counts=countConcWindows(statistics,windows);
  registry.db.transaction(()=>{
    registry.db.prepare("DELETE FROM hltv_statistics_window_counts WHERE observation_id=?").run(observationId);
    const insert=registry.db.prepare("INSERT INTO hltv_statistics_window_counts(observation_id,steam_id,class_id,weapon,window_count) VALUES(?,?,?,?,?)");
    for(const [key,count] of counts)insert.run(observationId,...JSON.parse(key),count);
    registry.db.prepare("INSERT INTO hltv_statistics_window_provenance(observation_id,payload_sha256,run_id,method,created_at) VALUES(?,?,?,'strict-hit-evidence-v1',?) ON CONFLICT(observation_id) DO UPDATE SET payload_sha256=excluded.payload_sha256,run_id=excluded.run_id,method=excluded.method,created_at=excluded.created_at")
      .run(observationId,observation.payload_sha256,observation.run_id,Date.now());
  }).immediate();
}
function ensureWindowCounts(registry,observation){
  const provenance=registry.db.prepare("SELECT payload_sha256,run_id,method FROM hltv_statistics_window_provenance WHERE observation_id=?").get(observation.id);
  if(provenance?.payload_sha256===observation.payload_sha256&&provenance.run_id===observation.run_id&&provenance.method==="strict-hit-evidence-v1")return true;
  const run=registry.db.prepare("SELECT status,result_json FROM hltv_upstream_runs WHERE id=?").get(observation.run_id);
  if(!run||run.status!=="complete"||!run.result_json)return false;
  const estimate=JSON.parse(run.result_json);
  if(estimate.demo_sha256!==observation.demo_sha256||estimate.pairing?.log_sha256!==observation.log_sha256||estimate.upstream_sha!==observation.upstream_sha||!Array.isArray(estimate.windows))return false;
  recordWindowCounts(registry,observation.id,require("./playerStatistics").statisticsPayload(registry,observation.id),estimate.windows);
  return true;
}
module.exports={countConcWindows,recordWindowCounts,ensureWindowCounts};
