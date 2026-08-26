"use strict";

const express = require("express");
const compression = require("compression");
const { registerRoutes } = require("./routes");
const { securityHeaders } = require("./middleware/securityHeaders");
const { createCorsMiddleware } = require("./middleware/cors");
const { registerStaticFiles } = require("./middleware/staticFiles");
const { registerRateLimit } = require("./middleware/rateLimit");
const { createAnalyticsMiddleware } = require("./middleware/analytics");
const { registerErrorHandlers } = require("./middleware/errors");
const { checkSpeedrunDatabase } = require("./db/mariadb");
const { createPickupReplaysRouter, createPickupReplayViewerRouter } = require("./routes/pickupReplays");
const { createPickupLiveIngestRouter, createPickupLiveViewerRouter } = require("./routes/pickupLive");
const { registerRelayStatusRoute } = require("./live/udpRelay");

function createApp({
  db,
  fs,
  config,
  helpers,
  serializers,
  loadMatchPlayers,
  statements,
  pickupIngestion,
  pickupReplayViewer,
  pickupLive
}) {
  const {
    PUBLIC_DIR,
    DATA_DIR,
    SUPPORTERS_FILE,
    QUEUE_FILE,
    KICKED_FILE,
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
  app.use("/api/speedruns/replay", compression({ threshold: 0 }));

  app.use(securityHeaders);

  // Authenticated game-server traffic is validated by the live service before
  // its bounded JSON parser runs. Mount it ahead of public per-IP rate limits
  // so multiple live matches behind one server address cannot starve each other.
  if (pickupLive) app.use("/api", createPickupLiveIngestRouter({ live: pickupLive }));

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

  app.use("/api", createPickupReplaysRouter({
    ingestion: pickupIngestion
  }));
  app.use("/api/pickup-replays/viewer", compression({ threshold: 1024 }));
  app.use("/api", createPickupReplayViewerRouter({
    viewer: pickupReplayViewer
  }));
  if (pickupLive) {
    app.use("/api/pickup-live/viewer", compression({
      threshold: 1024,
      filter: (req, res) => !req.path.endsWith("/events") && compression.filter(req, res)
    }));
    app.use("/api", createPickupLiveViewerRouter({ live: pickupLive }));
  }

  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

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
        COUNT(DISTINCT m.match_id) AS games,
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
        games: Number(r.games || 0),
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

      const eligibleIds = out
        .filter(row => !row.hidden && row.elo != null && (Number(row.wins || 0) + Number(row.losses || 0) + Number(row.ties || 0)) >= 10)
        .map(row => row.id);

      const historyByPlayer = new Map();
      const distinctRankedMatches = new Set();
      const chunks = [];
      for (let i = 0; i < eligibleIds.length; i += 450) chunks.push(eligibleIds.slice(i, i + 450));

      for (const chunk of chunks) {
        if (!chunk.length) continue;
        const placeholders = chunk.map(() => "?").join(",");
        const historyRows = db.prepare(`
          WITH recent AS (
            SELECT
              rc.player_id,
              rc.match_id,
              rc.before,
              rc.after,
              rc.delta,
              rc.ts,
              m.winner,
              m.blue_ids,
              m.red_ids,
              ROW_NUMBER() OVER (
                PARTITION BY rc.player_id
                ORDER BY rc.ts DESC, rc.match_id DESC
              ) AS rn
            FROM rating_changes rc
            JOIN matches m ON m.match_id = rc.match_id
            WHERE rc.player_id IN (${placeholders})
              AND m.status = 'completed'
              ${days > 0 ? "AND m.created_at >= ?" : ""}
          )
          SELECT *
          FROM recent
          WHERE rn <= 20
          ORDER BY player_id, ts ASC, match_id ASC
        `).all(...(days > 0 ? [...chunk, cutoff] : chunk));

        const matchRows = db.prepare(`
          SELECT DISTINCT rc.match_id
          FROM rating_changes rc
          JOIN matches m ON m.match_id = rc.match_id
          WHERE rc.player_id IN (${placeholders})
            AND m.status = 'completed'
            ${days > 0 ? "AND m.created_at >= ?" : ""}
        `).all(...(days > 0 ? [...chunk, cutoff] : chunk));

        for (const row of matchRows) distinctRankedMatches.add(String(row.match_id));

        for (const row of historyRows) {
          const playerId = String(row.player_id);
          const list = historyByPlayer.get(playerId) || [];
          let team = null;
          try {
            const blueIds = parseIdList(row.blue_ids).map(String);
            const redIds = parseIdList(row.red_ids).map(String);
            if (blueIds.includes(playerId)) team = "BLUE";
            else if (redIds.includes(playerId)) team = "RED";
          } catch {}

          const winner = String(row.winner || "").toUpperCase();
          const result = winner === "TIE" ? "T" : team && winner === team ? "W" : team && winner ? "L" : null;
          list.push({
            match_id: String(row.match_id),
            after: row.after == null ? null : Number(row.after),
            before: row.before == null ? null : Number(row.before),
            delta: Number(row.delta || 0),
            result
          });
          historyByPlayer.set(playerId, list);
        }
      }

      for (const row of out) {
        if (row.hidden || row.elo == null) {
          row.elo_delta_recent = null;
          row.elo_trend = [];
          row.recent_results = [];
          continue;
        }

        const history = historyByPlayer.get(row.id) || [];
        const trend = history
          .map(item => Number(item.after ?? item.before))
          .filter(value => Number.isFinite(value));
        const first = history[0];
        const last = history[history.length - 1];
        const baseline = first ? Number(first.before ?? first.after ?? last?.after ?? row.elo) : Number(row.elo || 0);
        const current = last ? Number(last.after ?? row.elo) : Number(row.elo || 0);

        row.elo_delta_recent = Math.round(current - baseline);
        row.elo_trend = trend;
        row.recent_results = history.slice(-10).map(item => item.result || "?");
      }

      res.json({
        ok: true,
        data: out,
        summary: {
          games_played: distinctRankedMatches.size
        }
      });
    } catch (e) {
      logRouteError("[leaderboard]", e);
      sendError(res, 500, "leaderboard_failed");
    }
  }

  registerRelayStatusRoute(app);

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
    KICKED_FILE,
    DATA_DIR,
    compareProfileStmt,
    compareMatchesStmt,
    safePublicUrl,
    checkSpeedrunDatabase
  });

  registerErrorHandlers(app, {
    sendError,
    logRouteError
  });

  return app;
}

module.exports = { createApp };
