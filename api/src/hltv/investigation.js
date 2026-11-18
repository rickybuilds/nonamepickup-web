"use strict";
const crypto=require("crypto");
const {demoStatistics,statisticsPayload}=require("./playerStatistics");
const id=(observation,kind,index)=>crypto.createHash("sha256").update(`${observation.payload_sha256}:${kind}:${index}`).digest("hex").slice(0,32);
const steam=value=>/^STEAM_[0-5]:[01]:\d+$/.test(value||"");
const IDENTITY_UNAVAILABLE="identity_unavailable";
const assetFailures=new Set(["missing_map_asset","missing_or_invalid_player_model","no_server_player_models","missing_private_asset","asset_checksum_mismatch"]);
const failureReasons={missing_map_asset:"The scanner could not reconstruct required map geometry.",missing_private_asset:"A required private map or model asset is unavailable.",asset_checksum_mismatch:"A required asset failed checksum verification.",missing_or_invalid_player_model:"A required player model is missing or invalid.",no_server_player_models:"The recording did not provide usable player model references.",unsupported_upstream_scanner:"The pinned upstream revision does not provide a compatible scanner.",upstream_scanner_incomplete:"The upstream scanner did not finish with a valid result.",upstream_scanner_timeout:"The upstream scanner exceeded its bounded run time."};
function scannerState(registry,demoId,observation,payload,capability={}){
  const demo=registry.get(demoId);
  const latest=registry.db.prepare("SELECT id,status,error_code,diagnostic_json,created_at,started_at,finished_at,upstream_sha FROM hltv_upstream_runs WHERE demo_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(demoId);
  let diagnostic=null;try{diagnostic=latest?.diagnostic_json?JSON.parse(latest.diagnostic_json):null;}catch{}
  const findings=payload?.scanner?.version==="upstream-runAnalysis"&&Array.isArray(payload.scanner.findings)?payload.scanner.findings:null;
  const counts={wall_track:0,snap:0},players={};
  for(const f of findings||[]){const kind=f.kind==="track"?"wall_track":f.kind==="snap"?"snap":null;if(!kind)continue;counts[kind]++;if(steam(f.steam_id)){players[f.steam_id]||={wall_track:0,snap:0};players[f.steam_id][kind]++;}else{players[IDENTITY_UNAVAILABLE]||={wall_track:0,snap:0};players[IDENTITY_UNAVAILABLE][kind]++;}}
  let state="not_analyzed",reason="This recording has not completed the pinned wall-track and snap scanner.";
  if(latest?.status==="queued"){state="queued";reason="The existing bounded worker has this recording queued.";}
  else if(latest?.status==="processing"){state="running";reason="The existing bounded worker is processing this recording.";}
  else if(latest?.status==="failed"){
    state=assetFailures.has(latest.error_code)?"missing_assets":latest.error_code==="unsupported_upstream_scanner"?"unsupported":"failed";
    reason=failureReasons[latest.error_code]||"The latest upstream analysis failed ("+(latest.error_code||"unknown error")+").";
  }
  else if(findings&&(!latest||latest.id===observation?.run_id)){state="completed";reason="The pinned upstream scanner completed; findings are investigation leads, not verdicts.";}
  else if(capability.upstreamEnabled===false||capability.statisticsEnabled===false){state="unsupported";reason=capability.upstreamEnabled===false?"Upstream analysis is disabled on this server.":"HLTV statistics and scanner processing are disabled on this server.";}
  else if(payload?.scanner&&!findings){state="unsupported";reason="This stored payload uses an unsupported scanner version.";}
  else if(observation&&!payload?.scanner){state="legacy_firing_only";reason="This recording has firing statistics but no scanner result; request a new scanner pass to add wall-track and snap evidence.";}
  else if(latest?.status==="complete"){state="unsupported";reason="The completed run did not produce a scanner payload.";}
  const common={state,reason,latest_run_id:latest?.id||null,latest_run_status:latest?.status||null,error_code:latest?.error_code||null,diagnostic,
    started_at:latest?.started_at||null,finished_at:latest?.finished_at||null,source_observation_id:findings?observation.id:null,
    upstream_sha:observation?.upstream_sha||latest?.upstream_sha||null,config_hash:observation?.config_hash||null,
    settings:findings?payload.scanner.settings||null:null,previous_result:!!findings&&!!latest&&latest.id!==observation.run_id,
    can_run:capability.upstreamEnabled!==false&&capability.statisticsEnabled!==false&&demo.file_status==="available"&&!['queued','processing'].includes(latest?.status)};
  const scannerResult=(kind,title)=>({...common,count:counts[kind],reason:state==="completed"?(counts[kind]?`${title} completed with ${counts[kind]} candidate leads. Review each in context.`:`${title} completed with no candidate leads under the recorded scanner settings.`):reason});
  return {wall_track:scannerResult("wall_track","Wall-track"),snap:scannerResult("snap","Snap"),players};
}
function events(registry,demoId,capability={}){
  const observation=demoStatistics(registry,demoId);
  if(!observation)return {observation:null,players:[],events:[],status:"statistics_unavailable",scanner:scannerState(registry,demoId,null,null,capability)};
  const payload=statisticsPayload(registry,observation.id),players=new Map(),items=[];
  const scanner=scannerState(registry,demoId,observation,payload,capability);
  for(const group of observation.groups)players.set(group.steam_id,group.player_name||group.steam_id);
  for(const [index,f] of (payload.scanner?.findings||[]).entries()){
    const identity=steam(f.steam_id)?f.steam_id:IDENTITY_UNAVAILABLE;
    players.set(identity,steam(f.steam_id)?(f.player_name||f.steam_id):"Identity unavailable");
    items.push({id:id(observation,f.kind,index),category:f.kind==="track"?"wall_track":"snap",steam_id:steam(f.steam_id)?f.steam_id:null,player_name:steam(f.steam_id)?f.player_name:"Identity unavailable",identity_unavailable:!steam(f.steam_id),
      target_steam_id:f.target_steam_id,target_name:f.target_name,time_seconds:f.time_seconds,end_seconds:f.end_seconds,
      quality:"reconstructed_geometry",source:"ghosty_runAnalysis",source_event_ids:[`scanner.findings[${index}]`],details:f,
      limitations:f.kind==="track"?["Occlusion and aim alignment are reconstructed; sound, communication and prior knowledge are unknown."]:["Snapshot samples do not establish precise mouse movement or intent."]});
  }
  if(Number.isFinite(payload.source_start_seconds))for(const [index,shot] of payload.shots.entries()){
    if(!steam(shot.steam_id))continue;
    const time=shot.time_seconds-payload.source_start_seconds;
    if(!Number.isFinite(time)||time<0)continue;
    players.set(shot.steam_id,shot.name||shot.steam_id);
    items.push({id:id(observation,"firing",index),category:"firing",steam_id:shot.steam_id,player_name:shot.name,
      time_seconds:time,end_seconds:time,weapon:shot.weapon,quality:shot.evidence?.status?"associated_evidence":"recorded_event",
      source:"ghosty_firing",source_event_ids:[`shots[${index}]`],details:shot,limitations:["A firing event can represent multiple bullets or pellets; unmatched evidence is not a confirmed miss."]});
  }
  const run=registry.db.prepare("SELECT result_json FROM hltv_upstream_runs WHERE id=? AND status='complete'").get(observation.run_id);
  if(run?.result_json){
    const result=JSON.parse(run.result_json);
    for(const [index,w] of (result.windows||[]).entries()){
      if(!steam(w.player_steam_id)||!Number.isFinite(w.time_seconds))continue;
      players.set(w.player_steam_id,w.player_name||w.player_steam_id);
      items.push({id:id(observation,"concussion",index),category:"concussion",steam_id:w.player_steam_id,player_name:w.player_name,
        time_seconds:w.time_seconds,end_seconds:w.end_seconds,quality:"estimated_log_alignment",source:"verified_server_log",source_event_ids:w.log_line!=null?[`log_line:${w.log_line}`]:[],
        details:w,limitations:["Server log timing and estimated concussion duration do not establish the client's visual effect."]});
    }
  }
  items.sort((a,b)=>a.time_seconds-b.time_seconds||a.id.localeCompare(b.id));
  return {observation:{id:observation.id,demo_sha256:observation.demo_sha256,config_hash:observation.config_hash,upstream_sha:observation.upstream_sha},
    players:[...players].map(([steam_id,name])=>({steam_id,name})).sort((a,b)=>a.name.localeCompare(b.name)),events:items,scanner,
    status:payload.scanner?"ready":"scanner_unavailable_for_existing_analysis"};
}
function timeline(registry,demoId,steamId,query={},capability={}){
  if(!steam(steamId)&&steamId!==IDENTITY_UNAVAILABLE)throw new Error("invalid_player_identity");
  const data=events(registry,demoId,capability),allowed=new Set(["wall_track","snap","firing","concussion"]);
  const category=query.category||null,weapon=query.weapon||null,quality=query.quality||null,source=query.source||null;
  if(category&&!allowed.has(category))throw new Error("invalid_event_category");
  if(weapon&&!/^[a-z_]{1,40}$/.test(weapon))throw new Error("invalid_weapon_filter");
  if(quality&&!new Set(["reconstructed_geometry","associated_evidence","recorded_event","estimated_log_alignment"]).has(quality))throw new Error("invalid_quality_filter");
  if(source&&!new Set(["ghosty_runAnalysis","ghosty_firing","verified_server_log"]).has(source))throw new Error("invalid_source_filter");
  const start=query.start==null?0:Number(query.start),end=query.end==null?Number.MAX_SAFE_INTEGER:Number(query.end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start)throw new Error("invalid_time_range");
  const offset=Math.max(0,Math.min(10000,Math.trunc(Number(query.offset)||0))),limit=Math.max(1,Math.min(100,Math.trunc(Number(query.limit)||50)));
  const filtered=data.events.filter(e=>(steamId===IDENTITY_UNAVAILABLE?e.identity_unavailable:e.steam_id===steamId)&&(!category||e.category===category)&&(!weapon||e.weapon===weapon)&&(!quality||e.quality===quality)&&(!source||e.source===source)&&e.time_seconds>=start&&e.time_seconds<=end);
  return {status:data.status,scanner:data.scanner,observation:data.observation,total:filtered.length,offset,limit,events:filtered.slice(offset,offset+limit)};
}
function detail(registry,demoId,eventId){
  if(!/^[a-f0-9]{32}$/.test(eventId))throw new Error("invalid_event_id");
  const data=events(registry,demoId),event=data.events.find(e=>e.id===eventId);
  if(!event)throw new Error("event_not_found");
  return {observation:data.observation,event};
}
module.exports={events,timeline,detail};
