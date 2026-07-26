"use strict";

const express = require("express");

const PLAYER_IDENTITIES_SQL = `
  SELECT
    pi.steam_id,
    pi.discord_id,
    pi.current_name,
    pi.current_ip,
    pi.current_server,
    pi.first_seen,
    pi.last_seen,
    pi.connection_count,
    (
      SELECT COUNT(*)
      FROM steam_alias_history sah
      WHERE sah.steam_id = pi.steam_id
    ) AS alias_count,
    (
      SELECT COUNT(*)
      FROM steam_ip_history sip
      WHERE sip.steam_id = pi.steam_id
    ) AS ip_count
  FROM player_identities pi
  ORDER BY pi.last_seen DESC
`;

const PLAYER_IDENTITY_SQL = `
  SELECT
    steam_id,
    discord_id,
    current_name,
    current_ip,
    current_server,
    first_seen,
    last_seen,
    connection_count
  FROM player_identities
  WHERE steam_id = ?
`;

const PLAYER_ALIASES_SQL = `
  SELECT
    alias,
    times_seen,
    first_seen,
    last_seen
  FROM steam_alias_history
  WHERE steam_id = ?
  ORDER BY times_seen DESC
`;

const PLAYER_IPS_SQL = `
  SELECT
    sip.ip,
    sip.times_seen,
    sip.first_seen,
    sip.last_seen,
    (
      SELECT COUNT(DISTINCT shared.steam_id)
      FROM steam_ip_history shared
      WHERE shared.ip = sip.ip
    ) AS steam_id_count
  FROM steam_ip_history sip
  WHERE sip.steam_id = ?
  ORDER BY sip.times_seen DESC
`;

const SHARED_IPS_SQL = `
  SELECT ip, COUNT(DISTINCT steam_id) AS steam_id_count
  FROM steam_ip_history
  WHERE ip IS NOT NULL AND TRIM(ip) <> ''
  GROUP BY ip
  HAVING COUNT(DISTINCT steam_id) > 1
`;

const PLAYERS_BY_IP_SQL = `
  SELECT
    sip.steam_id,
    pi.current_name,
    pi.discord_id,
    SUM(sip.times_seen) AS times_seen,
    MIN(sip.first_seen) AS first_seen,
    MAX(sip.last_seen) AS last_seen
  FROM steam_ip_history sip
  LEFT JOIN player_identities pi ON pi.steam_id = sip.steam_id
  WHERE sip.ip = ?
  GROUP BY sip.steam_id, pi.current_name, pi.discord_id
  ORDER BY last_seen DESC, times_seen DESC
`;

function createPlayerIdentitiesRouter({
  db,
  cleanString,
  sendError,
  logRouteError
}) {
  const router = express.Router();

  router.get("/player-identities", (req, res) => {
    try {
      const data = db.prepare(PLAYER_IDENTITIES_SQL).all();
      const sharedIps = Object.fromEntries(
        db.prepare(SHARED_IPS_SQL).all().map(row => [
          String(row.ip),
          Number(row.steam_id_count || 0)
        ])
      );

      res.json({ ok: true, data, shared_ips: sharedIps });
    } catch (error) {
      logRouteError("[/api/player-identities]", error);
      sendError(res, 500, "player_identities_failed");
    }
  });

  router.get("/player-identities/ip/:ip", (req, res) => {
    const ip = cleanString(req.params.ip, 100);
    if (!ip) return sendError(res, 400, "invalid_ip");

    try {
      const data = db.prepare(PLAYERS_BY_IP_SQL).all(ip);
      res.json({ ok: true, ip, data });
    } catch (error) {
      logRouteError("[/api/player-identities/ip/:ip]", error);
      sendError(res, 500, "player_identities_ip_failed");
    }
  });

  router.get("/player-identities/:steamid", (req, res) => {
    const steamId = cleanString(req.params.steamid, 100);
    if (!steamId) return sendError(res, 400, "invalid_steam_id");

    try {
      const player = db.prepare(PLAYER_IDENTITY_SQL).get(steamId);
      if (!player) return sendError(res, 404, "player_identity_not_found");

      const aliases = db.prepare(PLAYER_ALIASES_SQL).all(steamId);
      const ips = db.prepare(PLAYER_IPS_SQL).all(steamId);
      res.json({ ok: true, player, aliases, ips });
    } catch (error) {
      logRouteError("[/api/player-identities/:steamid]", error);
      sendError(res, 500, "player_identity_failed");
    }
  });

  return router;
}

module.exports = {
  createPlayerIdentitiesRouter,
  PLAYER_IDENTITIES_SQL,
  PLAYER_IDENTITY_SQL,
  PLAYER_ALIASES_SQL,
  PLAYER_IPS_SQL,
  SHARED_IPS_SQL,
  PLAYERS_BY_IP_SQL
};
