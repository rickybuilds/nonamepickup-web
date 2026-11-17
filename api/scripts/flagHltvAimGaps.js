"use strict";
require("dotenv").config({path:require("path").resolve(__dirname,"../.env"),quiet:true});
const {Registry}=require("../src/hltv/registry"),{config}=require("../src/hltv/config"),{upstreamConfig}=require("../src/hltv/upstream");
const {demoStatistics}=require("../src/hltv/playerStatistics"),{evaluateGapReview}=require("../src/hltv/gapReview");
try{
  if(process.argv.length!==3||process.argv[2]!=="--apply")throw new Error("Usage: node scripts/flagHltvAimGaps.js --apply");
  if(!config().enabled||!upstreamConfig().gapReviewEnabled)throw new Error("Enable HLTV_REGISTRY_ENABLED and HLTV_AIM_GAP_REVIEW_ENABLED first");
  const registry=new Registry(config());
  try{
    const demos=registry.db.prepare("SELECT DISTINCT d.id FROM hltv_demos d JOIN hltv_statistics_observations o ON o.demo_id=d.id WHERE d.file_status='available'").all();
    let findings=0,alerts=0,failed=0;
    for(const demo of demos){try{const result=evaluateGapReview(registry,demoStatistics(registry,demo.id),{enabled:true});findings+=result.findings;alerts+=Number(!!result.alert_id);}catch(error){failed++;console.error("[HLTV gap backfill]",demo.id,error.message);}}
    console.log(JSON.stringify({observations:demos.length,findings,alerts,failed,note:"Real stored comparisons only; no demo decoding. Existing findings are deduplicated."}));
    if(failed)process.exitCode=1;
  }finally{registry.close();}
}catch(error){console.error("[HLTV gap backfill]",error.message);process.exitCode=1;}
