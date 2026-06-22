"use strict";

const express = require("express");

function createHomeRouter({ db, cached, logRouteError, sendError }) {
  const router = express.Router();

  function timed(label, fn) {
    console.time(label);
    try {
      return fn();
    } finally {
      console.timeEnd(label);
    }
  }

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

  function parseIdSet(value) {
    try {
      const parsed = JSON.parse(value || "[]");
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function teamFor(row) {
    const playerId = String(row.id);
    if (parseIdSet(row.blue_ids).has(playerId)) return "BLUE";
    if (parseIdSet(row.red_ids).has(playerId)) return "RED";
    return null;
  }

  router.get("/home", (req, res) => {
    console.time("home:total");
    try {
      const data = cached("home_v2_pass7", () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff1d = now - 86400;
        const cutoff7d = now - (7 * 86400);
        const cutoff30d = now - (30 * 86400);

        const summaryRow = timed("home:summary", () => one(`
          SELECT
            COUNT(*) AS totalMatches,
            MIN(created_at) AS firstMatchAt,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches1d,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches7d,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches30d
          FROM matches
          WHERE status='completed'
        `, [cutoff1d, cutoff7d, cutoff30d]) || {});

        const playerRow = timed("home:players", () => one(`
          SELECT
            (SELECT COUNT(DISTINCT player_id) FROM ratings) AS uniquePlayers,
            (
              SELECT COUNT(DISTINCT rc.player_id)
              FROM rating_changes rc
              JOIN matches m ON m.match_id=rc.match_id
              WHERE m.status='completed' AND m.created_at >= ?
            ) AS uniquePlayers1d,
            (
              SELECT COUNT(DISTINCT rc.player_id)
              FROM rating_changes rc
              JOIN matches m ON m.match_id=rc.match_id
              WHERE m.status='completed' AND m.created_at >= ?
            ) AS uniquePlayers7d,
            (
              SELECT COUNT(DISTINCT rc.player_id)
              FROM rating_changes rc
              JOIN matches m ON m.match_id=rc.match_id
              WHERE m.status='completed' AND m.created_at >= ?
            ) AS uniquePlayers30d
        `, [cutoff1d, cutoff7d, cutoff30d]) || {});

        const playerGames = timed("home:playerGames", () => db.prepare(`
          SELECT
            rc.player_id AS id,
            COALESCE(r.display_name, rc.player_id) AS player,
            m.created_at,
            m.winner,
            m.blue_ids,
            m.red_ids
          FROM rating_changes rc
          JOIN matches m ON m.match_id=rc.match_id
          LEFT JOIN ratings r ON r.player_id=rc.player_id
          WHERE m.status='completed'
          ORDER BY rc.player_id, m.created_at
        `).all());

        const mostWins = timed("home:mostWins", () => {
          const byPlayer = new Map();
          for (const row of playerGames) {
            const id = String(row.id);
            const stat = byPlayer.get(id) || { id, player: row.player, wins: 0 };
            const team = teamFor(row);
            if (team && row.winner === team) stat.wins += 1;
            byPlayer.set(id, stat);
          }
          return player([...byPlayer.values()].sort((a, b) =>
            b.wins - a.wins || String(a.player).localeCompare(String(b.player))
          )[0], "wins");
        });

        const mostMatches = timed("home:mostMatches", () => {
          const byPlayer = new Map();
          for (const row of playerGames) {
            const id = String(row.id);
            const stat = byPlayer.get(id) || { id, player: row.player, games: 0 };
            stat.games += 1;
            byPlayer.set(id, stat);
          }
          return player([...byPlayer.values()].sort((a, b) =>
            b.games - a.games || String(a.player).localeCompare(String(b.player))
          )[0], "games");
        });

        const mostMvps = timed("home:mostMvps", () => player(one(`
          WITH mvp_identities AS (
            SELECT
              m.match_id,
              COALESCE(
                COALESCE(psi_key.discord_id, psi_sid.discord_id),
                m.mvp_player_key,
                m.steam_id,
                LOWER(TRIM(m.mvp_display_name))
              ) AS identity,
              COALESCE(psi_key.discord_id, psi_sid.discord_id) AS player_id,
              COALESCE(r.display_name, m.mvp_display_name, m.mvp_player_key, m.steam_id) AS player
            FROM match_round_mvps m
            LEFT JOIN player_steam_ids psi_key ON psi_key.steam_id=m.mvp_player_key
            LEFT JOIN player_steam_ids psi_sid ON psi_sid.steam_id=m.steam_id
            LEFT JOIN ratings r ON r.player_id=COALESCE(psi_key.discord_id,psi_sid.discord_id)
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
        `), "mvps"));

        const highestMvpRate = timed("home:highestMvpRate", () => player(one(`
          WITH linked_mvps AS (
            SELECT
                COALESCE(psi_key.discord_id,psi_sid.discord_id) AS player_id,
                COUNT(DISTINCT m.match_id) AS mvp_games
              FROM match_round_mvps m
              LEFT JOIN player_steam_ids psi_key ON psi_key.steam_id=m.mvp_player_key
              LEFT JOIN player_steam_ids psi_sid ON psi_sid.steam_id=m.steam_id
              WHERE COALESCE(psi_key.discord_id,psi_sid.discord_id) IS NOT NULL
              GROUP BY COALESCE(psi_key.discord_id,psi_sid.discord_id)
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
            ON lm.player_id=pg.player_id
          LEFT JOIN ratings r
            ON r.player_id=pg.player_id
          WHERE pg.games >= 25
          ORDER BY mvp_pct DESC, COALESCE(lm.mvp_games, 0) DESC, games DESC, player COLLATE NOCASE
          LIMIT 1
        `), "mvp_pct"));

        const longestWinStreak = timed("home:longestWinStreak", () => {
          const byPlayer = new Map();
          for (const row of playerGames) {
            if (!row.winner) continue;
            const id = String(row.id);
            const stat = byPlayer.get(id) || { id, player: row.player, current: 0, best: 0 };
            const team = teamFor(row);
            if (team && row.winner === team) {
              stat.current += 1;
              stat.best = Math.max(stat.best, stat.current);
            } else {
              stat.current = 0;
            }
            byPlayer.set(id, stat);
          }
          return player([...byPlayer.values()].map(row => ({
            id: row.id,
            player: row.player,
            wins: row.best
          })).filter(row => row.wins > 0).sort((a, b) =>
            b.wins - a.wins || String(a.player).localeCompare(String(b.player))
          )[0], "wins");
        });

        const activeWinStreak = timed("home:activeWinStreak", () => {
          const byPlayer = new Map();
          for (const row of playerGames) {
            if (!row.winner) continue;
            const id = String(row.id);
            const list = byPlayer.get(id) || [];
            list.push(row);
            byPlayer.set(id, list);
          }
          const rows = [];
          for (const [id, games] of byPlayer) {
            let wins = 0;
            const sorted = [...games].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
            for (const row of sorted) {
              const team = teamFor(row);
              if (team && row.winner === team) wins += 1;
              else break;
            }
            if (wins > 0) rows.push({ id, player: sorted[0]?.player || id, wins });
          }
          return player(rows.sort((a, b) =>
            b.wins - a.wins || String(a.player).localeCompare(String(b.player))
          )[0], "wins");
        });

        const biggest30dEloSurge = timed("home:biggest30dEloSurge", () => player(one(`
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
        `, [cutoff30d]), "delta"));

        return {
          summary: {
            totalMatches: Number(summaryRow.totalMatches || 0),
            firstMatchAt: summaryRow.firstMatchAt ? Number(summaryRow.firstMatchAt) : null,
            uniquePlayers: Number(playerRow.uniquePlayers || 0),
            uniquePlayers1d: Number(playerRow.uniquePlayers1d || 0),
            uniquePlayers7d: Number(playerRow.uniquePlayers7d || 0),
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
    } finally {
      console.timeEnd("home:total");
    }
  });

  return router;
}

module.exports = { createHomeRouter };
