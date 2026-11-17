"use strict";
require("dotenv").config({path:require("path").resolve(__dirname,"../.env"),quiet:true});
const {Registry}=require("../src/hltv/registry"),{config}=require("../src/hltv/config"),{upstreamConfig}=require("../src/hltv/upstream");
const {demoStatistics}=require("../src/hltv/playerStatistics"),{evaluateGapReview,retireLegacyGapAlerts}=require("../src/hltv/gapReview");
try{
  if(process.argv.length!==3||process.argv[2]!=="--apply")throw new Error("Usage: node scripts/flagHltvAimGaps.js --apply");
  if(!config().enabled||(!upstreamConfig().gapReviewEnabled&&!upstreamConfig().aimReview.alertsEnabled))throw new Error("Enable registry plus quiet gap markers or strict hit-evidence alerts first");
  const registry=new Registry(config());
  try{
    const demos=registry.db.prepare("SELECT DISTINCT d.id FROM hltv_demos d JOIN hltv_statistics_observations o ON o.demo_id=d.id WHERE d.file_status='available'").all();
    let findings=0,alerts=0,failed=0,markers=0;const suppressed=retireLegacyGapAlerts(registry);
    for(const demo of demos){try{const observation=demoStatistics(registry,demo.id);require("../src/hltv/concWindows").ensureWindowCounts(registry,observation);const result=evaluateGapReview(registry,observation,{...upstreamConfig().aimReview,enabled:true});findings+=result.findings;markers+=result.markers;alerts+=Number(!!result.alert_id);}catch(error){failed++;console.error("[HLTV gap backfill]",demo.id,error.message);}}
    console.log(JSON.stringify({observations:demos.length,markers,findings,alerts,suppressed_legacy_alerts:suppressed,failed,note:"Real stored comparisons only; no demo decoding. Missing original conc-window evidence cannot trigger an alert."}));
    if(failed)process.exitCode=1;
  }finally{registry.close();}
}catch(error){console.error("[HLTV gap backfill]",error.message);process.exitCode=1;}
