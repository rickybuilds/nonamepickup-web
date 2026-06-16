"use strict";

const express = require("express");

function createMapsRouter({
  db,
  cached,
  maxMatchLimit,
  positiveInt,
  cleanString,
  matchColumns,
  loadMatchPlayers,
  serializeMatch,
  sendError,
  logRouteError
}) {
  const router = express.Router();

  router.get("/map/:map/players", (req, res) => {
    try {
      const map = cleanString(req.params.map, 200);
      if (!map) return sendError(res, 400, "missing_map");

      const rows = db.prepare(`
      SELECT
        rc.player_id,
        COALESCE(r.display_name, rc.player_id) AS player,
        COUNT(*) AS gp,
        SUM(CASE
              WHEN m.winner='BLUE' AND EXISTS (
                SELECT 1 FROM json_each(m.blue_ids)
                WHERE CAST(value AS TEXT) = CAST(rc.player_id AS TEXT)
              ) THEN 1
              WHEN m.winner='RED' AND EXISTS (
                SELECT 1 FROM json_each(m.red_ids)
                WHERE CAST(value AS TEXT) = CAST(rc.player_id AS TEXT)
              ) THEN 1
              ELSE 0 END) AS w,
        SUM(CASE
              WHEN m.winner='BLUE' AND EXISTS (
                SELECT 1 FROM json_each(m.red_ids)
                WHERE CAST(value AS TEXT) = CAST(rc.player_id AS TEXT)
              ) THEN 1
              WHEN m.winner='RED' AND EXISTS (
                SELECT 1 FROM json_each(m.blue_ids)
                WHERE CAST(value AS TEXT) = CAST(rc.player_id AS TEXT)
              ) THEN 1
              ELSE 0 END) AS l,
        SUM(CASE WHEN m.winner='TIE' THEN 1 ELSE 0 END) AS t
      FROM rating_changes rc
      JOIN matches m ON m.match_id = rc.match_id
      LEFT JOIN ratings r ON r.player_id = rc.player_id
      WHERE m.status='completed' AND m.map_name=?
      GROUP BY rc.player_id
      HAVING gp > 0
      ORDER BY w DESC, gp DESC
    `).all(map);

      const out = rows.map(r => {
        const decided = (r.w || 0) + (r.l || 0);
        return {
          id: String(r.player_id),
          player: r.player,
          gp: r.gp || 0,
          w: r.w || 0,
          l: r.l || 0,
          t: r.t || 0,
          winRate: decided > 0 ? (((r.w || 0) / decided) * 100).toFixed(1) : "0.0"
        };
      });

      res.json({ ok: true, data: out });
    } catch (e) {
      logRouteError("[/api/map/:map/players]", e);
      sendError(res, 500, "map_players_failed");
    }
  });

  router.get("/map/:map/matches", (req, res) => {
    try {
      const map = cleanString(req.params.map, 200);
      if (!map) return sendError(res, 400, "missing_map");

      const limit = positiveInt(req.query.limit, 500, 1, maxMatchLimit);

      const rows = db.prepare(`
      SELECT ${matchColumns("m")}
      FROM matches m
      WHERE m.map_name = ?
        AND m.status IN ('completed','in_progress')
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(map, limit);
      const playersByMatch = loadMatchPlayers(rows, { includeRatings: false });
      const out = rows.map(row => serializeMatch(row, playersByMatch, { includeTfcstats: false }));

      res.json({ ok: true, data: out, count: out.length });
    } catch (e) {
      logRouteError("[/api/map/:map/matches]", e);
      sendError(res, 500, "map_matches_failed");
    }
  });

  router.get("/mapaverages", (req, res) => {
    try {
      const data = cached('mapaverages', () => {
        const rows = db.prepare(`
        SELECT
          map_name,
          COUNT(*) AS games,
          ROUND(AVG((score_blue + score_red) / 2.0), 1) AS avg_score_per_team
        FROM matches
        WHERE status='completed'
        GROUP BY map_name
        ORDER BY games DESC
      `).all();

        return rows.map(r => ({
          map: r.map_name,
          games: r.games,
          avgScorePerTeam: r.avg_score_per_team
        }));
      });

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/mapaverages]", e);
      res.json({ ok: false, error: "mapaverages_failed" });
    }
  });

  return router;
}

module.exports = { createMapsRouter };
