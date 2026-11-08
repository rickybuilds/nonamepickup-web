"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mysql = require("mysql2/promise");
const { createBootcampRouter } = require("../src/routes/bootcamp");

test("authenticated Discord license refresh commits once and is retry-safe in MariaDB", {
  skip: process.env.BOOTCAMP_LOCAL_DB_TEST !== "1"
}, async () => {
  const pool = mysql.createPool({ host: "127.0.0.1", port: 34079, user: "root", database: "bootcamp_local_test", connectionLimit: 2 });
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const map = `api_${suffix}`;
  const steamId = `STEAM_0:1:${Date.now() % 1000000000}`;
  let drillId;
  let eventId;
  let server;
  try {
    await pool.execute("INSERT INTO bootcamp_maps (map, in_rotation, rotation_order) VALUES (?, 1, 1)", [map]);
    const [drill] = await pool.execute("INSERT INTO bootcamp_drills (map, slug, kind, name) VALUES (?, 'tour_quiz', 'tour', 'Tour')", [map]);
    drillId = drill.insertId;
    await pool.execute("INSERT INTO bootcamp_tiers (steamid, target_type, target_id, map, class_id, tier) VALUES (?, 'drill', ?, ?, 0, 1)", [steamId, drillId, map]);
    const [event] = await pool.execute("INSERT INTO bootcamp_events (kind, steamid, player_name, map) VALUES ('lesson', ?, 'Integration Test', ?)", [steamId, map]);
    eventId = event.insertId;

    const app = express();
    app.use(express.json());
    app.use("/api/bootcamp", createBootcampRouter({
      query: async (sql, params) => { const [rows] = await pool.execute(sql, params); return rows; },
      connectionFactory: () => pool.getConnection(),
      discordServiceToken: "integration-test-token"
    }));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/bootcamp/integrations/discord/licenses/recompute`;
    const request = () => fetch(url, { method: "POST", headers: {
      authorization: "Bearer integration-test-token", "content-type": "application/json"
    }, body: JSON.stringify({ steamId }) });

    const first = await request();
    assert.equal(first.status, 200);
    assert.equal((await first.json()).license.level, "permit");
    const second = await request();
    assert.equal(second.status, 200);
    assert.equal((await second.json()).changed, false);

    const [licenses] = await pool.execute("SELECT level FROM bootcamp_licenses WHERE steamid = ?", [steamId]);
    assert.deepEqual(licenses.map(row => row.level), ["permit"]);
    const [licenseEvents] = await pool.execute("SELECT id FROM bootcamp_events WHERE steamid = ? AND kind = 'license'", [steamId]);
    assert.equal(licenseEvents.length, 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.execute("DELETE FROM bootcamp_events WHERE steamid = ?", [steamId]).catch(() => {});
    if (eventId) await pool.execute("DELETE FROM bootcamp_events WHERE id = ?", [eventId]).catch(() => {});
    await pool.execute("DELETE FROM bootcamp_tiers WHERE steamid = ?", [steamId]).catch(() => {});
    await pool.execute("DELETE FROM bootcamp_licenses WHERE steamid = ?", [steamId]).catch(() => {});
    if (drillId) await pool.execute("DELETE FROM bootcamp_drills WHERE id = ?", [drillId]).catch(() => {});
    await pool.execute("DELETE FROM bootcamp_maps WHERE map = ?", [map]).catch(() => {});
    await pool.end();
  }
});
