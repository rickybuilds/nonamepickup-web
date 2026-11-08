"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const crypto = require("node:crypto");
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

test("public replay metadata exposes frame context without loading replay chunks", async () => {
  const calls = [], app = express();
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    calls.push({ sql, args });
    if (/bootcamp replay metadata/i.test(sql)) return [{ run_id: 3, ghost_id: 7, map: "openfire", route_id: 2,
      route_name: "Ramp", class_id: 5, player_name: "Runner", steamid: "STEAM_0:1:4", time_ms: 12000,
      config_version: 4, frame_interval: 1 / 30, frame_count: 2 }];
    return [];
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp/replay/run`;
    const response = await fetch(`${base}/3/metadata`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { source: "bootcamp", runId: 3, ghostId: 7, map: "openfire", routeId: 2,
      routeName: "Ramp", classId: 5, playerName: "Runner", steamid: "STEAM_0:1:4", timeMs: 12000,
      configVersion: 4, frameInterval: 1 / 30, frameCount: 2 });
    assert.deepEqual(calls[0].args, [3]);
    assert.match(calls[0].sql, /b\.finalization_required\s*=\s*0/i);
    assert.doesNotMatch(calls[0].sql, /bootcamp_ghost_chunks/i);
    assert.equal((await fetch(`${base}/0/metadata`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("published Bootcamp replay exposes the TFTR v1 sidecar without changing JSON replay output", async () => {
  const calls = [], app = express();
  const record = { id: 7, run_id: 3, map: "openfire", route_id: 2, class_id: 5, time_ms: 12000,
    config_version: 4, is_complete: 1, frame_interval: 1 / 30, tier_tag: 2 };
  const tracks = {
    pos: [{ chunk_id: 0, data: "0,1,2,3,4,5,6,7,8,9,10,11,12;0.033,2,3,4,5,6,7,0,8,9,10,11,0;" }],
    proj: [{ chunk_id: 0, data: "0,1,2;" }], input: [{ chunk_id: 0, data: "0,1;" }],
    cmd: [{ chunk_id: 0, data: "0,1;" }], event: [{ chunk_id: 0, data: "0.5,8,0,0;" }]
  };
  for (const [track, rows] of Object.entries(tracks)) {
    record[`${track}_frames`] = rows.reduce((sum, row) => sum + (row.data.match(/;/g) || []).length, 0);
    record[`spool_${track}_sha`] = crypto.createHash("sha256").update(rows.map(row => row.data).join(""), "utf8").digest("hex");
  }
  app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
    calls.push({ sql, args });
    if (/tftr sidecar/i.test(sql)) return [record];
    if (/bootcamp_ghost_chunks/i.test(sql) && /'input'/i.test(sql)) return Object.entries(tracks).flatMap(([track, rows]) => rows.map(row => ({ track, ...row })));
    return [ { ghost_id: 7, run_id: 3, map: "openfire", route_id: 2, route_name: "Ramp", class_id: 5,
      player_name: "Runner", steamid: "STEAM_0:1:4", time_ms: 12000, config_version: 4, frame_interval: 1 / 30, pos_frames: 2,
      track: "pos", chunk_id: 0, data: tracks.pos[0].data },
    { ghost_id: 7, run_id: 3, track: "event", chunk_id: 0, data: tracks.event[0].data } ];
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    const response = await fetch(`${base}/replay/run/3/tftr`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/vnd\.nn\.ghost-sidecar/);
    assert.equal(response.headers.get("x-tftr-version"), "1");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "TFTR");
    assert.equal(bytes.readUInt16LE(4), 1);
    const mapLen = bytes.readUInt8(6);
    assert.equal(bytes.toString("utf8", 7, 7 + mapLen), "openfire");
    assert.equal(bytes.readUInt32LE(7 + mapLen), 4);
    assert.equal(bytes.readUInt8(11 + mapLen), 1);
    assert.equal(bytes.readUInt32LE(12 + mapLen), 2);
    assert.equal(bytes.readUInt32LE(19 + mapLen), 2);
    assert.equal(bytes.readUInt32LE(23 + mapLen), 1);
    assert.equal(bytes.length, 27 + mapLen + 2 * 39 + 13);
    const firstFrame = 27 + mapLen;
    assert.equal(bytes.readUInt32LE(firstFrame), 0);
    assert.equal(bytes.readFloatLE(firstFrame + 4), 1);
    assert.equal(bytes.readFloatLE(firstFrame + 16), 4);
    assert.equal(bytes.readFloatLE(firstFrame + 24), 9);
    assert.equal(bytes.readUInt16LE(firstFrame + 36), 7);
    assert.equal(bytes.readUInt8(firstFrame + 38), 12);
    const firstEvent = firstFrame + 2 * 39;
    assert.equal(bytes.readUInt32LE(firstEvent), 15);
    assert.equal(bytes.readUInt8(firstEvent + 4), 8);
    assert.ok(calls.some(call => /b\.finalization_required\s*=\s*0/i.test(call.sql) && /b\.flagged\s*=\s*0/i.test(call.sql)));
    const legacy = await fetch(`${base}/replay/run/3`);
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).source, "bootcamp");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("TFTR sidecar is unavailable for legacy position samples without motion fields", async () => {
  const app = express();
  const tracks = { pos: "0,1,2,3,4,5,6,7,8;0.033,2,3,4,5,6,7,0,8;", proj: "0,1;", input: "0,1;",
    cmd: "0,1;", event: "0.5,8,0,0;" };
  const record = { id: 7, run_id: 3, map: "openfire", route_id: 2, class_id: 5,
    time_ms: 12000, config_version: 4, is_complete: 1, frame_interval: 1 / 30, tier_tag: 0 };
  for (const [track, data] of Object.entries(tracks)) {
    record[`${track}_frames`] = (data.match(/;/g) || []).length;
    record[`spool_${track}_sha`] = crypto.createHash("sha256").update(data, "utf8").digest("hex");
  }
  app.use("/api/bootcamp", createBootcampRouter({ query: async sql => {
    if (/tftr sidecar/i.test(sql)) return [record];
    if (/bootcamp_ghost_chunks/i.test(sql)) return Object.entries(tracks).map(([track, data]) => ({ track, chunk_id: 0, data }));
    return [];
  } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bootcamp/replay/run/3/tftr`);
    assert.equal(response.status, 406);
    assert.deepEqual(await response.json(), { error: "tftr_sidecar_unavailable", reason: "legacy_position_track_has_no_motion_fields" });
    record.spool_pos_sha = "0".repeat(64);
    const altered = await fetch(`http://127.0.0.1:${server.address().port}/api/bootcamp/replay/run/3/tftr`);
    assert.equal(altered.status, 422);
    assert.deepEqual(await altered.json(), { error: "replay_invalid", reason: "pos_integrity_mismatch" });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
