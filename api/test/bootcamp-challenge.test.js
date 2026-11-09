"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  return new Promise(resolve => server.once("listening", () => resolve({
    base: `http://127.0.0.1:${server.address().port}/api/bootcamp`,
    close: () => new Promise(done => server.close(done))
  })));
}

test("current weekly challenge returns its route leaderboard limited to the challenge window", async () => {
  const seen = [];
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    seen.push({ sql, args });
    if (/FROM bootcamp_challenges/i.test(sql)) return [{ id: 17, week_start: "2026-11-02", map: "openfire", target_type: "route", target_id: 4,
      title: "Openfire conc run", starts_at: "2026-11-02 00:00:00", ends_at: "2026-11-09 00:00:00", target_name: "Main Conc" }];
    if (/FROM bootcamp_runs/i.test(sql)) return [{ steamid: "STEAM_0:1:4", player_name: "Runner", class_id: 5, result: 12000, result_id: 22 }];
    throw new Error("Unexpected query");
  } }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.base}/challenge/current`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      challenge: { id: 17, weekStart: "2026-11-02", map: "openfire", targetType: "route", targetId: 4,
        title: "Openfire conc run", startsAt: "2026-11-02 00:00:00", endsAt: "2026-11-09 00:00:00", targetName: "Main Conc" },
      standings: [{ steamId: "STEAM_0:1:4", playerName: "Runner", classId: 5, timeMs: 12000, score: null, resultId: 22 }]
    });
    assert.match(seen[0].sql, /UTC_TIMESTAMP\(\)/i);
    assert.deepEqual(seen[1].args, [4, "2026-11-02 00:00:00", "2026-11-09 00:00:00"]);
    assert.match(seen[1].sql, /flagged\s*=\s*0\s+OR\s+\w+\.reviewed\s*=\s*1/i);
    assert.match(seen[1].sql, /CONVERT_TZ\(b\.created_at,\s*@@session\.time_zone,\s*['"]\+00:00['"]\)/i);
    assert.match(seen[1].sql, /finalization_required\s*=\s*0/i);
  } finally { await server.close(); }
});

test("weekly challenge returns an empty state when no challenge is active", async () => {
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async () => [] }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.base}/challenge/current`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { challenge: null, standings: [] });
  } finally { await server.close(); }
});

test("drill challenge standings require published, replay-complete scores", async () => {
  const seen = [];
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    seen.push({ sql, args });
    if (/FROM bootcamp_challenges/i.test(sql)) return [{ id: 18, week_start: "2026-11-02", map: "openfire", target_type: "drill", target_id: 7,
      title: "Hold the flag", starts_at: "2026-11-02 00:00:00", ends_at: "2026-11-09 00:00:00", target_name: "SG Hold" }];
    if (/FROM bootcamp_drill_sets/i.test(sql)) return [{ steamid: "STEAM_0:1:8", player_name: "Builder", class_id: 9, result: 94.5, result_id: 31 }];
    throw new Error("Unexpected query");
  } }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.base}/challenge/current`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.challenge.targetType, "drill");
    assert.deepEqual(body.standings[0], { steamId: "STEAM_0:1:8", playerName: "Builder", classId: 9, timeMs: null, score: 94.5, resultId: 31 });
    assert.deepEqual(seen[1].args, [7, "2026-11-02 00:00:00", "2026-11-09 00:00:00"]);
    assert.match(seen[1].sql, /bootcamp_finalized_drill_sets/i);
    assert.match(seen[1].sql, /g\.is_complete\s*=\s*1/i);
    assert.match(seen[1].sql, /CONVERT_TZ\(s\.created_at,\s*@@session\.time_zone,\s*['"]\+00:00['"]\)/i);
  } finally { await server.close(); }
});
