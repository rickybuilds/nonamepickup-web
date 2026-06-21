"use strict";

const express = require("express");
const { safePublicUrl } = require("../helpers/urls");

const IDENTITY_CTES = `
  WITH steam_links AS (
    SELECT steam_id, MAX(discord_id) AS discord_id
    FROM player_steam_ids
    WHERE steam_id IS NOT NULL AND steam_id != ''
    GROUP BY steam_id
  ),
  player_stats AS (
    SELECT
      s.*,
      COALESCE(pk.discord_id, sid.discord_id) AS player_id,
      COALESCE(
        r.display_name,
        s.display_name,
        s.player_key,
        s.steam_id,
        'Unknown'
      ) AS player,
      COALESCE(
        pk.discord_id,
        sid.discord_id,
        NULLIF(s.player_key, ''),
        NULLIF(s.steam_id, ''),
        LOWER(TRIM(s.display_name))
      ) AS identity
    FROM match_player_stats s
    LEFT JOIN steam_links pk ON pk.steam_id = s.player_key
    LEFT JOIN steam_links sid ON sid.steam_id = s.steam_id
    LEFT JOIN ratings r ON r.player_id = COALESCE(pk.discord_id, sid.discord_id)
  ),
  round_stats AS (
    SELECT
      s.*,
      COALESCE(pk.discord_id, sid.discord_id) AS player_id,
      COALESCE(
        r.display_name,
        s.display_name,
        s.player_key,
        s.steam_id,
        'Unknown'
      ) AS player,
      COALESCE(
        pk.discord_id,
        sid.discord_id,
        NULLIF(s.player_key, ''),
        NULLIF(s.steam_id, ''),
        LOWER(TRIM(s.display_name))
      ) AS identity
    FROM match_player_round_stats s
    LEFT JOIN steam_links pk ON pk.steam_id = s.player_key
    LEFT JOIN steam_links sid ON sid.steam_id = s.steam_id
    LEFT JOIN ratings r ON r.player_id = COALESCE(pk.discord_id, sid.discord_id)
  ),
  match_stats AS (
    SELECT
      MAX(player_id) AS player_id,
      MAX(player) AS player,
      identity,
      match_id,
      SUM(COALESCE(kills, 0)) AS kills,
      SUM(COALESCE(deaths_by_enemy, 0) + COALESCE(deaths_by_team, 0) + COALESCE(suicides, 0)) AS deaths,
      SUM(COALESCE(enemy_damage, 0)) AS enemy_damage,
      SUM(COALESCE(team_damage, 0)) AS team_damage,
      SUM(COALESCE(team_kills, 0)) AS team_kills,
      SUM(COALESCE(suicides, 0)) AS suicides,
      SUM(COALESCE(flag_captures, 0)) AS flag_captures,
      SUM(COALESCE(flag_touches, 0)) AS flag_touches,
      SUM(COALESCE(initial_touches, 0)) AS initial_touches,
      SUM(COALESCE(flag_time_seconds, 0)) AS flag_time_seconds,
      SUM(COALESCE(conc_jumps, 0)) AS conc_jumps
    FROM round_stats
    WHERE identity IS NOT NULL AND identity != ''
    GROUP BY identity, match_id
  )
`;

const MVP_CTES = `
  WITH steam_links AS (
    SELECT steam_id, MAX(discord_id) AS discord_id
    FROM player_steam_ids
    WHERE steam_id IS NOT NULL AND steam_id != ''
    GROUP BY steam_id
  ),
  mvp_rows AS (
    SELECT
      m.match_id,
      COALESCE(pk.discord_id, sid.discord_id) AS player_id,
      COALESCE(
        r.display_name,
        m.mvp_display_name,
        m.mvp_player_key,
        m.steam_id,
        'Unknown'
      ) AS player,
      COALESCE(
        pk.discord_id,
        sid.discord_id,
        NULLIF(m.mvp_player_key, ''),
        NULLIF(m.steam_id, ''),
        LOWER(TRIM(m.mvp_display_name))
      ) AS identity
    FROM match_round_mvps m
    LEFT JOIN steam_links pk ON pk.steam_id = m.mvp_player_key
    LEFT JOIN steam_links sid ON sid.steam_id = m.steam_id
    LEFT JOIN ratings r ON r.player_id = COALESCE(pk.discord_id, sid.discord_id)
  )
`;

function createAnalyticsRouter({ db, cachedFor, positiveInt, sendError, logRouteError }) {
  const router = express.Router();

  function leaders(sql, ...params) {
    return db.prepare(sql).all(...params).map(row => ({
      id: row.player_id == null ? null : String(row.player_id),
      player: row.player || "Unknown",
      value: Number(row.value || 0),
      secondary: row.secondary == null ? null : Number(row.secondary || 0),
      matches: row.matches == null ? null : Number(row.matches || 0),
      match_id: row.match_id == null ? null : String(row.match_id),
      round_num: row.round_num == null ? null : Number(row.round_num || 0),
      map: row.map_name || null,
      hampalyzer_url: safePublicUrl(row.hampalyzer_url),
      tfcstats_url: safePublicUrl(row.tfcstats_url)
    }));
  }

  router.get("/analytics", (req, res) => {
    try {
      const limit = positiveInt(req.query.limit, 5, 1, 10);
      const payload = cachedFor(`analytics:${limit}`, 300_000, () => {
        const summary = db.prepare(`
          SELECT
            (SELECT COUNT(*) FROM matches WHERE status = 'completed') AS matches,
            (SELECT COUNT(DISTINCT identity) FROM (
              SELECT COALESCE(
                COALESCE(psi_key.discord_id, psi_sid.discord_id),
                NULLIF(s.player_key, ''),
                NULLIF(s.steam_id, ''),
                LOWER(TRIM(s.display_name))
              ) AS identity
              FROM match_player_stats s
              LEFT JOIN player_steam_ids psi_key ON psi_key.steam_id = s.player_key
              LEFT JOIN player_steam_ids psi_sid ON psi_sid.steam_id = s.steam_id
            ) WHERE identity IS NOT NULL AND identity != '') AS players,
            (SELECT COUNT(*) FROM match_player_round_stats) AS player_rounds
        `).get();

        const mvps = leaders(`${MVP_CTES}
          SELECT
            MAX(player_id) AS player_id,
            MAX(player) AS player,
            COUNT(DISTINCT match_id) AS value
          FROM mvp_rows
          WHERE identity IS NOT NULL AND identity != ''
          GROUP BY identity
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit);

        const mvpRate = leaders(`${MVP_CTES},
          player_games AS (
            SELECT
              COALESCE(pk.discord_id, sid.discord_id) AS player_id,
              COALESCE(
                r.display_name,
                s.display_name,
                s.player_key,
                s.steam_id,
                'Unknown'
              ) AS player,
              COALESCE(
                pk.discord_id,
                sid.discord_id,
                NULLIF(s.player_key, ''),
                NULLIF(s.steam_id, ''),
                LOWER(TRIM(s.display_name))
              ) AS identity,
              COUNT(DISTINCT s.match_id) AS games
            FROM match_player_stats s
            LEFT JOIN steam_links pk ON pk.steam_id = s.player_key
            LEFT JOIN steam_links sid ON sid.steam_id = s.steam_id
            LEFT JOIN ratings r ON r.player_id = COALESCE(pk.discord_id, sid.discord_id)
            GROUP BY identity
          )
          SELECT
            MAX(pg.player_id) AS player_id,
            MAX(pg.player) AS player,
            ROUND(100.0 * COUNT(DISTINCT mr.match_id) / NULLIF(MAX(pg.games), 0), 2) AS value,
            COUNT(DISTINCT mr.match_id) AS secondary,
            MAX(pg.games) AS matches
          FROM player_games pg
          LEFT JOIN mvp_rows mr ON mr.identity = pg.identity
          WHERE pg.identity IS NOT NULL AND pg.identity != ''
          GROUP BY pg.identity
          HAVING MAX(pg.games) >= 25
          ORDER BY value DESC, secondary DESC, matches DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit);

        const totalsQuery = (expression, extra = "") => leaders(`${IDENTITY_CTES}
          SELECT
            MAX(player_id) AS player_id,
            MAX(player) AS player,
            ${expression} AS value,
            COUNT(DISTINCT match_id) AS matches
          FROM player_stats
          WHERE identity IS NOT NULL AND identity != '' ${extra}
          GROUP BY identity
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit);

        const roundRecordQuery = expression => leaders(`${IDENTITY_CTES}
          SELECT
            player_id,
            player,
            ${expression} AS value,
            match_id,
            round_num,
            m.map_name,
            m.hampalyzer_url,
            m.tfcstats_url
          FROM round_stats
          LEFT JOIN matches m USING (match_id)
          WHERE identity IS NOT NULL AND identity != ''
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit);

        const matchRecordQuery = (expression, having = "") => leaders(`${IDENTITY_CTES}
          SELECT
            ms.player_id,
            ms.player,
            ${expression} AS value,
            ms.match_id,
            m.map_name,
            m.hampalyzer_url,
            m.tfcstats_url
          FROM match_stats ms
          LEFT JOIN matches m USING (match_id)
          ${having}
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit);

        const roleQuery = side => {
          const teamColumn = side === "offense" ? "offense_team" : "defense_team";
          return db.prepare(`${IDENTITY_CTES}
          SELECT
            MAX(player_id) AS player_id,
            MAX(player) AS player,
            SUM(enemy_damage) AS value,
            SUM(kills) AS secondary,
            COUNT(DISTINCT rs.match_id) AS matches
          FROM round_stats rs
          JOIN match_rounds mr
            ON mr.match_id = rs.match_id
           AND mr.round_num = rs.round_num
          WHERE identity IS NOT NULL
            AND identity != ''
            AND LOWER(TRIM(rs.team_name)) = LOWER(TRIM(mr.${teamColumn}))
          GROUP BY identity
          ORDER BY value DESC, secondary DESC, player COLLATE NOCASE
          LIMIT ?
        `).all(limit).map(row => ({
            id: row.player_id == null ? null : String(row.player_id),
            player: row.player || "Unknown",
            value: Number(row.value || 0),
            secondary: Number(row.secondary || 0),
            matches: Number(row.matches || 0)
          }));
        };

        const roundClassQuery = (className, expression) => leaders(`${IDENTITY_CTES}
          SELECT
            MAX(player_id) AS player_id,
            MAX(player) AS player,
            ${expression} AS value,
            COUNT(DISTINCT match_id) AS matches
          FROM round_stats
          WHERE identity IS NOT NULL
            AND identity != ''
            AND LOWER(COALESCE(role, '')) LIKE LOWER(?)
          GROUP BY identity
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, `%${className}%`, limit);

        const offensiveQuery = expression => leaders(`${IDENTITY_CTES}
          SELECT
            MAX(player_id) AS player_id,
            MAX(player) AS player,
            ${expression} AS value,
            COUNT(DISTINCT rs.match_id) AS matches
          FROM round_stats rs
          JOIN match_rounds mr
            ON mr.match_id = rs.match_id
           AND mr.round_num = rs.round_num
          WHERE identity IS NOT NULL
            AND identity != ''
            AND LOWER(TRIM(rs.team_name)) = LOWER(TRIM(mr.offense_team))
          GROUP BY identity
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit);

        const dispenserKills = leaders(`${IDENTITY_CTES}
          SELECT
            MAX(ps.player_id) AS player_id,
            MAX(ps.player) AS player,
            SUM(w.kills) AS value,
            COUNT(DISTINCT w.match_id) AS matches
          FROM match_player_weapons w
          LEFT JOIN player_stats ps
            ON ps.match_id = w.match_id
           AND ps.player_key = w.player_key
          WHERE COALESCE(ps.identity, NULLIF(w.player_key, '')) IS NOT NULL
            AND COALESCE(ps.identity, NULLIF(w.player_key, '')) != ''
            AND w.weapon = 'weapon-16'
          GROUP BY COALESCE(ps.identity, w.player_key)
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit);

        const classQuery = (className, expression) => leaders(`${IDENTITY_CTES}
          SELECT
            MAX(player_id) AS player_id,
            MAX(player) AS player,
            ${expression} AS value,
            COUNT(DISTINCT match_id) AS matches
          FROM player_stats
          WHERE identity IS NOT NULL
            AND identity != ''
            AND LOWER(COALESCE(main_class, '')) = '${className}'
          GROUP BY identity
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit);

        return {
          ok: true,
          data: {
            generated_at: Math.floor(Date.now() / 1000),
            limit,
            summary: {
              matches: Number(summary.matches || 0),
              players: Number(summary.players || 0),
              player_rounds: Number(summary.player_rounds || 0)
            },
            mvps,
            mvp_rate: mvpRate,
            combat: {
              games: totalsQuery("COUNT(DISTINCT match_id)"),
              kills: totalsQuery("SUM(kills)"),
              enemy_damage: totalsQuery("SUM(enemy_damage)"),
              kdr: leaders(`${IDENTITY_CTES}
                SELECT
                  MAX(player_id) AS player_id,
                  MAX(player) AS player,
                  ROUND(CAST(SUM(kills) AS REAL) / NULLIF(SUM(deaths), 0), 2) AS value,
                  SUM(kills) AS secondary,
                  COUNT(DISTINCT match_id) AS matches
                FROM player_stats
                WHERE identity IS NOT NULL AND identity != ''
                GROUP BY identity
                HAVING SUM(deaths) > 0 AND COUNT(DISTINCT match_id) >= 25
                ORDER BY value DESC, secondary DESC, player COLLATE NOCASE
                LIMIT ?
              `, limit),
              round_kills: roundRecordQuery("kills"),
              round_damage: roundRecordQuery("enemy_damage")
            },
            flags: {
              caps: totalsQuery("SUM(flag_captures)"),
              touches: totalsQuery("SUM(flag_touches)"),
              initial_touches: totalsQuery("SUM(initial_touches)"),
              flag_time: totalsQuery("SUM(flag_time_seconds)"),
              conversion: leaders(`${IDENTITY_CTES}
                SELECT
                  MAX(player_id) AS player_id,
                  MAX(player) AS player,
                  ROUND(100.0 * SUM(flag_captures) / NULLIF(SUM(initial_touches), 0), 1) AS value,
                  SUM(flag_captures) AS secondary,
                  COUNT(DISTINCT match_id) AS matches
                FROM player_stats
                WHERE identity IS NOT NULL AND identity != ''
                GROUP BY identity
                HAVING SUM(initial_touches) >= 10
                ORDER BY value DESC, secondary DESC, player COLLATE NOCASE
                LIMIT ?
              `, limit)
            },
            roles: {
              soldier_damage: classQuery("soldier", "SUM(enemy_damage)"),
              soldier_kills: classQuery("soldier", "SUM(kills)"),
              hwguy_damage: roundClassQuery("HWGuy", "SUM(enemy_damage)"),
              hwguy_kills: roundClassQuery("HWGuy", "SUM(kills)"),
              demoman_damage: roundClassQuery("Demoman", "SUM(enemy_damage)"),
              demoman_kills: roundClassQuery("Demoman", "SUM(kills)"),
              engineer_kills: roundClassQuery("Engineer", "SUM(kills)"),
              medic_caps: classQuery("medic", "SUM(flag_captures)"),
              medic_touches: classQuery("medic", "SUM(flag_touches)"),
              scout_caps: classQuery("scout", "SUM(flag_captures)"),
              scout_touches: classQuery("scout", "SUM(flag_touches)"),
              engineer_sentry_kills: leaders(`${IDENTITY_CTES}
                SELECT
                  MAX(player_id) AS player_id,
                  MAX(player) AS player,
                  SUM(sentry_kills) AS value,
                  COUNT(DISTINCT match_id) AS matches
                FROM round_stats
                WHERE identity IS NOT NULL AND identity != ''
                GROUP BY identity
                ORDER BY value DESC, player COLLATE NOCASE
                LIMIT ?
              `, limit),
              dispenser_kills: dispenserKills,
              defense: roleQuery("defense"),
              offense: roleQuery("offense"),
              offensive_flag_captures: offensiveQuery("SUM(flag_captures)"),
              offensive_flag_touches: offensiveQuery("SUM(flag_touches)"),
              offensive_initial_touches: offensiveQuery("SUM(initial_touches)"),
              offensive_flag_time: offensiveQuery("SUM(flag_time_seconds)"),
              offensive_damage: offensiveQuery("SUM(enemy_damage)")
            },
            rounds: {
              kills: roundRecordQuery("kills"),
              damage: roundRecordQuery("enemy_damage"),
              caps: roundRecordQuery("flag_captures"),
              touches: roundRecordQuery("flag_touches"),
              initial_touches: roundRecordQuery("initial_touches"),
              flag_time: roundRecordQuery("flag_time_seconds"),
              conc_jumps: roundRecordQuery("conc_jumps"),
              suicides: roundRecordQuery("suicides"),
              team_kills: roundRecordQuery("team_kills"),
              team_damage: roundRecordQuery("team_damage")
            },
            matches: {
              kills: matchRecordQuery("ms.kills"),
              enemy_damage: matchRecordQuery("ms.enemy_damage"),
              caps: matchRecordQuery("ms.flag_captures"),
              touches: matchRecordQuery("ms.flag_touches"),
              initial_touches: matchRecordQuery("ms.initial_touches"),
              flag_time: matchRecordQuery("ms.flag_time_seconds"),
              conc_jumps: matchRecordQuery("ms.conc_jumps"),
              suicides: matchRecordQuery("ms.suicides"),
              team_kills: matchRecordQuery("ms.team_kills"),
              team_damage: matchRecordQuery("ms.team_damage"),
              deaths: matchRecordQuery("ms.deaths"),
              kdr: matchRecordQuery(
                "ROUND(CAST(ms.kills AS REAL) / NULLIF(ms.deaths, 0), 2)",
                "WHERE ms.kills >= 10 AND ms.deaths > 0"
              )
            },
            chaos: {
              suicides: leaders(`${IDENTITY_CTES}
                SELECT MAX(player_id) AS player_id, MAX(player) AS player,
                       SUM(suicides) AS value, COUNT(DISTINCT match_id) AS matches
                FROM round_stats
                WHERE identity IS NOT NULL AND identity != ''
                GROUP BY identity
                ORDER BY value DESC, player COLLATE NOCASE
                LIMIT ?
              `, limit),
              team_kills: leaders(`${IDENTITY_CTES}
                SELECT MAX(player_id) AS player_id, MAX(player) AS player,
                       SUM(team_kills) AS value, COUNT(DISTINCT match_id) AS matches
                FROM round_stats
                WHERE identity IS NOT NULL AND identity != ''
                GROUP BY identity
                ORDER BY value DESC, player COLLATE NOCASE
                LIMIT ?
              `, limit),
              team_damage: totalsQuery("SUM(team_damage)"),
              deaths: totalsQuery("SUM(deaths)"),
              worst_kdr: leaders(`${IDENTITY_CTES}
                SELECT MAX(player_id) AS player_id, MAX(player) AS player,
                       ROUND(CAST(SUM(kills) AS REAL) / NULLIF(SUM(deaths), 0), 2) AS value,
                       SUM(kills) + SUM(deaths) AS secondary,
                       COUNT(DISTINCT match_id) AS matches
                FROM player_stats
                WHERE identity IS NOT NULL AND identity != ''
                GROUP BY identity
                HAVING SUM(deaths) > 0 AND SUM(kills) + SUM(deaths) >= 25
                ORDER BY value ASC, secondary DESC, player COLLATE NOCASE
                LIMIT ?
              `, limit),
              team_kills_per_match: leaders(`${IDENTITY_CTES}
                SELECT MAX(player_id) AS player_id, MAX(player) AS player,
                       ROUND(CAST(SUM(team_kills) AS REAL) / NULLIF(COUNT(DISTINCT match_id), 0), 2) AS value,
                       COUNT(DISTINCT match_id) AS matches
                FROM round_stats
                WHERE identity IS NOT NULL AND identity != ''
                GROUP BY identity
                HAVING COUNT(DISTINCT match_id) >= 10
                ORDER BY value DESC, player COLLATE NOCASE
                LIMIT ?
              `, limit),
              suicides_per_match: leaders(`${IDENTITY_CTES}
                SELECT MAX(player_id) AS player_id, MAX(player) AS player,
                       ROUND(CAST(SUM(suicides) AS REAL) / NULLIF(COUNT(DISTINCT match_id), 0), 2) AS value,
                       COUNT(DISTINCT match_id) AS matches
                FROM round_stats
                WHERE identity IS NOT NULL AND identity != ''
                GROUP BY identity
                HAVING COUNT(DISTINCT match_id) >= 10
                ORDER BY value DESC, player COLLATE NOCASE
                LIMIT ?
              `, limit)
            }
          }
        };
      });

      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
      res.json(payload);
    } catch (error) {
      logRouteError("[/api/analytics]", error);
      sendError(res, 500, "analytics_failed");
    }
  });

  return router;
}

module.exports = { createAnalyticsRouter };
