"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

function setup(query, token = "service-secret", connectionFactory) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use("/api/bootcamp", createBootcampRouter({
    query: async (sql, args) => { calls.push({ sql, args }); return query(sql, args); },
    discordServiceToken: token,
    connectionFactory
  }));
  const server = app.listen(0, "127.0.0.1");
  return new Promise(resolve => server.once("listening", () => resolve({
    base: `http://127.0.0.1:${server.address().port}/api/bootcamp`,
    calls,
    close: () => new Promise(done => server.close(done)),
    auth: "Bearer service-secret"
  })));
}

test("Discord event feed is authenticated, bounded, and returns Bootcamp event context", async () => {
  const app = await setup(async () => [{
    id: 7, kind: "record", steamid: "STEAM_0:1:4", player_name: "Ricky", target_type: "route",
    target_id: 3, target_name: "Ramp", map: "2fort", class_id: 5, tier: 3, value_ms: 12000,
    replay_run_id: 41, created_at: "2026-11-08 12:00:00"
  }]);
  try {
    assert.equal((await fetch(`${app.base}/integrations/discord/events?after_id=6`)).status, 401);
    const response = await fetch(`${app.base}/integrations/discord/events?after_id=6&limit=10`, { headers: { authorization: app.auth } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { events: [{
      id: 7, kind: "record", steamId: "STEAM_0:1:4", playerName: "Ricky", targetType: "route",
      targetId: 3, targetName: "Ramp", map: "2fort", classId: 5, tier: 3, valueMs: 12000,
      replayRunId: 41, createdAt: "2026-11-08 12:00:00"
    }] });
    assert.deepEqual(app.calls[0].args, [6, 10]);
    for (const value of ["bootcamp_events", "bootcamp_routes", "bootcamp_drills", "bootcamp_runs"])
      assert.match(app.calls[0].sql, new RegExp(value));
    assert.equal((await fetch(`${app.base}/integrations/discord/events?after_id=-1`, { headers: { authorization: app.auth } })).status, 400);
    assert.equal((await fetch(`${app.base}/integrations/discord/events?after_id=6&limit=201`, { headers: { authorization: app.auth } })).status, 400);
  } finally { await app.close(); }
});

test("Discord event feed fails closed without a configured service token", async () => {
  const app = await setup(async () => [], "");
  try {
    const response = await fetch(`${app.base}/integrations/discord/events?after_id=0`, { headers: { authorization: app.auth } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "bootcamp_service_not_configured" });
    assert.equal(app.calls.length, 0);
  } finally { await app.close(); }
});

test("Discord license recompute validates service identity and commits through the API database connection", async () => {
  const statements = [];
  const connection = {
    async beginTransaction() { statements.push("BEGIN"); },
    async commit() { statements.push("COMMIT"); },
    async rollback() { statements.push("ROLLBACK"); },
    release() { statements.push("RELEASE"); },
    async execute(sql) {
      statements.push(sql);
      if (/SELECT level, endorsements, granted_at/i.test(sql)) return [[{ level: "none", endorsements: "", granted_at: null }], []];
      if (/SELECT id, map, slug, kind, class_id FROM bootcamp_drills/i.test(sql)) return [[{ id: 9, map: "2fort", slug: "tour_quiz", kind: "tour", class_id: 0 }], []];
      if (/SELECT id, map, slug, type, class_id FROM bootcamp_routes/i.test(sql)) return [[], []];
      if (/SELECT map, rotation_order FROM bootcamp_maps/i.test(sql)) return [[{ map: "2fort", rotation_order: 1 }], []];
      if (/SELECT target_type, target_id, class_id, tier FROM bootcamp_tiers/i.test(sql)) return [[{ target_type: "drill", target_id: 9, class_id: 5, tier: 1 }], []];
      if (/SELECT player_name FROM bootcamp_events/i.test(sql)) return [[{ player_name: "Runner" }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const app = await setup(async () => [], "service-secret", async () => connection);
  try {
    const bad = await fetch(`${app.base}/integrations/discord/licenses/recompute`, {
      method: "POST", headers: { authorization: app.auth, "content-type": "application/json" },
      body: JSON.stringify({ steamId: "not-a-steam-id" })
    });
    assert.equal(bad.status, 400);
    const response = await fetch(`${app.base}/integrations/discord/licenses/recompute`, {
      method: "POST", headers: { authorization: app.auth, "content-type": "application/json" },
      body: JSON.stringify({ steamId: "STEAM_0:1:4" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.license.level, "permit");
    assert.equal(body.changed, true);
    assert.ok(statements.some(sql => /INSERT INTO bootcamp_events/i.test(sql)));
    assert.equal(statements.at(-2), "COMMIT");
    assert.equal(statements.at(-1), "RELEASE");
  } finally { await app.close(); }
});
