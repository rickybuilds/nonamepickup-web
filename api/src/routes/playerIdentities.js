"use strict";

const express = require("express");

const PLAYER_IDENTITIES_SQL = `
  SELECT
    pi.steam_id,
    pi.discord_id,
    r.display_name AS discord_name,
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
  LEFT JOIN ratings r ON CAST(r.player_id AS TEXT) = CAST(pi.discord_id AS TEXT)
  ORDER BY pi.last_seen DESC
`;

const PLAYER_IDENTITY_SQL = `
  SELECT
    pi.steam_id,
    pi.discord_id,
    r.display_name AS discord_name,
    sp.avatar,
    sp.avatarmedium,
    sp.avatarfull,
    current_name,
    current_ip,
    current_server,
    first_seen,
    last_seen,
    connection_count
  FROM player_identities pi
  LEFT JOIN ratings r ON CAST(r.player_id AS TEXT) = CAST(pi.discord_id AS TEXT)
  LEFT JOIN steam_profiles sp ON sp.steam_id = pi.steam_id
  WHERE pi.steam_id = ?
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
    r.display_name AS discord_name,
    SUM(sip.times_seen) AS times_seen,
    MIN(sip.first_seen) AS first_seen,
    MAX(sip.last_seen) AS last_seen
  FROM steam_ip_history sip
  LEFT JOIN player_identities pi ON pi.steam_id = sip.steam_id
  LEFT JOIN ratings r ON CAST(r.player_id AS TEXT) = CAST(pi.discord_id AS TEXT)
  WHERE sip.ip = ?
  GROUP BY sip.steam_id, pi.current_name, pi.discord_id, r.display_name
  ORDER BY last_seen DESC, times_seen DESC
`;

const PLAYER_IDENTITIES_SUMMARY_SQL = `
  SELECT
    COUNT(*) AS known_players,
    COALESCE(SUM(connection_count), 0) AS total_connections,
    COALESCE(SUM(CASE WHEN discord_id IS NULL OR TRIM(discord_id) = '' THEN 1 ELSE 0 END), 0) AS unlinked_players,
    COALESCE(MAX(last_seen), 0) AS last_updated,
    COALESCE(SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS recent_players,
    COALESCE(SUM(CASE WHEN (SELECT COUNT(*) FROM steam_ip_history sip WHERE sip.steam_id = pi.steam_id) > 1 THEN 1 ELSE 0 END), 0) AS multiple_ip_players,
    COALESCE(SUM(CASE WHEN (SELECT COUNT(*) FROM steam_alias_history sah WHERE sah.steam_id = pi.steam_id) > 1 THEN 1 ELSE 0 END), 0) AS multiple_alias_players
  FROM player_identities pi
`;

const PLAYER_IDENTITIES_PAGE_SELECT = `
  SELECT
    pi.steam_id,
    pi.discord_id,
    r.display_name AS discord_name,
    sp.avatar,
    sp.avatarmedium,
    sp.avatarfull,
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
  LEFT JOIN ratings r ON CAST(r.player_id AS TEXT) = CAST(pi.discord_id AS TEXT)
  LEFT JOIN steam_profiles sp ON sp.steam_id = pi.steam_id
`;

function playerIdentityPageQuery({ query, filter, page, limit }) {
  const clauses = [];
  const params = [];
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const cutoff = Math.floor(Date.now() / 1000) - (7 * 86400);

  if (normalizedQuery) {
    const term = `%${normalizedQuery}%`;
    clauses.push(`(
      LOWER(COALESCE(pi.current_name, '')) LIKE ?
      OR LOWER(COALESCE(pi.steam_id, '')) LIKE ?
      OR LOWER(COALESCE(pi.discord_id, '')) LIKE ?
      OR LOWER(COALESCE(r.display_name, '')) LIKE ?
      OR EXISTS (SELECT 1 FROM steam_alias_history sah_search WHERE sah_search.steam_id = pi.steam_id AND LOWER(sah_search.alias) LIKE ?)
      OR EXISTS (SELECT 1 FROM steam_ip_history sip_search WHERE sip_search.steam_id = pi.steam_id AND LOWER(sip_search.ip) LIKE ?)
    )`);
    params.push(term, term, term, term, term, term);
  }

  switch (filter) {
    case 'recent':
      clauses.push('pi.last_seen >= ?');
      params.push(cutoff);
      break;
    case 'unlinked':
      clauses.push("(pi.discord_id IS NULL OR TRIM(pi.discord_id) = '')");
      break;
    case 'multiple_ips':
      clauses.push('(SELECT COUNT(*) FROM steam_ip_history sip_filter WHERE sip_filter.steam_id = pi.steam_id) > 1');
      break;
    case 'multiple_aliases':
      clauses.push('(SELECT COUNT(*) FROM steam_alias_history sah_filter WHERE sah_filter.steam_id = pi.steam_id) > 1');
      break;
    default:
      break;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const offset = (page - 1) * limit;
  return {
    where,
    params,
    offset,
    countSql: `SELECT COUNT(*) AS total FROM player_identities pi LEFT JOIN ratings r ON CAST(r.player_id AS TEXT) = CAST(pi.discord_id AS TEXT) ${where}`,
    rowsSql: `${PLAYER_IDENTITIES_PAGE_SELECT} ${where} ORDER BY pi.last_seen DESC LIMIT ? OFFSET ?`
  };
}

function createPlayerIdentitiesRouter({
  db,
  cleanString,
  sendError,
  logRouteError
}) {
  const router = express.Router();

  router.get("/player-identities", (req, res) => {
    try {
      const query = cleanString(req.query.q, 120);
      const allowedFilters = new Set(["all", "recent", "unlinked", "multiple_ips", "multiple_aliases"]);
      const filter = allowedFilters.has(req.query.filter) ? req.query.filter : "all";
      const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 10));
      const pageQuery = playerIdentityPageQuery({ query, filter, page, limit });
      const total = Number(db.prepare(pageQuery.countSql).get(...pageQuery.params)?.total || 0);
      const data = db.prepare(pageQuery.rowsSql).all(...pageQuery.params, limit, pageQuery.offset);
      const cutoff = Math.floor(Date.now() / 1000) - (7 * 86400);
      const summaryRow = db.prepare(PLAYER_IDENTITIES_SUMMARY_SQL).get(cutoff) || {};

      res.json({
        ok: true,
        data,
        pagination: { page, limit, total },
        summary: {
          known_players: Number(summaryRow.known_players || 0),
          total_connections: Number(summaryRow.total_connections || 0),
          unlinked_players: Number(summaryRow.unlinked_players || 0),
          last_updated: summaryRow.last_updated || null,
          filters: {
            all: Number(summaryRow.known_players || 0),
            recent: Number(summaryRow.recent_players || 0),
            unlinked: Number(summaryRow.unlinked_players || 0),
            multiple_ips: Number(summaryRow.multiple_ip_players || 0),
            multiple_aliases: Number(summaryRow.multiple_alias_players || 0)
          }
        }
      });
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
  PLAYERS_BY_IP_SQL,
  PLAYER_IDENTITIES_SUMMARY_SQL,
  PLAYER_IDENTITIES_PAGE_SELECT,
  playerIdentityPageQuery
};
