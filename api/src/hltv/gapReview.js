"use strict";
const crypto=require("crypto");
const RULE="aim-gap-under-10-v1";
function evaluateGapReview(registry,observation,{enabled=false}={}){
  if(!enabled||!observation)return {findings:0};
  return registry.db.transaction(()=>{
    const demo=registry.get(observation.demo_id);
    if(demo.file_status!=="available")return {findings:0,skipped:"source_unavailable"};
    const review=registry.db.prepare("SELECT * FROM hltv_cases WHERE demo_id=?").get(demo.id);
    if(review&&["dismissed","confirmed"].includes(review.status))return {findings:0,skipped:"review_resolved"};
    const pairs=new Map();
    for(const group of observation.groups){
      if(!["conc","outside"].includes(group.state))continue;
      const key=JSON.stringify([group.steam_id,group.class_id,group.weapon]);
      if(!pairs.has(key))pairs.set(key,{});pairs.get(key)[group.state]=group;
    }
    const fresh=[];
    for(const {conc,outside} of pairs.values()){
      if(!conc||!outside||conc.eligible<=0||outside.eligible<=0)continue;
      // Integer comparison avoids rounding an exact 10-point boundary into a finding.
      if(Math.abs(conc.aim_near*outside.eligible-outside.aim_near*conc.eligible)*100>=10*conc.eligible*outside.eligible)continue;
      const id=crypto.createHash("sha256").update(JSON.stringify([RULE,observation.input_key,conc.steam_id,conc.class_id,conc.weapon])).digest("hex");
      if(registry.db.prepare("SELECT 1 FROM hltv_gap_findings WHERE id=?").get(id))continue;
      const concPercent=100*conc.aim_near/conc.eligible,outsidePercent=100*outside.aim_near/outside.eligible;
      fresh.push({id,data:{rule:RULE,steam_id:conc.steam_id,player_name:conc.player_name,class_id:conc.class_id,weapon:conc.weapon,
        conc_near:conc.aim_near,conc_eligible:conc.eligible,conc_percent:concPercent,
        outside_near:outside.aim_near,outside_eligible:outside.eligible,outside_percent:outsidePercent,
        gap_points:Math.abs(concPercent-outsidePercent),small_sample:conc.eligible<25||outside.eligible<25,
        upstream_sha:observation.upstream_sha,config_hash:observation.config_hash,log_round:observation.log_round,
        summary:"Aim-near rates are less than 10 percentage points apart. Human review requested; not a cheating verdict."}});
    }
    if(!fresh.length)return {findings:0};
    registry.storage.verify(demo);
    const alertId=crypto.randomUUID(),now=Date.now();
    registry.db.prepare("INSERT INTO hltv_alerts(id,demo_id,kind,created_at) VALUES(?,?,'aim_gap_review',?)").run(alertId,demo.id,now);
    const insert=registry.db.prepare("INSERT INTO hltv_gap_findings(id,demo_id,observation_id,alert_id,created_at,data_json) VALUES(?,?,?,?,?,?)");
    for(const finding of fresh)insert.run(finding.id,demo.id,observation.id,alertId,now,JSON.stringify(finding.data));
    if(!review){
      registry.db.prepare("INSERT INTO hltv_cases(id,demo_id,source,status,priority,opened_by,opened_at) VALUES(?,?,'aim_gap','queued','high','aim-gap-rule',?)").run(crypto.randomUUID(),demo.id,now);
      registry.db.prepare("UPDATE hltv_demos SET review_status='queued' WHERE id=?").run(demo.id);
    }else registry.db.prepare("UPDATE hltv_cases SET priority='high' WHERE demo_id=?").run(demo.id);
    if(!registry.db.prepare("SELECT 1 FROM hltv_holds WHERE demo_id=? AND created_by='aim-gap-rule' AND released_at IS NULL").get(demo.id))registry.hold(demo.id,"Aim-gap review: "+fresh.length+" player/weapon comparisons under 10 percentage points","aim-gap-rule");
    const days=registry.db.prepare("SELECT days FROM hltv_policy WHERE class='high'").get().days;
    registry.db.prepare("UPDATE hltv_demos SET retention_class=CASE WHEN retention_class='evidence' THEN retention_class ELSE 'high' END,expires_at=MAX(expires_at,?) WHERE id=?").run(now+days*86400000,demo.id);
    registry.audit(demo.id,"aim-gap-rule","aim_gap_review",{observation_id:observation.id,findings:fresh.map(f=>f.id),alert_id:alertId});
    return {findings:fresh.length,alert_id:alertId};
  }).immediate();
}
module.exports={evaluateGapReview};
