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
    if (/FROM bootcamp_drill_sets/i.test(sql)) return [{ set_id: 11, drill_id: 7, map: "openfire", slug: "hold", drill_name: "Hold", kind: "position", class_id: 3, score: 90, tier: 2 }];
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
    assert.equal(profile.drillBests[0].score, 90);
    const drillQuery = seen.find(item => /FROM bootcamp_drill_sets/i.test(item.sql));
    assert.deepEqual(drillQuery.args, ["STEAM_0:1:4"]);
    assert.match(drillQuery.sql, /finalization_required\s*=\s*0/i);
    assert.match(drillQuery.sql, /bootcamp_finalized_drill_sets/i);
    assert.match(drillQuery.sql, /s\.recording_token\s+IS\s+NULL/i);
    assert.match(drillQuery.sql, /g\.is_complete\s*=\s*1/i);
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

test("legacy Bootcamp detail pages receive only current published map, route, and drill results", async () => {
  const seen = [];
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    seen.push({ sql, args });
    if (/FROM bootcamp_maps m/i.test(sql)) return [{ map: "2fort", config_version: 3, in_rotation: 1, rotation_order: 0 }];
    if (/FROM bootcamp_points/i.test(sql)) return [{ kind: "crit", n: 1 }, { kind: "spot", n: 2 }];
    if (/FROM bootcamp_drills d/i.test(sql) && /WHERE d\.map/i.test(sql))
      return [{ id: 9, slug: "sg", name: "Sentry placement", kind: "sg", class_id: 9, tier_bronze: 40, tier_silver: 60, tier_gold: 80, tier_plat: 95, sets: 3, best_score: 85 }];
    if (/FROM bootcamp_routes r/i.test(sql) && /WHERE r\.map/i.test(sql))
      return [{ id: 4, slug: "lantest", name: "LAN test", map: "2fort", type: "walk", class_id: 0,
        target_crit: "lantestflag", config_version: 3, reference_time_ms: 12000, runs: 3, runners: 2 }];
    if (/FROM bootcamp_runs b/i.test(sql) && /ROW_NUMBER/i.test(sql))
      return [{ run_id: 7, route_id: 4, steamid: "STEAM_0:1:4", player_name: "Runner", class_id: 1, time_ms: 11000, tier: 2, has_replay: 1 }];
    if (/FROM bootcamp_runs b/i.test(sql) && /ORDER BY b\.id DESC LIMIT 25/i.test(sql)) return [];
    if (/FROM bootcamp_runs b/i.test(sql) && /legacy/i.test(sql)) return [{ legacy_run_count: 1 }];
    if (/FROM bootcamp_routes r/i.test(sql) && /WHERE r\.id/i.test(sql))
      return [{ id: 4, slug: "lantest", name: "LAN test", map: "2fort", type: "walk", class_id: 0,
        target_crit: "lantestflag", config_version: 3, start_x: 0, start_y: 0, start_z: 0,
        start_radius: 48, start_height: 72, end_kind: 0, end_x: 100, end_y: 0, end_z: 0,
        end_radius: 48, end_height: 72, tier_bronze_pct: 90, tier_silver_pct: 80, tier_gold_pct: 70,
        tier_plat_pct: 60, reference_time_ms: 12000 }];
    if (/bootcamp_route_checkpoints/i.test(sql)) return [];
    if (/FROM bootcamp_drills d/i.test(sql) && /WHERE d\.id/i.test(sql))
      return [{ id: 9, slug: "sg", name: "Sentry placement", map: "2fort", kind: "sg", class_id: 9,
        tier_bronze: 40, tier_silver: 60, tier_gold: 80, tier_plat: 95 }];
    if (/FROM bootcamp_drill_sets s/i.test(sql) && /ROW_NUMBER/i.test(sql))
      return [{ set_id: 21, steamid: "STEAM_0:1:4", player_name: "Runner", class_id: 9, score: 85, tier: 3, ghost_id: 31, details_json: "{}" }];
    throw new Error(`Unexpected query: ${sql}`);
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    const map = await (await fetch(`${base}/maps/2fort`)).json();
    assert.equal(map.routes[0].record.runId, 7);
    assert.equal(map.drills[0].bestScore, 85);
    const route = await (await fetch(`${base}/routes/4`)).json();
    assert.equal(route.route.targetCrit, "lantestflag");
    assert.equal(route.leaderboard[0].hasReplay, true);
    assert.equal(route.legacyRuns, 1);
    const drill = await (await fetch(`${base}/drills/9`)).json();
    assert.equal(drill.drill.name, "Sentry placement");
    assert.equal(drill.leaderboard[0].ghostId, 31);
    for (const q of seen.filter(item => /FROM bootcamp_runs b|FROM bootcamp_drill_sets s/i.test(item.sql))) {
      assert.match(q.sql, /finalization_required\s*=\s*0/i);
      if (/bootcamp_runs/i.test(q.sql)) assert.match(q.sql, /flagged\s*=\s*0\s+OR\s+b?\.reviewed\s*=\s*1/i);
      else assert.match(q.sql, /bootcamp_finalized_drill_sets/i);
    }
    assert.equal((await fetch(`${base}/routes/nope`)).status, 400);
    assert.equal((await fetch(`${base}/drills/nope`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("skill points expose all-time best tiers and monthly tier-improvement standings", async () => {
  const seen = [];
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    seen.push({ sql, args });
    if (/FROM bootcamp_tiers/i.test(sql)) return [{ steamid: "STEAM_0:1:4", player_name: "Runner", points: 12, objectives: 6 }];
    return [{ steamid: "STEAM_0:1:5", player_name: "Monthly", points: 3, objectives: 2 }];
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp/leaderboards/skill-points`;
    const allTime = await (await fetch(base)).json();
    assert.equal(allTime.period, "all_time");
    assert.deepEqual(allTime.scores[0], { steamId: "STEAM_0:1:4", playerName: "Runner", points: 12, objectives: 6 });
    assert.match(seen[0].sql, /bootcamp_tiers/i);
    assert.match(seen[0].sql, /WHEN\s+4\s+THEN\s+5/i);

    const monthlyResponse = await fetch(`${base}?period=monthly&month=2026-11`);
    assert.equal(monthlyResponse.status, 200);
    const monthly = await monthlyResponse.json();
    assert.equal(monthly.period, "monthly");
    assert.equal(monthly.month, "2026-11");
    assert.deepEqual(monthly.scores[0], { steamId: "STEAM_0:1:5", playerName: "Monthly", points: 3, objectives: 2 });
    assert.deepEqual(seen[1].args, ["2026-11-01 00:00:00", "2026-12-01 00:00:00"]);
    assert.match(seen[1].sql, /LAG\s*\(/i);
    assert.match(seen[1].sql, /tier_up/i);
    assert.equal((await fetch(`${base}?period=monthly&month=2026-13`)).status, 400);
    assert.equal((await fetch(`${base}?period=weekly`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
