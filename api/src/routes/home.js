"use strict";

const express = require("express");

function createHomeRouter({ db, cached, logRouteError, sendError }) {
  const router = express.Router();

  function one(sql, params = []) {
    try {
      return db.prepare(sql).get(...params) || null;
    } catch {
      return null;
    }
  }

  function player(row, valueKey = "value") {
    if (!row) return null;
    return {
      id: row.id == null ? null : String(row.id),
      player: row.player || (row.id == null ? "Unknown" : String(row.id)),
      value: Number(row[valueKey] || 0),
      display: row.display || null
    };
  }

  router.get("/home", (req, res) => {
    try {
      const data = cached("home_v2_pass6", () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff1d = now - 86400;
        const cutoff7d = now - (7 * 86400);
        const cutoff30d = now - (30 * 86400);

        const summaryRow = one(`
          SELECT
            COUNT(*) AS totalMatches,
            MIN(created_at) AS firstMatchAt,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches1d,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches7d,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches30d
          FROM matches
          WHERE status='completed'
        `, [cutoff1d, cutoff7d, cutoff30d]) || {};

        const playerRow = one(`
          SELECT
            (SELECT COUNT(DISTINCT player_id) FROM ratings) AS uniquePlayers,
            (
              SELECT COUNT(DISTINCT rc.player_id)
              FROM rating_changes rc
              JOIN matches m ON m.match_id=rc.match_id
              WHERE m.status='completed' AND m.created_at >= ?
            ) AS uniquePlayers30d
        `, [cutoff30d]) || {};

        const mostWins = player(one(`
          SELECT
            rc.player_id AS id,
            COALESCE(r.display_name, rc.player_id) AS player,
            SUM(CASE
              WHEN m.winner='BLUE' AND EXISTS (
                SELECT 1 FROM json_each(m.blue_ids)
                WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)
              ) THEN 1
              WHEN m.winner='RED' AND EXISTS (
                SELECT 1 FROM json_each(m.red_ids)
                WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)
              ) THEN 1
              ELSE 0
            END) AS wins
          FROM rating_changes rc
          JOIN matches m ON m.match_id=rc.match_id
          LEFT JOIN ratings r ON r.player_id=rc.player_id
          WHERE m.status='completed'
          GROUP BY rc.player_id
          ORDER BY wins DESC, player COLLATE NOCASE
          LIMIT 1
        `), "wins");

        const mostMatches = player(one(`
          SELECT
            rc.player_id AS id,
            COALESCE(r.display_name, rc.player_id) AS player,
            COUNT(DISTINCT rc.match_id) AS games
          FROM rating_changes rc
          JOIN matches m ON m.match_id=rc.match_id
          LEFT JOIN ratings r ON r.player_id=rc.player_id
          WHERE m.status='completed'
          GROUP BY rc.player_id
          ORDER BY games DESC, player COLLATE NOCASE
          LIMIT 1
        `), "games");

        const mostMvps = player(one(`
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
            COUNT(DISTINCT match_id) AS mvps
          FROM mvp_identities
          WHERE identity IS NOT NULL AND identity!=''
          GROUP BY identity
          ORDER BY mvps DESC, player COLLATE NOCASE
          LIMIT 1
        `), "mvps");

        const highestMvpRate = player(one(`
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
            ROUND(100.0 * COALESCE(lm.mvp_games, 0) / pg.games, 1) AS mvp_pct,
            printf('%.1f%% MVP rate', ROUND(100.0 * COALESCE(lm.mvp_games, 0) / pg.games, 1)) AS display
          FROM player_games pg
          LEFT JOIN linked_mvps lm
            ON CAST(lm.player_id AS TEXT)=CAST(pg.player_id AS TEXT)
          LEFT JOIN ratings r
            ON CAST(r.player_id AS TEXT)=CAST(pg.player_id AS TEXT)
          WHERE pg.games >= 25
          ORDER BY mvp_pct DESC, COALESCE(lm.mvp_games, 0) DESC, games DESC, player COLLATE NOCASE
          LIMIT 1
        `), "mvp_pct");

        const longestWinStreak = player(one(`
          WITH player_games AS (
            SELECT
              rc.player_id,
              COALESCE(r.display_name, rc.player_id) AS player,
              m.created_at,
              CASE
                WHEN m.winner='BLUE' AND EXISTS (
                  SELECT 1 FROM json_each(m.blue_ids)
                  WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)
                ) THEN 1
                WHEN m.winner='RED' AND EXISTS (
                  SELECT 1 FROM json_each(m.red_ids)
                  WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)
                ) THEN 1
                ELSE 0
              END AS is_win
            FROM rating_changes rc
            JOIN matches m ON m.match_id=rc.match_id
            LEFT JOIN ratings r ON r.player_id=rc.player_id
            WHERE m.status='completed' AND m.winner IS NOT NULL
          ),
          marked AS (
            SELECT
              player_id,
              player,
              is_win,
              SUM(CASE WHEN is_win=0 THEN 1 ELSE 0 END)
                OVER (
                  PARTITION BY player_id
                  ORDER BY created_at
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS reset_group
            FROM player_games
          )
          SELECT
            player_id AS id,
            player,
            COUNT(*) AS wins
          FROM marked
          WHERE is_win=1
          GROUP BY player_id, player, reset_group
          ORDER BY wins DESC, player COLLATE NOCASE
          LIMIT 1
        `), "wins");

        const activeWinStreak = player(one(`
          WITH player_games AS (
            SELECT
              rc.player_id,
              COALESCE(r.display_name, rc.player_id) AS player,
              m.created_at,
              CASE
                WHEN m.winner='BLUE' AND EXISTS (
                  SELECT 1 FROM json_each(m.blue_ids)
                  WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)
                ) THEN 1
                WHEN m.winner='RED' AND EXISTS (
                  SELECT 1 FROM json_each(m.red_ids)
                  WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)
                ) THEN 1
                ELSE 0
              END AS is_win
            FROM rating_changes rc
            JOIN matches m ON m.match_id=rc.match_id
            LEFT JOIN ratings r ON r.player_id=rc.player_id
            WHERE m.status='completed' AND m.winner IS NOT NULL
          ),
          marked AS (
            SELECT
              player_id,
              player,
              created_at,
              is_win,
              SUM(CASE WHEN is_win=0 THEN 1 ELSE 0 END)
                OVER (
                  PARTITION BY player_id
                  ORDER BY created_at DESC
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS reset_group
            FROM player_games
          )
          SELECT
            player_id AS id,
            player,
            COUNT(*) AS wins
          FROM marked
          WHERE is_win=1 AND reset_group=0
          GROUP BY player_id, player
          ORDER BY wins DESC, player COLLATE NOCASE
          LIMIT 1
        `), "wins");

        const biggest30dEloSurge = player(one(`
          SELECT
            rc.player_id AS id,
            COALESCE(r.display_name, rc.player_id) AS player,
            SUM(rc.delta) AS delta
          FROM rating_changes rc
          JOIN matches m ON m.match_id=rc.match_id
          LEFT JOIN ratings r ON r.player_id=rc.player_id
          WHERE m.status='completed'
            AND m.created_at >= ?
            AND rc.match_id NOT LIKE 'admin-%'
            AND ABS(COALESCE(rc.delta, 0)) <= 500
            AND COALESCE(m.map_name, '') NOT LIKE '%Admin Adjustment%'
          GROUP BY rc.player_id
          HAVING ABS(delta) <= 500
          ORDER BY delta DESC, player COLLATE NOCASE
          LIMIT 1
        `, [cutoff30d]), "delta");

        return {
          summary: {
            totalMatches: Number(summaryRow.totalMatches || 0),
            firstMatchAt: summaryRow.firstMatchAt ? Number(summaryRow.firstMatchAt) : null,
            uniquePlayers: Number(playerRow.uniquePlayers || 0),
            uniquePlayers30d: Number(playerRow.uniquePlayers30d || 0),
            matches1d: Number(summaryRow.matches1d || 0),
            matches7d: Number(summaryRow.matches7d || 0),
            matches30d: Number(summaryRow.matches30d || 0)
          },
          playerLegends: [
            mostMatches && { label: "The Grinder", ...mostMatches, unit: "matches" },
            mostWins && { label: "The Kingmaker", ...mostWins, unit: "wins" },
            mostMvps && { label: "The Closer", ...mostMvps, unit: "MVPs" },
            highestMvpRate && { label: "The Specialist", ...highestMvpRate, unit: "% MVP rate" },
            (activeWinStreak || longestWinStreak) && { label: "The Hot Hand", ...(activeWinStreak || longestWinStreak), unit: "wins" },
            biggest30dEloSurge && { label: "The Rocket", ...biggest30dEloSurge, unit: "Elo" }
          ].filter(Boolean)
        };
      });

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/home]", e);
      sendError(res, 500, "home_failed");
    }
  });

  return router;
}

module.exports = { createHomeRouter };
