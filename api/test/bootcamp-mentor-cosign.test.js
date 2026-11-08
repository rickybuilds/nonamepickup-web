"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBootcampRouter } = require("../src/routes/bootcamp");

async function setup(query, credentials = {}, findDiscordIdBySteam = null) {
  const app = express();
  app.use(express.json());
  app.use("/api/bootcamp", createBootcampRouter({
    query, findDiscordIdBySteam, adminUser: "reviewer", adminPassword: "secret", discordServiceToken: "service-secret", ...credentials
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}/api/bootcamp`,
    close: () => new Promise(resolve => server.close(resolve)),
    headers: { authorization: "Bearer service-secret", "content-type": "application/json" }
  };
}

test("mentor co-sign uses the authenticated service boundary and records an idempotent attestation", async () => {
  const calls = [];
  const app = await setup(async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT cosigned_by/i.test(sql)) return [{ cosigned_by: "12345678901234567" }];
    return [{ affectedRows: 1 }];
  });
  try {
    const body = { steamId: "STEAM_0:1:55", mentorDiscordId: "12345678901234567" };
    assert.equal((await fetch(`${app.base}/integrations/discord/licenses/cosign`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    })).status, 401);
    const response = await fetch(`${app.base}/integrations/discord/licenses/cosign`, {
      method: "POST", headers: app.headers, body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cosigned: true, ...body });
    assert.match(calls[0].sql, /INSERT INTO bootcamp_licenses/i);
    assert.match(calls[0].sql, /cosigned_by/i);
    assert.deepEqual(calls[0].params, [body.steamId, body.mentorDiscordId]);
    assert.deepEqual(calls[1].params, [body.steamId]);
  } finally { await app.close(); }
});

test("mentor co-sign rejects malformed identities and does not overwrite another mentor", async () => {
  const app = await setup(async sql => {
    if (/SELECT cosigned_by/i.test(sql)) return [{ cosigned_by: "76543210987654321" }];
    return [{ affectedRows: 1 }];
  });
  try {
    const invalid = await fetch(`${app.base}/integrations/discord/licenses/cosign`, {
      method: "POST", headers: app.headers, body: JSON.stringify({ steamId: "bad", mentorDiscordId: "x" })
    });
    assert.equal(invalid.status, 400);
    const conflict = await fetch(`${app.base}/integrations/discord/licenses/cosign`, {
      method: "POST", headers: app.headers,
      body: JSON.stringify({ steamId: "STEAM_0:1:55", mentorDiscordId: "12345678901234567" })
    });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: "license_already_cosigned" });
  } finally { await app.close(); }
});

test("player license profile includes the co-signing mentor identity", async () => {
  const app = await setup(async sql => {
    if (/SELECT level, endorsements, granted_at, cosigned_by/i.test(sql))
      return [{ level: "licensed", endorsements: "offense", granted_at: null, cosigned_by: "12345678901234567" }];
    if (/FROM bootcamp_runs/i.test(sql) || /FROM bootcamp_drill_sets/i.test(sql)) return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  try {
    const response = await fetch(`${app.base}/players/STEAM_0:1:55`);
    assert.equal(response.status, 200);
    const profile = await response.json();
    assert.equal(profile.license.cosignedBy, "12345678901234567");
  } finally { await app.close(); }
});

test("player profile resolves its Discord identity from the existing NoName Steam link table", async () => {
  const linkedPlayers = new Map([["STEAM_0:1:55", "12345678901234567"]]);
  const findDiscordIdBySteam = steamId => linkedPlayers.get(steamId) || null;
  const app = await setup(async sql => {
    if (/SELECT level, endorsements, granted_at, cosigned_by/i.test(sql)) return [];
    if (/FROM bootcamp_runs/i.test(sql) || /FROM bootcamp_drill_sets/i.test(sql)) return [];
    throw new Error(`Unexpected query: ${sql}`);
  }, {}, findDiscordIdBySteam);
  try {
    const response = await fetch(`${app.base}/players/STEAM_0:1:55`);
    assert.equal(response.status, 200);
    const profile = await response.json();
    assert.equal(profile.player.discordId, "12345678901234567");
  } finally {
    await app.close();
  }
});

test("player profile remains available when the shared identity lookup fails", async () => {
  const routeErrors = [];
  const app = await setup(async sql => {
    if (/SELECT level, endorsements, granted_at, cosigned_by/i.test(sql)) return [];
    if (/FROM bootcamp_runs/i.test(sql) || /FROM bootcamp_drill_sets/i.test(sql)) return [];
    throw new Error(`Unexpected query: ${sql}`);
  }, { logRouteError: (...args) => routeErrors.push(args) }, () => { throw new Error("identity store offline"); });
  try {
    const response = await fetch(`${app.base}/players/STEAM_0:1:55`);
    assert.equal(response.status, 200);
    const profile = await response.json();
    assert.equal(profile.player.discordId, null);
    assert.equal(routeErrors.length, 1);
  } finally {
    await app.close();
  }
});
