"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

function setup(query, credentials = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/bootcamp", createBootcampRouter({ query, adminUser: "reviewer", adminPassword: "secret", ...credentials }));
  const server = app.listen(0, "127.0.0.1");
  return new Promise(resolve => server.once("listening", () => resolve({
    base: `http://127.0.0.1:${server.address().port}/api/bootcamp`,
    close: () => new Promise(done => server.close(done)),
    auth: `Basic ${Buffer.from("reviewer:secret").toString("base64")}`
  })));
}

test("review queue is private, bounded, and contains only complete current pending runs", async () => {
  const calls = [];
  const app = await setup(async (sql, params) => { calls.push({ sql, params }); return [{ run_id: 7, steamid: "STEAM_0:1:4", player_name: "Ricky", map: "2fort", route_id: 3, route_name: "Ramp", class_id: 2, time_ms: 1000, tier: 1, config_version: 4, created_at: "2026-11-08", ghost_id: 8 }]; });
  try {
    assert.equal((await fetch(`${app.base}/admin/reviews`)).status, 401);
    const response = await fetch(`${app.base}/admin/reviews?limit=10`, { headers: { authorization: app.auth } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { reviews: [{ runId: 7, steamId: "STEAM_0:1:4", playerName: "Ricky", map: "2fort", routeId: 3, routeName: "Ramp", classId: 2, timeMs: 1000, tier: 1, configVersion: 4, createdAt: "2026-11-08", ghostId: 8 }] });
    assert.deepEqual(calls[0].params, [10]);
    for (const condition of ["flagged = 1", "reviewed = 0", "valid = 1", "mode = 1", "finalization_required = 0", "config_version", "bootcamp_ghosts"])
      assert.match(calls[0].sql, new RegExp(condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  } finally { await app.close(); }
});

test("review endpoint validates verdicts and invokes the atomic database procedure", async () => {
  const calls = [];
  const app = await setup(async (sql, params) => { calls.push({ sql, params }); return sql.includes("CALL") ? [[{ changed: 1 }]] : [{ id: 7 }]; });
  try {
    assert.equal((await fetch(`${app.base}/admin/reviews/7`, { method: "POST", headers: { authorization: app.auth, "content-type": "application/json" }, body: JSON.stringify({ verdict: "maybe" }) })).status, 400);
    const response = await fetch(`${app.base}/admin/reviews/7`, { method: "POST", headers: { authorization: app.auth, "content-type": "application/json" }, body: JSON.stringify({ verdict: "approve" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reviewed: true, runId: 7, verdict: "approve" });
    assert.match(calls[1].sql, /CALL\s+bootcamp_review_run/i);
    assert.deepEqual(calls[1].params, [7, 1]);
  } finally { await app.close(); }
});

test("review endpoints fail closed when admin credentials are not configured", async () => {
  const app = await setup(async () => [], { adminUser: "", adminPassword: "" });
  try {
    const response = await fetch(`${app.base}/admin/reviews`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "bootcamp_admin_not_configured" });
  } finally { await app.close(); }
});

test("pending replay can be inspected only through the authenticated review endpoint", async () => {
  const calls = [];
  const app = await setup(async (sql, params) => {
    calls.push({ sql, params });
    const common = { ghost_id: 8, run_id: 7, map: "2fort", route_id: 3, route_name: "Ramp", class_id: 2,
      player_name: "Ricky", steamid: "STEAM_0:1:4", time_ms: 1000, config_version: 4, frame_interval: 0.02, pos_frames: 2 };
    return [
      { ...common, track: "pos", chunk_id: 0, data: "0,1,2,3,0,90,0,0,-;1,4,5,6,0,91,0,2,-;" },
      { ...common, track: "event", chunk_id: 0, data: "0.5,8,0,0;" }
    ];
  });
  try {
    assert.equal((await fetch(`${app.base}/admin/reviews/7/replay`)).status, 401);
    const response = await fetch(`${app.base}/admin/reviews/7/replay`, { headers: { authorization: app.auth } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).frames.length, 2);
    assert.match(calls[0].sql, /FROM\s+bootcamp_ghosts/i);
    assert.match(calls[0].sql, /b\.flagged\s*=\s*1/i);
  } finally { await app.close(); }
});
