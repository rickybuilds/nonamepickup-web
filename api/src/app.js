"use strict";

const express = require("express");
const { registerRoutes } = require("./routes");
const { securityHeaders } = require("./middleware/securityHeaders");
const { createCorsMiddleware } = require("./middleware/cors");
const { registerStaticFiles } = require("./middleware/staticFiles");
const { registerRateLimit } = require("./middleware/rateLimit");
const { createAnalyticsMiddleware } = require("./middleware/analytics");
const { registerErrorHandlers } = require("./middleware/errors");

function createApp({
  db,
  fs,
  config,
  helpers,
  serializers,
  loadMatchPlayers,
  statements
}) {
  const {
    PUBLIC_DIR,
    DATA_DIR,
    SUPPORTERS_FILE,
    QUEUE_FILE,
    TRUST_PROXY,
    CORS_ORIGIN,
    API_RATE_LIMIT,
    MAX_MATCH_LIMIT,
    MAX_PLAYER_MATCH_LIMIT,
    ANALYTICS_SALT
  } = config;
  const {
    cached,
    cachedFor,
    positiveInt,
    nonNegativeInt,
    cleanString,
    parseIdList,
    safePublicUrl,
    sendError,
    logRouteError
  } = helpers;
  const { matchColumns, serializeMatch } = serializers;
  const {
    analyticsInsertStmt,
    statsSummaryStmt,
    compareProfileStmt,
    compareMatchesStmt
  } = statements;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", TRUST_PROXY);
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

  app.use(securityHeaders);

  registerRateLimit(app, {
    apiRateLimit: API_RATE_LIMIT,
    sendError
  });

  // CORS
  app.use(createCorsMiddleware(CORS_ORIGIN));

  // Website analytics logging
  app.use(createAnalyticsMiddleware({
    analyticsInsertStmt,
    analyticsSalt: ANALYTICS_SALT,
    cleanString
  }));

  // static
  registerStaticFiles(app, PUBLIC_DIR);

  function leaderboardHandler(req, res) {
    try {
      const limit = positiveInt(req.query.limit, 50, 1, 2000);
      const days = nonNegativeInt(req.query.days, 30, 3650);
      const cutoff = Math.floor(Date.now() / 1000) - (days * 86400);

      const rows = db.prepare(`
      WITH primary_steam AS (
        SELECT discord_id, MIN(steam_id) AS steam_id
        FROM player_steam_ids
        WHERE is_primary = 1
        GROUP BY discord_id
      )
      SELECT
        rt.player_id,
        rt.display_name,
        rt.rating,
        up.hide_elo,
        ps.steam_id,
        sp.steam_id64,
        sp.personaname,
        sp.profileurl,
        sp.avatar,
        sp.avatarmedium,
        sp.avatarfull,
        COUNT(DISTINCT r.match_id) AS games,
        SUM(CASE
              WHEN m.winner='BLUE' AND EXISTS (
                SELECT 1 FROM json_each(m.blue_ids)
                WHERE CAST(value AS TEXT) = CAST(rt.player_id AS TEXT)
              ) THEN 1
              WHEN m.winner='RED' AND EXISTS (
                SELECT 1 FROM json_each(m.red_ids)
                WHERE CAST(value AS TEXT) = CAST(rt.player_id AS TEXT)
              ) THEN 1
              ELSE 0 END) AS wins,
        SUM(CASE
              WHEN m.winner='BLUE' AND EXISTS (
                SELECT 1 FROM json_each(m.red_ids)
                WHERE CAST(value AS TEXT) = CAST(rt.player_id AS TEXT)
              ) THEN 1
              WHEN m.winner='RED' AND EXISTS (
                SELECT 1 FROM json_each(m.blue_ids)
                WHERE CAST(value AS TEXT) = CAST(rt.player_id AS TEXT)
              ) THEN 1
              ELSE 0 END) AS losses,
        SUM(CASE WHEN m.winner='TIE' THEN 1 ELSE 0 END) AS ties
      FROM ratings rt
      LEFT JOIN user_prefs up ON up.player_id = rt.player_id
      LEFT JOIN primary_steam ps ON CAST(ps.discord_id AS TEXT) = CAST(rt.player_id AS TEXT)
      LEFT JOIN steam_profiles sp ON sp.steam_id = ps.steam_id
      LEFT JOIN rating_changes r ON r.player_id = rt.player_id
      LEFT JOIN matches m ON m.match_id = r.match_id
           AND m.status='completed'
           ${days > 0 ? "AND m.created_at >= ?" : ""}
      GROUP BY rt.player_id
      ORDER BY rt.rating DESC
      LIMIT ?
    `).all(...(days > 0 ? [cutoff, limit] : [limit]));

      const out = rows.map((r, i) => ({
        rank: i + 1,
        id: String(r.player_id),
        player: r.display_name || String(r.player_id),
        elo: r.hide_elo ? null : r.rating,
        hidden: !!r.hide_elo,
        wins: r.wins || 0,
        losses: r.losses || 0,
        ties: r.ties || 0,
        record: `${r.wins || 0}-${r.losses || 0}-${r.ties || 0}`,
        steam_id: r.steam_id || null,
        steam_id64: r.steam_id64 || null,
        personaname: r.personaname || null,
        profileurl: r.profileurl || null,
        avatar: r.avatar || null,
        avatarmedium: r.avatarmedium || null,
        avatarfull: r.avatarfull || null
      }));

      res.json({ ok: true, data: out });
    } catch (e) {
      logRouteError("[leaderboard]", e);
      sendError(res, 500, "leaderboard_failed");
    }
  }

  registerRoutes(app, {
    leaderboardHandler,
    db,
    fs,
    SUPPORTERS_FILE,
    sendError,
    logRouteError,
    positiveInt,
    nonNegativeInt,
    cachedFor,
    MAX_MATCH_LIMIT,
    cleanString,
    matchColumns,
    loadMatchPlayers,
    serializeMatch,
    MAX_PLAYER_MATCH_LIMIT,
    parseIdList,
    cached,
    statsSummaryStmt,
    QUEUE_FILE,
    DATA_DIR,
    compareProfileStmt,
    compareMatchesStmt,
    safePublicUrl
  });

  registerErrorHandlers(app, {
    sendError,
    logRouteError
  });

  return app;
}

module.exports = { createApp };
