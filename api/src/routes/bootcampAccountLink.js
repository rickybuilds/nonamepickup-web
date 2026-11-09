"use strict";

const express = require("express");
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");

const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const DISCORD_ME = "https://discord.com/api/users/@me";
const STATE_COOKIE = "bc_account_link_state";
const FLOW_TTL_SECONDS = 600;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function parseCookie(header, name) {
  for (const item of String(header || "").split(";")) {
    const split = item.trim().indexOf("=");
    if (split < 0) continue;
    if (item.trim().slice(0, split) !== name) continue;
    try { return decodeURIComponent(item.trim().slice(split + 1)); } catch { return ""; }
  }
  return "";
}

function secureCallback(value, allowLoopbackHttp) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (allowLoopbackHttp && url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch { return false; }
}

function steam64ToSteam2(value) {
  const text = String(value || "");
  if (!/^7656119\d{10}$/.test(text)) return null;
  const accountId = BigInt(text) - 76561197960265728n;
  if (accountId < 0n || accountId > 4294967295n) return null;
  return `STEAM_0:${accountId % 2n}:${accountId / 2n}`;
}

function discordIdValid(value) {
  return /^\d{17,20}$/.test(String(value || ""));
}

function createBootcampAccountLinkRouter({
  db = null,
  enabled = false,
  steamReturnUrl = "",
  discordClientId = "",
  discordClientSecret = "",
  discordRedirectUrl = "",
  hubUrl = "",
  fetchImpl = globalThis.fetch,
  now = () => Math.floor(Date.now() / 1000)
} = {}) {
  const router = express.Router();
  const allowLoopbackHttp = process.env.NODE_ENV === "test";
  let steamCallback;
  let hub;
  let configured = false;
  try {
    steamCallback = new URL(steamReturnUrl);
    hub = new URL(hubUrl);
    const discordCallback = new URL(discordRedirectUrl);
    configured = Boolean(enabled && db && fetchImpl && discordClientId && discordClientSecret &&
      secureCallback(steamReturnUrl, allowLoopbackHttp) &&
      secureCallback(discordRedirectUrl, allowLoopbackHttp) &&
      secureCallback(hubUrl, allowLoopbackHttp) &&
      steamCallback.search === "" && steamCallback.hash === "" &&
      discordCallback.search === "" && discordCallback.hash === "" && hub.search === "" && hub.hash === "");
  } catch { configured = false; }

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: (() => { try { return new URL(steamReturnUrl).protocol === "https:"; } catch { return true; } })(),
    path: "/api/bootcamp/account-link",
    maxAge: FLOW_TTL_SECONDS * 1000
  };
  const clearCookie = res => res.clearCookie(STATE_COOKIE, { ...cookieOptions, maxAge: undefined });
  const redirectResult = (res, result) => {
    const target = new URL(hubUrl || "https://invalid.local/");
    target.searchParams.set("account_link", result);
    return res.redirect(303, target.toString());
  };
  const getFlow = (state, step) => {
    if (!state || !/^[A-Za-z0-9_-]{40,60}$/.test(state)) return null;
    return db.prepare(`SELECT state_hash, step, steam_id, expires_at FROM bootcamp_account_link_flows
      WHERE state_hash = ? AND step = ? AND expires_at > ?`).get(sha256(state), step, now()) || null;
  };
  const stateMatches = (req, state) => {
    const cookieState = parseCookie(req.headers.cookie, STATE_COOKIE);
    const left = Buffer.from(String(state || ""));
    const right = Buffer.from(cookieState);
    return left.length >= 40 && left.length === right.length && timingSafeEqual(left, right);
  };
  const setState = (res, state) => res.cookie(STATE_COOKIE, state, cookieOptions);
  const newState = () => randomBytes(32).toString("base64url");
  const consumeFlow = state => db.prepare("DELETE FROM bootcamp_account_link_flows WHERE state_hash = ?").run(sha256(state));

  router.get("/status", (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json({ enabled: configured });
  });

  router.get("/start", (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!configured) return res.status(503).json({ error: "bootcamp_account_link_unavailable" });
    try {
      db.prepare("DELETE FROM bootcamp_account_link_flows WHERE expires_at <= ?").run(now());
      const state = newState();
      const expiresAt = now() + FLOW_TTL_SECONDS;
      db.prepare(`INSERT INTO bootcamp_account_link_flows(state_hash, step, steam_id, expires_at, created_at)
        VALUES (?, 'steam', NULL, ?, ?)`).run(sha256(state), expiresAt, now());
      setState(res, state);
      const returnTo = new URL(steamReturnUrl);
      returnTo.searchParams.set("state", state);
      const realm = `${new URL(steamReturnUrl).origin}/`;
      const target = new URL(STEAM_OPENID);
      for (const [key, value] of Object.entries({
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": returnTo.toString(),
        "openid.realm": realm,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
      })) target.searchParams.set(key, value);
      return res.redirect(302, target.toString());
    } catch {
      return res.status(503).json({ error: "bootcamp_account_link_unavailable" });
    }
  });

  router.get("/steam/callback", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!configured) return res.status(503).json({ error: "bootcamp_account_link_unavailable" });
    const state = String(req.query.state || "");
    const flow = stateMatches(req, state) ? getFlow(state, "steam") : null;
    const claimed = String(req.query["openid.claimed_id"] || "");
    const identity = String(req.query["openid.identity"] || "");
    const providerEndpoint = String(req.query["openid.op_endpoint"] || "");
    const claimedMatch = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/.exec(claimed);
    const signed = String(req.query["openid.signed"] || "").split(",");
    const returnTo = new URL(steamReturnUrl);
    returnTo.searchParams.set("state", state);
    if (!flow || req.query["openid.mode"] !== "id_res" || providerEndpoint !== STEAM_OPENID || !claimedMatch || identity !== claimed ||
        !signed.includes("op_endpoint") || !signed.includes("claimed_id") || !signed.includes("identity") || !signed.includes("return_to") ||
        !signed.includes("response_nonce") || req.query["openid.return_to"] !== returnTo.toString()) {
      if (stateMatches(req, state)) consumeFlow(state);
      clearCookie(res);
      return redirectResult(res, "steam-failed");
    }
    try {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query)) {
        if (key.startsWith("openid.") && typeof value === "string") body.set(key, value);
      }
      body.set("openid.mode", "check_authentication");
      const response = await fetchImpl(STEAM_OPENID, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/x-www-form-urlencoded" }, body
      });
      const assertion = await response.text();
      if (!response.ok || !/(?:^|\n)is_valid:true(?:\r?\n|$)/.test(assertion)) throw new Error("steam_assertion_rejected");
      const steamId = steam64ToSteam2(claimedMatch[1]);
      if (!steamId) throw new Error("steam_id_invalid");

      const discordState = newState();
      const updated = db.prepare(`UPDATE bootcamp_account_link_flows SET state_hash = ?, step = 'discord', steam_id = ?, expires_at = ?
        WHERE state_hash = ? AND step = 'steam' AND expires_at > ?`).run(
        sha256(discordState), steamId, now() + FLOW_TTL_SECONDS, flow.state_hash, now());
      if (updated.changes !== 1) throw new Error("account_link_flow_expired");
      setState(res, discordState);
      const target = new URL(DISCORD_AUTHORIZE);
      target.search = new URLSearchParams({
        client_id: String(discordClientId), response_type: "code", scope: "identify",
        redirect_uri: discordRedirectUrl, state: discordState
      }).toString();
      return res.redirect(302, target.toString());
    } catch {
      consumeFlow(state);
      clearCookie(res);
      return redirectResult(res, "steam-failed");
    }
  });

  router.get("/discord/callback", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!configured) return res.status(503).json({ error: "bootcamp_account_link_unavailable" });
    const state = String(req.query.state || "");
    const flow = stateMatches(req, state) ? getFlow(state, "discord") : null;
    if (!flow || !/^[A-Za-z0-9._-]{16,256}$/.test(String(req.query.code || ""))) {
      if (stateMatches(req, state)) consumeFlow(state);
      clearCookie(res);
      return redirectResult(res, "discord-failed");
    }
    try {
      const tokenBody = new URLSearchParams({
        client_id: String(discordClientId), client_secret: String(discordClientSecret),
        grant_type: "authorization_code", code: String(req.query.code), redirect_uri: String(discordRedirectUrl)
      });
      const tokenResponse = await fetchImpl(DISCORD_TOKEN, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/x-www-form-urlencoded" }, body: tokenBody
      });
      if (!tokenResponse.ok) throw new Error("discord_token_rejected");
      const token = await tokenResponse.json();
      if (token.token_type !== "Bearer" || typeof token.access_token !== "string" || token.access_token.length < 8 || token.access_token.length > 4096)
        throw new Error("discord_token_invalid");
      const userResponse = await fetchImpl(DISCORD_ME, {
        redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${token.access_token}` }
      });
      if (!userResponse.ok) throw new Error("discord_identity_rejected");
      const user = await userResponse.json();
      if (!discordIdValid(user.id)) throw new Error("discord_identity_invalid");

      const linkTransaction = db.transaction(() => {
        const existing = db.prepare("SELECT discord_id FROM player_steam_ids WHERE steam_id = ?").all(flow.steam_id);
        if (existing.some(row => String(row.discord_id) !== String(user.id))) {
          db.prepare("DELETE FROM bootcamp_account_link_flows WHERE state_hash = ?").run(flow.state_hash);
          return "steam_conflict";
        }
        db.prepare(`INSERT INTO player_steam_ids(discord_id, steam_id, display_name, is_primary, notes, updated_at)
          VALUES (?, ?, NULL, 0, 'self-service Bootcamp account link', ?)
          ON CONFLICT(discord_id, steam_id) DO UPDATE SET notes=excluded.notes, updated_at=excluded.updated_at`)
          .run(String(user.id), flow.steam_id, now());
        const hasIdentityTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_identities'").get();
        if (hasIdentityTable) db.prepare("UPDATE player_identities SET discord_id = ?, updated_at = ? WHERE steam_id = ?")
          .run(String(user.id), now(), flow.steam_id);
        db.prepare(`INSERT INTO bootcamp_account_link_outbox(discord_id, steam_id, status, attempts, next_attempt_at, created_at, updated_at)
          VALUES (?, ?, 'pending', 0, ?, ?, ?)
          ON CONFLICT(discord_id, steam_id) DO UPDATE SET status='pending', next_attempt_at=excluded.next_attempt_at,
            last_error=NULL, updated_at=excluded.updated_at`)
          .run(String(user.id), flow.steam_id, now(), now(), now());
        db.prepare("DELETE FROM bootcamp_account_link_flows WHERE state_hash = ?").run(flow.state_hash);
        return "linked";
      });
      const linked = typeof linkTransaction.immediate === "function" ? linkTransaction.immediate() : linkTransaction();
      clearCookie(res);
      return redirectResult(res, linked);
    } catch {
      consumeFlow(state);
      clearCookie(res);
      return redirectResult(res, "discord-failed");
    }
  });

  return router;
}

module.exports = { createBootcampAccountLinkRouter, steam64ToSteam2 };
