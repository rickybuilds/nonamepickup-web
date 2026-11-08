"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mysql = require("mysql2/promise");
const { createBootcampRouter } = require("../src/routes/bootcamp");

test("weekly route challenge standings exclude unreviewed flagged runs and stay inside the UTC week", { skip: process.env.BOOTCAMP_LOCAL_DB_TEST !== "1" }, async () => {
  const db = await mysql.createConnection({ host: "127.0.0.1", port: 34079, user: "root", database: "bootcamp_local_test" });
  const map = `challenge_${Date.now()}`, steam = `STEAM_0:1:${Date.now()}`;
  let routeId, challengeId, server;
  try {
    const [mapInsert] = await db.execute("INSERT INTO bootcamp_maps (map) VALUES (?)", [map]);
    const [routeInsert] = await db.execute("INSERT INTO bootcamp_routes (map, slug, name, type, config_version) VALUES (?, 'weekly', 'Weekly route', 'conc', 1)", [map]);
    routeId = routeInsert.insertId;
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
    const weekStart = monday.toISOString().slice(0, 10);
    const startsAt = `${weekStart} 00:00:00`;
    const endsAt = `${new Date(monday.valueOf() + 7 * 86400000).toISOString().slice(0, 10)} 00:00:00`;
    const [challenge] = await db.execute("INSERT INTO bootcamp_challenges (title, target_type, target_id, starts_at, ends_at, created_by) VALUES ('Weekly test', 'route', ?, ?, ?, 'web-test')",
      [routeId, startsAt, endsAt]);
    challengeId = challenge.insertId;
    await db.execute(`INSERT INTO bootcamp_runs (steamid, player_name, map, route_id, class_id, time_ms, valid, mode, config_version, flagged, reviewed)
      VALUES (?, 'Runner', ?, ?, 5, 18000, 1, 1, 1, 0, 0), (?, 'Runner', ?, ?, 5, 9000, 1, 1, 1, 1, 0)`,
      [steam, map, routeId, steam, map, routeId]);
    const app = express();
    app.use("/api/bootcamp", createBootcampRouter({ query: async (sql, args) => {
      const [rows] = await db.execute(sql, args);
      return rows;
    } }));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bootcamp/challenge/current`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.challenge.id, challengeId);
    assert.equal(body.standings.length, 1);
    assert.equal(body.standings[0].timeMs, 18000);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (challengeId) await db.execute("DELETE FROM bootcamp_challenges WHERE id = ?", [challengeId]);
    if (routeId) {
      await db.execute("DELETE FROM bootcamp_runs WHERE route_id = ?", [routeId]);
      await db.execute("DELETE FROM bootcamp_routes WHERE id = ?", [routeId]);
    }
    await db.execute("DELETE FROM bootcamp_maps WHERE map = ?", [map]);
    await db.end();
  }
});
