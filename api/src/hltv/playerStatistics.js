"use strict";
const crypto=require("crypto");
const zlib=require("zlib");
const hash=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha=value=>/^[a-f0-9]{64}$/.test(value||"");
const steam=value=>/^STEAM_[0-5]:[01]:\d+$/.test(value||"");
const counters=["recorded","eligible","no_enemy","unavailable","uncertain","geometry_hit","aim_near","strict","inclusive","evidence_eligible"];
function storeStatistics(registry,source,result){
  if(result.version!==1||result.metric!=="ghosty-firing-v1"||!Array.isArray(result.groups)||result.groups.length>2000||!Array.isArray(result.shots)||result.shots.length>10000||!Array.isArray(result.assets)||result.assets.length>136||!Number.isSafeInteger(result.unassigned)||result.unassigned<0)throw new Error("invalid_statistics_contract");
  const {demo,pairing}=source;
  if(!sha(demo.sha256)||!sha(pairing.log_sha256)||![1,2].includes(pairing.log_round)||!/^[a-f0-9]{40}$/.test(source.upstream_sha||""))throw new Error("invalid_statistics_source");
  const settings=result.settings;
  if(settings?.margin!==.1||settings.aspect!==4/3||settings.lag_compensation!==true||!Number.isFinite(settings.uncertainty)||settings.uncertainty<0||settings.uncertainty>10)throw new Error("unsupported_statistics_settings");
  const identities=new Set();
  for(const row of result.groups){
    const identity=JSON.stringify([row.steam_id,row.class_id,row.weapon,row.state]);
    if(identities.has(identity)||!steam(row.steam_id)||!Number.isInteger(row.class_id)||row.class_id<1||row.class_id>10||!(/^[a-z_]{1,40}$/).test(row.weapon||"")||!["conc","outside","uncertain"].includes(row.state)||typeof row.name!=="string"||row.name.length>255)throw new Error("invalid_statistics_identity");
    identities.add(identity);
    if(counters.some(key=>!Number.isSafeInteger(row[key])||row[key]<0||row[key]>10000)||row.recorded!==row.eligible+row.no_enemy+row.unavailable+row.uncertain||row.geometry_hit>row.eligible||row.aim_near>row.eligible||row.strict>row.inclusive||row.inclusive>row.evidence_eligible||row.evidence_eligible>row.eligible)throw new Error("invalid_statistics_counts");
    if(row.state==="uncertain"&&row.uncertain!==row.recorded)throw new Error("invalid_uncertain_statistics");
  }
  const assets=result.assets.map(asset=>{if(typeof asset.route!=="string"||asset.route.length>300||asset.missing||!sha(asset.sha256))throw new Error("incomplete_statistics_assets");return [asset.route,asset.sha256];}).sort((a,b)=>a[0].localeCompare(b[0]));
  if(result.scanner){
    if(result.scanner.version!=="upstream-runAnalysis"||result.scanner.time_coordinate!=="demo_relative_seconds"||!Array.isArray(result.scanner.findings)||result.scanner.findings.length>2000)throw new Error("invalid_scanner_contract");
    for(const f of result.scanner.findings)if(!["track","snap"].includes(f.kind)||!Number.isFinite(f.time_seconds)||!Number.isFinite(f.end_seconds)||f.time_seconds<0||f.end_seconds<f.time_seconds||f.steam_id!=null&&!steam(f.steam_id)||f.target_steam_id!=null&&!steam(f.target_steam_id))throw new Error("invalid_scanner_finding");
  }
  const configHash=hash({adapter:"ghosty-firing-v1",scanner:result.scanner?.version||null,upstream:source.upstream_sha,settings,assets});
  const inputKey=hash([demo.sha256,pairing.log_sha256]),serialized=JSON.stringify(result);
  const payloadHash=crypto.createHash("sha256").update(serialized).digest("hex");
  if(Buffer.byteLength(serialized)>16777216)throw new Error("statistics_result_too_large");
  return registry.db.transaction(()=>{
    const immutable=registry.db.prepare("SELECT payload_sha256 FROM hltv_statistics_results WHERE run_id=?").get(source.id);
    if(immutable&&immutable.payload_sha256!==payloadHash)throw new Error("immutable_statistics_run");
    const previous=registry.db.prepare("SELECT id FROM hltv_statistics_observations WHERE input_key=? AND config_hash=?").get(inputKey,configHash);
    const id=previous?.id||crypto.randomUUID();
    registry.db.prepare("INSERT OR IGNORE INTO hltv_statistics_payloads(sha256,result_gzip) VALUES(?,?)").run(payloadHash,zlib.gzipSync(serialized,{level:1}));
    registry.db.prepare(`INSERT INTO hltv_statistics_observations(id,input_key,config_hash,demo_id,run_id,match_id,server,map,recorded_at,created_at,upstream_sha,demo_sha256,log_sha256,log_round,payload_sha256)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(input_key,config_hash) DO UPDATE SET run_id=excluded.run_id,created_at=excluded.created_at,payload_sha256=excluded.payload_sha256`)
      .run(id,inputKey,configHash,demo.id,source.id,demo.match_id,demo.server,demo.map,demo.recorded_at,Date.now(),source.upstream_sha,demo.sha256,pairing.log_sha256,pairing.log_round,payloadHash);
    registry.db.prepare("INSERT OR IGNORE INTO hltv_statistics_results(run_id,observation_id,payload_sha256,created_at) VALUES(?,?,?,?)").run(source.id,id,payloadHash,Date.now());
    registry.db.prepare("DELETE FROM hltv_player_statistics WHERE observation_id=?").run(id);
    const insert=registry.db.prepare(`INSERT INTO hltv_player_statistics(observation_id,steam_id,player_name,class_id,weapon,state,complete,${counters.join(",")}) VALUES(${Array(17).fill("?").join(",")})`);
    for(const row of result.groups)insert.run(id,row.steam_id,row.name,row.class_id,row.weapon,row.state,Number(row.unavailable===0&&result.unassigned===0&&row.state!=="uncertain"),...counters.map(key=>row[key]));
    registry.audit(demo.id,"statistics-worker","statistics_stored",{run_id:source.id,observation_id:id,payload_sha256:payloadHash,config_hash:configHash});
    return {id,input_key:inputKey,config_hash:configHash};
  }).immediate();
}
function playerHistory(registry,{steamId,configHash,weapon,classId,map,before,days,excludeInputKey}){
  if(!steam(steamId)||!sha(configHash)||!Number.isSafeInteger(Number(before))||Number(before)<1||!sha(excludeInputKey)&&excludeInputKey!=="none")throw new Error("invalid_history_filter");
  if(days!=null&&Number(days)!==30)throw new Error("unsupported_history_window");
  const lower=days==null?0:Number(before)-30*86400000;
  const groups=registry.db.prepare(`SELECT s.class_id,s.weapon,s.state,o.map,COUNT(DISTINCT o.input_key) AS rounds,COUNT(DISTINCT o.server||':'||o.match_id) AS matches,
    MIN(o.recorded_at) AS first_recorded_at,MAX(o.recorded_at) AS last_recorded_at,${counters.map(key=>`SUM(s.${key}) AS ${key}`).join(",")}
    FROM hltv_player_statistics s JOIN hltv_statistics_observations o ON o.id=s.observation_id
    WHERE s.steam_id=? AND o.config_hash=? AND o.recorded_at<? AND o.recorded_at>=? AND o.input_key<>? AND s.complete=1
    AND (? IS NULL OR s.weapon=?) AND (? IS NULL OR s.class_id=?) AND (? IS NULL OR o.map=?)
    GROUP BY s.class_id,s.weapon,s.state,o.map ORDER BY o.map,s.class_id,s.weapon,s.state LIMIT 500`)
    .all(steamId,configHash,Number(before),lower,excludeInputKey,weapon||null,weapon||null,classId||null,classId||null,map||null,map||null);
  for(const row of groups){row.geometry_percent=row.eligible?100*row.geometry_hit/row.eligible:null;row.aim_near_percent=row.eligible?100*row.aim_near/row.eligible:null;row.strict_percent=row.evidence_eligible?100*row.strict/row.evidence_eligible:null;row.inclusive_percent=row.evidence_eligible?100*row.inclusive/row.evidence_eligible:null;}
  return {steam_id:steamId,config_hash:configHash,before:Number(before),days:days==null?null:30,groups,kind:"descriptive_personal_history"};
}
function demoStatistics(registry,demoId){
  registry.get(demoId);
  const observation=registry.db.prepare("SELECT id,input_key,config_hash,demo_id,match_id,server,map,recorded_at,created_at,upstream_sha,log_round,demo_sha256,log_sha256,run_id,payload_sha256 FROM hltv_statistics_observations WHERE demo_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(demoId);
  return observation?{...observation,groups:registry.db.prepare(`SELECT s.*,CASE WHEN s.state='conc' AND p.payload_sha256=? AND p.run_id=? THEN w.window_count ELSE NULL END AS conc_windows
    FROM hltv_player_statistics s LEFT JOIN hltv_statistics_window_counts w ON w.observation_id=s.observation_id AND w.steam_id=s.steam_id AND w.class_id=s.class_id AND w.weapon=s.weapon
    LEFT JOIN hltv_statistics_window_provenance p ON p.observation_id=s.observation_id WHERE s.observation_id=? ORDER BY s.steam_id,s.class_id,s.weapon,s.state`).all(observation.payload_sha256,observation.run_id,observation.id)}:null;
}
function statisticsPayload(registry,observationId){
  const row=registry.db.prepare("SELECT p.result_gzip FROM hltv_statistics_observations o JOIN hltv_statistics_payloads p ON p.sha256=o.payload_sha256 WHERE o.id=?").get(observationId);
  if(!row)throw new Error("statistics_not_found");
  return JSON.parse(zlib.gunzipSync(row.result_gzip,{maxOutputLength:16777216}));
}
module.exports={storeStatistics,playerHistory,demoStatistics,statisticsPayload};
