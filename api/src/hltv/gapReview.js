"use strict";
const crypto=require("crypto");
const {policyOptions,closeGap,classifyComparison}=require("./aimReviewPolicy");
const hash=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function retireLegacyGapAlerts(registry){return registry.db.prepare("INSERT OR IGNORE INTO hltv_alert_suppressions(alert_id,reason,created_at) SELECT id,'Single-round gap rule retired; kept as quiet website marker',? FROM hltv_alerts WHERE kind='aim_gap_review' AND sent_at IS NULL").run(Date.now()).changes;}
function evaluateGapReview(registry,input,settings={}){
  if(!settings.enabled||!input)return {findings:0,markers:0};
  const options=policyOptions(settings);
  return registry.db.transaction(()=>{
    retireLegacyGapAlerts(registry);
    const observation=registry.db.prepare("SELECT * FROM hltv_statistics_observations WHERE id=?").get(input.id);
    if(!observation)throw new Error("statistics_observation_missing");
    const groups=registry.db.prepare("SELECT * FROM hltv_player_statistics WHERE observation_id=?").all(observation.id),demo=registry.get(observation.demo_id),review=registry.db.prepare("SELECT * FROM hltv_cases WHERE demo_id=?").get(demo.id),pairs=new Map();
    for(const group of groups){if(!["conc","outside"].includes(group.state))continue;const key=JSON.stringify([group.steam_id,group.class_id,group.weapon]);if(!pairs.has(key))pairs.set(key,{});pairs.get(key)[group.state]=group;}
    const fresh=[];let markers=0;
    const allowed=options.alertsEnabled&&demo.file_status==="available"&&(!review||!["dismissed","confirmed"].includes(review.status));
    for(const {conc,outside} of pairs.values()){
      if(!conc||conc.eligible<=0)continue;
      const concPercent=conc.evidence_eligible?100*conc.strict/conc.evidence_eligible:null,outsidePercent=outside?.evidence_eligible?100*outside.strict/outside.evidence_eligible:null;
      const data={metric:"strict-hit-evidence-v1",steam_id:conc.steam_id,player_name:conc.player_name,class_id:conc.class_id,weapon:conc.weapon,conc_hits:conc.strict,conc_eligible:conc.evidence_eligible,conc_percent:concPercent,outside_hits:outside?.strict||0,outside_eligible:outside?.evidence_eligible||0,outside_percent:outsidePercent,gap_points:outsidePercent==null||concPercent==null?null:Math.abs(concPercent-outsidePercent),aim_near_context:{conc:100*conc.aim_near/conc.eligible,outside:outside?.eligible?100*outside.aim_near/outside.eligible:null},upstream_sha:observation.upstream_sha,config_hash:observation.config_hash,log_round:observation.log_round};
      if(closeGap(conc,outside)){
        const id=hash(["quiet-gap-v2",observation.input_key,observation.config_hash,conc.steam_id,conc.class_id,conc.weapon]);
        const c=100*conc.aim_near/conc.eligible,o=100*outside.aim_near/outside.eligible;
        markers+=registry.db.prepare("INSERT OR IGNORE INTO hltv_aim_markers(id,demo_id,observation_id,created_at,data_json) VALUES(?,?,?,?,?)").run(id,demo.id,observation.id,Date.now(),JSON.stringify({...data,metric:"aim-near-context",conc_near:conc.aim_near,conc_eligible:conc.eligible,outside_near:outside.aim_near,outside_eligible:outside.eligible,conc_percent:c,outside_percent:o,gap_points:Math.abs(c-o),rule:"quiet-gap-v2",summary:"Close aim-near rates: quiet website marker, not a review alert."})).changes;
      }
      if(!allowed)continue;
      const classification=classifyComparison(registry,observation,conc,outside,options);if(!classification.trigger)continue;
      const id=hash(["hit-evidence-pattern-v1",classification.trigger,observation.input_key,conc.steam_id,conc.class_id,conc.weapon]);if(registry.db.prepare("SELECT 1 FROM hltv_gap_findings WHERE id=?").get(id))continue;
      fresh.push({id,data:{...data,...classification,rule:"hit-evidence-pattern-v1",thresholds:{min_conc_windows:options.minConcWindows,high_conc_percent:options.highConcPercent,evidence_gap_points:options.evidenceGapPoints,repeat_games:options.repeatGames,repeat_window:options.repeatWindow,baseline_games:options.baselineGames,baseline_rise_points:options.baselineRisePoints},summary:"Configured strict hit-evidence trigger; human review requested, not exact bullet accuracy or a cheating verdict."}});
    }
    if(!fresh.length)return {findings:0,markers};
    registry.storage.verify(demo);const alertId=crypto.randomUUID(),now=Date.now();
    registry.db.prepare("INSERT INTO hltv_alerts(id,demo_id,kind,created_at) VALUES(?,?,'hit_evidence_review',?)").run(alertId,demo.id,now);
    const insert=registry.db.prepare("INSERT INTO hltv_gap_findings(id,demo_id,observation_id,alert_id,created_at,data_json) VALUES(?,?,?,?,?,?)");for(const finding of fresh)insert.run(finding.id,demo.id,observation.id,alertId,now,JSON.stringify(finding.data));
    if(!review){registry.db.prepare("INSERT INTO hltv_cases(id,demo_id,source,status,priority,opened_by,opened_at) VALUES(?,?,'aim_pattern','queued','high','aim-pattern-rule',?)").run(crypto.randomUUID(),demo.id,now);registry.db.prepare("UPDATE hltv_demos SET review_status='queued' WHERE id=?").run(demo.id);}else registry.db.prepare("UPDATE hltv_cases SET priority='high' WHERE demo_id=?").run(demo.id);
    if(!registry.db.prepare("SELECT 1 FROM hltv_holds WHERE demo_id=? AND created_by='aim-pattern-rule' AND released_at IS NULL").get(demo.id))registry.hold(demo.id,"Sampled aim-pattern review: "+fresh.length+" comparisons","aim-pattern-rule");
    const days=registry.db.prepare("SELECT days FROM hltv_policy WHERE class='high'").get().days;registry.db.prepare("UPDATE hltv_demos SET retention_class=CASE WHEN retention_class='evidence' THEN retention_class ELSE 'high' END,expires_at=MAX(expires_at,?) WHERE id=?").run(now+days*86400000,demo.id);
    registry.audit(demo.id,"aim-pattern-rule","aim_pattern_review",{observation_id:observation.id,findings:fresh.map(f=>f.id),alert_id:alertId});
    return {findings:fresh.length,markers,alert_id:alertId};
  }).immediate();
}
module.exports={evaluateGapReview,retireLegacyGapAlerts};
