"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

test("skill-point boards calculate current tier weights and monthly improvements in MariaDB", { skip: process.env.BOOTCAMP_LOCAL_DB_TEST !== "1" }, async () => {
  const mysql = require("mysql2/promise");
  const db = await mysql.createConnection({ host: "127.0.0.1", port: 34079, user: "root", database: "bootcamp_local_test" });
  const steam = `STEAM_0:1:${Date.now()}`;
  const targets = [Date.now() % 100000000, (Date.now() + 1) % 100000000, (Date.now() + 2) % 100000000];
  let server;
  try {
    await db.execute("INSERT INTO bootcamp_tiers (steamid, target_type, target_id, map, class_id, tier) VALUES (?, 'route', ?, 'skill_test', 1, 3), (?, 'drill', ?, 'skill_test', 3, 4), (?, 'drill', ?, 'skill_test', 4, 2)",
      [steam, targets[0], steam, targets[1], steam, targets[2]]);
    const events = [
      ["2026-10-31 23:59:59", targets[0], 1, "Bronze"],
      ["2026-11-02 00:00:00", targets[0], 2, "Silver"],
      ["2026-11-03 00:00:00", targets[0], 3, "Gold"],
      ["2026-11-04 00:00:00", targets[1], 4, "Platinum"],
      ["2026-11-30 23:59:59", targets[2], 2, "Silver"]
    ];
    for (const [createdAt, targetId, tier, name] of events) {
      await db.execute("INSERT INTO bootcamp_events (kind, steamid, player_name, map, target_type, target_id, class_id, tier, created_at) VALUES ('tier_up', ?, ?, 'skill_test', ?, ?, ?, ?, ?)",
        [steam, name, targetId === targets[0] ? "route" : "drill", targetId, targetId === targets[0] ? 1 : targetId === targets[1] ? 3 : 4, tier, createdAt]);
    }
    const app = express();
    app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => (await db.execute(sql, args))[0] }));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp/leaderboards/skill-points`;
    const [allTime, monthly] = await Promise.all([
      fetch(`${base}?period=all_time`).then(response => response.json()),
      fetch(`${base}?period=monthly&month=2026-11`).then(response => response.json())
    ]);
    assert.deepEqual(allTime.scores.find(row => row.steamId === steam),
      { steamId: steam, playerName: "Silver", points: 10, objectives: 3 });
    assert.deepEqual(monthly.scores.find(row => row.steamId === steam),
      { steamId: steam, playerName: "Silver", points: 9, objectives: 3 });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.execute("DELETE FROM bootcamp_events WHERE steamid = ?", [steam]);
    await db.execute("DELETE FROM bootcamp_tiers WHERE steamid = ?", [steam]);
    await db.end();
  }
});

test("Bootcamp public APIs exclude pending, invalid, unfinalized and legacy runs in MariaDB", { skip: process.env.BOOTCAMP_LOCAL_DB_TEST !== "1" }, async () => {
  const mysql = require("mysql2/promise");
  const db = await mysql.createConnection({ host: "127.0.0.1", port: 34079, user: "root", database: "bootcamp_local_test" });
  const map = `web_${Date.now()}`, steam = `STEAM_0:1:${Date.now()}`;
  let routeId, drillId, server;
  try {
    await db.execute("INSERT INTO bootcamp_maps (map) VALUES (?)", [map]);
    const [route] = await db.execute("INSERT INTO bootcamp_routes (map, slug, name, type, config_version) VALUES (?, 'route', 'Route', 'conc', 2)", [map]);
    routeId = route.insertId;
    const [drill] = await db.execute("INSERT INTO bootcamp_drills (map, slug, kind, name, class_id) VALUES (?, 'hold', 'position', 'Hold', 3)", [map]);
    drillId = drill.insertId;
    const drillSetIds = [];
    for (const [classId, score] of [[3, 60], [3, 80], [3, 75], [6, 77]]) {
      const [set] = await db.execute("INSERT INTO bootcamp_drill_sets (steamid, player_name, map, drill_id, class_id, score, tier) VALUES (?, 'Tester', ?, ?, ?, ?, 2)", [steam, map, drillId, classId, score]);
      drillSetIds.push(set.insertId);
    }
    const tokenBase = (Date.now() % 100_000_000) * 10;
    for (const [score, finalizationRequired, token] of [[999, 1, tokenBase], [1000, 0, tokenBase + 1]]) {
      const [set] = await db.execute("INSERT INTO bootcamp_drill_sets (steamid, player_name, map, drill_id, class_id, score, tier, finalization_required, recording_token) VALUES (?, 'Tester', ?, ?, 3, ?, 4, ?, ?)",
        [steam, map, drillId, score, finalizationRequired, token]);
      drillSetIds.push(set.insertId);
    }
    const [publishedSet] = await db.execute("INSERT INTO bootcamp_drill_sets (steamid, player_name, map, drill_id, class_id, score, tier, finalization_required, recording_token) VALUES (?, 'Tester', ?, ?, 4, 90, 2, 1, ?)", [steam, map, drillId, tokenBase + 2]);
    drillSetIds.push(publishedSet.insertId);
    const [drillGhost] = await db.execute("INSERT INTO bootcamp_ghosts (drill_set_id, map, class_id, steamid, player_name, kind, pos_frames, is_complete) VALUES (?, ?, 4, ?, 'Tester', 'drill', 2, 1)",
      [publishedSet.insertId, map, steam]);
    await db.execute("UPDATE bootcamp_drill_sets SET ghost_id = ? WHERE id = ?", [drillGhost.insertId, publishedSet.insertId]);
    await db.execute("INSERT INTO bootcamp_ghost_chunks (ghost_id, track, chunk_id, data) VALUES (?, 'pos', 0, ?)", [drillGhost.insertId, "0,1,2,3,0,90,0,0,-;1,4,5,6,0,91,0,2,-;"]);
    await db.execute("CALL bootcamp_finalize_drill_set(?)", [publishedSet.insertId]);
    await db.execute("INSERT INTO bootcamp_route_classes (route_id, class_id) VALUES (?, 1), (?, 5)", [routeId, routeId]);
    await db.execute("INSERT INTO bootcamp_licenses (steamid, level, endorsements) VALUES (?, 'permit', 'offense')", [steam]);
    const runIds = [];
    for (const [time, version, valid, flagged, reviewed, finalization] of [
      [12000, 2, 1, 0, 0, 0], [13000, 2, 1, 0, 0, 0], [1000, 2, 1, 1, 0, 0],
      [2000, 1, 1, 0, 0, 0], [3000, 2, 0, 0, 0, 0], [4000, 2, 1, 0, 1, 1], [15000, 2, 1, 0, 0, 0]
    ]) {
      const [run] = await db.execute("INSERT INTO bootcamp_runs (steamid, player_name, map, route_id, class_id, time_ms, config_version, valid, flagged, reviewed, finalization_required) VALUES (?, 'Tester', ?, ?, 5, ?, ?, ?, ?, ?, ?)",
        [steam, map, routeId, time, version, valid, flagged, reviewed, finalization]);
      runIds.push(run.insertId);
      const [ghost] = await db.execute("INSERT INTO bootcamp_ghosts (run_id, map, route_id, class_id, steamid, player_name, pos_frames, is_complete) VALUES (?, ?, ?, 5, ?, 'Tester', 2, ?)", [run.insertId, map, routeId, steam, time === 15000 ? 0 : 1]);
      await db.execute("UPDATE bootcamp_runs SET ghost_id = ? WHERE id = ?", [ghost.insertId, run.insertId]);
      await db.execute("INSERT INTO bootcamp_ghost_chunks (ghost_id, track, chunk_id, data) VALUES (?, 'pos', 0, ?)", [ghost.insertId, "0,1,2,3,0,90,0,0,-;1,4,5,6,0,91,0,2,-;"]);
      if (time === 12000) {
        const tracks = { pos: "0,1,2,3,4,5,6,7,8,9,10,11,12;0.033,2,3,4,5,6,7,0,8,9,10,11,0;",
          proj: "0,projectile;", input: "0,1;", cmd: "0,1;", event: "0.5,8,0,0;" };
        await db.execute("DELETE FROM bootcamp_ghost_chunks WHERE ghost_id = ?", [ghost.insertId]);
        const hashes = {};
        for (const [track, data] of Object.entries(tracks)) {
          await db.execute("INSERT INTO bootcamp_ghost_chunks (ghost_id, track, chunk_id, data) VALUES (?, ?, 0, ?)", [ghost.insertId, track, data]);
          hashes[`spool_${track}_sha`] = crypto.createHash("sha256").update(data, "utf8").digest("hex");
        }
        await db.execute(`UPDATE bootcamp_ghosts SET proj_frames = 1, input_frames = 1, cmd_frames = 1, event_frames = 1,
            spool_pos_sha = ?, spool_proj_sha = ?, spool_input_sha = ?, spool_cmd_sha = ?, spool_event_sha = ? WHERE id = ?`,
          [hashes.spool_pos_sha, hashes.spool_proj_sha, hashes.spool_input_sha, hashes.spool_cmd_sha, hashes.spool_event_sha, ghost.insertId]);
      }
    }
    const app = express();
    app.use(express.json());
    app.use("/api/bootcamp", createBootcampRouter({ adminUser: "reviewer", adminPassword: "test-only",
      query: async (sql, args) => (await db.execute(sql, args))[0] }));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    const routes = await (await fetch(`${base}/maps/${map}/routes`)).json();
    assert.deepEqual(routes.routes[0].allowedClasses, [1, 5]);
    const profile = await (await fetch(`${base}/players/${steam}`)).json();
    assert.equal(profile.license.level, "permit");
    assert.deepEqual(profile.personalBests.map(run => run.timeMs), [12000]);
    assert.deepEqual(profile.drillBests.map(row => [row.classId, row.score]), [[3, 80], [4, 90], [6, 77]]);
    const leaderboard = await (await fetch(`${base}/routes/${routeId}/leaderboard`)).json();
    assert.deepEqual(leaderboard.runs.map(run => run.timeMs), [12000]);
    const replay = await fetch(`${base}/replay/run/${runIds[0]}`);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).frames.length, 2);
    const tftr = await fetch(`${base}/replay/run/${runIds[0]}/tftr`);
    assert.equal(tftr.status, 200);
    assert.match(tftr.headers.get("content-type"), /application\/vnd\.nn\.ghost-sidecar/);
    const tftrBytes = Buffer.from(await tftr.arrayBuffer());
    assert.equal(tftrBytes.subarray(0, 4).toString("ascii"), "TFTR");
    assert.equal(tftrBytes.readUInt16LE(4), 1);
    assert.equal(tftr.headers.get("x-tftr-sha256"), crypto.createHash("sha256").update(tftrBytes).digest("hex"));
    const replayMetadata = await fetch(`${base}/replay/run/${runIds[0]}/metadata`);
    assert.equal(replayMetadata.status, 200);
    const replayContext = await replayMetadata.json();
    assert.deepEqual([replayContext.runId, replayContext.map, replayContext.routeId, replayContext.frameCount],
      [runIds[0], map, routeId, 2]);
    for (const id of runIds.slice(2)) {
      assert.equal((await fetch(`${base}/replay/run/${id}`)).status, 404);
      assert.equal((await fetch(`${base}/replay/run/${id}/tftr`)).status, 404);
      assert.equal((await fetch(`${base}/replay/run/${id}/metadata`)).status, 404);
    }
    const drills = await (await fetch(`${base}/maps/${map}/drills`)).json();
    assert.equal(drills.drills[0].id, drillId);
    const drillBoard = await (await fetch(`${base}/drills/${drillId}/leaderboard`)).json();
    assert.deepEqual(drillBoard.scores.map(row => [row.classId, row.score]), [[4, 90], [3, 80], [6, 77]]);
    const auth = `Basic ${Buffer.from("reviewer:test-only").toString("base64")}`;
    const reviewQueue = await (await fetch(`${base}/admin/reviews`, { headers: { authorization: auth } })).json();
    assert.ok(reviewQueue.reviews.some(run => run.runId === runIds[2] && run.ghostId));
    const pendingReplay = await fetch(`${base}/admin/reviews/${runIds[2]}/replay`, { headers: { authorization: auth } });
    assert.equal(pendingReplay.status, 200);
    assert.equal((await pendingReplay.json()).frames.length, 2);
    const approval = await fetch(`${base}/admin/reviews/${runIds[2]}`, { method: "POST",
      headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ verdict: "approve" }) });
    assert.equal(approval.status, 200);
    assert.equal((await (await fetch(`${base}/replay/run/${runIds[2]}`)).json()).runId, runIds[2]);
    const reviewedBoard = await (await fetch(`${base}/routes/${routeId}/leaderboard`)).json();
    assert.equal(reviewedBoard.runs[0].timeMs, 1000);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (routeId) {
      await db.execute("DELETE c FROM bootcamp_ghost_chunks c JOIN bootcamp_ghosts g ON g.id = c.ghost_id WHERE g.route_id = ?", [routeId]);
      await db.execute("DELETE FROM bootcamp_ghosts WHERE route_id = ?", [routeId]);
      await db.execute("DELETE FROM bootcamp_runs WHERE route_id = ?", [routeId]);
      await db.execute("DELETE FROM bootcamp_route_classes WHERE route_id = ?", [routeId]);
      await db.execute("DELETE FROM bootcamp_routes WHERE id = ?", [routeId]);
    }
    if (drillId) {
      await db.execute("DELETE FROM bootcamp_events WHERE target_type = 'drill' AND target_id = ? AND steamid = ?", [drillId, steam]);
      await db.execute("DELETE FROM bootcamp_tiers WHERE target_type = 'drill' AND target_id = ? AND steamid = ?", [drillId, steam]);
      await db.execute("DELETE c FROM bootcamp_ghost_chunks c JOIN bootcamp_ghosts g ON g.id = c.ghost_id WHERE g.drill_set_id IN (SELECT id FROM bootcamp_drill_sets WHERE drill_id = ?)", [drillId]);
      await db.execute("DELETE FROM bootcamp_ghosts WHERE drill_set_id IN (SELECT id FROM bootcamp_drill_sets WHERE drill_id = ?)", [drillId]);
      await db.execute("DELETE FROM bootcamp_finalized_drill_sets WHERE drill_set_id IN (SELECT id FROM bootcamp_drill_sets WHERE drill_id = ?)", [drillId]);
      await db.execute("DELETE FROM bootcamp_drill_sets WHERE drill_id = ?", [drillId]);
      await db.execute("DELETE FROM bootcamp_drills WHERE id = ?", [drillId]);
    }
    await db.execute("DELETE FROM bootcamp_licenses WHERE steamid = ?", [steam]);
    await db.execute("DELETE FROM bootcamp_maps WHERE map = ?", [map]);
    await db.end();
  }
});
