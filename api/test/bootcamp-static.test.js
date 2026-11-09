"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const { registerStaticFiles } = require("../src/middleware/staticFiles");

test("the Bootcamp hub opens a profile from the Steam-ID deep link", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "../../assets/js/bootcamp-hub.js"), "utf8");
  assert.match(script, /new URLSearchParams\(location\.search\)/);
  assert.match(script, /get\("steamid"\)/);
  assert.match(script, /profileForm\.requestSubmit\(\)/);
  assert.match(script, /profile\.drillBests\?/);
  assert.match(script, /api\/bootcamp\/challenge\/current/);
  assert.match(script, /api\/bootcamp\/seasons\/current/);
  assert.match(script, /leaderboards\/skill-points\?period=monthly/);
  assert.match(script, /leaderboards\/skill-points\?period=all_time/);
  const page = fs.readFileSync(path.resolve(__dirname, "../../bootcamp.html"), "utf8");
  assert.match(page, /id="weekly-challenge"/);
  assert.match(page, /id="bc-season"[^>]*hidden/);
  assert.match(page, /id="bc-monthly-points"/);
  assert.match(page, /id="bc-alltime-points"/);
});

test("Bootcamp page and assets are disabled by default", async () => {
  const old = process.env.BOOTCAMP_API_ENABLED;
  delete process.env.BOOTCAMP_API_ENABLED;
  const app = express();
  registerStaticFiles(app, path.resolve(__dirname, "../.."));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + "/index.html")).status, 200);
    for (const file of ["/bootcamp.html", "/bootcamp-review.html", "/bootcamp-map.html", "/bootcamp-route.html",
      "/bootcamp-drill.html", "/bootcamp-player.html", "/BOOTCAMP.HTML", "/bootcamp%2ehtml",
      "/assets/js/bootcamp-hub.js", "/assets/css/bootcamp-hub.css", "/assets/js/bootcamp-review.js",
      "/assets/css/bootcamp-review.css", "/assets/js/bootcamp.js", "/assets/css/bootcamp.css"]) {
      assert.equal((await fetch(base + file)).status, 404);
    }
    process.env.BOOTCAMP_API_ENABLED = "true";
    for (const file of ["/bootcamp.html", "/bootcamp-review.html", "/bootcamp-map.html", "/bootcamp-route.html",
      "/bootcamp-drill.html", "/bootcamp-player.html", "/assets/js/bootcamp-hub.js", "/assets/css/bootcamp-hub.css",
      "/assets/js/bootcamp-review.js", "/assets/css/bootcamp-review.css", "/assets/js/bootcamp.js", "/assets/css/bootcamp.css"]) {
      assert.equal((await fetch(base + file)).status, 200);
    }
  } finally {
    if (old === undefined) delete process.env.BOOTCAMP_API_ENABLED;
    else process.env.BOOTCAMP_API_ENABLED = old;
    await new Promise(resolve => server.close(resolve));
  }
});

test("the 2D replay overview is confined to Bootcamp replays and has map metadata", () => {
  const root = path.resolve(__dirname, "../..");
  const page = fs.readFileSync(path.join(root, "speedrun-replay.html"), "utf8");
  const viewer = fs.readFileSync(path.join(root, "assets/js/speedrun-replay.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/data/bootcamp-overviews.json"), "utf8"));
  assert.match(page, /id="bootcamp-overview-panel"[^>]*hidden/);
  assert.match(page, /id="bootcamp-overview-speed"[^>]*tabindex="0"/);
  assert.match(page, /assets\/css\/bootcamp-replay-overview\.css/);
  assert.match(viewer, /state\.replay\?\.source === "bootcamp"/);
  assert.match(viewer, /new BootcampReplayOverview/);
  assert.match(viewer, /document\.body\.classList\.toggle\("bootcamp-overview-active", state\.replay\?\.source === "bootcamp"\)/);
  const overviewCss = fs.readFileSync(path.join(root, "assets/css/bootcamp-replay-overview.css"), "utf8");
  assert.match(overviewCss, /\.replay-page\.bootcamp-overview-active\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(overviewCss, /\.bootcamp-overview-active\s+\.replay-stage\s*\{[^}]*height:\s*calc\(100vh - 74px\)/s);
  assert.match(overviewCss, /\.bootcamp-overview-event\s*\{[^}]*min-height:\s*36px/s);
  assert.deepEqual(Object.keys(manifest.maps).sort(), ["2fort", "avanti", "badlands", "casbah", "crossover2", "cz2", "dustbowl", "epicenter", "flagrun", "hunted", "push", "ravelin", "rock2", "warpath", "well"].sort());
  assert.equal(manifest.maps["2fort"].transform.length, 6);
  assert.ok(fs.existsSync(path.join(root, "assets/images/bootcamp-overviews/2fort.png")));
});

test("the shared 3D viewer consumes TFTR when available and keeps the legacy replay fallback", () => {
  const root = path.resolve(__dirname, "../..");
  const viewer = fs.readFileSync(path.join(root, "assets/js/speedrun-replay.js"), "utf8");
  assert.match(viewer, /import \{ fetchBootcampReplay \} from "\.\/bootcamp-tftr-client\.mjs\?v=1"/);
  assert.match(viewer, /query\.get\("source"\) === "bootcamp"/);
  assert.match(viewer, /return fetchBootcampReplay\(firstParam\(query, \["runId", "run_id", "run"\]\), replayPath\)/);
});

test("Bootcamp detail navigation uses current page routes and published replay run IDs", () => {
  const root = path.resolve(__dirname, "../..");
  const hub = fs.readFileSync(path.join(root, "assets/js/bootcamp-hub.js"), "utf8");
  const legacyViews = fs.readFileSync(path.join(root, "assets/js/bootcamp.js"), "utf8");
  assert.match(hub, /bootcamp-map\.html\?map=/);
  assert.match(hub, /bootcamp-route\.html\?id=/);
  assert.match(hub, /bootcamp-drill\.html\?id=/);
  assert.match(hub, /bootcamp-player\.html\?id=/);
  assert.match(legacyViews, /source=bootcamp&runId=/);
  assert.match(legacyViews, /compareRunId=/);
  assert.doesNotMatch(legacyViews, /bootcampRunId|bootcampGhostId|\/api\/bootcamp\/review/);
});
