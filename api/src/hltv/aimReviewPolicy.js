"use strict";
const {ensureWindowCounts}=require("./concWindows");
const HITSCAN=new Set(["ac","shotgun","super_shotgun","sniper","auto_rifle"]);
const DEFAULTS=Object.freeze({alertsEnabled:false,minConcWindows:20,highConcPercent:100,repeatGames:2,repeatWindow:3,baselineGames:25,baselineRisePoints:20});
function policyOptions(options={}){
  const result={...DEFAULTS,...options};
  for(const [key,min,max] of [["minConcWindows",1,5000],["repeatGames",2,20],["repeatWindow",2,20],["baselineGames",1,5000]])if(!Number.isSafeInteger(result[key])||result[key]<min||result[key]>max)throw new Error("invalid_aim_policy_"+key);
  for(const key of ["highConcPercent","baselineRisePoints"])if(!Number.isFinite(result[key])||result[key]<=0||result[key]>100)throw new Error("invalid_aim_policy_"+key);
  if(result.repeatGames>result.repeatWindow)throw new Error("invalid_aim_repeat_window");
  return result;
}
function aimReviewConfig(env=process.env){
  return policyOptions({alertsEnabled:env.HLTV_HIT_EVIDENCE_ALERTS_ENABLED==="true",minConcWindows:Number(env.HLTV_HIT_ALERT_MIN_CONC_WINDOWS||20),highConcPercent:Number(env.HLTV_HIT_HIGH_CONC_PERCENT||100),repeatGames:Number(env.HLTV_HIT_REPEAT_GAMES||2),repeatWindow:Number(env.HLTV_HIT_REPEAT_WINDOW||3),baselineGames:Number(env.HLTV_HIT_BASELINE_GAMES||25),baselineRisePoints:Number(env.HLTV_HIT_BASELINE_RISE_POINTS||20)});
}
function closeGap(conc,outside){return !!conc&&!!outside&&conc.eligible>0&&outside.eligible>0&&Math.abs(conc.aim_near*outside.eligible-outside.aim_near*conc.eligible)*100<10*conc.eligible*outside.eligible;}
function closeEvidenceGap(conc,outside){return !!conc&&!!outside&&conc.evidence_eligible>0&&outside.evidence_eligible>0&&Math.abs(conc.strict*outside.evidence_eligible-outside.strict*conc.evidence_eligible)*100<10*conc.evidence_eligible*outside.evidence_eligible;}
function historyRows(registry,current,group){
  return registry.db.prepare(`SELECT o.*,c.strict AS hits,c.evidence_eligible AS eligible,c.complete,x.strict AS outside_hits,x.evidence_eligible AS outside_eligible,x.complete AS outside_complete
    FROM hltv_statistics_observations o JOIN hltv_player_statistics c ON c.observation_id=o.id AND c.state='conc'
    LEFT JOIN hltv_player_statistics x ON x.observation_id=o.id AND x.steam_id=c.steam_id AND x.class_id=c.class_id AND x.weapon=c.weapon AND x.state='outside'
    WHERE c.steam_id=? AND c.class_id=? AND c.weapon=? AND c.complete=1 AND c.evidence_eligible>0 AND o.map=? AND o.config_hash=? AND o.recorded_at<? AND o.input_key<>?
    AND NOT(o.server=? AND o.match_id=?) ORDER BY o.recorded_at DESC,o.id DESC LIMIT 10000`)
    .all(group.steam_id,group.class_id,group.weapon,current.map,current.config_hash,current.recorded_at,current.input_key,current.server,current.match_id);
}
function baselineFrom(rows,minimum){
  const games=new Set(rows.map(row=>JSON.stringify([row.server,row.match_id]))),hits=rows.reduce((sum,row)=>sum+row.hits,0),eligible=rows.reduce((sum,row)=>sum+row.eligible,0);
  return {games:games.size,rounds:rows.length,hits,eligible,percent:eligible?100*hits/eligible:null,required_games:minimum,ready:games.size>=minimum&&eligible>0};
}
function windowCount(registry,observation,group){
  if(!ensureWindowCounts(registry,observation))return null;
  return registry.db.prepare("SELECT window_count FROM hltv_statistics_window_counts WHERE observation_id=? AND steam_id=? AND class_id=? AND weapon=?").get(observation.id,group.steam_id,group.class_id,group.weapon)?.window_count??null;
}
function repeatedGames(registry,group,rows,options){
  const games=new Map();for(const row of rows){const key=JSON.stringify([row.server,row.match_id]);if(!games.has(key))games.set(key,[]);games.get(key).push(row);}
  const recent=[...games.values()].slice(0,options.repeatWindow-1),support=[];
  for(const rounds of recent){
    let hits=0,eligible=0,outHits=0,outEligible=0,windows=0,known=true;
    for(const row of rounds){const count=windowCount(registry,row,group);if(count==null||!row.outside_complete||!row.outside_eligible)known=false;else windows+=count;hits+=row.hits;eligible+=row.eligible;outHits+=row.outside_hits||0;outEligible+=row.outside_eligible||0;}
    if(known&&windows>=options.minConcWindows&&closeEvidenceGap({strict:hits,evidence_eligible:eligible},{strict:outHits,evidence_eligible:outEligible}))support.push({server:rounds[0].server,match_id:rounds[0].match_id,observation_ids:rounds.map(row=>row.id),conc_windows:windows});
  }
  return {qualifying_games:1+support.length,window_games:Math.min(options.repeatWindow,1+recent.length),support};
}
function classifyComparison(registry,observation,conc,outside,options){
  const history=historyRows(registry,observation,conc),baseline=baselineFrom(history,options.baselineGames),count=windowCount(registry,observation,conc),result={baseline,conc_windows:count,trigger:null};
  if(!HITSCAN.has(conc.weapon)||!conc.complete||conc.evidence_eligible<=0||count==null||count<options.minConcWindows)return result;
  if(conc.strict*100>=options.highConcPercent*conc.evidence_eligible)return {...result,trigger:"high_conc"};
  if(baseline.ready&&100*(conc.strict*baseline.eligible-baseline.hits*conc.evidence_eligible)>=options.baselineRisePoints*conc.evidence_eligible*baseline.eligible)return {...result,trigger:"baseline_rise",rise_points:100*conc.strict/conc.evidence_eligible-baseline.percent};
  if(outside?.complete&&closeEvidenceGap(conc,outside)){const repetition=repeatedGames(registry,conc,history,options);if(repetition.qualifying_games>=options.repeatGames)return {...result,trigger:"repeated_gap",repetition};}
  return result;
}
module.exports={DEFAULTS,HITSCAN,policyOptions,aimReviewConfig,closeGap,classifyComparison,historyRows,baselineFrom};
