"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const { Registry } = require("../src/hltv/registry");
const crypto = require("crypto");
const { ingestPending } = require("../src/hltv/worker");
const { validateResult, UnavailableAnalyzer } = require("../src/hltv/analyzer");
test("feature and cleanup default off; cleanup preview defaults on",()=>{
  const c=require("../src/hltv/config").config({});
  assert.equal(c.enabled,false);assert.equal(c.cleanupEnabled,false);assert.equal(c.dryRun,true);
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
test("duplicate handoff is idempotent; unavailable analyzer blocks deletion", t => {
  const { registry: r, demo, manifest } = fixture(t);
  assert.equal(r.ingest(manifest)[0].id, demo.id);
  assert.equal(r.list({}).length, 1);
  assert.equal(demo.analysis_status, "unsupported");
  assert.equal(r.cleanup({ enabled: true, dryRun: false }).deleted, 0);
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
  for(const endpoint of ["/demos","/demos/"+demo.id,"/demos/"+demo.id+"/file"]){
    assert.equal((await fetch(url+endpoint)).status,401);
    assert.equal((await fetch(url+endpoint,{headers:{Authorization:"Bearer "+"b".repeat(48)}})).status,403);
  }
  assert.equal((await fetch(url+`/demos/${demo.id}/actions/hold`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:"unauthorized"})})).status,401);
  const res=await fetch(url+"/demos/"+demo.id,{headers:{Authorization:"Bearer "+token}});
  assert.equal(res.status,200);assert.equal((await res.json()).storage_key,undefined);
  assert.equal(r.detail(demo.id).holds.length,0);
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
