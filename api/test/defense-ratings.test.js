"use strict";

const { loadDefenseRatings } = require("../src/lib/defenseRatings");
const { DatabaseSync } = require("node:sqlite");
const assert = require("node:assert/strict");
const test = require("node:test");

test('report cache serves stale data, coalesces limits and retains success through backoff', async () => {
  const { ReportCache } = require('../src/lib/reportCache');
  let now = 0, revision = 'v1', calls = 0, finish;
  const cache = new ReportCache({ now: () => now, revision: () => revision, ttlMs: 45,
    cooldownMs: 100, retryMs: 200, run: () => { calls++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); } });
  const cold = cache.get('analytics', 5);
  const concurrent = cache.get('analytics', 10);
  assert.equal(calls, 1);
  finish.resolve({ '5': '{"limit":5}', '10': '{"limit":10}' });
  assert.equal((await cold).body, '{"limit":5}');
  assert.equal((await concurrent).body, '{"limit":10}');
  assert.equal((await cache.get('analytics', 5)).status, 'HIT');
  now = 101; revision = 'v2';
  const stale = await cache.get('analytics', 5);
  assert.equal(stale.status, 'STALE'); assert.equal(stale.body, '{"limit":5}');
  assert.equal(calls, 2);
  finish.reject(new Error('worker crash'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await cache.get('analytics', 5)).status, 'BACKOFF');
  assert.equal(calls, 2);
  now = 302;
  assert.equal((await cache.get('analytics', 5)).body, '{"limit":5}');
  finish.resolve({ '5': 'new', '10': 'new10' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await cache.get('analytics', 10)).body, 'new10');
});

test('report cache unchanged data avoids rebuild; cold failures and invalidation recover', async () => {
  const { ReportCache } = require('../src/lib/reportCache');
  let now = 0, calls = 0, fail = true;
  const cache = new ReportCache({ now: () => now, revision: () => 'same', ttlMs: 10,
    cooldownMs: 20, retryMs: 30, run: async () => { calls++; if (fail) throw Error('failed'); return {default:'ok'}; } });
  await assert.rejects(cache.get('defense'), /failed/);
  await assert.rejects(cache.get('defense'), /backoff/);
  fail = false; now = 31;
  assert.equal((await cache.get('defense')).body, 'ok');
  now = 100;
  assert.equal((await cache.get('defense')).status, 'HIT');
  assert.equal(calls, 2);
  cache.invalidate();
  assert.equal((await cache.get('defense')).status, 'STALE');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3);
});

test('report cache serializes report kinds and never starts work without demand', async () => {
  const { ReportCache } = require('../src/lib/reportCache');
  const calls = [], completions = [];
  const cache = new ReportCache({ revision: () => 'v1', cooldownMs:0, run: kind => {
    calls.push(kind); return new Promise(resolve => completions.push(resolve));
  } });
  const a = cache.get('analytics', 5), b = cache.get('defense');
  assert.deepEqual(calls, ['analytics']);
  completions[0]({'5':'a'}); await a;
  assert.deepEqual(calls, ['analytics','defense']);
  completions[1]({default:'b'}); await b;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2); assert.equal(cache.pending.size, 0);
  await assert.rejects(cache.get('analytics',11), /Invalid limit/);
});

test('successful cold reports bootstrap sequentially without the routine refresh cooldown', async () => {
  const {ReportCache}=require('../src/lib/reportCache');
  const calls=[],finish=[];
  const cache=new ReportCache({revision:()=>1,run:kind=>{calls.push(kind);return new Promise(resolve=>finish.push(resolve))}});
  const first=cache.get('defense'),second=cache.get('analytics',5);
  assert.deepEqual(calls,['defense']);
  finish[0]({default:'defense'});await first;
  assert.deepEqual(calls,['defense','analytics']);
  finish[1]({'5':'analytics'});await second;
  cache.invalidate();
  assert.equal((await cache.get('defense')).status,'STALE');
  assert.equal(calls.length,2);assert.ok(cache.timer);
  clearTimeout(cache.timer);
});

test('cold reports cannot bypass cooldown after a failed child', async () => {
  const {ReportCache}=require('../src/lib/reportCache');
  const calls=[];let fail;
  const cache=new ReportCache({revision:()=>1,run:kind=>{calls.push(kind);return new Promise((_,reject)=>{fail=reject})}});
  const first=cache.get('defense'),second=cache.get('analytics',5);
  fail(Error('crashed'));await assert.rejects(first,/crashed/);
  assert.deepEqual(calls,['defense']);assert.ok(cache.timer);
  clearTimeout(cache.timer);
  // The queued promise intentionally remains pending: no extra worker was started.
  void second;
});

test('warming responses request a short retry and do not log expected startup waits as failures', async () => {
  const {createAnalyticsRouter}=require('../src/routes/analytics');
  const {createStatsRouter}=require('../src/routes/stats');
  for(const router of [createAnalyticsRouter,createStatsRouter]){
    const logged=[];const headers={};let status;
    const warming=Object.assign(Error('Report warming'),{code:'REPORT_WARMING'});
    const routes=router({reports:{get:async()=>{throw warming}},positiveInt:()=>5,
      logRouteError:(...args)=>logged.push(args),sendError:(_,value)=>{status=value}});
    await routes.stack[0].route.stack.at(-1).handle({query:{}},{setHeader:(key,value)=>{headers[key]=value}});
    assert.equal(status,503);assert.equal(headers['Retry-After'],'5');assert.equal(logged.length,0);
  }
});

test('a restarted report cache serves its saved success before a new build finishes', async () => {
  const {ReportCache}=require('../src/lib/reportCache');
  const saved=new Map();let loads=0,now=1000,finish;
  const store={load:async kind=>{loads++;return saved.get(kind)},save:async(kind,value)=>{saved.set(kind,value)}};
  const first=new ReportCache({store,now:()=>now,revision:()=>1,run:async()=>({default:'last success'})});
  await first.get('defense');assert.equal(saved.get('defense').bodies.default,'last success');
  now=2000;
  const restarted=new ReportCache({store,now:()=>now,revision:()=>2,run:()=>new Promise(resolve=>{finish=resolve})});
  const [a,b]=await Promise.all([restarted.get('defense'),restarted.get('defense')]);
  assert.equal(a.body,'last success');assert.equal(a.status,'STALE');assert.equal(a.age,1);
  assert.equal(b.body,a.body);assert.equal(loads,2);assert.equal(restarted.pending.size,1);
  finish({default:'updated'});await restarted.pending.get('defense');
  assert.equal(saved.get('defense').bodies.default,'updated');
});

test('snapshot storage failures never reject a successful build or discard a restored response', async () => {
  const {ReportCache}=require('../src/lib/reportCache');
  const store={load:async()=>{throw Error('unreadable')},save:async()=>{throw Error('disk full')}};
  const cache=new ReportCache({store,revision:()=>1,run:async()=>({default:'computed'}),warn:()=>{}});
  assert.equal((await cache.get('defense')).body,'computed');
  const restored=new ReportCache({store:{load:async()=>({generatedAt:Date.now(),bodies:{default:'restored'}}),save:store.save},
    revision:()=>{throw Error('database busy')},run:()=>assert.fail('must not calculate'),warn:()=>{}});
  assert.equal((await restored.get('defense')).body,'restored');
});

test('report disk snapshots are atomic, private, bounded, versioned and tied to a database', async () => {
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const {ReportStore}=require('../src/lib/reportStore');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'noname-snapshots-'));let now=1000;
  try {
    const store=new ReportStore({directory:dir,databaseKey:'a',now:()=>now,maxAgeMs:10000,maxBytes:10000});
    const value={generatedAt:now,bodies:{default:JSON.stringify({ok:true,data:{maps:[],classes:[]}})}};
    assert.equal(await store.load('defense'),null);
    await store.save('defense',value);
    assert.deepEqual(await store.load('defense'),value);
    assert.deepEqual((await fs.readdir(dir)),['defense.json']);
    const other=new ReportStore({directory:dir,databaseKey:'b',now:()=>now});
    assert.equal(await other.load('defense'),null);
    const limited=new ReportStore({directory:dir,databaseKey:'a',now:()=>now,maxBytes:2});
    assert.equal(await limited.load('defense'),null);
    await assert.rejects(limited.save('defense',value),/too large/);
    assert.deepEqual(await store.load('defense'),value);
    now=11001;assert.equal(await store.load('defense'),null);now=1000;
    const file=path.join(dir,'defense.json');let parsed=JSON.parse(await fs.readFile(file,'utf8'));
    await fs.writeFile(file,JSON.stringify({...parsed,version:0}));assert.equal(await store.load('defense'),null);
    await fs.writeFile(file,JSON.stringify({...parsed,bodies:{default:'invalid json'}}));assert.equal(await store.load('defense'),null);
    await fs.writeFile(file,'interrupted JSON');assert.equal(await store.load('defense'),null);
    await store.save('defense',value);
    if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('report revalidation exposes actual DB-check time without rebuilding unchanged statistics', async () => {
  const {ReportCache,reportHeaders}=require('../src/lib/reportCache');
  let now=1000,builds=0,checks=0;
  const cache=new ReportCache({now:()=>now,revision:()=>{checks++;return 1},run:async()=>{builds++;return {default:'same'}}});
  await cache.get('defense');now=7000;
  const report=await cache.get('defense');
  assert.equal(report.validatedAt,7);assert.equal(builds,1);assert.equal(checks,2);
  const headers={};reportHeaders({setHeader:(key,value)=>{headers[key]=value},type(){}},report,'Defense');
  assert.equal(headers['X-Defense-Validated-At'],'7');
});

test('live report watcher checks headers, reloads only changed reports and pauses while hidden', async () => {
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../../assets/js/main.js'),'utf8');
  const start=source.indexOf('function watchReport('),end=source.indexOf('function escapeHtml(');
  const timers=[],events={},statuses=[];let etag='one',calls=0,reloads=0;
  const context={document:{hidden:false,addEventListener:(name,fn)=>{events[name]=fn},removeEventListener(){}},
    window:{addEventListener(){},removeEventListener(){}},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},
    fetch:async(_,options)=>{calls++;assert.equal(options.method,'HEAD');return {ok:true,headers:{get:key=>key==='ETag'?etag:key.endsWith('Validated-At')?'7':'HIT'}}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const stop=context.watchReport('/api/analytics?limit=5',async()=>{reloads++;return {_report:{etag}}},{_report:{etag:'one'}},value=>statuses.push(value));
  await timers.pop()();assert.equal(calls,1);assert.equal(reloads,0);assert.equal(statuses[0].validatedAt,7);
  etag='two';await timers.pop()();assert.equal(reloads,1);
  context.document.hidden=true;await timers.pop()();assert.equal(calls,2);
  context.document.hidden=false;await events.visibilitychange();assert.equal(calls,3);assert.equal(reloads,1);
  stop();
});

test('live analytics refresh retains the current Shame page and clamps a shortened list',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../../assets/js/analytics.js'),'utf8');
  const fn=source.slice(source.indexOf('  function renderShame('),source.indexOf('  function fillActivityMonths('));
  const target={innerHTML:''};let click;
  const context={shamePage:0,document:{getElementById:()=>target},sections:{chaos:[['least_flag_touches','Flags','caps']]},
    renderCard:(_,rows)=>JSON.stringify(rows),bindReportClick:(_,callback)=>{click=callback}};
  vm.createContext(context);vm.runInContext(fn,context);
  const data={least_flag_touches:Array.from({length:12},(_,id)=>({id}))};
  context.renderShame(data,'');click({target:{closest:()=>({dataset:{shamePage:'next'}})}});
  assert.match(target.innerHTML,/Page 2 of 3/);
  context.renderShame(data,'');assert.match(target.innerHTML,/Page 2 of 3/);
  context.renderShame({least_flag_touches:[{id:0}]},'');assert.match(target.innerHTML,/"id":0/);
});

test('live HEAD checks expose freshness and ETag without transferring the report body',async()=>{
  const express=require('express');const {createAnalyticsRouter}=require('../src/routes/analytics');
  const app=express();const body=JSON.stringify({ok:true,data:{generated_at:100,limit:5}});
  app.use(createAnalyticsRouter({reports:{get:async()=>({body,status:'HIT',age:5,validatedAt:105})},positiveInt:()=>5,
    logRouteError:(_,e)=>{throw e},sendError:()=>assert.fail('unexpected error')}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}/analytics?limit=5`;
    const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal(head.headers.get('X-Analytics-Validated-At'),'105');assert.ok(head.headers.get('ETag'));
    const full=await fetch(url);assert.equal(full.headers.get('ETag'),head.headers.get('ETag'));assert.equal(await full.text(),body);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('revision read failures preserve stale reports and apply retry backoff', async () => {
  const {ReportCache}=require('../src/lib/reportCache');
  let now=0,fail=false,reads=0;
  const cache=new ReportCache({now:()=>now,ttlMs:10,cooldownMs:0,retryMs:100,
    revision:()=>{reads++;if(fail)throw Error('database busy');return 'v1'},run:async()=>({default:'good'})});
  await cache.get('defense');now=11;fail=true;
  const stale=await cache.get('defense');
  assert.equal(stale.body,'good');assert.equal(stale.status,'BACKOFF');
  await cache.get('defense');assert.equal(reads,2);
  now=112;fail=false;assert.equal((await cache.get('defense')).body,'good');
});

test('revision markers track imports and successful MVP changes, ignoring unavailable retry timestamps', () => {
  const {createRevisionReader}=require('../src/lib/reportCache');
  let now=0;const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE matches(status TEXT,created_at INTEGER,nn_mvp_status TEXT,nn_mvp_computed_at INTEGER);
      CREATE TABLE match_stat_imports(status TEXT,imported_at INTEGER);
      CREATE TABLE tfcstats_imports(imported_at INTEGER);
      INSERT INTO matches VALUES('completed',1,'unavailable',10),('completed',2,'available',11);
      INSERT INTO match_stat_imports VALUES('ok',10);`);
    const read=createRevisionReader(db,()=>now);const first=read();
    db.exec("UPDATE matches SET nn_mvp_computed_at=99 WHERE nn_mvp_status='unavailable'");now=45001;
    assert.equal(read(),first);
    db.exec("UPDATE matches SET nn_mvp_computed_at=100 WHERE nn_mvp_status='available'");now+=45001;
    const changed=read();assert.notEqual(changed,first);
    db.exec("UPDATE match_stat_imports SET imported_at=100");now+=45001;
    assert.notEqual(read(),changed);
  } finally {db.close();}
});

test('report worker timeout kills child and waits for close; crash and spawn failure reject', async () => {
  const {runReport} = require('../src/lib/reportCache');
  const {EventEmitter} = require('node:events');
  const child = new EventEmitter(); let killed, closed = false;
  child.kill = signal => { killed = signal; setTimeout(() => { closed = true; child.emit('close',null); },5); };
  await assert.rejects(runReport('unused','analytics',{spawn:()=>child,timeoutMs:5}), /timed out/);
  assert.equal(killed,'SIGKILL'); assert.equal(closed,true);
  for (const event of ['error','crash']) {
    const broken = new EventEmitter(); broken.kill=()=>{};
    const pending=runReport('unused','defense',{spawn:()=>broken});
    if(event==='error')broken.emit('error',new Error('spawn failed'));
    broken.emit('close',1);
    await assert.rejects(pending,event==='error'?/spawn failed/:/without a result/);
  }
});

test('report worker reads a file-backed database without mutating it and honors resource options', async () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {fork}=require('node:child_process');
  const {runReport}=require('../src/lib/reportCache');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noname-report-'));
  const file=path.join(dir,'fixture.db');
  const db=new DatabaseSync(file);db.exec("CREATE TABLE matches(match_id TEXT,map_name TEXT,status TEXT); INSERT INTO matches VALUES('m','well','completed')");db.close();
  const before=fs.readFileSync(file);
  try {
    let metrics;
    const result=await runReport(file,'defense',{onMetrics:value=>{metrics=value},spawn:(worker,args,options)=>{
      assert.deepEqual(options.execArgv,['--max-old-space-size=192']);
      assert.equal(options.windowsHide,true);
      return fork(worker,args,options);
    }});
    assert.equal(JSON.parse(result.default).data.maps[0].map,'well');
    assert.ok(metrics.priority>0);assert.ok(metrics.rssMiB>0);
    assert.deepEqual(fs.readFileSync(file),before);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('analytics projections share one build while preserving fixed lists and per-weapon limits', () => {
  const {projectAnalytics}=require('../src/lib/analyticsProjection');
  const rows=Array.from({length:10},(_,i)=>({id:i}));
  const data={mvps:rows,mvp_rate:rows,activity:rows};
  for(const key of ['mvp_results','streaks','per_game','combat','flags','roles','rounds','matches','chaos'])data[key]={leaders:rows};
  data.chaos.least_flag_touches=Array.from({length:50},(_,i)=>i);
  data.weapons={totals:rows,maps:rows,leaders:['a','b'].flatMap(weapon=>rows.map(row=>({...row,weapon})))};
  data.maps={most_played:rows,total_kills:rows,average_team_score:rows,details:rows,leaders:rows};
  for(let limit=1;limit<=10;limit++){
    const result=projectAnalytics({ok:true,data},limit).data;
    assert.equal(result.mvps.length,limit);assert.equal(result.rounds.leaders.length,limit);
    assert.equal(result.weapons.leaders.length,limit*2);assert.equal(result.maps.most_played.length,limit);
    assert.equal(result.chaos.least_flag_touches.length,50);assert.equal(result.maps.leaders.length,10);
    assert.equal(result.weapons.totals.length,10);assert.equal(result.activity.length,10);
    assert.equal(data.mvps.length,10);
  }
});

test('defense detail projections preserve ratings, filter observations and reject invalid selections', async () => {
  const {createStatsRouter}=require('../src/routes/stats');
  const bucket={baseline:7,players:[{id:'1',defense:2,estimated:true}],observations:[{conceded:5}],status:'estimated'};
  const payload={ok:true,data:{classes:[{id:'soldier'},{id:'engineer'}],maps:[{map:'well',classes:{soldier:bucket,engineer:bucket}},{map:'2fort',classes:{soldier:bucket}}],coverage:{sources:[{rows:10}]}}};
  const router=createStatsRouter({reports:{get:async()=>({body:JSON.stringify(payload),status:'HIT',age:0})},sendError:(res,status,error)=>{res.status=status;res.error=error},logRouteError:(_,e)=>{throw e}});
  const handler=router.stack.find(layer=>layer.route?.path==='/stats/defense-ratings').route.stack.at(-1).handle;
  for(const detail of ['summary','selected']){
    let result;await handler({query:{detail,map:'well',class:'soldier'}},{setHeader(){},type(){},json:p=>{result=p}});
    assert.deepEqual(result.data.coverage,payload.data.coverage);
    const selected=result.data.maps[0].classes.soldier;
    assert.equal(selected.baseline,7);assert.deepEqual(selected.players,bucket.players);
    assert.equal(selected.observations.length,detail==='summary'?0:1);
    assert.equal(result.data.maps.length,detail==='summary'?2:1);
    if(detail==='selected')assert.deepEqual(Object.keys(result.data.maps[0].classes),['soldier']);
  }
  const res={setHeader(){},type(){}};
  await handler({query:{detail:'selected',map:'missing',class:'soldier'}},res);
  assert.equal(res.status,400);assert.equal(res.error,'invalid_defense_selection');
});

test('cold HTTP wait is bounded without cancelling the shared refresh and a new cache starts cold', async () => {
  const {ReportCache,coldWait}=require('../src/lib/reportCache');
  let finish,calls=0;
  const settings={revision:()=>1,cooldownMs:0,run:()=>{calls++;return new Promise(resolve=>{finish=resolve})}};
  const cache=new ReportCache(settings),pending=cache.get('defense');
  await assert.rejects(coldWait(pending,5),/warming/);
  assert.equal(calls,1);assert.equal(cache.pending.size,1);
  finish({default:'ready'});await pending;
  assert.equal((await cache.get('defense')).status,'HIT');
  const restarted=new ReportCache(settings),cold=restarted.get('defense');
  assert.equal(calls,2);finish({default:'after restart'});
  assert.equal((await cold).status,'MISS');
});

test('report clients retry bounded warming responses and leave unrelated failures alone', async () => {
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../../assets/js/main.js'),'utf8');
  const fn=source.slice(source.indexOf('async function fetchJSON('),source.indexOf('function escapeHtml('));
  let calls=0;const delays=[];
  const context={console:{error(){}},setTimeout:(callback,ms)=>{delays.push(ms);callback()},fetch:async()=>{
    calls++;return calls===1?{ok:false,status:503,headers:{get:()=> '60'},json:async()=>({ok:false,error:'analytics_warming'})}:{ok:true,json:async()=>({ok:true,data:{ready:true}})};
  }};
  vm.createContext(context);vm.runInContext(fn,context);
  assert.equal((await context.fetchJSON('/api/analytics?limit=5')).ok,true);
  assert.equal(calls,2);assert.deepEqual(delays,[60000]);
  calls=0;await context.fetchJSON('/api/leaderboard');assert.equal(calls,1);
  calls=0;context.fetch=async()=>{calls++;return {ok:false,status:503,headers:{get:()=> '60'},json:async()=>({ok:false,error:'defense_ratings_warming'})}};
  assert.equal((await context.fetchJSON('/api/stats/defense-ratings')).ok,false);
  assert.equal(calls,4);
});

test('shared ratings names use Discord display names rather than game aliases',()=>{
  const {loadDiscordDisplayNames}=require('../src/lib/discordDisplayNames');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE ratings(player_id TEXT,display_name TEXT);
      CREATE TABLE discord_names(discord_id TEXT,display_name TEXT,global_name TEXT,username TEXT);
      INSERT INTO ratings VALUES ('1','Cached Discord'),('2','Fallback Discord');
      INSERT INTO discord_names VALUES ('1','Server Display','Global Name','username');`);
    const names=loadDiscordDisplayNames(db);assert.equal(names.get('1'),'Server Display');assert.equal(names.get('2'),'Fallback Discord');
  }finally{db.close();}
});

test("defense metadata never promotes aggregate class time or isolated role events into class ratings", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE matches (match_id TEXT, map_name TEXT, status TEXT);
      CREATE TABLE match_player_classes (match_id TEXT, class_name TEXT, seconds INTEGER);
      CREATE TABLE match_role_events (match_id TEXT, class_name TEXT, role_value TEXT, game_time_seconds INTEGER);
      INSERT INTO matches VALUES ('done','well','completed'), ('active','well','active'), ('unknown','(unknown)','completed');
      INSERT INTO match_player_classes VALUES ('done','soldier',1200), ('done','engineer',1), ('active','soldier',1500);
      INSERT INTO match_role_events VALUES ('done','soldier','defense',10), ('done','engineer','defense',20);`);
    const result = loadDefenseRatings(db);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.classes.map(c => c.id), ["soldier", "demoman", "hwguy", "engineer"]);
    assert.deepEqual(result.maps, [{ map: "well", completedMatches: 1, games: null, baseline: null, players: [], observations: [], status: "unavailable" }]);
    assert.equal(result.eligibleAppearances, null); assert.equal(result.qualifyingPlayers, null);
    assert.equal(result.coverage.sources.find(s => s.id === "match_player_classes").rows, 3);
    assert.equal(result.coverage.sources.find(s => s.id === "match_role_events").completedMatchCount, 1);
    assert.ok(result.methodology.missing.some(s => /coverage/i.test(s)));
    assert.equal(result.coverage.sources.find(s => s.id === "match_cap_events").available, false);
  } finally { db.close(); }
});

test("defense empty and missing telemetry remain unavailable rather than zero-rated", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE matches (match_id TEXT, map_name TEXT, status TEXT)");
    const result = loadDefenseRatings(db);
    assert.deepEqual(result.maps, []);
    assert.equal(result.coverage.completedMatches, 0);
    assert.equal(result.methodology.baseline, "unavailable");
    assert.equal(result.eligibleAppearances, null);
    assert.ok(result.coverage.sources.every(s => s.rows === null));
  } finally { db.close(); }
});

test("defense ratings use linked round role and class data as clearly labeled estimates", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE matches (match_id TEXT, map_name TEXT, status TEXT, created_at INTEGER);
      CREATE TABLE match_player_classes (match_id TEXT, player_key TEXT, round_num INTEGER, class_name TEXT, seconds INTEGER);
      CREATE TABLE match_player_round_stats (match_id TEXT, player_key TEXT, display_name TEXT, round_num INTEGER, team_name TEXT, role TEXT, flag_captures INTEGER);
      CREATE TABLE match_rounds (match_id TEXT, round_num INTEGER, duration_seconds INTEGER, team1_score INTEGER, team2_score INTEGER, offense_team TEXT, defense_team TEXT);
      CREATE TABLE player_steam_ids (steam_id TEXT, discord_id TEXT);
      CREATE TABLE ratings (player_id TEXT,display_name TEXT);
      CREATE TABLE discord_names (discord_id TEXT,display_name TEXT,global_name TEXT,username TEXT);
      INSERT INTO matches VALUES ('m','phantom_lg','completed',1);
      INSERT INTO player_steam_ids VALUES ('STEAM_TEST','123');
      INSERT INTO ratings VALUES ('123','Cached Alice');
      INSERT INTO discord_names VALUES ('123','Discord Alice','Global Alice','alice');
      INSERT INTO match_rounds VALUES ('m',1,900,70,20,'Team A','Team B');
      INSERT INTO match_player_round_stats VALUES ('m','STEAM_TEST','Alice',1,'Team B','Soldier',0),('m','OFFENSE','Bob',1,'Team A','Medic',7);
      INSERT INTO match_player_classes VALUES ('m','STEAM_TEST',1,'soldier',800),('m','STEAM_TEST',1,'medic',20);`);
    const result=loadDefenseRatings(db); const map=result.maps[0]; const soldier=map.classes.soldier;
    assert.equal(result.status,'estimated'); assert.equal(soldier.status,'estimated'); assert.equal(soldier.games,1);
    assert.equal(soldier.baseline,7); assert.equal(soldier.players[0].player,'Discord Alice'); assert.equal(soldier.players[0].profileId,'123'); assert.equal(soldier.players[0].defense,0);
    assert.equal(soldier.players[0].estimated,true); assert.equal(result.methodology.threshold.dominantClass,.7);
    assert.deepEqual(soldier.observations[0].playerIds,['123']);
    for(const className of ['demoman','hwguy','engineer','soldier']) {
      db.prepare("UPDATE match_player_round_stats SET role=? WHERE player_key='STEAM_TEST'").run(className);
      db.prepare("UPDATE match_player_classes SET class_name=? WHERE player_key='STEAM_TEST' AND class_name!='medic'").run(className);
      assert.equal(loadDefenseRatings(db).maps[0].classes[className].players[0].games,1);
    }
    // A second defender shares the outcome; it must not double-weight the baseline.
    db.exec(`INSERT INTO player_steam_ids VALUES ('SECOND','456');
      INSERT INTO match_player_round_stats VALUES ('m','SECOND','Second',1,'Team B','Soldier',0);
      INSERT INTO match_player_classes VALUES ('m','SECOND',1,'soldier',900);`);
    const shared=loadDefenseRatings(db).maps[0].classes.soldier;
    assert.equal(shared.games,1);assert.equal(shared.baseline,7);assert.equal(shared.players.length,2);
    assert.equal(shared.observations[0].playerIds.length,2);
    db.exec("UPDATE player_steam_ids SET discord_id='123' WHERE steam_id='SECOND'");
    const merged=loadDefenseRatings(db).maps[0].classes.soldier;
    assert.equal(merged.players.length,1);assert.equal(merged.players[0].id,'123');
    assert.equal(merged.players[0].games,1);assert.equal(merged.players[0].conceded,7);
    assert.deepEqual(merged.observations[0].playerIds,['123']);
    db.exec(`INSERT INTO matches VALUES ('m2','phantom_lg','completed',2);
      INSERT INTO match_rounds VALUES ('m2',1,900,30,0,'Team A','Team B');
      INSERT INTO match_player_round_stats VALUES ('m2','SECOND','Alias',1,'Team B','Soldier',0),('m2','OFFENSE','Bob',1,'Team A','Medic',3);
      INSERT INTO match_player_classes VALUES ('m2','SECOND',1,'soldier',900);`);
    const combined=loadDefenseRatings(db).maps[0].classes.soldier;
    assert.equal(combined.players.length,1);assert.equal(combined.players[0].games,2);
    assert.equal(combined.players[0].conceded,5);assert.equal(combined.baseline,5);
    db.exec("DELETE FROM matches WHERE match_id='m2'; UPDATE player_steam_ids SET discord_id='456' WHERE steam_id='SECOND'");
    db.exec("UPDATE match_player_classes SET seconds=1000 WHERE player_key='SECOND'");
    assert.equal(loadDefenseRatings(db).coverage.exclusions.invalidDuration,1);
    db.exec("UPDATE match_player_classes SET seconds=700 WHERE player_key='SECOND'; INSERT INTO match_player_classes VALUES ('m','SECOND',1,'medic',200)");
    assert.equal(loadDefenseRatings(db).coverage.exclusions.suspiciousClass,1);
    db.exec("UPDATE match_player_round_stats SET flag_captures=NULL WHERE player_key='OFFENSE'");
    assert.equal(loadDefenseRatings(db).status,'unavailable');
  } finally { db.close(); }
});

test("defense endpoint preserves API envelope and unavailable contract for every class/filter", async () => {
  const { createStatsRouter } = require("../src/routes/stats");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE matches (match_id TEXT, map_name TEXT, status TEXT); INSERT INTO matches VALUES ('m','well','completed')");
    const reports = { get: async kind => { assert.equal(kind, 'defense'); return { body: JSON.stringify({ok:true,data:loadDefenseRatings(db)}), status:'HIT', age:0 }; } };
    const router = createStatsRouter({ db, reports, sendError: () => assert.fail("unexpected API error"), logRouteError: (_, error) => { throw error; } });
    const handler = router.stack.find(layer => layer.route?.path === "/stats/defense-ratings").route.stack.at(-1).handle;
    for (const classId of ["soldier", "demoman", "hwguy", "engineer", "invalid"]) {
      let response;
      await handler({ query: { class: classId, map: "well", minimum: "5", sort: "defense" } }, { setHeader(){}, type(){}, send(value) { response = JSON.parse(value); } });
      assert.equal(response.ok, true); assert.equal(response.data.status, "unavailable");
      assert.equal(response.data.maps[0].baseline, null); assert.deepEqual(response.data.maps[0].players, []);
      assert.equal(response.data.classes.length, 4);
    }
  } finally { db.close(); }
});

test("defense endpoint reports failures without leaking internal errors", async () => {
  const { createStatsRouter } = require("../src/routes/stats");
  const logged = [], errors = [];
  const router = createStatsRouter({ db: {}, reports: {get: async () => { throw new Error("private database path"); }}, logRouteError: (...args) => logged.push(args), sendError: (_, code, message) => errors.push({ code, message }) });
  await router.stack.find(layer => layer.route?.path === "/stats/defense-ratings").route.stack.at(-1).handle({}, {setHeader(){}});
  assert.deepEqual(errors, [{ code: 503, message: "defense_ratings_warming" }]);
  assert.equal(logged.length, 1);
});
