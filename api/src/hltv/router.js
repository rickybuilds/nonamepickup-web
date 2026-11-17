"use strict";
const express = require("express"), fs = require("fs");
const { createAuth } = require("./auth");
const { upstreamConfig, queueRun } = require("./upstream");
const { demoStatistics,playerHistory,statisticsPayload }=require("./playerStatistics");
const investigation=require("./investigation");
function publicData(value) {
  // Raw local paths never cross the HTTP boundary, even to a reviewer.
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["storage_key", "last_error"].includes(key)).map(([key, v]) => [key, publicData(v)]));
  return value;
}
function createRouter({ registry, env = process.env }) {
  const router = express.Router();
  const accounts = new (require("./accounts").ReviewerAccounts)(registry, env);
  router.use((req,res,next)=>{res.set({"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"});next();});
  router.use(express.json({ limit: "16kb", strict: true }));
  router.get("/auth/options", (req,res)=>res.json({accounts_enabled:accounts.enabled}));
  router.post("/auth/login", async (req,res)=>res.json(await accounts.login(req.body||{},req.ip)));
  router.use(createAuth(env, accounts));
  router.use((req,res,next)=>{
    if(req.hltvAccount?.must_change_password && !["/session","/account/password","/auth/logout"].includes(req.path))return res.status(403).json({error:"password_change_required"});
    next();
  });
  const route = fn => (req, res, next) => { try { fn(req, res); } catch (error) { next(error); } };
  router.get("/session", (req, res) => res.json({ user_id: req.hltvActor, username:req.hltvAccount?.username,accounts_enabled:accounts.enabled,can_manage_users:accounts.isOwner(req.hltvActor),must_change_password:!!req.hltvAccount?.must_change_password,upstream_enabled: upstreamConfig(env).enabled,statistics_enabled:upstreamConfig(env).statisticsEnabled }));
  router.post("/auth/logout",route((req,res)=>{accounts.logout(req.hltvSessionToken);res.json({ok:true});}));
  router.post("/account/password",async(req,res)=>{
    if(!req.hltvAccount)return res.status(400).json({error:"username_login_required"});
    res.json(await accounts.changePassword(req.hltvAccount,req.hltvSessionToken,req.body||{}));
  });
  router.get("/users",route((req,res)=>res.json(accounts.list(req.hltvActor))));
  router.post("/users",async(req,res)=>res.status(201).json(await accounts.create(req.body||{},req.hltvActor)));
  router.post("/users/:id/reset",async(req,res)=>res.json(await accounts.reset(req.params.id,req.body||{},req.hltvActor)));
  router.post("/users/:id/disable",route((req,res)=>res.json(accounts.disable(req.params.id,req.hltvActor))));
  router.get("/demos/:id/statistics",route((req,res)=>{
    if(!upstreamConfig(env).statisticsEnabled)return res.status(404).json({error:"statistics_disabled"});
    const observation=demoStatistics(registry,req.params.id);
    if(observation){const {aimReviewConfig,historyRows,baselineFrom}=require("./aimReviewPolicy"),policy=aimReviewConfig(env);observation.review_context=observation.groups.filter(group=>group.state==="conc").map(group=>({steam_id:group.steam_id,class_id:group.class_id,weapon:group.weapon,conc_windows:group.conc_windows,baseline:baselineFrom(historyRows(registry,observation,group),policy.baselineGames)}));}
    const job=registry.db.prepare("SELECT j.skip_reason,r.status,r.error_code FROM hltv_statistics_jobs j LEFT JOIN hltv_upstream_runs r ON r.id=j.run_id WHERE j.demo_id=?").get(req.params.id)||null;
    res.json({observation,job});
  }));
  router.get("/demos/:id/players/:steam/history",route((req,res)=>{
    if(!upstreamConfig(env).statisticsEnabled)return res.status(404).json({error:"statistics_disabled"});
    const observation=demoStatistics(registry,req.params.id);
    if(!observation)return res.json({groups:[],kind:"descriptive_personal_history"});
    res.json(playerHistory(registry,{steamId:req.params.steam,configHash:observation.config_hash,before:observation.recorded_at,
      excludeInputKey:observation.input_key,days:req.query.days,map:registry.get(req.params.id).map}));
  }));
  router.get("/demos/:id/statistics/shots",route((req,res)=>{
    if(!upstreamConfig(env).statisticsEnabled)return res.status(404).json({error:"statistics_disabled"});
    const observation=demoStatistics(registry,req.params.id);
    if(!observation)return res.json({shots:[],total:0});
    const offset=Math.max(0,Math.min(10000,Number(req.query.offset)||0));
    const result=statisticsPayload(registry,observation.id);
    const shots=result.shots.filter(shot=>!req.query.steam_id||shot.steam_id===req.query.steam_id);
    res.json({shots:shots.slice(offset,offset+100),total:shots.length,offset});
  }));
  router.get("/demos/:id/investigation",route((req,res)=>{
    const data=investigation.events(registry,req.params.id);
    res.json({status:data.status,observation:data.observation,players:data.players});
  }));
  router.get("/demos/:id/players/:steam/timeline",route((req,res)=>res.json(investigation.timeline(registry,req.params.id,req.params.steam,req.query))));
  router.get("/demos/:id/events/:event",route((req,res)=>res.json(investigation.detail(registry,req.params.id,req.params.event))));
  router.get("/storage-summary", route((req, res) => res.json(registry.summary())));
  router.get("/jobs",route((req,res)=>res.json(registry.db.prepare(`SELECT u.id,u.status,u.error_code,u.created_at,u.finished_at,d.map,d.match_id
    FROM hltv_upstream_runs u JOIN hltv_demos d ON d.id=u.demo_id ORDER BY u.created_at DESC,u.id DESC LIMIT 50`).all())));
  router.get("/demos", route((req, res) => res.json(publicData(registry.list(req.query)))));
  router.get("/demos/:id", route((req, res) => res.json(publicData(registry.detail(req.params.id)))));
  router.post("/demos/:id/upstream", route((req, res) => {
    if (!upstreamConfig(env).enabled) return res.status(404).json({ ok: false, error: "upstream_disabled" });
    res.status(202).json(queueRun(registry, req.params.id, req.hltvActor));
  }));
  router.post("/demos/:id/actions/:action", route((req, res) => {
    if (!req.body || Array.isArray(req.body)) throw new Error("Object body required");
    res.json(publicData(registry.action(req.params.id, req.params.action, req.body, req.hltvActor)));
  }));
  router.get("/retention-preview", route((req, res) => res.json(registry.cleanup({ dryRun: true, verifyFiles: false }))));
  // Cleanup is CLI-only to keep file hashing/unlink work off the live web event loop.
  router.get("/demos/:id/file", route((req, res) => {
    const download = registry.db.transaction(() => {
      const demo = registry.get(req.params.id);
      if (demo.file_status !== "available") throw new Error("Demo unavailable");
      const file = registry.storage.verify(demo);
      const holdId = registry.hold(demo.id, "Authenticated download in progress", req.hltvActor);
      const fd = fs.openSync(file.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd);
      if (opened.ino !== file.ino || opened.dev !== file.dev || opened.size !== file.size) { fs.closeSync(fd); throw new Error("Demo changed during download"); }
      registry.audit(demo.id, req.hltvActor, "download", { sha256: demo.sha256 });
      return { demo, holdId, fd };
    }).immediate();
    let released = false;
    const release = () => {
      if (released) return; released = true;
      try {
        registry.db.transaction(() => {
          registry.db.prepare("UPDATE hltv_holds SET released_at=?,released_by=?,release_reason='Download finished' WHERE id=?").run(Date.now(), req.hltvActor, download.holdId);
          registry.audit(download.demo.id, req.hltvActor, "download_finished", {});
        }).immediate();
      } catch (error) { console.error("[HLTV] download hold retained:", error.message); }
    };
    res.on("close", release); res.on("finish", release);
    const observation=registry.db.prepare("SELECT log_round FROM hltv_statistics_observations WHERE demo_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(download.demo.id);
    const name=env.HLTV_FRIENDLY_DEMO_NAMES_ENABLED==="true"?require("./sourceRecovery").downloadName(download.demo,observation?.log_round):`${download.demo.id}.dem`;
    res.set({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"` });
    const stream = fs.createReadStream(null, { fd: download.fd, autoClose: true });
    res.on("close", () => stream.destroy());
    stream.on("error", () => { res.destroy(); release(); }); stream.pipe(res);
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    // Never expose SQL errors or filesystem paths.
    console.error("[HLTV review] request failed:", error.code || error.name);
    if(error.status===429)res.set("Retry-After","900");
    res.status(error.publicCode?error.status:400).json({ ok: false, error: error.publicCode||"review_operation_failed" });
  });
  return router;
}
module.exports = { createRouter, publicData };
