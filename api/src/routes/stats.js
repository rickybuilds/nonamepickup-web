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

          const rateRow = db.prepare(`
            WITH linked_mvps AS (
              SELECT
                psi.discord_id AS player_id,
                COUNT(DISTINCT m.match_id) AS mvp_games
              FROM match_round_mvps m
              JOIN player_steam_ids psi
                ON psi.steam_id=m.mvp_player_key OR psi.steam_id=m.steam_id
              WHERE psi.discord_id IS NOT NULL
              GROUP BY psi.discord_id
            ),
            player_games AS (
              SELECT
                rc.player_id,
                COUNT(DISTINCT rc.match_id) AS games
              FROM rating_changes rc
              JOIN matches m ON m.match_id=rc.match_id
              WHERE m.status='completed'
              GROUP BY rc.player_id
            )
            SELECT
              pg.player_id AS id,
              COALESCE(r.display_name, pg.player_id) AS player,
              pg.games,
              COALESCE(lm.mvp_games, 0) AS mvp_games,
              ROUND(100.0 * COALESCE(lm.mvp_games, 0) / pg.games, 1) AS mvp_pct
            FROM player_games pg
            LEFT JOIN linked_mvps lm
              ON CAST(lm.player_id AS TEXT)=CAST(pg.player_id AS TEXT)
            LEFT JOIN ratings r
              ON CAST(r.player_id AS TEXT)=CAST(pg.player_id AS TEXT)
            WHERE pg.games >= 25
            ORDER BY mvp_pct DESC, mvp_games DESC, games DESC, player COLLATE NOCASE
            LIMIT 1
          `).get();

          const rateLeader = rateRow ? {
            id: rateRow.id == null ? null : String(rateRow.id),
            player: rateRow.player || "Unknown",
            games: Number(rateRow.games || 0),
            mvp_games: Number(rateRow.mvp_games || 0),
            mvp_pct: Number(rateRow.mvp_pct || 0)
          } : null;

          return { leader: leaders[0] || null, leaders, rateLeader };
        } catch (error) {
          if (String(error?.message || "").includes("no such table")) {
            return { leader: null, leaders: [], rateLeader: null };
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

        const topActiveRows = db.prepare(`
        SELECT rc.player_id,
               COALESCE(r.display_name, rc.player_id) as name,
               COUNT(DISTINCT rc.match_id) as games
        FROM rating_changes rc
        JOIN matches m ON m.match_id = rc.match_id
        LEFT JOIN ratings r ON r.player_id = rc.player_id
        WHERE m.status='completed' AND m.created_at >= ?
        GROUP BY rc.player_id
        ORDER BY games DESC, name COLLATE NOCASE
        LIMIT 2
      `).all(cutoff30d);

        const topActiveList = topActiveRows.map(row => ({
          id: String(row.player_id),
          player: row.name || String(row.player_id),
          games: Number(row.games || 0)
        }));

        return {
          uniquePlayers,
          uniquePlayers30d,
          topActive: topActiveList[0] || null,
          topActiveRunnerUp: topActiveList[1] || null,
          topActiveList
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
        const activeRows = db.prepare(`
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
        LIMIT 2
      `).all();

        const currentStreakLeaders = activeRows.map(row => ({
          id: String(row.player_id),
          player: row.name || String(row.player_id),
          wins: Number(row.active || 0)
        }));

        return {
          currentStreak: currentStreakLeaders[0] || null,
          currentStreakRunnerUp: currentStreakLeaders[1] || null,
          currentStreakLeaders
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
