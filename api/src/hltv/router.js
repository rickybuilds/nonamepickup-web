"use strict";
const express = require("express"), fs = require("fs");
const { createAuth } = require("./auth");
const { upstreamConfig, queueRun } = require("./upstream");
function publicData(value) {
  // Raw local paths never cross the HTTP boundary, even to a reviewer.
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["storage_key", "last_error"].includes(key)).map(([key, v]) => [key, publicData(v)]));
  return value;
}
function createRouter({ registry, env = process.env }) {
  const router = express.Router();
  router.use(createAuth(env));
  router.use(express.json({ limit: "16kb", strict: true }));
  const route = fn => (req, res, next) => { try { fn(req, res); } catch (error) { next(error); } };
  router.get("/session", (req, res) => res.json({ user_id: req.hltvActor, upstream_enabled: upstreamConfig(env).enabled }));
  router.get("/storage-summary", route((req, res) => res.json(registry.summary())));
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
    res.set({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${download.demo.id}.dem"` });
    const stream = fs.createReadStream(null, { fd: download.fd, autoClose: true });
    res.on("close", () => stream.destroy());
    stream.on("error", () => { res.destroy(); release(); }); stream.pipe(res);
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    // Never expose SQL errors or filesystem paths.
    console.error("[HLTV review] request failed:", error.code || error.name);
    res.status(400).json({ ok: false, error: "review_operation_failed" });
  });
  return router;
}
module.exports = { createRouter, publicData };
