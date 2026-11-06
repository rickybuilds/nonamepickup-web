"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

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
    for (const [classId, score] of [[3, 60], [3, 80], [3, 75], [6, 77]])
      await db.execute("INSERT INTO bootcamp_drill_sets (steamid, player_name, map, drill_id, class_id, score, tier) VALUES (?, 'Tester', ?, ?, ?, ?, 2)", [steam, map, drillId, classId, score]);
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
    }
    const app = express();
    app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => (await db.execute(sql, args))[0] }));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    const routes = await (await fetch(`${base}/maps/${map}/routes`)).json();
    assert.deepEqual(routes.routes[0].allowedClasses, [1, 5]);
    const profile = await (await fetch(`${base}/players/${steam}`)).json();
    assert.equal(profile.license.level, "permit");
    assert.deepEqual(profile.personalBests.map(run => run.timeMs), [12000]);
    const leaderboard = await (await fetch(`${base}/routes/${routeId}/leaderboard`)).json();
    assert.deepEqual(leaderboard.runs.map(run => run.timeMs), [12000]);
    const replay = await fetch(`${base}/replay/run/${runIds[0]}`);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).frames.length, 2);
    for (const id of runIds.slice(2)) assert.equal((await fetch(`${base}/replay/run/${id}`)).status, 404);
    const drills = await (await fetch(`${base}/maps/${map}/drills`)).json();
    assert.equal(drills.drills[0].id, drillId);
    const drillBoard = await (await fetch(`${base}/drills/${drillId}/leaderboard`)).json();
    assert.deepEqual(drillBoard.scores.map(row => [row.classId, row.score]), [[3, 80], [6, 77]]);
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
      await db.execute("DELETE FROM bootcamp_drill_sets WHERE drill_id = ?", [drillId]);
      await db.execute("DELETE FROM bootcamp_drills WHERE id = ?", [drillId]);
    }
    await db.execute("DELETE FROM bootcamp_licenses WHERE steamid = ?", [steam]);
    await db.execute("DELETE FROM bootcamp_maps WHERE map = ?", [map]);
    await db.end();
  }
});
