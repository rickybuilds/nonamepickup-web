"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

test("public replay reconstructs ordered chunks through the eligible ghost view", async () => {
  const calls = [], app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    calls.push({ sql, args });
    const common = { ghost_id: 7, run_id: 3, map: "openfire", route_id: 2, route_name: "Ramp", class_id: 5,
      player_name: "Runner", steamid: "STEAM_0:1:4", time_ms: 12000, config_version: 2, frame_interval: 0.02, pos_frames: 2 };
    return [
      { ...common, track: "event", chunk_id: 0, data: "0.5,8,0,0;" },
      { ...common, track: "pos", chunk_id: 0, data: "0,1,2,3,0,90,0,0,-;" },
      { ...common, track: "pos", chunk_id: 1, data: "1,4,5,6,0,91,0,2,-;" }
    ];
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    const response = await fetch(`${base}/replay/run/3`);
    assert.equal(response.status, 200);
    const replay = await response.json();
    assert.equal(replay.frames.length, 2);
    assert.equal(replay.frames[1].x, 4);
    assert.equal(replay.events[0].code, 8);
    assert.deepEqual(calls[0].args, [3]);
    assert.match(calls[0].sql, /bootcamp_public_route_ghosts/i);
    assert.match(calls[0].sql, /finalization_required\s*=\s*0/i);
    assert.equal((await fetch(`${base}/replay/run/0`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("public replay rejects missing, incomplete and fragmented recordings", async () => {
  let rows = [];
  const app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async () => rows }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/bootcamp/replay/run/3`;
    assert.equal((await fetch(url)).status, 404);
    rows = [{ ghost_id: 7, run_id: 3, pos_frames: 2, track: "pos", chunk_id: 1, data: "0,1,2,3,0,90,0,0,-;1,4,5,6,0,91,0,2,-;" }];
    assert.equal((await fetch(url)).status, 422);
    rows[0].chunk_id = 0;
    rows[0].data = "0,1,2,3,0,90,0,0,-;";
    assert.equal((await fetch(url)).status, 422);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
