"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const { Registry } = require("../src/hltv/registry");
const crypto = require("crypto");
const { ingestPending } = require("../src/hltv/worker");
const { validateResult, UnavailableAnalyzer } = require("../src/hltv/analyzer");
test("unchanged upstream viewer loads without a browser and keeps original geometry functions", t => {
  const root = process.env.HLTV_TEST_UPSTREAM_ROOT;
  if (!root) {t.skip("Upstream checkout is an optional integration input");return;}
  const { loadViewer } = require("../src/hltv/upstream_statistics");
  const viewer = loadViewer(root, async () => { throw new Error("unexpected fetch"); });
  assert.equal(typeof viewer.runConcAim, "function");
  assert.equal(typeof viewer.Studio.poseServer, "function");
  assert.equal(viewer.ConcAim.stateAt([{t:10,end:20}], 15), "conc");
  assert.equal(viewer.ConcAim.stateAt([{t:10,end:20}], 10), "uncertain");
});
test("original upstream comparison executes with real private map and model assets", async t => {
  const root=process.env.HLTV_TEST_UPSTREAM_ROOT,python=process.env.HLTV_TEST_PYTHON,assets=process.env.HLTV_TEST_ASSETS;
  if(!root||!python||!assets){t.skip("Private assets and upstream Python are optional integration inputs");return;}
  const zlib=require("zlib"),{spawnSync}=require("child_process");
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"hltv-statistics-probe-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const n=121,parts=[],layout={};let offset=0;
  const section=(name,array)=>{const part=Buffer.from(array.buffer,array.byteOffset,array.byteLength);layout[name]=[offset,part.length];parts.push(part);offset+=part.length;};
  section("times",Float32Array.from({length:n},(_,i)=>i/20));
  for(const slot of [1,2]){const pos=new Float32Array(n*5);for(let i=0;i<n;i++){pos[i*5]=slot===1?0:200;pos[i*5+4]=slot===1?0:180;}section("pos"+slot,pos);section("info"+slot,Uint32Array.from({length:n},()=>1|(slot<<5)|(5<<8)));}
  section("objs",new Float32Array());
  const fires=new Float32Array(32);fires[0]=2;fires[1]=1;fires[2]=1;fires[16]=3;fires[17]=2;fires[18]=1;section("events",fires);
  const meta={file:"synthetic-transport.dem",map:"2trof_b4",game:"tfc",frames:n,slots:[1,2],start:0,end:6,duration:6,hltv:true,complete:true,
    pauses:[],kills:[],shots:[],players:[1,2].map(ent=>({ent,steam:`STEAM_0:1:${ent}`,name:"Fixture "+ent,first:0,left:null,bot:false,ping:50})),
    levels:[{t:0,frame:0,map:"2trof_b4",models:{1:"models/player/scout/scout.mdl"},events:{1:"events/wpn/tf_sg.sc"}}],
    pmodels:{1:[[0,1]],2:[[0,1]]},buffers:layout};
  const log={version:1,file:meta.file,map:meta.map,demoEnd:6,alignment:{anchors:24,uncertainty:1},events:[],combat:[],stops:[]};
  fs.writeFileSync(path.join(directory,"meta.json.gz"),zlib.gzipSync(JSON.stringify(meta)));
  fs.writeFileSync(path.join(directory,"data.bin.gz"),zlib.gzipSync(Buffer.concat(parts)));
  fs.writeFileSync(path.join(directory,"matched-log.json"),JSON.stringify(log));
  const converted=spawnSync(python,["-I",path.resolve(__dirname,"../src/hltv/upstream_assets.py")],{input:JSON.stringify({upstream_root:root,assets_root:assets,output_dir:directory}),encoding:"utf8",timeout:120000});
  assert.equal(converted.status,0,converted.stdout+converted.stderr);
  const receipt=await require("../src/hltv/upstream_statistics").run(root,directory);
  assert.equal(receipt.recorded_shots,2);
  const result=JSON.parse(fs.readFileSync(path.join(directory,"statistics.json")));
  assert.equal(result.groups.reduce((n,row)=>n+row.recorded,0),2);
  assert.equal(result.unassigned,0);
  for(const row of result.groups)assert.equal(row.recorded,row.eligible+row.no_enemy+row.unavailable+row.uncertain);
  if(process.env.HLTV_TEST_PLAYWRIGHT){
    const {chromium}=require(process.env.HLTV_TEST_PLAYWRIGHT),adapter=require("../src/hltv/upstream_statistics");
    const browser=await chromium.launch({channel:"chrome",headless:true,args:["--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--enable-unsafe-swiftshader"]}),reader=adapter.assetReader(path.join(directory,"assets.bin"));
    try{
      const page=await browser.newPage(),errors=[];page.on("pageerror",error=>{if(!error.message.includes("noname_skip_browser_render"))errors.push(error.stack);});
      await page.route("**/*",async route=>{
        const pathname=new URL(route.request().url()).pathname;
        if(pathname==="/")return route.fulfill({contentType:"text/html",body:'<div id="pickList"></div><canvas id="gl"></canvas><canvas id="tl"></canvas><input id="concAimMargin" value="10"><input id="concViewAspect" value="1.3333333333333333"><div id="concAimResults"></div>'});
        const response=await reader.fetch(pathname);return route.fulfill({status:response.ok?200:404,body:response.ok?Buffer.from(await response.arrayBuffer()):"missing"});
      });
      await page.goto("http://fixture.local/");
      await page.addScriptTag({content:'const FX={init(){throw Error("noname_skip_browser_render")}};'});
      for(const file of ["conc.js","conc_aim.js","blood_hits.js","studio.js","viewer.js"])await page.addScriptTag({content:fs.readFileSync(path.join(root,"web",file),"utf8")});
      assert.equal(await page.evaluate(()=>Studio.available()),true,JSON.stringify(errors));
      const code=`const key=${(shot=>`${shot.slot}|${shot.t}|${shot.weapon}`).toString()};const evidenceQueues=${adapter.evidenceQueues.toString()};const loadViewer=()=>({S,prefs,Studio,ConcEstimate,ConcAim,BloodHits,buildData,loadMap,runConcAim,playerState,serverModelPath,who});const compare=${adapter.compare.toString()};`;
      await page.addScriptTag({content:code});
      const browserResult=await page.evaluate(async ({meta,bytes,log})=>compare("",meta,Uint8Array.from(bytes).buffer,log,fetch),{meta,bytes:[...Buffer.concat(parts)],log});
      assert.deepEqual(browserResult.groups,result.groups,"Real WebGL and inert drawing must yield identical counters");
      assert.deepEqual(browserResult.audits,result.audits,"Original geometry and evidence output must agree");
      assert.deepEqual(errors,[]);
    }finally{reader.close();await browser.close();}
  }
});
test("same-time firing events retain distinct evidence identities",()=>{
  const {evidenceQueues}=require("../src/hltv/upstream_statistics");
  const shot={slot:1,t:2,weapon:"shotgun"};
  const take=evidenceQueues([{...shot,id:3,status:"ambiguous",inclusiveMatch:{bloodId:7}},{...shot,id:4,status:"unmatched"}]);
  assert.equal(take(shot).id,3);assert.equal(take(shot).id,4);assert.equal(take(shot),undefined);
});
test("long multi-stage jobs retain their processing lease while heartbeat is fresh",async t=>{
  const {registry:r,demo}=fixture(t),{queueRun,runPending}=require("../src/hltv/upstream");
  const run=queueRun(r,demo.id,"admin");
  r.db.prepare("UPDATE hltv_upstream_runs SET status='processing',started_at=? WHERE id=?").run(Date.now()-900000,run.id);
  r.db.prepare("INSERT INTO hltv_upstream_heartbeats(run_id,touched_at) VALUES(?,?)").run(run.id,Date.now());
  assert.equal((await runPending(r,{enabled:true})).processed,0);
  assert.equal(r.db.prepare("SELECT status FROM hltv_upstream_runs WHERE id=?").get(run.id).status,"processing");
});
test("feature and cleanup default off; cleanup preview defaults on",()=>{
  const c=require("../src/hltv/config").config({});
  assert.equal(c.enabled,false);assert.equal(c.cleanupEnabled,false);assert.equal(c.dryRun,true);
  assert.equal(c.manualRetentionEnabled,false);
  assert.equal(require("../src/hltv/upstream").upstreamConfig({}).enabled,false);
  assert.equal(require("../src/hltv/upstream").upstreamConfig({}).statisticsEnabled,false);
  assert.equal(require("../src/hltv/upstream").upstreamConfig({}).statisticsAutoCollect,false);
  assert.equal(require("../src/hltv/upstream").upstreamConfig({}).gapReviewEnabled,false);
});
test("automatic statistics collection queues once and releases only its own finished lease",t=>{
  const {registry:r,root,manifest}=fixture(t),{queueAutomaticStatistics,releaseStatisticsLeases}=require("../src/hltv/statisticsQueue");
  const bytes=Buffer.alloc(640);bytes.write("HLDEMO");bytes.writeInt32LE(544,540);bytes.writeInt32LE(1,544);
  fs.writeFileSync(path.join(root,"incoming/recording/complete.dem"),bytes);
  const demo=r.ingest({...manifest,demos:[{...manifest.demos[0],storage_key:"incoming/recording/complete.dem",filename:"complete.dem",recorded_at:2}]})[0];
  const manual=r.hold(demo.id,"manual evidence","admin");
  assert.equal(queueAutomaticStatistics(r,{enabled:true,statisticsEnabled:false}),null);
  assert.equal(queueAutomaticStatistics(r,{enabled:true,statisticsEnabled:true,statisticsAutoCollect:false}),null);
  const run=queueAutomaticStatistics(r,{enabled:true,statisticsEnabled:true,statisticsAutoCollect:true});assert.ok(run.id);
  assert.equal(queueAutomaticStatistics(r,{enabled:true,statisticsEnabled:true,statisticsAutoCollect:true}).reason,"invalid_demo_header");
  assert.equal(queueAutomaticStatistics(r,{enabled:true,statisticsEnabled:true,statisticsAutoCollect:true}),null);
  releaseStatisticsLeases(r);assert.equal(r.detail(demo.id).holds.length,2);
  r.db.prepare("UPDATE hltv_upstream_runs SET status='failed' WHERE id=?").run(run.id);
  releaseStatisticsLeases(r);
  assert.deepEqual(r.detail(demo.id).holds.map(h=>h.id),[manual]);
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_alerts").get().n,0);
});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hltv-test-"));
  const registry = new Registry({ root, database: path.join(root, "registry.db"), minFreeBytes: 0 });
  t.after(() => { registry.close(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "incoming/recording"), { recursive: true });
  fs.writeFileSync(path.join(root, "incoming/recording/round.dem"), "file bytes for storage tests");
  const manifest = { version: 1, match_id: "match1", server: "east", map: "2fort", demos: [
    { storage_key: "incoming/recording/round.dem", filename: "round.dem", recorded_at: 1, round_id: null }
  ] };
  const demo = registry.ingest(manifest)[0];
  return { root, registry, demo, manifest };
}
test("close-gap comparisons become quiet markers without reviews, holds or Discord alerts",t=>{
  const {registry:r,demo}=fixture(t),{evaluateGapReview}=require("../src/hltv/gapReview");
  const pair=(weapon,concNear,concCount,outNear,outCount)=>[...[{state:"conc",aim_near:concNear,eligible:concCount},{state:"outside",aim_near:outNear,eligible:outCount}].map(row=>({steam_id:"STEAM_0:1:123",name:"Player",class_id:6,weapon,recorded:row.eligible,no_enemy:0,unavailable:0,uncertain:0,geometry_hit:0,strict:0,inclusive:0,evidence_eligible:0,...row}))];
  const groups=[...pair("ac",22,227,138,744),...pair("shotgun",1,2,1,2),...pair("rpg",1,10,2,10),...pair("nailgun",0,0,1,10),...pair("super_shotgun",10,25,10,25)];
  const {storeStatistics,demoStatistics}=require("../src/hltv/playerStatistics");
  storeStatistics(r,{id:"source-run",demo,upstream_sha:"b".repeat(40),pairing:{log_sha256:"c".repeat(64),log_round:1}},{version:1,metric:"ghosty-firing-v1",settings:{margin:.1,aspect:4/3,lag_compensation:true,uncertainty:1},assets:[],groups,shots:[],unassigned:0});
  const obs=demoStatistics(r,demo.id);
  assert.equal(evaluateGapReview(r,obs,{enabled:false}).findings,0);
  const result=evaluateGapReview(r,obs,{enabled:true});assert.equal(result.findings,0);assert.equal(result.markers,3);
  assert.equal(r.get(demo.id).review_status,"unreviewed");assert.equal(r.get(demo.id).retention_class,"normal");
  assert.equal(r.detail(demo.id).holds.length,0);assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_alerts").get().n,0);
  assert.equal(evaluateGapReview(r,obs,{enabled:true}).findings,0);
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_aim_markers").get().n,3);
});
function statisticsRound(registry,root,{seq,match="game"+seq,eligible=20,near=20,hits=near,outside=20,outsideNear=8,outsideHits=outsideNear,windows=20,weapon="super_shotgun",map="2fort",upstream="b".repeat(40)}){
  const filename=`incoming/recording/stat-${seq}.dem`;fs.writeFileSync(path.join(root,filename),"unique fixture "+seq);
  const demo=registry.ingest({version:1,match_id:match,server:"east",map,demos:[{storage_key:filename,filename:`stat-${seq}.dem`,recorded_at:seq*1000+1}]})[0];
  const identity={steam_id:"STEAM_0:1:123",name:"Player",class_id:6,weapon};
  const direct=["ac","shotgun","super_shotgun","sniper","auto_rifle"].includes(weapon);
  const group=(state,n,aim,hit)=>({...identity,state,recorded:n,eligible:n,aim_near:aim,no_enemy:0,unavailable:0,uncertain:0,geometry_hit:0,strict:direct?hit:0,inclusive:direct?hit:0,evidence_eligible:direct?n:0});
  const shots=Array.from({length:eligible},(_,i)=>({...identity,state:"conc",visibility:"visible",time_seconds:(i%windows)*10+2,evidence:direct?{includedInPercentage:true,status:i<hits?"blood-damage":"unmatched"}:null}));
  const statistics={version:1,metric:"ghosty-firing-v1",settings:{margin:.1,aspect:4/3,lag_compensation:true,uncertainty:1},assets:[],groups:[group("conc",eligible,near,hits),group("outside",outside,outsideNear,outsideHits)],shots,unassigned:0};
  const {storeStatistics,demoStatistics}=require("../src/hltv/playerStatistics");
  const saved=storeStatistics(registry,{id:"stat-run-"+seq,demo,upstream_sha:upstream,pairing:{log_sha256:"c".repeat(64),log_round:1}},statistics);
  require("../src/hltv/concWindows").recordWindowCounts(registry,saved.id,statistics,Array.from({length:windows},(_,i)=>({player_steam_id:identity.steam_id,class_id:6,time_seconds:i*10,end_seconds:i*10+8})));
  return demoStatistics(registry,demo.id);
}
test("100 percent across twenty distinct conc windows can alert before twenty-five games",t=>{
  const {registry:r,root}=fixture(t),{evaluateGapReview}=require("../src/hltv/gapReview");
  const obs=statisticsRound(r,root,{seq:10,outside:0,outsideNear:0});
  const result=evaluateGapReview(r,obs,{enabled:true,alertsEnabled:true});assert.equal(result.findings,1);
  const finding=JSON.parse(r.db.prepare("SELECT data_json FROM hltv_gap_findings").get().data_json);
  assert.equal(finding.trigger,"high_conc");assert.equal(finding.conc_windows,20);assert.equal(finding.baseline.games,0);assert.equal(finding.baseline.ready,false);
  assert.equal(evaluateGapReview(r,obs,{enabled:true,alertsEnabled:true}).findings,0);
  assert.equal(r.get(obs.demo_id).review_status,"queued");assert.equal(r.detail(obs.demo_id).holds.length,1);
});
test("one hundred shots in one conc window and projectile weapons never satisfy the immediate rule",t=>{
  const {registry:r,root}=fixture(t),{evaluateGapReview}=require("../src/hltv/gapReview");
  const single=statisticsRound(r,root,{seq:10,eligible:100,near:100,windows:1});
  assert.equal(evaluateGapReview(r,single,{enabled:true,alertsEnabled:true}).findings,0);
  const projectile=statisticsRound(r,root,{seq:11,weapon:"rpg"});
  assert.equal(evaluateGapReview(r,projectile,{enabled:true,alertsEnabled:true}).findings,0);
  const good=statisticsRound(r,root,{seq:12});
  assert.equal(evaluateGapReview(r,good,{enabled:true,alertsEnabled:false}).findings,0);
  const geometryOnly=statisticsRound(r,root,{seq:13,near:20,hits:10});
  assert.equal(evaluateGapReview(r,geometryOnly,{enabled:true,alertsEnabled:true}).findings,0,"100% aim-near is not 100% strict hit evidence");
  const incomplete=statisticsRound(r,root,{seq:14});
  r.db.prepare("UPDATE hltv_player_statistics SET complete=0 WHERE observation_id=? AND state='conc'").run(incomplete.id);
  assert.equal(evaluateGapReview(r,incomplete,{enabled:true,alertsEnabled:true}).findings,0);
  const closed=statisticsRound(r,root,{seq:15});r.action(closed.demo_id,"flag",{reason:"manual case"},"admin");r.action(closed.demo_id,"status",{status:"dismissed",reason:"review complete"},"admin");
  assert.equal(evaluateGapReview(r,closed,{enabled:true,alertsEnabled:true}).findings,0);
  assert.equal(r.get(closed.demo_id).review_status,"dismissed");
});
test("repeated hit-evidence patterns count games once and preserve assignments and manual holds",t=>{
  const {registry:r,root}=fixture(t),{evaluateGapReview}=require("../src/hltv/gapReview");
  statisticsRound(r,root,{seq:10,match:"one",hits:8,near:20,outsideHits:8});
  const sameGame=statisticsRound(r,root,{seq:11,match:"one",hits:8,near:20,outsideHits:8});
  assert.equal(evaluateGapReview(r,sameGame,{enabled:true,alertsEnabled:true}).findings,0);
  const second=statisticsRound(r,root,{seq:12,match:"two",hits:8,near:20,outsideHits:8});
  r.action(second.demo_id,"flag",{reason:"manual investigation"},"admin");r.action(second.demo_id,"claim",{},"admin");
  const originalHolds=r.detail(second.demo_id).holds.map(h=>h.id);
  assert.equal(evaluateGapReview(r,second,{enabled:true,alertsEnabled:true}).findings,1);
  assert.equal(r.get(second.demo_id).review_status,"in_review");
  for(const hold of originalHolds)assert.ok(r.detail(second.demo_id).holds.some(h=>h.id===hold));
  const finding=JSON.parse(r.db.prepare("SELECT data_json FROM hltv_gap_findings").get().data_json);assert.equal(finding.trigger,"repeated_gap");assert.equal(finding.conc_percent,40);assert.equal(finding.baseline.games,1);
});
test("baseline readiness counts twenty-five prior games rather than shots or rounds",t=>{
  const {registry:r,root}=fixture(t),{evaluateGapReview}=require("../src/hltv/gapReview");
  for(let i=1;i<=25;i++)statisticsRound(r,root,{seq:i,match:i===25?"game24":"game"+i,near:8});
  const current=statisticsRound(r,root,{seq:26,near:16});
  statisticsRound(r,root,{seq:100,hits:20});
  statisticsRound(r,root,{seq:25.75,match:"game26",hits:20});
  statisticsRound(r,root,{seq:25.6,map:"other",hits:20});
  statisticsRound(r,root,{seq:25.7,upstream:"d".repeat(40),hits:20});
  assert.equal(evaluateGapReview(r,current,{enabled:true,alertsEnabled:true}).findings,0,"twenty-five rounds in twenty-four games is not ready");
  statisticsRound(r,root,{seq:25.5,match:"game25",near:8});
  const result=evaluateGapReview(r,current,{enabled:true,alertsEnabled:true});assert.equal(result.findings,1);
  const finding=JSON.parse(r.db.prepare("SELECT data_json FROM hltv_gap_findings").get().data_json);
  assert.equal(finding.trigger,"baseline_rise");assert.equal(finding.baseline.games,25);assert.equal(finding.baseline.percent,40);assert.equal(finding.conc_percent,80);
});
test("window coverage is recoverable from stored evidence without decoding and fails closed for mismatched sources",t=>{
  const {registry:r,root}=fixture(t),{ensureWindowCounts}=require("../src/hltv/concWindows");
  const obs=statisticsRound(r,root,{seq:10}),demo=r.get(obs.demo_id),hold=r.hold(demo.id,"Fixture source","test");
  r.db.prepare("DELETE FROM hltv_statistics_window_counts WHERE observation_id=?").run(obs.id);
  r.db.prepare("DELETE FROM hltv_statistics_window_provenance WHERE observation_id=?").run(obs.id);
  const estimate={demo_sha256:obs.demo_sha256,upstream_sha:obs.upstream_sha,pairing:{log_sha256:obs.log_sha256},windows:Array.from({length:20},(_,i)=>({player_steam_id:"STEAM_0:1:123",class_id:6,time_seconds:i*10,end_seconds:i*10+8}))};
  r.db.prepare("INSERT INTO hltv_upstream_runs(id,demo_id,hold_id,status,requested_by,created_at,result_json) VALUES(?,?,?,'complete','test',1,?)").run(obs.run_id,demo.id,hold,JSON.stringify({...estimate,demo_sha256:"wrong"}));
  assert.equal(ensureWindowCounts(r,obs),false);
  r.db.prepare("UPDATE hltv_upstream_runs SET result_json=? WHERE id=?").run(JSON.stringify(estimate),obs.run_id);
  assert.equal(ensureWindowCounts(r,obs),true);
  assert.equal(r.db.prepare("SELECT window_count FROM hltv_statistics_window_counts WHERE observation_id=?").get(obs.id).window_count,20);
});
test("legacy broad alerts are suppressed without changing sent history, manual alerts or holds",t=>{
  const {registry:r,demo}=fixture(t),{retireLegacyGapAlerts}=require("../src/hltv/gapReview");
  r.alert(demo.id,"aim_gap_review");r.alert(demo.id,"manual_flag");r.hold(demo.id,"manual","admin");
  assert.equal(retireLegacyGapAlerts(r),1);assert.equal(retireLegacyGapAlerts(r),0);
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_alerts WHERE sent_at IS NULL").get().n,2);
  assert.equal(r.summary().pending_alerts,1);
  assert.equal(r.detail(demo.id).holds.length,1);
  const {aimReviewConfig}=require("../src/hltv/aimReviewPolicy");assert.equal(aimReviewConfig({}).alertsEnabled,false);assert.equal(aimReviewConfig({}).baselineGames,25);
  assert.throws(()=>aimReviewConfig({HLTV_HIT_BASELINE_GAMES:"no"}));
});
test("player histories deduplicate reruns, preserve raw-expired data and pool counts without current/future leakage", t=>{
  const {registry:r,demo}=fixture(t),{storeStatistics,playerHistory}=require("../src/hltv/playerStatistics");
  const group={steam_id:"STEAM_0:1:123",name:"Player",class_id:5,weapon:"shotgun",state:"outside",recorded:10,eligible:8,no_enemy:1,unavailable:1,uncertain:0,geometry_hit:3,aim_near:4,strict:2,inclusive:3,evidence_eligible:8};
  const result={version:1,metric:"ghosty-firing-v1",settings:{margin:.1,aspect:4/3,lag_compensation:true,uncertainty:1},assets:[{route:"map",sha256:"a".repeat(64)}],groups:[group],shots:[],audits:[],unassigned:0};
  const source={id:"run-one",demo,upstream_sha:"b".repeat(40),pairing:{log_sha256:"c".repeat(64),log_round:1}};
  const first=storeStatistics(r,source,result);storeStatistics(r,{...source,id:"retry"},result);
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_player_statistics").get().n,1);
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_statistics_payloads").get().n,1);
  const filter={steamId:group.steam_id,configHash:first.config_hash,weapon:"shotgun",classId:5,map:"2fort",before:Date.now(),excludeInputKey:"none"};
  assert.equal(playerHistory(r,filter).groups.length,0,"partial groups must not enter rates");
  result.groups[0]={...group,recorded:9,unavailable:0};
  assert.throws(()=>storeStatistics(r,source,result),/immutable_statistics_run/);
  storeStatistics(r,{...source,id:"repaired"},result);
  let history=playerHistory(r,filter);assert.equal(history.groups[0].eligible,8);assert.equal(history.groups[0].strict_percent,25);
  assert.equal(playerHistory(r,{...filter,excludeInputKey:first.input_key}).groups.length,0);
  assert.equal(playerHistory(r,{...filter,before:1}).groups.length,0);
  assert.equal(playerHistory(r,{...filter,configHash:"d".repeat(64)}).groups.length,0);
  r.db.prepare("UPDATE hltv_demos SET file_status='deleted' WHERE id=?").run(demo.id);
  assert.equal(playerHistory(r,filter).groups[0].eligible,8);
  assert.throws(()=>storeStatistics(r,source,{...result,groups:[{...group,strict:99}]}));
  assert.throws(()=>storeStatistics(r,source,{...result,groups:[{...group,steam_id:"slot1"}]}));
});
test("player timeline keeps scanner identity, source time and stable event references", t=>{
  const {registry:r,demo}=fixture(t),{storeStatistics}=require("../src/hltv/playerStatistics"),investigation=require("../src/hltv/investigation");
  const steam="STEAM_0:1:123",target="STEAM_0:1:456";
  const group={steam_id:steam,name:"Player",class_id:5,weapon:"shotgun",state:"outside",recorded:1,eligible:1,no_enemy:0,unavailable:0,uncertain:0,geometry_hit:0,aim_near:0,strict:0,inclusive:0,evidence_eligible:1};
  const result={version:1,metric:"ghosty-firing-v1",source_start_seconds:100,settings:{margin:.1,aspect:4/3,lag_compensation:true,uncertainty:1},assets:[],groups:[group],unassigned:0,
    shots:[{steam_id:steam,name:"Player",time_seconds:102.5,weapon:"shotgun",state:"outside",visibility:"visible",evidence:{status:"unmatched"}}],
    scanner:{version:"upstream-runAnalysis",time_coordinate:"demo_relative_seconds",stats:{},findings:[{kind:"track",steam_id:steam,player_name:"Player",target_steam_id:target,target_name:"Target",time_seconds:1,end_seconds:2,target_movement:120,angular_sweep_degrees:5,heuristic_score:1.5}]}};
  const source={id:"timeline-run",demo,upstream_sha:"b".repeat(40),pairing:{log_sha256:"c".repeat(64),log_round:1}};
  storeStatistics(r,source,result);
  const timeline=investigation.timeline(r,demo.id,steam,{limit:1});
  assert.equal(timeline.total,2);assert.equal(timeline.events[0].category,"wall_track");assert.equal(timeline.events[0].time_seconds,1);
  assert.equal(timeline.events[0].target_steam_id,target);
  assert.equal(investigation.detail(r,demo.id,timeline.events[0].id).event.id,timeline.events[0].id);
  assert.equal(investigation.timeline(r,demo.id,steam,{category:"firing"}).events[0].time_seconds,2.5);
  assert.equal(investigation.timeline(r,demo.id,target,{}).total,0);
  assert.throws(()=>investigation.timeline(r,demo.id,steam,{start:3,end:2}),/invalid_time_range/);
  assert.throws(()=>storeStatistics(r,{...source,id:"bad-scanner"},{...result,scanner:{...result.scanner,findings:[{...result.scanner.findings[0],time_seconds:-1}]}}),/invalid_scanner_finding/);
});
test("failed or skipped automatic statistics cannot become routine cleanup eligible",t=>{
  const {registry:r,demo}=fixture(t),{queueRun}=require("../src/hltv/upstream");
  r.manualRetentionEnabled=true;
  r.db.prepare("UPDATE hltv_demos SET expires_at=0 WHERE id=?").run(demo.id);
  const run=queueRun(r,demo.id,"statistics-scheduler");
  r.db.prepare("INSERT INTO hltv_statistics_jobs(demo_id,run_id,created_at) VALUES(?,?,?)").run(demo.id,run.id,Date.now());
  r.db.prepare("UPDATE hltv_upstream_runs SET status='failed' WHERE id=?").run(run.id);
  require("../src/hltv/statisticsQueue").releaseStatisticsLeases(r);
  assert.equal(r.eligible(r.get(demo.id),Date.now()),false);
  assert.equal(r.cleanup({enabled:true,dryRun:true,verifyFiles:false}).eligible,0);
  r.db.prepare("UPDATE hltv_statistics_jobs SET run_id=NULL,skip_reason='unfinalized_demo' WHERE demo_id=?").run(demo.id);
  assert.equal(r.eligible(r.get(demo.id),Date.now()),false);
});
test("duplicate handoff is idempotent; unavailable analyzer blocks deletion", t => {
  const { registry: r, demo, manifest } = fixture(t);
  assert.equal(r.ingest(manifest)[0].id, demo.id);
  assert.equal(r.list({}).length, 1);
  assert.equal(demo.analysis_status, "unsupported");
  assert.equal(r.cleanup({ enabled: true, dryRun: false }).deleted, 0);
});

test("finalized recovery preserves the original, rejects unrelated bytes and queues one linked replacement",t=>{
  const {registry:r,root}=fixture(t),old=Buffer.alloc(644);old.write("HLDEMO");old.write("2fort",16);old.write("tfc",276);old.fill(7,544);
  fs.writeFileSync(path.join(root,"incoming/recording/open.dem"),old);
  const original=r.ingest({version:1,match_id:"recover",server:"east",map:"2fort",demos:[{storage_key:"incoming/recording/open.dem",filename:"-2611170000-2fort.dem",recorded_at:1000} ]})[0];
  r.action(original.id,"flag",{reason:"review",priority:"high"},"admin");r.action(original.id,"claim",{},"admin");r.action(original.id,"evidence",{reason:"retain evidence"},"admin");
  const complete=Buffer.alloc(760);old.copy(complete);complete.writeInt32LE(664,540);complete.writeInt32LE(1,664);complete.writeInt32LE(544,668+84);complete.writeInt32LE(120,668+88);
  fs.writeFileSync(path.join(root,"incoming/recording/recovered.dem"),complete);
  const input={storage_key:"incoming/recording/recovered.dem",filename:"recover-2fort-recovered.dem"};
  const wrong=Buffer.from(complete);wrong[600]=9;fs.writeFileSync(path.join(root,"incoming/recording/wrong.dem"),wrong);
  assert.throws(()=>r.recoverFinalizedSource(original.id,{...input,storage_key:"incoming/recording/wrong.dem"},"admin"),/prefix/);
  const result=r.recoverFinalizedSource(original.id,input,"admin"),again=r.recoverFinalizedSource(original.id,input,"admin");
  assert.equal(result.demo_id,again.demo_id);assert.equal(result.run_id,again.run_id);assert.notEqual(result.demo_id,original.id);
  assert.deepEqual(fs.readFileSync(path.join(root,original.storage_key)),old);assert.equal(r.get(original.id).sha256,original.sha256);
  assert.equal(r.detail(original.id).case.assigned_to,"admin");assert.equal(r.get(result.demo_id).retention_class,"evidence");assert(r.detail(result.demo_id).holds.length);
  assert.equal(r.detail(original.id).recovered_source.recovered_demo_id,result.demo_id);assert.equal(r.detail(result.demo_id).recovered_from.original_demo_id,original.id);
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_upstream_runs WHERE demo_id=?").get(result.demo_id).n,1);
  const {downloadName}=require("../src/hltv/sourceRecovery");assert.equal(downloadName(r.get(result.demo_id),2),"recover-2fort-round-2.dem");assert.match(downloadName(r.get(result.demo_id),null),/unpaired-/);
  require("../src/hltv/statisticsQueue").queueAutomaticStatistics(r,{enabled:true,statisticsEnabled:true,statisticsAutoCollect:true});
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_statistics_jobs WHERE demo_id=?").get(original.id).n,0);
  r.db.prepare("UPDATE hltv_upstream_runs SET status='complete' WHERE id=?").run(result.run_id);
  r.action(result.demo_id,"flag",{reason:"new finding",priority:"high"},"rule");
  const listed=r.list({search:"recover"});assert.equal(listed.length,1);assert.equal(listed[0].id,result.demo_id);assert.equal(listed[0].upstream_status,"complete");assert.equal(listed[0].review_status,"in_review");assert.equal(listed[0].assigned_to,"admin");
  assert.equal(r.list({status:"in_review",search:"recover"}).length,1);
  const current=r.detail(result.demo_id);assert.equal(current.review_demo_id,original.id);assert.equal(current.case.assigned_to,"admin");assert(current.holds.some(h=>h.demo_id===original.id));
});
test("opt-in manual mode expires only overdue unflagged demos without pretending analysis completed", t => {
  const {registry:r,demo,root}=fixture(t);
  r.manualRetentionEnabled=true;
  assert.equal(r.summary().analysis_blocked,0);
  r.db.prepare("UPDATE hltv_demos SET expires_at=? WHERE id=?").run(Date.now()+86400000,demo.id);
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
  r.db.prepare("UPDATE hltv_demos SET expires_at=1 WHERE id=?").run(demo.id);
  assert.equal(r.cleanup({enabled:true,dryRun:true}).eligible,1);
  assert.ok(fs.existsSync(path.join(root,demo.storage_key)));
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,1);
  assert.equal(r.get(demo.id).analysis_status,"unsupported");
  assert.ok(r.detail(demo.id).audit.some(a=>a.action==="deletion_claimed" && JSON.parse(a.details).retention_mode==="manual_review"));
});
test("manual routine expiry does not bypass failures, analysis runs, holds or flagged review", t => {
  const {registry:r,demo}=fixture(t);r.manualRetentionEnabled=true;
  for(const status of ["pending","processing","failed"]){
    r.db.prepare("UPDATE hltv_demos SET analysis_status=? WHERE id=?").run(status,demo.id);
    assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
  }
  r.db.prepare("UPDATE hltv_demos SET analysis_status='unsupported',last_error='incomplete source' WHERE id=?").run(demo.id);
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
  r.db.prepare("UPDATE hltv_demos SET last_error=NULL WHERE id=?").run(demo.id);
  r.db.prepare("INSERT INTO hltv_analysis_runs(id,demo_id,status,started_at) VALUES('run',?,'unsupported',1)").run(demo.id);
  assert.equal(r.summary().analysis_blocked,1);
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
  r.db.prepare("DELETE FROM hltv_analysis_runs WHERE id='run'").run();
  r.action(demo.id,"flag",{reason:"keep for review"},"123");
  r.db.prepare("UPDATE hltv_demos SET expires_at=1 WHERE id=?").run(demo.id);
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
  r.action(demo.id,"status",{status:"dismissed",reason:"review closed"},"123");
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
  assert.equal(r.get(demo.id).file_status,"available");
});
test("upstream queue is idempotent and protects a running job even if its hold is released", t => {
  const {registry:r,demo}=fixture(t), {queueRun}=require("../src/hltv/upstream");
  r.manualRetentionEnabled=true;
  const first=queueRun(r,demo.id,"123"), second=queueRun(r,demo.id,"123");
  assert.equal(first.id,second.id);
  assert.equal(r.detail(demo.id).holds.length,1);
  const hold=r.detail(demo.id).holds[0];
  r.action(demo.id,"release-hold",{reason:"administrator action",hold_id:hold.id},"123");
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
});
test("targeted upstream work selects only the requested run and never falls through to another match",async t=>{
  const {registry:r,demo,root}=fixture(t),{queueRun,runPending}=require("../src/hltv/upstream");
  const older=queueRun(r,demo.id,"admin"),other=statisticsRound(r,root,{seq:90,match:"DZW8NE"}),target=queueRun(r,other.demo_id,"admin");
  r.db.prepare("UPDATE hltv_upstream_runs SET created_at=1 WHERE id=?").run(older.id);
  r.minFreeBytes=Number.MAX_SAFE_INTEGER;
  const result=await runPending(r,{enabled:true,runId:target.id,statisticsEnabled:true,statisticsAutoCollect:true});
  assert.equal(result.run_id,target.id);assert.equal(result.status,"failed");
  assert.equal(r.db.prepare("SELECT status FROM hltv_upstream_runs WHERE id=?").get(older.id).status,"queued");
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_statistics_jobs").get().n,0);
  const again=await runPending(r,{enabled:true,runId:target.id});assert.equal(again.processed,0);assert.equal(again.reason,"requested_run_not_queued_or_worker_busy");
  assert.equal(r.db.prepare("SELECT status FROM hltv_upstream_runs WHERE id=?").get(older.id).status,"queued");
  await assert.rejects(runPending(r,{enabled:true,runId:"invalid"}),/Invalid upstream run ID/);
});

test("disabled upstream worker never starts a queued job",async t=>{
  const {registry:r,demo}=fixture(t), {queueRun,runPending}=require("../src/hltv/upstream");
  queueRun(r,demo.id,"123");
  assert.equal((await runPending(r,{enabled:false})).processed,0);
  assert.equal(r.db.prepare("SELECT status FROM hltv_upstream_runs").get().status,"queued");
});
test("bounded upstream process rejects timeouts and oversized output",async()=>{
  const {child}=require("../src/hltv/upstream");
  await assert.rejects(child(process.execPath,["-e","setTimeout(()=>{},10000)"],null,30),/resource_limit/);
  await assert.rejects(child(process.execPath,["-e","process.stdout.write('x'.repeat(3*1024*1024))"],null,3000),/resource_limit/);
});
test("missing upstream release fails safely and keeps its review hold",async t=>{
  const {registry:r,demo,root}=fixture(t), {queueRun,runPending}=require("../src/hltv/upstream");
  const queued=queueRun(r,demo.id,"123");
  const result=await runPending(r,{enabled:true,root:path.join(root,"not-installed"),python:process.execPath});
  assert.equal(result.status,"failed");
  assert.equal(r.db.prepare("SELECT status FROM hltv_upstream_runs WHERE id=?").get(queued.id).status,"failed");
  assert.equal(r.detail(demo.id).holds.length,1);
  assert.equal(r.get(demo.id).analysis_status,"unsupported");
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_alerts").get().n,0);
});
test("interrupted upstream cache is reaped without touching original demos or holds",t=>{
  const {registry:r,demo,root}=fixture(t), {queueRun,reapScratch}=require("../src/hltv/upstream");
  const queued=queueRun(r,demo.id,"123"), scratch=path.join(root,"cache","ghosty-"+queued.id);
  fs.mkdirSync(scratch,{recursive:true});fs.writeFileSync(path.join(scratch,"meta.json.gz"),"partial decoded cache");
  reapScratch(r);assert.ok(fs.existsSync(scratch),"active scratch stays available to its worker");
  r.db.prepare("UPDATE hltv_upstream_runs SET status='failed' WHERE id=?").run(queued.id);
  reapScratch(r);assert.equal(fs.existsSync(scratch),false);
  assert.ok(fs.existsSync(path.join(root,demo.storage_key)));assert.equal(r.detail(demo.id).holds.length,1);
});
test("report holds survive closure, evidence preservation and policy changes", t => {
  const { registry: r, demo } = fixture(t);
  r.action(demo.id, "report", { reason: "player report" }, "123");
  r.action(demo.id, "status", { status: "dismissed", reason: "reviewed" }, "123");
  assert.equal(r.detail(demo.id).holds.length, 1);
  r.action(demo.id, "evidence", { reason: "retain original" }, "123");
  r.action(demo.id, "policy", { class: "normal", days: 1 }, "123");
  assert.equal(r.cleanup({ enabled: true, dryRun: false }).deleted, 0);
  assert.ok(r.detail(demo.id).audit.length >= 3);
});
test("explicit waiver allows expired normal deletion; dry-run retains bytes", t => {
  const { registry: r, demo, root } = fixture(t);
  r.action(demo.id, "waive-analysis", { reason: "manually inspected" }, "123");
  assert.equal(r.cleanup({ enabled: true, dryRun: true }).eligible, 1);
  assert.ok(fs.existsSync(path.join(root, demo.storage_key)));
  assert.equal(r.cleanup({ enabled: true, dryRun: false }).deleted, 1);
  assert.equal(r.detail(demo.id).file_status, "deleted");
});
test("traversal and checksum substitution stop storage operations", t => {
  const { registry: r, demo, manifest, root } = fixture(t);
  assert.throws(() => r.ingest({ ...manifest, demos: [{ ...manifest.demos[0], storage_key: "../escape.dem" }] }));
  fs.writeFileSync(path.join(root, demo.storage_key), "tampered");
  assert.throws(() => r.action(demo.id, "evidence", { reason: "preserve" }, "123"));
  r.action(demo.id, "waive-analysis", { reason: "manual inspection" }, "123");
  assert.equal(r.cleanup({ enabled: true, dryRun: false }).deleted, 0);
  assert.ok(fs.existsSync(path.join(root, demo.storage_key)));
});
test("manifest worker recovers completed downloads without re-fetching", t => {
  const { registry: r, manifest, root } = fixture(t);
  fs.writeFileSync(path.join(root,"incoming/recording/ready.json"),JSON.stringify(manifest));
  assert.equal(ingestPending(r).registered,1);
  assert.equal(ingestPending(r).registered,0);
  assert.equal(r.list({}).length,1);
});
test("all incomplete states, active reviews and evidence stop cleanup", t => {
  const { registry:r,demo }=fixture(t);
  for(const status of ["pending","processing","failed","unsupported"]){
    r.db.prepare("UPDATE hltv_demos SET analysis_status=? WHERE id=?").run(status,demo.id);
    assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
  }
  r.action(demo.id,"waive-analysis",{reason:"inspected"},"123");
  r.action(demo.id,"flag",{reason:"needs review"},"123");
  const hold=r.detail(demo.id).holds[0];
  r.action(demo.id,"release-hold",{reason:"case still open",hold_id:hold.id},"123");
  r.db.prepare("UPDATE hltv_demos SET expires_at=1 WHERE id=?").run(demo.id);
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
});
test("failed/missing file and symlink input never delete other files",t=>{
  const {registry:r,demo,root}=fixture(t);
  const outside=path.join(root,"outside.dem");fs.writeFileSync(outside,"private");
  fs.unlinkSync(path.join(root,demo.storage_key));
  r.action(demo.id,"waive-analysis",{reason:"inspected previously"},"123");
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,0);
  assert.equal(fs.readFileSync(outside,"utf8"),"private");
  // Directory junctions are available without Windows symlink privileges.
  fs.symlinkSync(root,path.join(root,"incoming/link"),"junction");
  assert.throws(()=>r.storage.resolve("incoming/link/outside.dem"));
});
test("default adapter produces unsupported, never fabricated findings",async()=>{
  const input={demo_id:"demo",sha256:"checksum"};
  const result=await new UnavailableAnalyzer().analyze(input);
  assert.equal(validateResult(input,result).status,"unsupported");
  assert.deepEqual(result.anomalies,[]);
  assert.throws(()=>validateResult(input,{...result,demo_id:"other"}));
  assert.throws(()=>validateResult(input,{...result,status:"complete",anomalies:[{event_id:"x",severity:"high"}]}));
});
test("review API denies unknown credentials and keeps paths private",async t=>{
  const {registry:r,demo}=fixture(t);
  const express=require("express"), {createRouter}=require("../src/hltv/router");
  const token="a".repeat(48), user="123456789012345678";
  const app=express();app.use("/api/admin/hltv",createRouter({registry:r,env:{HLTV_REVIEW_ALLOWED_USER_IDS:user,HLTV_REVIEW_TOKEN_HASHES:JSON.stringify({[user]:crypto.createHash("sha256").update(token).digest("hex")})}}));
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/admin/hltv`;
  for(const endpoint of ["/demos","/jobs","/demos/"+demo.id,"/demos/"+demo.id+"/file","/demos/"+demo.id+"/statistics","/demos/"+demo.id+"/investigation","/demos/"+demo.id+"/players/STEAM_0:1:123/history","/demos/"+demo.id+"/players/STEAM_0:1:123/timeline"]){
    assert.equal((await fetch(url+endpoint)).status,401);
    assert.equal((await fetch(url+endpoint,{headers:{Authorization:"Bearer "+"b".repeat(48)}})).status,403);
  }
  assert.equal((await fetch(url+`/demos/${demo.id}/actions/hold`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:"unauthorized"})})).status,401);
  assert.equal((await fetch(url+`/demos/${demo.id}/upstream`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status,401);
  assert.equal((await fetch(url+`/demos/${demo.id}/upstream`,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:"{}"})).status,404);
  const res=await fetch(url+"/demos/"+demo.id,{headers:{Authorization:"Bearer "+token}});
  assert.equal(res.status,200);assert.equal((await res.json()).storage_key,undefined);
  assert.equal(r.detail(demo.id).holds.length,0);
});
test("reviewer accounts require password changes and restrict account management to owners",async t=>{
  const {registry:r,demo}=fixture(t),express=require("express"),{createRouter}=require("../src/hltv/router");
  const owner="123456789012345678",key="o".repeat(48),app=express();
  app.use(createRouter({registry:r,env:{HLTV_REVIEW_ACCOUNTS_ENABLED:"true",HLTV_REVIEW_OWNER_USER_IDS:owner,HLTV_REVIEW_ALLOWED_USER_IDS:owner,HLTV_REVIEW_TOKEN_HASHES:JSON.stringify({[owner]:crypto.createHash("sha256").update(key).digest("hex")})}}));
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(url,token,body)=>fetch(base+url,{method:body?"POST":"GET",headers:{...(token?{Authorization:"Bearer "+token}:{}),"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request("/auth/options")).status,200);
  assert.equal((await request("/users",null,{})).status,401);
  assert.equal((await request("/users",key,{username:"small",password:"short"})).status,400);
  const created=await request("/users",key,{username:"reviewer",password:"temp42"});assert.equal(created.status,201);const user=await created.json();assert.equal(user.password_hash,undefined);
  assert.equal((await request("/users",key,{username:"REVIEWER",password:"temp42"})).status,409);
  assert.equal((await request("/auth/login",null,{username:"reviewer",password:"incorrect password"})).status,401);
  const first=await (await request("/auth/login",null,{username:"REVIEWER",password:"temp42"})).json();assert(first.token);assert.equal(first.must_change_password,true);
  for(const endpoint of ["/demos","/demos/"+demo.id,"/demos/"+demo.id+"/file","/users"])assert.equal((await request(endpoint,first.token)).status,403);
  assert.equal((await request("/account/password",first.token,{current_password:"temp42",new_password:"temp42"})).status,400);
  const changed=await (await request("/account/password",first.token,{current_password:"temp42",new_password:"new456"})).json();assert(changed.token);
  assert.equal((await request("/demos",first.token)).status,403);
  assert.equal((await request("/demos",changed.token)).status,200);
  assert.equal((await request("/users",changed.token,{username:"intruder",password:"another passphrase"})).status,403);
  assert.equal((await request("/users/"+user.id+"/reset",changed.token,{password:"reset8"})).status,403);
  assert.equal((await request("/users/"+user.id+"/reset",key,{password:"reset8"})).status,200);
  assert.equal((await request("/demos",changed.token)).status,403);
  const reset=await (await request("/auth/login",null,{username:"reviewer",password:"reset8"})).json();assert.equal(reset.must_change_password,true);
  assert.equal((await request("/users/"+user.id+"/disable",key,{})).status,200);
  assert.equal((await request("/session",reset.token)).status,403);
  assert.equal((await request("/auth/login",null,{username:"reviewer",password:"reset8"})).status,401);
  const stored=r.db.prepare("SELECT password_hash FROM hltv_review_users WHERE id=?").get(user.id).password_hash;assert(!stored.includes("passphrase"));assert.match(stored,/^scrypt\$/);
  assert(!JSON.stringify(r.db.prepare("SELECT * FROM hltv_audit").all()).includes("passphrase"));
});

test("account login throttles persist, sessions expire and logout revokes access",async t=>{
  const {registry:r}=fixture(t),{ReviewerAccounts}=require("../src/hltv/accounts");
  const accounts=new ReviewerAccounts(r,{HLTV_REVIEW_ACCOUNTS_ENABLED:"true",HLTV_REVIEW_OWNER_USER_IDS:"123456789012345678"});
  const user=await accounts.create({username:"example",password:"temporary passphrase"},"123456789012345678");
  const other=await accounts.create({username:"another",password:"temporary passphrase"},"123456789012345678");
  assert.notEqual(r.db.prepare("SELECT password_hash FROM hltv_review_users WHERE id=?").get(user.id).password_hash,r.db.prepare("SELECT password_hash FROM hltv_review_users WHERE id=?").get(other.id).password_hash);
  const owner=await accounts.create({username:"owner",password:"temporary passphrase",discord_id:"123456789012345678"},"123456789012345678");
  assert.throws(()=>accounts.disable(owner.id,"123456789012345678"),e=>e.status===400);
  for(let i=0;i<10;i++)await assert.rejects(accounts.login({username:"missing",password:"wrong passphrase"},"client"),e=>e.status===401);
  await assert.rejects(new ReviewerAccounts(r,{HLTV_REVIEW_ACCOUNTS_ENABLED:"true"}).login({username:"missing",password:"wrong passphrase"},"other-client"),e=>e.status===429);
  const login=await accounts.login({username:"example",password:"temporary passphrase"},"client");assert(accounts.authenticate(login.token));
  r.db.prepare("UPDATE hltv_review_sessions SET expires_at=0").run();assert.equal(accounts.authenticate(login.token),null);
  const second=await accounts.login({username:"example",password:"temporary passphrase"},"client");accounts.logout(second.token);assert.equal(accounts.authenticate(second.token),null);
  const sessions=[];for(let i=0;i<6;i++)sessions.push(await accounts.login({username:"example",password:"temporary passphrase"},"client"));
  assert.equal(accounts.authenticate(sessions[0].token),null);assert(accounts.authenticate(sessions[5].token));
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM hltv_review_sessions WHERE user_id=?").get(user.id).n,5);
  const disabled=new ReviewerAccounts(r,{});assert.equal(disabled.authenticate(sessions[5].token),null);await assert.rejects(disabled.login({username:"example",password:"temporary passphrase"},"client"),e=>e.status===404);
  assert.equal(user.username,"example");
});

test("private statistics API returns an explicit empty state when collection is enabled",async t=>{
  const {registry:r,demo}=fixture(t),express=require("express"),{createRouter}=require("../src/hltv/router");
  const token="c".repeat(48),user="123456789012345678",app=express();
  app.use(createRouter({registry:r,env:{HLTV_STATISTICS_ENABLED:"true",HLTV_REVIEW_ALLOWED_USER_IDS:user,HLTV_REVIEW_TOKEN_HASHES:JSON.stringify({[user]:crypto.createHash("sha256").update(token).digest("hex")})}}));
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/demos/${demo.id}/statistics`,{headers:{Authorization:"Bearer "+token}});
  assert.equal(response.status,200);assert.equal((await response.json()).observation,null);
});
test("cleanup reconciles an interrupted deletion and serializes competing holds",t=>{
  const {registry:r,demo,root}=fixture(t);
  r.action(demo.id,"waive-analysis",{reason:"inspected"},"123");
  const other=new Registry({root,database:path.join(root,"registry.db"),minFreeBytes:0});
  other.db.pragma("busy_timeout=0");
  const verify=r.storage.verify.bind(r.storage); let blocked=false;
  r.storage.verify=d=>{try{other.action(d.id,"hold",{reason:"concurrent"},"456");}catch(e){blocked=e.code==="SQLITE_BUSY";}return verify(d);};
  // Simulate crash after unlink with the durable deleting marker still present.
  r.db.prepare("UPDATE hltv_demos SET file_status='deleting' WHERE id=?").run(demo.id);
  fs.unlinkSync(path.join(root,demo.storage_key));
  r.cleanup({enabled:true,dryRun:false});
  assert.equal(blocked,true);
  assert.equal(r.get(demo.id).file_status,"deleted");
  assert.ok(r.detail(demo.id).audit.some(a=>a.action==="deletion_reconciled"));
  other.close();
});
test("an available missing file is not misreported as a completed deletion",t=>{
  const {registry:r,demo,root}=fixture(t);
  r.action(demo.id,"waive-analysis",{reason:"inspected"},"123");
  fs.unlinkSync(path.join(root,demo.storage_key));
  r.cleanup({enabled:true,dryRun:false});
  assert.notEqual(r.get(demo.id).file_status,"deleted");
});
test("deletion intent is committed before unlink",t=>{
  const {registry:r,demo,root}=fixture(t);
  r.action(demo.id,"waive-analysis",{reason:"inspected"},"123");
  const other=new Registry({root,database:path.join(root,"registry.db"),minFreeBytes:0});
  const unlink=fs.unlinkSync;let observed;
  fs.unlinkSync=file=>{observed=other.get(demo.id).file_status;return unlink(file);};
  try{r.cleanup({enabled:true,dryRun:false});}finally{fs.unlinkSync=unlink;other.close();}
  assert.equal(observed,"deleting");
});
test("duplicate physical files are managed by the same review and retention",t=>{
  const {registry:r,demo,root,manifest}=fixture(t);
  fs.mkdirSync(path.join(root,"incoming/retry"));
  fs.copyFileSync(path.join(root,demo.storage_key),path.join(root,"incoming/retry/round.dem"));
  assert.equal(r.ingest({...manifest,demos:[{...manifest.demos[0],storage_key:"incoming/retry/round.dem"}]})[0].id,demo.id);
  assert.equal(r.summary().available_bytes,demo.size_bytes*2);
  r.action(demo.id,"waive-analysis",{reason:"inspected"},"123");
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,1);
  assert.equal(fs.existsSync(path.join(root,"incoming/retry/round.dem")),false);
});
test("blocked earlier rows do not starve eligible files",t=>{
  const {registry:r,demo}=fixture(t);
  const insert=r.db.prepare(`INSERT INTO hltv_demos(id,match_id,server,storage_key,filename,size_bytes,sha256,recorded_at,ingested_at,expires_at)
    VALUES(?,?,'east',?,'blocked.dem',1,?,1,1,1)`);
  for(let i=0;i<105;i++)insert.run("blocked"+i,"blocked"+i,"missing"+i+".dem","hash"+i);
  r.action(demo.id,"waive-analysis",{reason:"inspected"},"123");
  assert.equal(r.cleanup({enabled:true,dryRun:false}).deleted,1);
});
test("backfill cannot assign another demo's held physical file as a copy",t=>{
  const {registry:r,demo,root,manifest}=fixture(t);
  fs.mkdirSync(path.join(root,"incoming/other"));
  fs.copyFileSync(path.join(root,demo.storage_key),path.join(root,"incoming/other/round.dem"));
  const second=r.ingest({...manifest,match_id:"match2",demos:[{...manifest.demos[0],storage_key:"incoming/other/round.dem"}]})[0];
  r.action(demo.id,"evidence",{reason:"protected first recording"},"123");
  assert.throws(()=>r.ingest({...manifest,match_id:"match2"}));
  r.action(second.id,"waive-analysis",{reason:"inspected second"},"123");
  r.cleanup({enabled:true,dryRun:false});
  assert.ok(fs.existsSync(path.join(root,demo.storage_key)));
});
test("backfill reactivates verified bytes restored at the original storage key",t=>{
  const {registry:r,demo,root,manifest}=fixture(t);
  const bytes=fs.readFileSync(path.join(root,demo.storage_key));
  r.action(demo.id,"waive-analysis",{reason:"inspected"},"123");r.cleanup({enabled:true,dryRun:false});
  fs.writeFileSync(path.join(root,demo.storage_key),bytes);
  const restored=r.ingest(manifest)[0];
  assert.equal(restored.file_status,"available");assert.equal(restored.analysis_waiver,null);
});
