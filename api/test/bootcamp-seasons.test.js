"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

function start(router) {
  const app = express();
  app.use(express.json());
  app.use("/api/bootcamp", router);
  const server = app.listen(0, "127.0.0.1");
  return new Promise(resolve => server.once("listening", () => resolve({
    server,
    base: `http://127.0.0.1:${server.address().port}/api/bootcamp`
  })));
}

test("season API is hidden by default and avoids database reads", async () => {
  let calls = 0;
  const { server, base } = await start(createBootcampRouter({
    seasonsEnabled: false,
    query: async () => { calls++; throw new Error("disabled season feature must not query"); }
  }));
  try {
    const response = await fetch(`${base}/seasons/current`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { season: null, standings: [] });
    const hiddenAdmin = await fetch(`${base}/admin/seasons`, { method: "POST" });
    assert.equal(hiddenAdmin.status, 404);
    assert.equal(calls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("active season standings award only tier improvements within the configured season", async () => {
  const seen = [];
  const { server, base } = await start(createBootcampRouter({
    seasonsEnabled: true,
    query: async (sql, args) => {
      seen.push({ sql, args });
      if (/FROM bootcamp_seasons/i.test(sql)) return [{ id: 7, slug: "winter-2026", title: "Winter 2026",
        starts_at: "2026-11-01 00:00:00", ends_at: "2027-02-01 00:00:00" }];
      return [{ steamid: "STEAM_0:1:5", player_name: "Runner", points: 8, objectives: 3 }];
    }
  }));
  try {
    const response = await fetch(`${base}/seasons/current`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      season: { id: 7, slug: "winter-2026", title: "Winter 2026", startsAt: "2026-11-01 00:00:00", endsAt: "2027-02-01 00:00:00" },
      standings: [{ rank: 1, steamId: "STEAM_0:1:5", playerName: "Runner", points: 8, objectives: 3 }]
    });
    assert.deepEqual(seen[1].args, ["2026-11-01 00:00:00", "2027-02-01 00:00:00"]);
    assert.match(seen[1].sql, /LAG\s*\(/i);
    assert.match(seen[1].sql, /CONVERT_TZ\(created_at,\s*@@session\.time_zone,\s*['"]\+00:00['"]\)\s*>=\s*\?/i);
    assert.match(seen[1].sql, /CONVERT_TZ\(created_at,\s*@@session\.time_zone,\s*['"]\+00:00['"]\)\s*<\s*\?/i);
    assert.match(seen[1].sql, /tier\s*>\s*previous_tier/i);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("season scheduling validates UTC windows and rejects overlapping seasons", async () => {
  const seen = [];
  const { server, base } = await start(createBootcampRouter({
    seasonsEnabled: true, adminUser: "admin", adminPassword: "secret",
    query: async (sql, args) => {
      seen.push({ sql, args });
      if (/SELECT id FROM bootcamp_seasons/i.test(sql)) return seen.filter(item => /SELECT id FROM bootcamp_seasons/i.test(item.sql)).length > 1 ? [{ id: 9 }] : [];
      if (/INSERT INTO bootcamp_seasons/i.test(sql)) return { insertId: 9 };
      throw new Error("unexpected query");
    }
  }));
  try {
    const url = `${base}/admin/seasons`;
    const headers = { authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`, "content-type": "application/json" };
    const invalid = await fetch(url, { method: "POST", headers, body: JSON.stringify({ slug: "winter 2026", title: "Winter", startsAt: "bad", endsAt: "bad" }) });
    assert.equal(invalid.status, 400);
    assert.equal(seen.length, 0);
    const created = await fetch(url, { method: "POST", headers, body: JSON.stringify({ slug: "winter-2026", title: "Winter 2026",
      startsAt: "2026-11-01T00:00:00Z", endsAt: "2027-02-01T00:00:00Z" }) });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { season: { id: 9, slug: "winter-2026", title: "Winter 2026",
      startsAt: "2026-11-01 00:00:00", endsAt: "2027-02-01 00:00:00" } });
    assert.deepEqual(seen[0].args, ["2027-02-01 00:00:00", "2026-11-01 00:00:00"]);
    assert.deepEqual(seen[1].args, ["winter-2026", "Winter 2026", "2026-11-01 00:00:00", "2027-02-01 00:00:00", "admin"]);
    const overlap = await fetch(url, { method: "POST", headers, body: JSON.stringify({ slug: "winter-2027", title: "Winter 2027",
      startsAt: "2027-01-01T00:00:00Z", endsAt: "2027-03-01T00:00:00Z" }) });
    assert.equal(overlap.status, 409);
    assert.deepEqual(await overlap.json(), { error: "season_window_overlaps" });
    assert.equal(seen.length, 3);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
