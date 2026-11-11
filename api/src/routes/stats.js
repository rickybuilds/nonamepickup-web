"use strict";

const express = require("express");
const { loadDefenseRatings } = require("../lib/defenseRatings");
const { loadDiscordDisplayNames } = require("../lib/discordDisplayNames");

function createStatsRouter({ db, cached, cachedFor, statsSummaryStmt, sendError, logRouteError }) {
  const router = express.Router();

  router.get("/stats/defense-ratings", (req, res) => {
    try {
      const data = cachedFor("defense_ratings_estimated_v3", 5 * 60 * 1000, () => loadDefenseRatings(db));
      res.json({ ok: true, data });
    } catch (error) {
      logRouteError("[/api/stats/defense-ratings]", error);
      sendError(res, 500, "defense_ratings_failed");
    }
  });

  router.get("/stats/capture-ratings", (req, res) => {
    try {
      const data = cached("capture_ratings_discord_v3", () => {
        const matches = db.prepare(`
          SELECT match_id, created_at, map_name, blue_ids, red_ids
          FROM matches
          WHERE status='completed' AND map_name IS NOT NULL AND TRIM(map_name) != ''
            AND map_name != '(unknown)'
        `).all();
        const stats = db.prepare(`
          SELECT s.match_id, s.player_key, s.steam_id, s.flag_captures,
            pk.discord_id AS key_id, sid.discord_id AS steam_id_link
          FROM match_player_stats s
          JOIN matches m ON m.match_id=s.match_id AND m.status='completed'
          LEFT JOIN player_steam_ids pk ON pk.steam_id=s.player_key
          LEFT JOIN player_steam_ids sid ON sid.steam_id=s.steam_id
        `).all();
        const names = loadDiscordDisplayNames(db);
        const byMatch = new Map();
        for (const row of stats) {
          if (!byMatch.has(row.match_id)) byMatch.set(row.match_id, []);
          byMatch.get(row.match_id).push(row);
        }
        const maps = new Map();
        for (const match of matches) {
          let blue, red;
          try {
            blue = JSON.parse(match.blue_ids);
            red = JSON.parse(match.red_ids);
          } catch { continue; }
          if (!Array.isArray(blue) || !Array.isArray(red) || !blue.length || !red.length) continue;
          blue = blue.map(String); red = red.map(String);
          const roster = [...blue, ...red];
          if (new Set(roster).size !== roster.length) continue;
          const players = new Map();
          let valid = true;
          for (const row of byMatch.get(match.match_id) || []) {
            const candidates = [...new Set([row.key_id, row.steam_id_link, row.player_key]
              .filter(value => value != null && roster.includes(String(value))).map(String))];
            const captures = Number(row.flag_captures);
            if (candidates.length !== 1 || row.flag_captures == null || !Number.isInteger(captures) || captures < 0 || players.has(candidates[0])) {
              valid = false; break;
            }
            players.set(candidates[0], captures);
          }
          if (!valid || players.size !== roster.length) continue;
          const blueCaps = blue.reduce((sum, id) => sum + players.get(id), 0);
          const redCaps = red.reduce((sum, id) => sum + players.get(id), 0);
          if (!maps.has(match.map_name)) maps.set(match.map_name, { map: match.map_name, games: 0, totalCaps: 0, players: new Map(), observations: [] });
          const map = maps.get(match.map_name);
          map.games++; map.totalCaps += blueCaps + redCaps;
          // One observation per eligible match, independent of roster size.
          map.observations.push({
            matchId: String(match.match_id),
            createdAt: match.created_at == null || !Number.isFinite(Number(match.created_at)) ? null : Number(match.created_at),
            blueCaps, redCaps
          });
          for (const [team, scored, conceded] of [[blue, blueCaps, redCaps], [red, redCaps, blueCaps]]) {
            for (const id of team) {
              if (!map.players.has(id)) map.players.set(id, { id, player: names.get(id) || `Discord user ${id}`, games: 0, scored: 0, conceded: 0 });
              const player = map.players.get(id);
              player.games++; player.scored += scored; player.conceded += conceded;
            }
          }
        }
        return [...maps.values()].map(map => {
          const average = map.totalCaps / (map.games * 2);
          return { map: map.map, games: map.games, average,
            observations: map.observations.sort((a, b) =>
              (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity) || a.matchId.localeCompare(b.matchId)),
            players: [...map.players.values()].map(player => ({
            id: player.id, player: player.player, games: player.games,
            scored: player.scored / player.games, conceded: player.conceded / player.games,
            offense: player.scored / player.games - average,
            defense: average - player.conceded / player.games,
            net: (player.scored - player.conceded) / player.games
          })) };
        }).sort((a, b) => b.games - a.games || a.map.localeCompare(b.map));
      });
      res.json({ ok: true, data });
    } catch (error) {
      logRouteError("[/api/stats/capture-ratings]", error);
      sendError(res, 500, "capture_ratings_failed");
    }
  });

  router.get("/stats/mostGamesAndTies", (req, res) => {
    try {
      const data = cached("stats_most_games_24h_v2", () => {
        const rows = db.prepare(`
          SELECT
            rc.player_id AS id,
            COALESCE(r.display_name, rc.player_id) AS player,
            date(datetime(m.created_at, 'unixepoch', '-6 hours')) AS day,
            COUNT(DISTINCT m.match_id) AS games
          FROM rating_changes rc
          JOIN matches m ON m.match_id = rc.match_id
          LEFT JOIN ratings r ON r.player_id = rc.player_id
          WHERE m.status = 'completed'
          GROUP BY rc.player_id, day
          HAVING games = (
            SELECT MAX(cnt) FROM (
              SELECT COUNT(DISTINCT m2.match_id) AS cnt
              FROM rating_changes rc2
              JOIN matches m2 ON m2.match_id = rc2.match_id
              WHERE m2.status = 'completed'
              GROUP BY rc2.player_id, date(datetime(m2.created_at, 'unixepoch', '-6 hours'))
            )
          )
          ORDER BY games DESC, player COLLATE NOCASE
        `).all();

        return {
          mostGames: rows.map(row => ({
            id: row.id == null ? null : String(row.id),
            player: row.player || "Unknown",
            count: Number(row.games || 0),
            date: row.day
          }))
        };
      });

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/stats/mostGamesAndTies]", e);
      sendError(res, 500, "stats_mostGamesAndTies_failed");
    }
  });

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
                  COALESCE(psi_key.discord_id, psi_sid.discord_id),
                  m.mvp_player_key,
                  m.steam_id,
                  LOWER(TRIM(m.mvp_display_name))
                ) AS identity,
                COALESCE(psi_key.discord_id, psi_sid.discord_id) AS player_id,
                COALESCE(r.display_name, m.mvp_display_name, m.mvp_player_key, m.steam_id) AS player
              FROM canonical_match_mvps m
              LEFT JOIN player_steam_ids psi_key ON psi_key.steam_id=m.mvp_player_key
              LEFT JOIN player_steam_ids psi_sid ON psi_sid.steam_id=m.steam_id
              LEFT JOIN ratings r ON r.player_id=COALESCE(psi_key.discord_id,psi_sid.discord_id)
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
                COALESCE(psi_key.discord_id,psi_sid.discord_id) AS player_id,
                COUNT(DISTINCT m.match_id) AS mvp_games
              FROM canonical_match_mvps m
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
              pg.games,
              COALESCE(lm.mvp_games, 0) AS mvp_games,
              ROUND(100.0 * COALESCE(lm.mvp_games, 0) / pg.games, 1) AS mvp_pct
            FROM player_games pg
            LEFT JOIN linked_mvps lm
              ON lm.player_id=pg.player_id
            LEFT JOIN ratings r
              ON r.player_id=pg.player_id
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
              WHEN UPPER(winner) = 'TIE'
                OR ABS(score_blue - score_red) < 25
              THEN 1 ELSE 0
            END
          ) AS closeGames,
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
      const data = cached("stats_streaks", () => {
        const cutoff45d = Math.floor(Date.now() / 1000) - 45 * 86400;
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
            AND m.created_at >= ?
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
      `).all(cutoff45d);

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
      });

      res.json({ ok: true, data });
    } catch (e) {
      logRouteError("[/api/stats/streaks]", e);
      sendError(res, 500, "stats_streaks_failed");
    }
  });

  return router;
}

module.exports = { createStatsRouter };
