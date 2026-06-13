"use strict";

const express = require("express");

function createStatsRouter({ db, cached, statsSummaryStmt, sendError, logRouteError }) {
  const router = express.Router();

  router.get("/stats/mvps", (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, Math.trunc(Number(req.query.limit) || 10)));
      const data = cached(`stats_mvps_${limit}`, () => {
        try {
          const rows = db.prepare(`
            WITH mvp_identities AS (
              SELECT
                m.match_id,
                COALESCE(
                  psi.discord_id,
                  m.mvp_player_key,
                  m.steam_id,
                  LOWER(TRIM(m.mvp_display_name))
                ) AS identity,
                psi.discord_id AS player_id,
                COALESCE(r.display_name, m.mvp_display_name, m.mvp_player_key, m.steam_id) AS player
              FROM match_round_mvps m
              LEFT JOIN player_steam_ids psi
                ON psi.steam_id=m.mvp_player_key OR psi.steam_id=m.steam_id
              LEFT JOIN ratings r ON r.player_id=psi.discord_id
            )
            SELECT
              MAX(player_id) AS id,
              MAX(player) AS player,
              COUNT(DISTINCT match_id) AS mvp_games
            FROM mvp_identities
            WHERE identity IS NOT NULL AND identity!=''
            GROUP BY identity
            ORDER BY mvp_games DESC, player COLLATE NOCASE
            LIMIT ?
          `).all(limit);

          const leaders = rows.map(row => ({
            id: row.id == null ? null : String(row.id),
            player: row.player || "Unknown",
            mvp_games: Number(row.mvp_games || 0)
          }));

          return { leader: leaders[0] || null, leaders };
        } catch (error) {
          if (String(error?.message || "").includes("no such table")) {
            return { leader: null, leaders: [] };
          }
          throw error;
        }
      });

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/stats/mvps]", e);
      sendError(res, 500, "stats_mvps_failed");
    }
  });

  router.get("/stats/matchOutcomes", (req, res) => {
    try {
      const data = cached("matchOutcomes", () => {
        return db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN UPPER(winner)='TIE' THEN 1 ELSE 0 END) AS ties,
          SUM(
            CASE
              WHEN UPPER(winner) != 'TIE'
              AND ABS(score_blue - score_red) < 15
              THEN 1 ELSE 0
            END
          ) AS under15,

          SUM(
            CASE
              WHEN UPPER(winner) != 'TIE'
              AND ABS(score_blue - score_red) >= 15
              AND ABS(score_blue - score_red) <= 25
              THEN 1 ELSE 0
            END
          ) AS under25,

          SUM(
            CASE
              WHEN UPPER(winner) != 'TIE'
              AND ABS(score_blue - score_red) > 25
              THEN 1 ELSE 0
            END
          ) AS blowouts
        FROM matches
        WHERE status='completed'
          AND score_blue IS NOT NULL
          AND score_red IS NOT NULL
      `).get();
      });

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/stats/matchOutcomes]", e);
      sendError(res, 500, "match_outcomes_failed");
    }
  });

  router.get("/stats/mostGamesAndTies", (req, res) => {
    try {
      const result = cached('mostGamesAndTies', () => {
        const totalTies = db
          .prepare("SELECT COUNT(*) AS c FROM matches WHERE LOWER(winner)='tie'")
          .get().c;

        const rows = db.prepare(`
        SELECT
          rc.player_id,
          COALESCE(r.display_name, rc.player_id) AS player,
          date(datetime(m.created_at, 'unixepoch', '-6 hours')) AS day,
          COUNT(DISTINCT m.match_id) AS games
        FROM rating_changes rc
        JOIN matches m ON m.match_id = rc.match_id
        LEFT JOIN ratings r ON r.player_id = rc.player_id
        WHERE m.status='completed'
        GROUP BY rc.player_id, day
        HAVING games = (
          SELECT MAX(cnt) FROM (
            SELECT COUNT(DISTINCT m2.match_id) AS cnt
            FROM rating_changes rc2
            JOIN matches m2 ON m2.match_id = rc2.match_id
            WHERE m2.status='completed'
            GROUP BY rc2.player_id, date(datetime(m2.created_at, 'unixepoch', '-6 hours'))
          )
        )
        ORDER BY games DESC, player ASC
      `).all();

        return {
          totalTies,
          mostGames: rows.map(r => ({ player: r.player, count: r.games, date: r.day }))
        };
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      logRouteError("[/api/stats/mostGamesAndTies]", err);
      sendError(res, 500, "stats_mostGamesAndTies_failed");
    }
  });

  router.get("/stats/summary", (req, res) => {
    try {
      const data = cached('stats_summary', () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff1d  = now - 86400;
        const cutoff7d  = now - (7 * 86400);
        const cutoff30d = now - (30 * 86400);
        const row = statsSummaryStmt.get(cutoff1d, cutoff7d, cutoff30d);

        return {
          totalMatches: Number(row.totalMatches || 0),
          matches1d: Number(row.matches1d || 0),
          matches7d: Number(row.matches7d || 0),
          matches30d: Number(row.matches30d || 0)
        };
      });

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/stats/summary]", e);
      sendError(res, 500, "stats_summary_failed");
    }
  });

  router.get("/stats/players", (req, res) => {
    try {
      const data = cached('stats_players', () => {
        const uniquePlayers = db.prepare(
          "SELECT COUNT(DISTINCT player_id) as c FROM ratings"
        ).get().c;

        const cutoff30d = Math.floor(Date.now() / 1000) - (30 * 86400);

        const uniquePlayers30d = db.prepare(`
        SELECT COUNT(DISTINCT rc.player_id) as c
        FROM rating_changes rc
        JOIN matches m ON m.match_id = rc.match_id
        WHERE m.status='completed'
          AND m.created_at >= ?
      `).get(cutoff30d).c;

        const topActive = db.prepare(`
        SELECT rc.player_id,
               COALESCE(r.display_name, rc.player_id) as name,
               COUNT(DISTINCT rc.match_id) as games
        FROM rating_changes rc
        JOIN matches m ON m.match_id = rc.match_id
        LEFT JOIN ratings r ON r.player_id = rc.player_id
        WHERE m.status='completed' AND m.created_at >= ?
        GROUP BY rc.player_id
        ORDER BY games DESC
        LIMIT 1
      `).get(cutoff30d);

        return {
          uniquePlayers,
          uniquePlayers30d,
          topActive: topActive ? { player: topActive.name, games: topActive.games } : null
        };
      });

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/stats/players]", e);
      sendError(res, 500, "stats_players_failed");
    }
  });

  router.get("/stats/streaks", (req, res) => {
    try {
      const data = (() => {
        const active = db.prepare(`
        WITH player_games AS (
          SELECT 
            rc.player_id,
            COALESCE(r.display_name, rc.player_id) AS name,
            m.created_at,
            CASE 
              WHEN m.winner = 'BLUE' AND EXISTS (
                SELECT 1 FROM json_each(m.blue_ids)
                WHERE CAST(value AS TEXT) = CAST(rc.player_id AS TEXT)
              ) THEN 1
              WHEN m.winner = 'RED' AND EXISTS (
                SELECT 1 FROM json_each(m.red_ids)
                WHERE CAST(value AS TEXT) = CAST(rc.player_id AS TEXT)
              ) THEN 1
              ELSE 0 
            END AS is_win
          FROM rating_changes rc
          JOIN matches m ON m.match_id = rc.match_id
          LEFT JOIN ratings r ON r.player_id = rc.player_id
          WHERE m.status = 'completed'
            AND m.winner IS NOT NULL
        ),
        marked AS (
          SELECT
            player_id,
            name,
            created_at,
            is_win,
            SUM(CASE WHEN is_win = 0 THEN 1 ELSE 0 END)
              OVER (
                PARTITION BY player_id
                ORDER BY created_at DESC
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS reset_group
          FROM player_games
        ),
        current_streaks AS (
          SELECT
            player_id,
            name,
            COUNT(*) AS active,
            MAX(created_at) AS last_played
          FROM marked
          WHERE is_win = 1
            AND reset_group = 0
          GROUP BY player_id, name
        )
        SELECT
          player_id,
          name,
          active
        FROM current_streaks
        ORDER BY active DESC, last_played DESC
        LIMIT 1
      `).get();

        return {
          currentStreak: active
            ? { player: active.name, wins: active.active }
            : null
        };
      })();

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/stats/streaks]", e);
      sendError(res, 500, "stats_streaks_failed");
    }
  });

  return router;
}

module.exports = { createStatsRouter };
