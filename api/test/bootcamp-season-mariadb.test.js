"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { createBootcampRouter } = require("../src/routes/bootcamp");

test("scheduled season migration and Website leaderboard work against isolated MariaDB", { skip: process.env.BOOTCAMP_LOCAL_DB_TEST !== "1" }, async () => {
  const db = await mysql.createConnection({ host: "127.0.0.1", port: 34079, user: "root", database: "bootcamp_local_test" });
  const slug = `season-test-${Date.now()}`;
  const steamId = `STEAM_0:1:${Date.now()}`;
  const firstTarget = Date.now() % 1000000000 + 1;
  let seasonId, server;
  try {
    const migration = await fs.readFile(path.resolve(__dirname, "../../../TFC-Bootcamp/migrations/015_training_seasons.sql"), "utf8");
    await db.query(migration);
    const [windowRows] = await db.query(`
      SELECT DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 10 SECOND, '%Y-%m-%dT%H:%i:%sZ') AS starts_at,
             DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 1 DAY, '%Y-%m-%dT%H:%i:%sZ') AS ends_at
    `);
    const startsAt = windowRows[0].starts_at, endsAt = windowRows[0].ends_at;
    const app = express();
    app.use(express.json());
    app.use("/api/bootcamp", createBootcampRouter({
      seasonsEnabled: true, adminUser: "season-test", adminPassword: "local-test-only",
      query: async (sql, args) => {
        const [rows] = await db.execute(sql, args);
        return rows;
      }
    }));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/bootcamp`;
    const authorization = `Basic ${Buffer.from("season-test:local-test-only").toString("base64")}`;
    const create = await fetch(`${base}/admin/seasons`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ slug, title: "Disposable season test", startsAt, endsAt })
    });
    assert.equal(create.status, 201);
    seasonId = (await create.json()).season.id;

    const startsSql = startsAt.replace("T", " ").replace("Z", "");
    const beforeSql = new Date(Date.parse(startsAt) - 1000).toISOString().slice(0, 19).replace("T", " ");
    const duringSql = new Date(Date.parse(startsAt) + 1000).toISOString().slice(0, 19).replace("T", " ");
    await db.execute(`INSERT INTO bootcamp_events (kind, steamid, player_name, map, target_type, target_id, class_id, tier, created_at)
      VALUES ('tier_up', ?, 'Season Runner', 'season_test', 'route', ?, 5, 1, ?),
             ('tier_up', ?, 'Season Runner', 'season_test', 'route', ?, 5, 2, ?),
             ('tier_up', ?, 'Season Runner', 'season_test', 'drill', ?, 3, 4, ?)` ,
    [steamId, firstTarget, beforeSql, steamId, firstTarget, duringSql, steamId, firstTarget + 1, duringSql]);
    const result = await (await fetch(`${base}/seasons/current`)).json();
    assert.equal(result.season.id, seasonId);
    assert.deepEqual(result.standings.find(row => row.steamId === steamId), {
      rank: result.standings.find(row => row.steamId === steamId).rank,
      steamId, playerName: "Season Runner", points: 6, objectives: 2
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.execute("DELETE FROM bootcamp_events WHERE steamid = ?", [steamId]);
    if (seasonId) await db.execute("DELETE FROM bootcamp_seasons WHERE id = ?", [seasonId]);
    await db.end();
  }
});
