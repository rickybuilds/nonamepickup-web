"use strict";
const crypto=require("crypto");
const {demoStatistics,statisticsPayload}=require("./playerStatistics");
const id=(observation,kind,index)=>crypto.createHash("sha256").update(`${observation.payload_sha256}:${kind}:${index}`).digest("hex").slice(0,32);
const steam=value=>/^STEAM_[0-5]:[01]:\d+$/.test(value||"");
function events(registry,demoId){
  const observation=demoStatistics(registry,demoId);
  if(!observation)return {observation:null,players:[],events:[],status:"statistics_unavailable"};
  const payload=statisticsPayload(registry,observation.id),players=new Map(),items=[];
  for(const group of observation.groups)players.set(group.steam_id,group.player_name||group.steam_id);
  for(const [index,f] of (payload.scanner?.findings||[]).entries()){
    if(!steam(f.steam_id))continue;
    players.set(f.steam_id,f.player_name||f.steam_id);
    items.push({id:id(observation,f.kind,index),category:f.kind==="track"?"wall_track":"snap",steam_id:f.steam_id,player_name:f.player_name,
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
    players:[...players].map(([steam_id,name])=>({steam_id,name})).sort((a,b)=>a.name.localeCompare(b.name)),events:items,
    status:payload.scanner?"ready":"scanner_unavailable_for_existing_analysis"};
}
function timeline(registry,demoId,steamId,query={}){
  if(!steam(steamId))throw new Error("invalid_player_identity");
  const data=events(registry,demoId),allowed=new Set(["wall_track","snap","firing","concussion"]);
  const category=query.category||null,weapon=query.weapon||null,quality=query.quality||null,source=query.source||null;
  if(category&&!allowed.has(category))throw new Error("invalid_event_category");
  if(weapon&&!/^[a-z_]{1,40}$/.test(weapon))throw new Error("invalid_weapon_filter");
  if(quality&&!new Set(["reconstructed_geometry","associated_evidence","recorded_event","estimated_log_alignment"]).has(quality))throw new Error("invalid_quality_filter");
  if(source&&!new Set(["ghosty_runAnalysis","ghosty_firing","verified_server_log"]).has(source))throw new Error("invalid_source_filter");
  const start=query.start==null?0:Number(query.start),end=query.end==null?Number.MAX_SAFE_INTEGER:Number(query.end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start)throw new Error("invalid_time_range");
  const offset=Math.max(0,Math.min(10000,Math.trunc(Number(query.offset)||0))),limit=Math.max(1,Math.min(100,Math.trunc(Number(query.limit)||50)));
  const filtered=data.events.filter(e=>e.steam_id===steamId&&(!category||e.category===category)&&(!weapon||e.weapon===weapon)&&(!quality||e.quality===quality)&&(!source||e.source===source)&&e.time_seconds>=start&&e.time_seconds<=end);
  return {status:data.status,observation:data.observation,total:filtered.length,offset,limit,events:filtered.slice(offset,offset+limit)};
}
function detail(registry,demoId,eventId){
  if(!/^[a-f0-9]{32}$/.test(eventId))throw new Error("invalid_event_id");
  const data=events(registry,demoId),event=data.events.find(e=>e.id===eventId);
  if(!event)throw new Error("event_not_found");
  return {observation:data.observation,event};
}
module.exports={events,timeline,detail};
