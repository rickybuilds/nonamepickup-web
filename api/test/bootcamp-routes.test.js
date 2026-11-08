"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter, bootcampEnabled } = require("../src/routes/bootcamp");

test("Bootcamp API requires an explicit true feature flag", () => {
  for (const value of [undefined, "", "false", "1", "yes"]) assert.equal(bootcampEnabled(value), false);
  assert.equal(bootcampEnabled("true"), true);
});

test("route leaderboard accepts a numeric route and returns only the query result", async () => {
  const app = express();
  const seen = [];
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    seen.push({ sql, args });
    return [{ run_id: 8, steamid: "STEAM_0:1:4", player_name: "Runner", class_id: 5, time_ms: 12000, has_replay: 1 }];
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/bootcamp/routes/4/leaderboard`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.runs[0].timeMs, 12000);
    assert.equal(body.runs[0].hasReplay, true);
    assert.deepEqual(seen[0].args, [4]);
    assert.match(seen[0].sql, /flagged\s*=\s*0\s+OR\s+\w+\.reviewed\s*=\s*1/i);
    assert.equal((await fetch(`${base}/api/bootcamp/routes/not-a-number/leaderboard`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("map catalog and player profile expose only bounded parameterized queries", async () => {
  const seen = [];
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    seen.push({ sql, args });
    if (/FROM bootcamp_maps/i.test(sql)) return [{ map: "openfire", route_count: 2 }];
    if (/FROM bootcamp_licenses/i.test(sql)) return [{ level: "permit", endorsements: "offense,engineer", granted_at: null }];
    if (/FROM bootcamp_runs/i.test(sql)) return [{ run_id: 10, route_id: 4, map: "openfire", slug: "main", route_name: "Main", class_id: 5, time_ms: 12000, tier: 2 }];
    if (/FROM bootcamp_routes/i.test(sql)) return [{ id: 4, slug: "main", name: "Main", type: "conc", class_id: 5, config_version: 1 }];
    throw new Error("Unexpected query");
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    assert.deepEqual((await (await fetch(`${base}/maps`)).json()).maps, [{ map: "openfire", routeCount: 2 }]);
    const route = (await (await fetch(`${base}/maps/openfire/routes`)).json()).routes[0];
    assert.equal(route.id, 4);
    assert.deepEqual(route.allowedClasses, [5]);
    const profile = await (await fetch(`${base}/players/STEAM_0:1:4`)).json();
    assert.equal(profile.license.level, "permit");
    assert.deepEqual(profile.license.endorsements, ["offense", "engineer"]);
    assert.equal(profile.personalBests[0].timeMs, 12000);
    const runQuery = seen.find(item => /FROM bootcamp_runs/i.test(item.sql));
    assert.deepEqual(runQuery.args, ["STEAM_0:1:4"]);
    assert.match(runQuery.sql, /finalization_required\s*=\s*0/i);
    assert.match(runQuery.sql, /config_version/i);
    assert.equal((await fetch(`${base}/players/not-a-steam-id`)).status, 400);
    assert.equal((await fetch(`${base}/maps/bad%20map/routes`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("Bootcamp catalog and profile report database failures without leaking details", async () => {
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({
    query: async () => { throw new Error("sensitive database detail"); },
    logRouteError: () => {}
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    for (const route of ["/maps", "/maps/openfire/routes", "/players/STEAM_0:1:4"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "bootcamp_database_unavailable" });
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("drill catalog and leaderboard validate inputs and return class-specific scores", async () => {
  const seen = [];
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    seen.push({ sql, args });
    return /ROW_NUMBER/i.test(sql)
      ? [{ set_id: 5, steamid: "STEAM_0:1:4", player_name: "Player", class_id: 3, score: 85, tier: 3 }]
      : [{ id: 7, slug: "position", name: "Position", kind: "position", class_id: 3 }];
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    assert.equal((await (await fetch(`${base}/maps/openfire/drills`)).json()).drills[0].id, 7);
    assert.equal((await (await fetch(`${base}/drills/7/leaderboard`)).json()).scores[0].score, 85);
    assert.deepEqual(seen[1].args, [7]);
    assert.match(seen[1].sql, /PARTITION BY s\.steamid, s\.class_id/i);
    assert.match(seen[1].sql, /s\.finalization_required\s*=\s*0/i);
    assert.match(seen[1].sql, /bootcamp_finalized_drill_sets/i);
    assert.match(seen[1].sql, /g\.is_complete\s*=\s*1/i);
    assert.match(seen[1].sql, /s\.recording_token\s+IS\s+NULL/i);
    assert.equal((await fetch(`${base}/drills/0/leaderboard`)).status, 400);
    assert.equal((await fetch(`${base}/maps/bad%20map/drills`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
