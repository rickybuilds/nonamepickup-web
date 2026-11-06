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
    return [{ run_id: 8, steamid: "STEAM_0:1:4", player_name: "Runner", class_id: 5, time_ms: 12000 }];
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/bootcamp/routes/4/leaderboard`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.runs[0].timeMs, 12000);
    assert.deepEqual(seen[0].args, [4]);
    assert.match(seen[0].sql, /flagged\s*=\s*0\s+OR\s+\w+\.reviewed\s*=\s*1/i);
    assert.equal((await fetch(`${base}/api/bootcamp/routes/not-a-number/leaderboard`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
