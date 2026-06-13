"use strict";

const https = require("https");

const STEAM_ID64_BASE = 76561197960265728n;
const PROFILE_TTL_SECONDS = 24 * 60 * 60;

function steam2ToSteamId64(steamId) {
  const match = /^STEAM_[0-5]:([01]):(\d+)$/.exec(String(steamId || "").trim());
  if (!match) return null;

  const accountId = (BigInt(match[2]) * 2n) + BigInt(match[1]);
  return String(STEAM_ID64_BASE + accountId);
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "NN-TFC-Steam-Profile-Refresh/1.0"
      },
      timeout: 15_000
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", data => {
        body += data;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`Steam API HTTP ${response.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Steam API returned invalid JSON: ${error.message}`));
        }
      });
    });

    request.on("timeout", () => request.destroy(new Error("Steam API request timed out")));
    request.on("error", reject);
  });
}

async function fetchSteamProfiles(steamId64s, apiKey, requestJson = fetchJson) {
  if (!apiKey) throw new Error("STEAM_API_KEY is required");
  if (!steamId64s.length) return [];

  const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamids", steamId64s.join(","));

  const payload = await requestJson(url);
  return Array.isArray(payload?.response?.players) ? payload.response.players : [];
}

async function refreshSteamProfiles({
  db,
  apiKey,
  force = false,
  now = Math.floor(Date.now() / 1000),
  requestJson = fetchJson,
  logger = console
}) {
  if (!db) throw new Error("A database connection is required");
  if (!apiKey) throw new Error("STEAM_API_KEY is required");

  const cutoff = now - PROFILE_TTL_SECONDS;
  const links = db.prepare(`
    SELECT psi.discord_id, psi.steam_id, sp.fetched_at
    FROM player_steam_ids psi
    LEFT JOIN steam_profiles sp ON sp.steam_id = psi.steam_id
    WHERE psi.is_primary = 1
    ORDER BY psi.discord_id, psi.steam_id
  `).all();

  const candidates = links
    .map(link => ({
      ...link,
      steam_id64: steam2ToSteamId64(link.steam_id)
    }))
    .filter(link => {
      if (!link.steam_id64) {
        logger.warn?.(`[steam] Skipping invalid Steam2 ID: ${link.steam_id}`);
        return false;
      }
      return force || !link.fetched_at || Number(link.fetched_at) < cutoff;
    });

  const bySteamId64 = new Map(candidates.map(link => [link.steam_id64, link]));
  const batches = chunk([...bySteamId64.keys()], 100);
  const upsert = db.prepare(`
    INSERT INTO steam_profiles (
      steam_id, steam_id64, personaname, profileurl,
      avatar, avatarmedium, avatarfull, fetched_at
    ) VALUES (
      @steam_id, @steam_id64, @personaname, @profileurl,
      @avatar, @avatarmedium, @avatarfull, @fetched_at
    )
    ON CONFLICT(steam_id) DO UPDATE SET
      steam_id64 = excluded.steam_id64,
      personaname = excluded.personaname,
      profileurl = excluded.profileurl,
      avatar = excluded.avatar,
      avatarmedium = excluded.avatarmedium,
      avatarfull = excluded.avatarfull,
      fetched_at = excluded.fetched_at
  `);
  const upsertMany = db.transaction(rows => {
    for (const row of rows) upsert.run(row);
  });

  let refreshed = 0;
  for (const batch of batches) {
    const profiles = await fetchSteamProfiles(batch, apiKey, requestJson);
    const profilesById = new Map(
      profiles.map(profile => [String(profile.steamid || ""), profile])
    );
    const rows = batch.map(steamId64 => {
      const link = bySteamId64.get(steamId64);
      const profile = profilesById.get(steamId64) || {};
      return {
        steam_id: link.steam_id,
        steam_id64: link.steam_id64,
        personaname: profile.personaname || null,
        profileurl: profile.profileurl || null,
        avatar: profile.avatar || null,
        avatarmedium: profile.avatarmedium || null,
        avatarfull: profile.avatarfull || null,
        fetched_at: now
      };
    });
    upsertMany(rows);
    refreshed += rows.length;
  }

  return {
    linked: links.length,
    eligible: candidates.length,
    batches: batches.length,
    refreshed,
    skippedFresh: links.length - candidates.length
  };
}

module.exports = {
  PROFILE_TTL_SECONDS,
  steam2ToSteamId64,
  fetchSteamProfiles,
  refreshSteamProfiles
};
