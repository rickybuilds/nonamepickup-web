"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const { createBootcampAccountLinkRouter, steam64ToSteam2 } = require("../src/routes/bootcampAccountLink");

function setup({ discordRows = [], enabled = true, fetchImpl, now } = {}) {
  const db = new DatabaseSync(":memory:");
  db.transaction = callback => (...args) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback(...args);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  db.exec(`
    CREATE TABLE bootcamp_account_link_flows (
      state_hash TEXT PRIMARY KEY, step TEXT NOT NULL, steam_id TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE bootcamp_account_link_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT NOT NULL, steam_id TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
      last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(discord_id, steam_id)
    );
    CREATE TABLE player_steam_ids (
      discord_id TEXT NOT NULL, steam_id TEXT NOT NULL, display_name TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0, notes TEXT, updated_at INTEGER,
      UNIQUE(discord_id, steam_id)
    );
    CREATE TABLE player_identities (steam_id TEXT PRIMARY KEY, discord_id TEXT, updated_at INTEGER);
  `);
  db.prepare("INSERT INTO player_identities(steam_id, discord_id, updated_at) VALUES ('STEAM_0:1:0', NULL, 0)").run();
  for (const [discordId, steamId] of discordRows)
    db.prepare("INSERT INTO player_steam_ids(discord_id, steam_id) VALUES (?, ?)").run(discordId, steamId);
  const app = express();
  app.use("/api/bootcamp/account-link", createBootcampAccountLinkRouter({
    db, enabled,
    steamReturnUrl: "https://example.test/api/bootcamp/account-link/steam/callback",
    discordClientId: "discord-client-id", discordClientSecret: "discord-client-secret",
    discordRedirectUrl: "https://example.test/api/bootcamp/account-link/discord/callback",
    hubUrl: "https://example.test/bootcamp.html", fetchImpl, now
  }));
  const server = app.listen(0, "127.0.0.1");
  return new Promise(resolve => server.once("listening", () => resolve({
    db, base: `http://127.0.0.1:${server.address().port}/api/bootcamp/account-link`,
    close: async () => { await new Promise(done => server.close(done)); db.close(); }
  })));
}

function cookie(response) {
  return String(response.headers.get("set-cookie") || "").split(";", 1)[0];
}

test("Steam64 conversion returns the shared canonical Steam2 identity", () => {
  assert.equal(steam64ToSteam2("76561197960265729"), "STEAM_0:1:0");
  assert.equal(steam64ToSteam2("76561197960265728"), "STEAM_0:0:0");
  assert.equal(steam64ToSteam2("76561202255233023"), null);
  assert.equal(steam64ToSteam2("STEAM_0:1:123"), null);
});

test("account-link routes remain hidden and unavailable when the feature flag is false", async () => {
  let providerCalls = 0;
  const app = await setup({ enabled: false, fetchImpl: async () => { providerCalls++; throw new Error("must not call provider"); } });
  try {
    const status = await fetch(`${app.base}/status`);
    assert.deepEqual({ ...await status.json() }, { enabled: false });
    const start = await fetch(`${app.base}/start`);
    assert.equal(start.status, 503);
    assert.equal(providerCalls, 0);
  } finally { await app.close(); }
});

test("account linking verifies both providers, atomically writes the shared link, and queues Bot sync", async () => {
  const calls = [];
  const app = await setup({ fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("steamcommunity.com")) return { ok: true, status: 200, text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n" };
    if (String(url) === "https://discord.com/api/oauth2/token") return { ok: true, status: 200, json: async () => ({ access_token: "temporary-test-access-token", token_type: "Bearer" }) };
    if (String(url) === "https://discord.com/api/users/@me") return { ok: true, status: 200, json: async () => ({ id: "123456789012345678" }) };
    throw new Error(`unexpected provider URL ${url}`);
  } });
  try {
    const start = await fetch(`${app.base}/start`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const steamCookie = cookie(start);
    const authorize = new URL(start.headers.get("location"));
    assert.equal(authorize.origin + authorize.pathname, "https://steamcommunity.com/openid/login");
    const steamReturn = new URL(authorize.searchParams.get("openid.return_to"));
    const steamState = steamReturn.searchParams.get("state");
    const steamParams = new URLSearchParams({
      state: steamState,
      "openid.mode": "id_res",
      "openid.op_endpoint": "https://steamcommunity.com/openid/login",
      "openid.claimed_id": "https://steamcommunity.com/openid/id/76561197960265729",
      "openid.identity": "https://steamcommunity.com/openid/id/76561197960265729",
      "openid.return_to": steamReturn.toString(),
      "openid.response_nonce": "2026-11-09T12:00:00Ztest",
      "openid.assoc_handle": "test-association",
      "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
      "openid.sig": "test-signature"
    });
    const steam = await fetch(`${app.base}/steam/callback?${steamParams}`, {
      headers: { cookie: steamCookie }, redirect: "manual"
    });
    assert.equal(steam.status, 302);
    const discordCookie = cookie(steam);
    const discordAuthorize = new URL(steam.headers.get("location"));
    assert.equal(discordAuthorize.origin + discordAuthorize.pathname, "https://discord.com/oauth2/authorize");
    assert.equal(discordAuthorize.searchParams.get("scope"), "identify");
    assert.equal(discordAuthorize.searchParams.get("redirect_uri"), "https://example.test/api/bootcamp/account-link/discord/callback");
    const discordState = discordAuthorize.searchParams.get("state");
    const done = await fetch(`${app.base}/discord/callback?${new URLSearchParams({ state: discordState, code: "valid-authorization-code" })}`, {
      headers: { cookie: discordCookie }, redirect: "manual"
    });
    assert.equal(done.status, 303);
    assert.equal(new URL(done.headers.get("location")).searchParams.get("account_link"), "linked");
    assert.equal(app.db.prepare("SELECT discord_id FROM player_steam_ids WHERE steam_id = ?").get("STEAM_0:1:0").discord_id, "123456789012345678");
    assert.equal(app.db.prepare("SELECT discord_id FROM player_identities WHERE steam_id = ?").get("STEAM_0:1:0").discord_id, "123456789012345678");
    assert.deepEqual({ ...app.db.prepare("SELECT discord_id, steam_id, status FROM bootcamp_account_link_outbox").get() }, {
      discord_id: "123456789012345678", steam_id: "STEAM_0:1:0", status: "pending"
    });
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM bootcamp_account_link_flows").get().count, 0);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.redirect, "error");
    assert.match(calls[1].options.headers["content-type"], /application\/x-www-form-urlencoded/);
    assert.equal(calls[1].options.body.get("code"), "valid-authorization-code");
    assert.equal(calls[1].options.redirect, "error");
    assert.equal(calls[2].options.headers.authorization, "Bearer temporary-test-access-token");
    assert.equal(calls[2].options.redirect, "error");
  } finally { await app.close(); }
});

test("account linking rejects an existing Steam identity with any other Discord owner", async () => {
  const app = await setup({ discordRows: [["123456789012345678", "STEAM_0:1:0"], ["999999999999999999", "STEAM_0:1:0"]], fetchImpl: async url => {
    if (String(url).includes("steamcommunity.com")) return { ok: true, text: async () => "is_valid:true\n" };
    if (String(url) === "https://discord.com/api/oauth2/token") return { ok: true, json: async () => ({ access_token: "temporary-test-access-token", token_type: "Bearer" }) };
    if (String(url) === "https://discord.com/api/users/@me") return { ok: true, json: async () => ({ id: "123456789012345678" }) };
    throw new Error("unexpected provider URL");
  } });
  try {
    const start = await fetch(`${app.base}/start`, { redirect: "manual" });
    const steamCookie = cookie(start);
    const openid = new URL(start.headers.get("location"));
    const returnTo = new URL(openid.searchParams.get("openid.return_to"));
    const state = returnTo.searchParams.get("state");
    const params = new URLSearchParams({
      state, "openid.mode": "id_res", "openid.claimed_id": "https://steamcommunity.com/openid/id/76561197960265729",
      "openid.op_endpoint": "https://steamcommunity.com/openid/login",
      "openid.identity": "https://steamcommunity.com/openid/id/76561197960265729", "openid.return_to": returnTo.toString(),
      "openid.response_nonce": "nonce", "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce", "openid.sig": "sig"
    });
    const steam = await fetch(`${app.base}/steam/callback?${params}`, { headers: { cookie: steamCookie }, redirect: "manual" });
    const discordAuthorize = new URL(steam.headers.get("location"));
    const discord = await fetch(`${app.base}/discord/callback?${new URLSearchParams({ state: discordAuthorize.searchParams.get("state"), code: "valid-authorization-code" })}`, {
      headers: { cookie: cookie(steam) }, redirect: "manual"
    });
    assert.equal(new URL(discord.headers.get("location")).searchParams.get("account_link"), "steam_conflict");
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM player_steam_ids WHERE steam_id = ?").get("STEAM_0:1:0").count, 2);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM bootcamp_account_link_outbox").get().count, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM bootcamp_account_link_flows").get().count, 0);
  } finally { await app.close(); }
});

test("account-link state mismatch is rejected before contacting Steam", async () => {
  let providerCalls = 0;
  const app = await setup({ fetchImpl: async () => { providerCalls++; throw new Error("must not call provider"); } });
  try {
    const response = await fetch(`${app.base}/steam/callback?state=${"a".repeat(43)}&openid.mode=id_res`, {
      headers: { cookie: "bc_account_link_state=not-the-query-state" }, redirect: "manual"
    });
    assert.equal(response.status, 303);
    assert.equal(providerCalls, 0);
  } finally { await app.close(); }
});

test("expired Steam state is discarded before provider verification", async () => {
  let timestamp = 1000, providerCalls = 0;
  const app = await setup({ now: () => timestamp, fetchImpl: async () => { providerCalls++; throw new Error("must not verify expired state"); } });
  try {
    const start = await fetch(`${app.base}/start`, { redirect: "manual" });
    const steamCookie = cookie(start);
    const openid = new URL(start.headers.get("location"));
    const returnTo = new URL(openid.searchParams.get("openid.return_to"));
    const state = returnTo.searchParams.get("state");
    const params = new URLSearchParams({
      state, "openid.mode": "id_res", "openid.claimed_id": "https://steamcommunity.com/openid/id/76561197960265729",
      "openid.op_endpoint": "https://steamcommunity.com/openid/login",
      "openid.identity": "https://steamcommunity.com/openid/id/76561197960265729", "openid.return_to": returnTo.toString(),
      "openid.response_nonce": "nonce", "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce", "openid.sig": "sig"
    });
    timestamp += 601;
    const response = await fetch(`${app.base}/steam/callback?${params}`, { headers: { cookie: steamCookie }, redirect: "manual" });
    assert.equal(new URL(response.headers.get("location")).searchParams.get("account_link"), "steam-failed");
    assert.equal(providerCalls, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM bootcamp_account_link_flows").get().count, 0);
  } finally { await app.close(); }
});

test("Steam rejection consumes the flow without writing an identity", async () => {
  let providerCalls = 0;
  const app = await setup({ fetchImpl: async () => { providerCalls++; return { ok: true, text: async () => "is_valid:false\n" }; } });
  try {
    const start = await fetch(`${app.base}/start`, { redirect: "manual" });
    const steamCookie = cookie(start);
    const openid = new URL(start.headers.get("location"));
    const returnTo = new URL(openid.searchParams.get("openid.return_to"));
    const state = returnTo.searchParams.get("state");
    const params = new URLSearchParams({
      state, "openid.mode": "id_res", "openid.claimed_id": "https://steamcommunity.com/openid/id/76561197960265729",
      "openid.op_endpoint": "https://steamcommunity.com/openid/login",
      "openid.identity": "https://steamcommunity.com/openid/id/76561197960265729", "openid.return_to": returnTo.toString(),
      "openid.response_nonce": "nonce", "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce", "openid.sig": "sig"
    });
    const response = await fetch(`${app.base}/steam/callback?${params}`, { headers: { cookie: steamCookie }, redirect: "manual" });
    assert.equal(new URL(response.headers.get("location")).searchParams.get("account_link"), "steam-failed");
    assert.equal(providerCalls, 1);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM player_steam_ids").get().count, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM bootcamp_account_link_flows").get().count, 0);
  } finally { await app.close(); }
});
