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
test("duplicate handoff is idempotent; unavailable analyzer blocks deletion", t => {
  const { registry: r, demo, manifest } = fixture(t);
  assert.equal(r.ingest(manifest)[0].id, demo.id);
  assert.equal(r.list({}).length, 1);
  assert.equal(demo.analysis_status, "unsupported");
  assert.equal(r.cleanup({ enabled: true, dryRun: false }).deleted, 0);
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
  for(const endpoint of ["/demos","/demos/"+demo.id,"/demos/"+demo.id+"/file","/demos/"+demo.id+"/statistics","/demos/"+demo.id+"/players/STEAM_0:1:123/history"]){
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
