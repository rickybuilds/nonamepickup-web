"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),http=require("node:http"),{spawn}=require("node:child_process");
const edge="C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const page=fs.readFileSync(path.join(__dirname,"../src/hltv/review.html"));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await pause(40);}throw Error("Browser test timed out");}
function cdpsocket(url){return new Promise((resolve,reject)=>{const ws=new WebSocket(url),waiting=new Map();let next=0;ws.addEventListener("open",()=>resolve({
  command(method,params={}){return new Promise((yes,no)=>{const id=++next;waiting.set(id,{yes,no});ws.send(JSON.stringify({id,method,params}));});},close(){ws.close();}}));
  ws.addEventListener("message",event=>{const data=JSON.parse(event.data);if(!data.id)return;const call=waiting.get(data.id);if(!call)return;waiting.delete(data.id);data.error?call.no(Error(data.error.message)):call.yes(data.result);});ws.addEventListener("error",reject);});}
test("browser navigation keeps controls enabled through queue, rapid switching, and API failure",{skip:process.platform!=="win32"||!fs.existsSync(edge)?"Requires installed Windows Edge":false,timeout:60000},async t=>{
  const state={calls:[],failNext:false,delayQueue:false,includeDemo:false,scannerStatus:"completed",scannerFindings:true,statisticsEnabled:true};
  const steam="STEAM_0:1:123",target="STEAM_0:1:456";
  const observation={id:"observation-1",demo_sha256:"a".repeat(64),upstream_sha:"b".repeat(40),config_hash:"c".repeat(64)};
  const findings=[{id:"1".repeat(32),category:"wall_track",steam_id:steam,player_name:"Player",target_steam_id:target,target_name:"Target",time_seconds:10,end_seconds:11.25,source:"ghosty_runAnalysis",quality:"reconstructed_geometry",details:{duration_seconds:1.25,target_movement:120,angular_sweep_degrees:8,related_firing:1,related_kill:false},limitations:["Reconstructed occlusion is not awareness."]},
    {id:"2".repeat(32),category:"snap",steam_id:steam,player_name:"Player",target_steam_id:target,target_name:"Target",time_seconds:20,end_seconds:20,source:"ghosty_runAnalysis",quality:"reconstructed_geometry",details:{angular_turn_degrees:20,sample_interval_seconds:.05,angular_speed_degrees_per_second:400,firing_delay_seconds:.08,heuristic_score:.6},limitations:["Snapshot samples do not prove intent."]}];
  const statistics={observation:{id:"observation-1",log_round:1,upstream_sha:"b".repeat(40),config_hash:"c".repeat(64),groups:[
    {steam_id:steam,player_name:"Player",class_id:1,weapon:"ac",state:"conc",recorded:500,eligible:409,aim_near:107,evidence_eligible:409,strict:108,inclusive:120,geometry_hit:107,no_enemy:0,unavailable:0,uncertain:0,complete:1},
    {steam_id:steam,player_name:"Player",class_id:1,weapon:"ac",state:"outside",recorded:800,eligible:674,aim_near:153,evidence_eligible:674,strict:177,inclusive:190,geometry_hit:153,no_enemy:0,unavailable:0,uncertain:0,complete:1}],review_context:[{steam_id:steam,class_id:1,weapon:"ac",conc_windows:12,baseline:{games:3,required_games:25,ready:false,percent:null}}]},job:null};
  const scanner=()=>({wall_track:{state:state.scannerStatus,count:state.scannerStatus==="completed"&&state.scannerFindings?1:0,can_run:state.scannerStatus!=="queued",reason:state.scannerStatus==="missing_assets"?"missing_map_asset":"Scanner completed."},snap:{state:state.scannerStatus,count:state.scannerStatus==="completed"&&state.scannerFindings?1:0,can_run:state.scannerStatus!=="queued",reason:"Scanner completed."},players:{[steam]:{wall_track:state.scannerFindings?1:0,snap:state.scannerFindings?1:0}}});
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,"http://localhost");state.calls.push(url.pathname+url.search);
    res.setHeader("Content-Type",url.pathname==="/admin/hltv-review"?"text/html":"application/json");
    if(url.pathname==="/admin/hltv-review")return res.end(page);
    if(url.pathname.endsWith("/auth/options"))return res.end(JSON.stringify({accounts_enabled:false}));
    if(url.pathname.endsWith("/session"))return res.end(JSON.stringify({user_id:"qa",username:"qa",accounts_enabled:false,can_manage_users:false,must_change_password:false,upstream_enabled:false,statistics_enabled:state.statisticsEnabled}));
    if(url.pathname.endsWith("/demos")){if(state.delayQueue&&url.searchParams.get("status")==="queued")await pause(250);return res.end(JSON.stringify(state.includeDemo?[{id:"demo-1",map:"2fort",match_id:"MATCH1",server:"east",recorded_at:Date.now(),review_status:"queued",priority:"high",upstream_status:null,log_round:1}]:[]));}
    if(url.pathname.endsWith("/demos/demo-1"))return res.end(JSON.stringify({id:"demo-1",map:"2fort",match_id:"MATCH1",server:"east",recorded_at:Date.now(),review_status:"queued",file_status:"available",analysis_status:"unsupported",retention_class:"normal",expires_at:Date.now()+86400000,sha256:"a".repeat(64),upstream_runs:[],holds:[],notes:[],anomalies:[],aim_markers:[],gap_findings:[],audit:[]}));
    if(url.pathname.endsWith("/demos/demo-1/statistics"))return res.end(JSON.stringify(statistics));
    if(url.pathname.endsWith("/demos/demo-1/investigation"))return res.end(JSON.stringify({status:"ready",players:[{steam_id:steam,name:"Player"}],scanner:scanner()}));
    if(url.pathname.includes("/players/")&&url.pathname.endsWith("/timeline")){const list=state.scannerStatus==="completed"&&state.scannerFindings?findings.filter(e=>!url.searchParams.get("category")||e.category===url.searchParams.get("category")):[];return res.end(JSON.stringify({status:"ready",observation,scanner:scanner(),total:list.length,offset:0,limit:100,events:list}));}
    if(url.pathname.includes("/events/"))return res.end(JSON.stringify({observation,event:findings.find(e=>url.pathname.endsWith(e.id))}));
    if(url.pathname.includes("/actions/"))return res.end(JSON.stringify({ok:true}));
    if(url.pathname.endsWith("/jobs"))return res.end("[]");
    if(url.pathname.endsWith("/storage-summary")){if(state.failNext){state.failNext=false;res.statusCode=503;return res.end(JSON.stringify({error:"unavailable"}));}return res.end(JSON.stringify({current_demos:1,demos:1,open_reviews:0,high_priority_reviews:0,free_bytes:1073741824,low_disk:false,policy:[{class:"normal",days:7}]}));}
    res.statusCode=404;res.end("{}");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"hltv-browser-"));
  const browser=spawn(edge,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--remote-debugging-port=0",`--user-data-dir=${profile}`,`http://127.0.0.1:${server.address().port}/admin/hltv-review`],{windowsHide:true,stdio:"ignore"});
  let cdp;
  t.after(async()=>{try{await Promise.race([cdp?.command("Browser.close"),pause(600)]);}catch{}cdp?.close();browser.kill();await pause(150);try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch(error){t.diagnostic("Edge retained its temporary profile: "+error.code);}});
  const portFile=path.join(profile,"DevToolsActivePort");
  const port=await until(()=>fs.existsSync(portFile)&&Number(fs.readFileSync(portFile,"utf8").split(/\r?\n/)[0]));
  const targets=await until(async()=>{const response=await fetch(`http://127.0.0.1:${port}/json`);const targets=await response.json();return targets.find(target=>target.type==="page"&&target.url.includes("hltv-review"))?.webSocketDebuggerUrl;});
  cdp=await cdpsocket(targets);await cdp.command("Runtime.enable");
  const evalJs=async expression=>{const result=await cdp.command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
  await until(()=>evalJs("!!document.getElementById('login')"));
  await evalJs("document.getElementById('token').value='local-test';document.querySelector('#login button').click()");
  await until(()=>evalJs("document.getElementById('workspace').hidden===false && document.getElementById('summaryRecordings').textContent==='1'"));
  const side=label=>`[...document.querySelectorAll('.console-side button')].find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`;
  const check=()=>evalJs("({status:document.getElementById('status').value,disabled:[...document.querySelectorAll('.console-side button,#lock,#refresh,#filters button')].filter(b=>b.disabled).map(b=>b.textContent.trim()),message:document.getElementById('message').textContent})");
  const before=state.calls.filter(call=>call.includes("/demos?")).length;
  await evalJs(side("Review Queue"));await until(()=>state.calls.some(call=>call.includes("status=queued"))&&evalJs("document.getElementById('status').value==='queued'"));
  await pause(180);assert.equal(state.calls.filter(call=>call.includes("/demos?")).length,before+1,"one queue refresh");assert.deepEqual((await check()).disabled,[]);
  await evalJs(side("Registry"));await until(()=>evalJs("document.getElementById('status').value===''"));assert.deepEqual((await check()).disabled,[]);
  for(let i=0;i<3;i++){await evalJs(side("Review Queue"));await evalJs(side("Registry"));}await pause(120);assert.deepEqual((await check()).disabled,[]);
  state.delayQueue=true;await evalJs(`${side("Review Queue")};${side("Registry")}`);await pause(400);
  assert.equal((await check()).status,"");assert.deepEqual((await check()).disabled,[]);
  state.failNext=true;await evalJs(side("Review Queue"));await until(()=>evalJs("document.getElementById('message').textContent.length>0"));assert.deepEqual((await check()).disabled,[]);
  await evalJs(side("Registry"));await until(()=>evalJs("document.getElementById('status').value===''"));assert.deepEqual((await check()).disabled,[]);
  await evalJs(side("Analysis Jobs"));await until(()=>evalJs("document.getElementById('jobsPanel').hidden===false"));assert.deepEqual((await check()).disabled,[]);
  state.includeDemo=true;await evalJs("document.getElementById('refresh').click()");await until(()=>evalJs("document.querySelector('#rows button')!==null"));
  await evalJs("document.querySelector('#rows button').click()");await until(()=>evalJs("document.getElementById('detail').hidden===false"));
  await until(()=>evalJs("document.getElementById('quickOutput').textContent.includes('Aim-near context')"));
  assert.equal(await evalJs("document.getElementById('quickOutput').textContent.includes('Strict hit evidence')"),true);
  assert.equal(await evalJs("document.getElementById('quickOutput').textContent.includes('Near Parity')"),true);
  assert.equal(await evalJs("document.getElementById('quickOutput').textContent.includes('107/409')"),true);
  assert.equal(await evalJs("document.getElementById('quickOutput').textContent.includes('108/409')"),true);
  assert.equal(await evalJs("document.getElementById('statsContext').textContent.includes('Historical consistency: insufficient baseline')"),true);
  statistics.observation.groups[0].complete=0;await evalJs("open('demo-1')");await until(()=>evalJs("document.getElementById('quickOutput').textContent.includes('Near Parity')"));
  assert.equal(await evalJs("document.getElementById('quickOutput').textContent.includes('107/409')"),true);
  assert.equal(await evalJs("document.getElementById('quickOutput').textContent.includes('108/409')"),true);
  statistics.observation.groups[0].complete=1;await evalJs("open('demo-1')");await until(()=>evalJs("document.getElementById('quickOutput').textContent.includes('Near Parity')"));
  await evalJs("[...document.querySelectorAll('.investigation-tabs button')].find(b=>b.textContent==='Wall-Track').click()");
  assert.equal(await evalJs("document.querySelector('.investigation-tabs button.active').textContent"),"Wall-Track");
  await until(()=>evalJs("document.querySelector('.event-row')?.textContent.includes('until 0:11.250')"));
  assert.equal(await evalJs("document.getElementById('evidenceSummary').textContent.includes('Wall-Track: 1 candidate')"),true);
  assert.equal(await evalJs("document.querySelector('.rail-marker.wall_track')?.style.width.length>0"),true);
  await evalJs("document.querySelector('.event-row').click()");
  await until(()=>evalJs("document.getElementById('eventInspector').textContent.includes('Target movement')"));
  await evalJs("[...document.querySelectorAll('.investigation-tabs button')].find(b=>b.textContent==='Snaps').click()");
  await until(()=>evalJs("document.querySelector('.event-row')?.textContent.includes('Pre-shot snap lead')"));
  await evalJs("document.querySelector('.event-row').click()");
  await until(()=>evalJs("document.getElementById('eventInspector').textContent.includes('Sample interval')"));
  state.scannerFindings=false;await evalJs("open('demo-1')");
  await until(()=>evalJs("document.getElementById('evidenceSummary').textContent.includes('Snaps: Completed — none found')"));
  assert.equal(await evalJs("document.getElementById('timelineList').textContent.includes('No candidates for this player')"),true);
  state.scannerStatus="queued";await evalJs("open('demo-1')");
  await until(()=>evalJs("document.getElementById('evidenceSummary').textContent.includes('Snaps: Queued')"));
  state.scannerStatus="missing_assets";await evalJs("open('demo-1')");
  await until(()=>evalJs("document.getElementById('evidenceSummary').textContent.includes('Wall-Track: Missing required assets')"));
  await evalJs("document.getElementById('reason').value='Local review fixture';document.getElementById('actionForm').requestSubmit()");
  await until(()=>state.calls.some(call=>call.includes("/actions/flag")));
  assert.equal(await evalJs("document.getElementById('lock').disabled"),false);
});
