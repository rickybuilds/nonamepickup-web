"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

test("Bootcamp public APIs exclude pending, invalid, unfinalized and legacy runs in MariaDB", { skip: process.env.BOOTCAMP_LOCAL_DB_TEST !== "1" }, async () => {
  const mysql = require("mysql2/promise");
  const db = await mysql.createConnection({ host: "127.0.0.1", port: 34079, user: "root", database: "bootcamp_local_test" });
  const map = `web_${Date.now()}`, steam = `STEAM_0:1:${Date.now()}`;
  let routeId, server;
  try {
    await db.execute("INSERT INTO bootcamp_maps (map) VALUES (?)", [map]);
    const [route] = await db.execute("INSERT INTO bootcamp_routes (map, slug, name, type, config_version) VALUES (?, 'route', 'Route', 'conc', 2)", [map]);
    routeId = route.insertId;
    await db.execute("INSERT INTO bootcamp_route_classes (route_id, class_id) VALUES (?, 1), (?, 5)", [routeId, routeId]);
    await db.execute("INSERT INTO bootcamp_licenses (steamid, level, endorsements) VALUES (?, 'permit', 'offense')", [steam]);
    for (const [time, version, valid, flagged, reviewed, finalization] of [
      [12000, 2, 1, 0, 0, 0], [13000, 2, 1, 0, 0, 0], [1000, 2, 1, 1, 0, 0],
      [2000, 1, 1, 0, 0, 0], [3000, 2, 0, 0, 0, 0], [4000, 2, 1, 0, 1, 1]
    ]) await db.execute("INSERT INTO bootcamp_runs (steamid, player_name, map, route_id, class_id, time_ms, config_version, valid, flagged, reviewed, finalization_required) VALUES (?, 'Tester', ?, ?, 5, ?, ?, ?, ?, ?, ?)",
      [steam, map, routeId, time, version, valid, flagged, reviewed, finalization]);
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
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (routeId) {
      await db.execute("DELETE FROM bootcamp_runs WHERE route_id = ?", [routeId]);
      await db.execute("DELETE FROM bootcamp_route_classes WHERE route_id = ?", [routeId]);
      await db.execute("DELETE FROM bootcamp_routes WHERE id = ?", [routeId]);
    }
    await db.execute("DELETE FROM bootcamp_licenses WHERE steamid = ?", [steam]);
    await db.execute("DELETE FROM bootcamp_maps WHERE map = ?", [map]);
    await db.end();
  }
});
