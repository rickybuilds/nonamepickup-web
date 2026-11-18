"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { activeRelease } = require("./upstreamRelease");
const { child, sandboxCommand, upstreamConfig } = require("./upstream");

const WEB_FILES = new Set(["style.css", "studio.js", "audio.js", "fx.js", "editor.js", "conc.js", "conc_aim.js", "blood_hits.js", "viewer.js"]);
const jobs = new Map();
const failures = new Map();

function cacheRoot(registry) {
  const root = path.join(registry.storage.root, "viewer-cache");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(root) !== root || fs.lstatSync(root).isSymbolicLink()) throw new Error("unsafe_viewer_cache");
  return root;
}
function cacheDirectory(registry, sha) {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error("invalid_viewer_identity");
  return path.join(cacheRoot(registry), sha);
}
function complete(directory) {
  return ["meta.json.gz", "data.bin.gz", "assets.bin", "ready.json"].every(name => fs.existsSync(path.join(directory, name)));
}
function removeDirectory(root, directory) {
  if (path.dirname(directory) !== root || !/^[a-f0-9]{64}$/.test(path.basename(directory))) return;
  if (fs.realpathSync(directory) !== directory || fs.lstatSync(directory).isSymbolicLink()) throw new Error("unsafe_viewer_cache_entry");
  fs.rmSync(directory, { recursive: true, force: false });
}
function removeTemporary(root, directory) {
  if (path.dirname(directory) !== root || !/^\.[a-f0-9]{64}-[a-f0-9-]{36}$/.test(path.basename(directory))) return;
  if (fs.realpathSync(directory) !== directory || fs.lstatSync(directory).isSymbolicLink()) throw new Error("unsafe_viewer_cache_entry");
  fs.rmSync(directory, { recursive: true, force: false });
}
function trimCache(registry, env, preserve) {
  const root = cacheRoot(registry), hours = Math.max(1, Math.min(168, Number(env.HLTV_VIEWER_CACHE_HOURS) || 12));
  const maximum = Math.max(268435456, Math.min(4294967296, Number(env.HLTV_VIEWER_CACHE_MAX_BYTES) || 1073741824));
  const rows = []; let reserved = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const directory = path.join(root, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink() && /^\.[a-f0-9]{64}-[a-f0-9-]{36}$/.test(entry.name)) {
      if (Date.now() - fs.statSync(directory).mtimeMs > 3600000) removeTemporary(root, directory);
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const bytes = fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, file) => sum + (file.isFile() && !file.isSymbolicLink() ? fs.statSync(path.join(directory, file.name)).size : 0), 0);
    if (directory === preserve) { reserved = bytes; continue; }
    rows.push({ directory, bytes, touched: fs.statSync(directory).mtimeMs });
  }
  rows.sort((a, b) => a.touched - b.touched);
  let total = reserved + rows.reduce((sum, row) => sum + row.bytes, 0), cutoff = Date.now() - hours * 3600000;
  for (const row of rows) if (row.touched < cutoff || total > maximum) { removeDirectory(root, row.directory); total -= row.bytes; }
}
function assetEntry(directory, route) {
  const filename = path.join(directory, "assets.bin"), fd = fs.openSync(filename, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 65536 || size > 268435456) throw new Error("invalid_viewer_assets");
    const length = Buffer.alloc(4); fs.readSync(fd, length, 0, 4, 0);
    const n = length.readUInt32LE(0); if (n < 2 || n > 65532) throw new Error("invalid_viewer_assets");
    const header = Buffer.alloc(n); fs.readSync(fd, header, 0, n, 4);
    const row = JSON.parse(header.toString("utf8")).assets.find(item => item.route === route);
    if (!row || row.missing || !Number.isSafeInteger(row.offset) || !Number.isSafeInteger(row.length) || row.offset < 65536 || row.length < 1 || row.offset + row.length > size) return null;
    const compressed = Buffer.alloc(row.length); fs.readSync(fd, compressed, 0, row.length, row.offset);
    return compressed;
  } finally { fs.closeSync(fd); }
}
function patchWeb(source) {
  return source.replaceAll("/api/", "/api/admin/hltv/viewer/")
    .replace("const m = /demo=([0-9a-f]+)/.exec(location.hash);", "const m = /demo=([0-9a-f-]{16,64})/.exec(location.hash);")
    .replace("fetch(`/api/admin/hltv/viewer/map/${encodeURIComponent(game)}/${encodeURIComponent(name)}`)", "fetch(`/api/admin/hltv/viewer/map/${encodeURIComponent(game)}/${encodeURIComponent(name)}?demo=${encodeURIComponent(S.id)}`)")
    .replace("fetch(`/api/admin/hltv/viewer/model/${encodeURIComponent(game)}/${encodeURIComponent(path)}`)", "fetch(`/api/admin/hltv/viewer/model/${encodeURIComponent(game)}/${encodeURIComponent(path)}?demo=${encodeURIComponent(S.id)}`)")
    .replace("startDemo();", "startDemo(); const requested=/[&#]t=([0-9]+(?:\\.[0-9]+)?)/.exec(location.hash); if(requested) S.t=Math.min(S.meta.end,S.meta.start+Number(requested[1])); const requestedPlayer=/[&#]player=([^&]+)/.exec(location.hash); if(requestedPlayer){const steam=decodeURIComponent(requestedPlayer[1]);const player=S.meta.players.find(p=>p.steam===steam&&p.first<=S.t&&(p.left==null||p.left>=S.t));if(player)selectPlayer(player.ent,'eye');}");
}
function viewerPage(release) {
  let html = fs.readFileSync(path.join(release.root, "web", "index.html"), "utf8");
  html = html.replaceAll('href="/web/', 'href="/api/admin/hltv/viewer/web/').replaceAll('src="/web/', 'src="/api/admin/hltv/viewer/web/');
  html = html.replace('<button id="btnOpen" class="btn">Open demo…</button>', '<button class="btn" type="button" onclick="window.close()">Close viewer</button>');
  html = html.replace('<button data-tab="edit">Edit</button>', '').replace('<div id="tab-edit" class="tab"></div>', '');
  html = html.replace('<div class="conc-log-attach">', '<div class="conc-log-attach" hidden>');
  html = html.replace('<div id="picker" class="overlay">', '<div id="picker" class="overlay hidden">');
  return html;
}
async function prepare(registry, env, demo, actor) {
  const config = upstreamConfig(env), release = activeRelease(config.root), final = cacheDirectory(registry, demo.sha256);
  if (complete(final)) return;
  if (jobs.has(demo.id)) return jobs.get(demo.id);
  const promise = (async () => {
    trimCache(registry, env, final);
    if (registry.storage.freeBytes() < registry.minFreeBytes + 629145600) throw new Error("insufficient_storage_headroom");
    const source = registry.storage.verify(demo), root = cacheRoot(registry), temporary = path.join(root, `.${demo.sha256}-${crypto.randomUUID()}`);
    fs.mkdirSync(temporary, { mode: 0o700 });
    const hold = registry.hold(demo.id, "Authenticated browser playback preparation", actor);
    try {
      const exportCommand = sandboxCommand(config.python, ["-I", path.join(__dirname, "viewer_export.py")], temporary, config.memoryBytes);
      await child(exportCommand.bin, exportCommand.args, { upstream_root: release.root, demo_path: source.path, demo_sha256: demo.sha256,
        max_demo_bytes: registry.storage.maxBytes, map: demo.map, output_dir: temporary, memory_bytes: config.memoryBytes });
      const assetsCommand = sandboxCommand(config.python, ["-I", path.join(__dirname, "upstream_assets.py")], temporary, config.memoryBytes);
      await child(assetsCommand.bin, assetsCommand.args, { upstream_root: release.root, assets_root: config.assetsRoot, output_dir: temporary, viewer: true });
      if (registry.storage.freeBytes() < registry.minFreeBytes) throw new Error("insufficient_storage_headroom");
      fs.writeFileSync(path.join(temporary, "ready.json"), JSON.stringify({ upstream_sha: release.sha, created_at: Date.now() }), { mode: 0o600, flag: "wx" });
      if (fs.existsSync(final)) removeDirectory(root, final);
      fs.renameSync(temporary, final);
      failures.delete(demo.id);
      registry.audit(demo.id, actor, "viewer_prepared", { upstream_sha: release.sha });
      trimCache(registry, env, final);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
      registry.db.prepare("UPDATE hltv_holds SET released_at=?,released_by=?,release_reason='Viewer preparation finished' WHERE id=? AND released_at IS NULL").run(Date.now(), actor, hold);
    }
  })().catch(error => { failures.set(demo.id, { message: error.message, at: Date.now() }); throw error; }).finally(() => jobs.delete(demo.id));
  jobs.set(demo.id, promise); return promise;
}

function registerViewer(router, { registry, env }) {
  router.post("/viewer/session", (req, res) => {
    if (env.HLTV_VIEWER_ENABLED !== "true") return res.status(404).json({ error: "viewer_disabled" });
    const demo = registry.get(req.body?.demo_id);
    if (demo.file_status !== "available") return res.status(409).json({ error: "demo_unavailable" });
    registry.storage.verify(demo);
    trimCache(registry, env, cacheDirectory(registry, demo.sha256));
    registry.audit(demo.id, req.hltvActor, "viewer_opened", {});
    res.cookie("hltv_viewer", Buffer.from(req.hltvSessionToken).toString("base64url"), { httpOnly: true, secure: true, sameSite: "strict", path: "/api/admin/hltv/viewer" });
    res.cookie("hltv_viewer_demo", demo.id, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/admin/hltv/viewer" });
    res.json({ ok: true });
  });
  router.get("/viewer/page", (req, res) => {
    if (env.HLTV_VIEWER_ENABLED !== "true") return res.status(404).send("Viewer disabled");
    res.set({ "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
    res.type("html").send(viewerPage(activeRelease(upstreamConfig(env).root)));
  });
  router.get("/viewer/web/:file", (req, res) => {
    if (env.HLTV_VIEWER_ENABLED !== "true" || !WEB_FILES.has(req.params.file)) return res.sendStatus(404);
    const release = activeRelease(upstreamConfig(env).root), filename = path.join(release.root, "web", req.params.file);
    const body = fs.readFileSync(filename, "utf8");
    res.type(req.params.file.endsWith(".css") ? "css" : "js").send(req.params.file.endsWith(".js") ? patchWeb(body) : body);
  });
  router.get("/viewer/demos", (_req, res) => res.json({ demos: [] }));
  router.get("/viewer/demo/:id/open", async (req, res, next) => {
    try {
      if (env.HLTV_VIEWER_ENABLED !== "true") return res.status(404).json({ error: "viewer_disabled" });
      const demo = registry.get(req.params.id), directory = cacheDirectory(registry, demo.sha256);
      if (demo.file_status !== "available") return res.json({ state: "error", error: "This recording is no longer available." });
      if (complete(directory)) { fs.utimesSync(directory, new Date(), new Date()); return res.json({ state: "ready" }); }
      const failure = failures.get(demo.id);
      if (failure && Date.now() - failure.at < 300000) return res.json({ state: "error", error: "Viewer preparation failed. Check the private API log, then try again." });
      if (failure) failures.delete(demo.id);
      if (!jobs.has(demo.id)) prepare(registry, env, demo, req.hltvActor).catch(error => console.error("[HLTV viewer]", error.message));
      return res.json({ state: "decoding", progress: jobs.has(demo.id) ? 0.35 : 0.05 });
    } catch (error) { next(error); }
  });
  router.get("/viewer/demo/:id/:file", (req, res, next) => {
    try {
      if (req.params.file === "conc-log") {
        let snapshot = registry.db.prepare("SELECT matched_log_json FROM hltv_source_log_snapshots WHERE demo_id=? ORDER BY created_at DESC LIMIT 1").get(req.params.id);
        if (!snapshot) {
          const linked = registry.db.prepare("SELECT original_demo_id,recovered_demo_id FROM hltv_source_recoveries WHERE original_demo_id=? OR recovered_demo_id=?").get(req.params.id, req.params.id);
          const related = linked && (linked.original_demo_id === req.params.id ? linked.recovered_demo_id : linked.original_demo_id);
          if (related) snapshot = registry.db.prepare("SELECT matched_log_json FROM hltv_source_log_snapshots WHERE demo_id=? ORDER BY created_at DESC LIMIT 1").get(related);
        }
        return res.json(snapshot ? JSON.parse(snapshot.matched_log_json) : {});
      }
      const names = { meta: ["meta.json.gz", "application/json"], data: ["data.bin.gz", "application/octet-stream"] }, item = names[req.params.file];
      if (!item) return res.sendStatus(404);
      const demo = registry.get(req.params.id); if (demo.file_status !== "available") return res.sendStatus(410); const directory = cacheDirectory(registry, demo.sha256);
      if (!complete(directory)) return res.status(409).json({ error: "viewer_not_prepared" });
      res.set({ "Content-Type": item[1], "Content-Encoding": "gzip", "Cache-Control": "private, max-age=3600" });
      fs.createReadStream(path.join(directory, item[0])).on("error", next).pipe(res);
    } catch (error) { next(error); }
  });
  for (const kind of ["map", "model"]) router.get(`/viewer/${kind}/:game/:name`, (req, res, next) => {
    try {
      if (req.params.game.toLowerCase() !== "tfc") return res.sendStatus(404);
      const demoId = String(req.query.demo || /(?:^|;\s*)hltv_viewer_demo=([^;]+)(?:;|$)/.exec(req.headers.cookie || "")?.[1] || "");
      const demo = registry.get(demoId); if (demo.file_status !== "available") return res.sendStatus(410); const directory = cacheDirectory(registry, demo.sha256);
      if (!complete(directory)) return res.sendStatus(404);
      const route = `/api/${kind}/tfc/${decodeURIComponent(req.params.name)}`, body = assetEntry(directory, route);
      if (!body) return res.status(404).json({ error: `${kind}_not_prepared` });
      res.set({ "Content-Type": "application/octet-stream", "Content-Encoding": "gzip", "Cache-Control": "private, max-age=3600" }).send(body);
    } catch (error) { next(error); }
  });
  router.get("/viewer/sound/:game/*path", (_req, res) => res.sendStatus(404));
  router.get("/viewer/sprite/:game/*path", (_req, res) => res.sendStatus(404));
}

module.exports = { registerViewer, patchWeb, viewerPage };
