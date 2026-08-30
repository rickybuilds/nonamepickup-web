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

const ANALYTICS_CACHE_TTL_MS = 45_000;
const MIN_PERFORMANCE_GAMES = 25;
const MIN_MAP_GAMES = 10;
const analyticsPayloadCache = new Map();

function createAnalyticsRouter({ db, cachedFor, positiveInt, sendError, logRouteError }) {
  const router = express.Router();

  function serializeLeader(row) {
    return {
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
    };
  }

  function serializeMapLeader(row) {
    return {
      map: row.map_name || "Unknown",
      value: Number(row.value || 0),
      secondary: row.secondary == null ? null : Number(row.secondary || 0),
      matches: row.matches == null ? null : Number(row.matches || 0)
    };
  }

  function leaders(sql, ...params) {
    return db.prepare(sql).all(...params).map(serializeLeader);
  }

  function timedAnalytics(label, fn) {
    console.time(label);
    try {
      return fn();
    } finally {
      console.timeEnd(label);
    }
  }

  function getAnalyticsCacheEntry(key) {
    const hit = analyticsPayloadCache.get(key);
    if (!hit) return null;
    return {
      ...hit,
      stale: Date.now() >= hit.expiresAt
    };
  }

  function setAnalyticsCache(key, payload) {
    const entry = {
      payload,
      body: JSON.stringify(payload),
      expiresAt: Date.now() + ANALYTICS_CACHE_TTL_MS
    };
    analyticsPayloadCache.set(key, entry);
    return entry;
  }

  function logQueryPlan(label, sql, params = []) {
    try {
      console.log(label, db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params));
    } catch (error) {
      console.warn(`${label}: failed`, error.message);
    }
  }

  router.get("/analytics", (req, res) => {
    try {
      const limit = positiveInt(req.query.limit, 5, 1, 10);
      const cacheKey = `analytics:${limit}`;
      const cachedEntry = getAnalyticsCacheEntry(cacheKey);
      if (cachedEntry && !cachedEntry.stale && req.query.refresh !== "1") {
        res.setHeader("X-Analytics-Cache", "HIT");
        res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
        res.type("application/json");
        return res.send(cachedEntry.body);
      }

      const payload = timedAnalytics(`analytics:total:${cacheKey}`, () => {
        const summary = timedAnalytics("analytics:summary", () => db.prepare(`
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
            (SELECT COUNT(DISTINCT match_id || ':' || round_num) FROM match_player_round_stats) AS rounds,
            (SELECT COUNT(*) FROM match_player_round_stats) AS player_rounds,
            (SELECT SUM(COALESCE(kills, 0)) FROM match_player_stats) AS total_kills
        `).get());

        const activity = timedAnalytics("analytics:activity", () => db.prepare(`
          SELECT
            strftime('%Y-%m', created_at, 'unixepoch') AS month,
            COUNT(*) AS matches
          FROM matches
          WHERE status = 'completed'
            AND created_at >= strftime('%s', 'now', 'start of month', '-11 months')
          GROUP BY month
          ORDER BY month
        `).all().map(row => ({
          month: row.month,
          matches: Number(row.matches || 0)
        })));

        const mvps = timedAnalytics("analytics:mvps", () => leaders(`${MVP_CTES}
          SELECT
            MAX(player_id) AS player_id,
            MAX(player) AS player,
            COUNT(DISTINCT match_id) AS value
          FROM mvp_rows
          WHERE identity IS NOT NULL AND identity != ''
          GROUP BY identity
          ORDER BY value DESC, player COLLATE NOCASE
          LIMIT ?
        `, limit));

        const mvpRate = timedAnalytics("analytics:mvpRate", () => leaders(`${MVP_CTES},
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
          HAVING MAX(pg.games) >= ?
          ORDER BY value DESC, secondary DESC, matches DESC, player COLLATE NOCASE
          LIMIT ?
        `, MIN_PERFORMANCE_GAMES, limit));

        let roundRowsCache = null;
        let playerTotalsCache = null;
        let playerRoundTotalsCache = null;
        const compareTopRows = (a, b, ascending = false) => {
          const valueDiff = ascending
            ? Number(a.value || 0) - Number(b.value || 0)
            : Number(b.value || 0) - Number(a.value || 0);
          if (valueDiff) return valueDiff;
          const secondaryDiff = Number(b.secondary || 0) - Number(a.secondary || 0);
          if (secondaryDiff) return secondaryDiff;
          const gamesDiff = Number(b.matches || 0) - Number(a.matches || 0);
          if (gamesDiff) return gamesDiff;
          const ap = String(a.player || "").toLowerCase();
          const bp = String(b.player || "").toLowerCase();
          return ap < bp ? -1 : ap > bp ? 1 : 0;
        };
        const topRows = (rows, valueFn, options = {}) => {
          const filterFn = options.filter || (() => true);
          const secondaryFn = options.secondary || (() => null);
          const ascending = !!options.ascending;
          const top = [];

          for (const row of rows) {
            if (!filterFn(row)) continue;
            const value = Number(valueFn(row) || 0);
            const candidate = {
              ...row,
              value,
              secondary: secondaryFn(row)
            };
            let insertAt = top.findIndex(existing => compareTopRows(candidate, existing, ascending) < 0);
            if (insertAt === -1) insertAt = top.length;
            if (insertAt < limit) {
              top.splice(insertAt, 0, candidate);
              if (top.length > limit) top.pop();
            }
          }

          return top.map(serializeLeader);
        };
        const getRoundRows = () => {
          if (roundRowsCache) return roundRowsCache;
          const roundRowsSql = `${IDENTITY_CTES}
            SELECT
              rs.player_id,
              rs.player,
              rs.match_id,
              rs.round_num,
              m.map_name,
              m.hampalyzer_url,
              m.tfcstats_url,
              rs.kills,
              rs.enemy_damage,
              rs.flag_captures,
              rs.flag_touches,
              rs.initial_touches,
              rs.flag_time_seconds,
              rs.conc_jumps,
              rs.suicides,
              rs.team_kills,
              rs.team_damage
            FROM round_stats rs
            LEFT JOIN matches m USING (match_id)
            WHERE rs.identity IS NOT NULL AND rs.identity != ''
          `;

          if (req.query.explain === "1") {
            logQueryPlan("analytics:rounds:plan", roundRowsSql);
          }

          roundRowsCache = timedAnalytics("analytics:rounds:base", () => db.prepare(roundRowsSql).all());
          return roundRowsCache;
        };

        const roundRecordQuery = column => topRows(getRoundRows(), row => row[column]);

        const getPlayerRoundTotals = () => {
          if (playerRoundTotalsCache) return playerRoundTotalsCache;
          playerRoundTotalsCache = timedAnalytics("analytics:playerRoundTotals", () => db.prepare(`${IDENTITY_CTES}
            SELECT
              MAX(player_id) AS player_id,
              MAX(player) AS player,
              COUNT(DISTINCT match_id) AS matches,
              COUNT(DISTINCT match_id || ':' || round_num) AS rounds,
              SUM(kills) AS kills,
              SUM(enemy_damage) AS enemy_damage
            FROM round_stats
            WHERE identity IS NOT NULL AND identity != ''
            GROUP BY identity
          `).all());
          return playerRoundTotalsCache;
        };

        const dispenserKills = timedAnalytics("analytics:roles:dispenserKills", () => leaders(`${IDENTITY_CTES}
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
        `, limit));

        const topAggregateRows = (rows, valueKey, secondaryKey = null, filterFn = () => true) => topRows(rows, row => row[valueKey], {
          filter: filterFn,
          secondary: secondaryKey ? row => Number(row[secondaryKey] || 0) : undefined
        });

        const getPlayerTotals = () => {
          if (playerTotalsCache) return playerTotalsCache;
          const playerTotalsSql = `${IDENTITY_CTES}
            SELECT
              MAX(player_id) AS player_id,
              MAX(player) AS player,
              COUNT(DISTINCT match_id) AS matches,
              SUM(kills) AS kills,
              SUM(deaths) AS deaths,
              SUM(enemy_damage) AS enemy_damage,
              SUM(team_damage) AS team_damage,
              SUM(flag_captures) AS flag_captures,
              SUM(flag_touches) AS flag_touches,
              SUM(initial_touches) AS initial_touches,
              SUM(flag_time_seconds) AS flag_time_seconds
            FROM player_stats
            WHERE identity IS NOT NULL AND identity != ''
            GROUP BY identity
          `;

          if (req.query.explain === "1") {
            logQueryPlan("analytics:playerTotals:plan", playerTotalsSql);
          }

          playerTotalsCache = timedAnalytics("analytics:playerTotals:base", () => db.prepare(playerTotalsSql).all());
          return playerTotalsCache;
        };

        const combat = timedAnalytics("analytics:combat", () => ({
          games: topAggregateRows(getPlayerTotals(), "matches"),
          kills: topAggregateRows(getPlayerTotals(), "kills"),
          enemy_damage: topAggregateRows(getPlayerTotals(), "enemy_damage"),
          kdr: topRows(getPlayerTotals(), row => Number((Number(row.kills || 0) / Number(row.deaths || 1)).toFixed(2)), {
            filter: row => Number(row.deaths || 0) > 0 && Number(row.matches || 0) >= MIN_PERFORMANCE_GAMES,
            secondary: row => Number(row.kills || 0)
          }),
          round_kills: roundRecordQuery("kills"),
          round_damage: roundRecordQuery("enemy_damage")
        }));

        const perGameMetric = (valueKey, decimals = 2) => topRows(
          getPlayerTotals(),
          row => Number((Number(row[valueKey] || 0) / Number(row.matches || 1)).toFixed(decimals)),
          {
            filter: row => Number(row.matches || 0) >= MIN_PERFORMANCE_GAMES,
            secondary: row => Number(row[valueKey] || 0)
          }
        );
        const perRoundMetric = (valueKey, decimals = 2) => topRows(
          getPlayerRoundTotals(),
          row => Number((Number(row[valueKey] || 0) / Number(row.rounds || 1)).toFixed(decimals)),
          {
            filter: row => Number(row.matches || 0) >= MIN_PERFORMANCE_GAMES && Number(row.rounds || 0) > 0,
            secondary: row => Number(row[valueKey] || 0)
          }
        );

        const winRate = timedAnalytics("analytics:winRate", () => leaders(`
          WITH player_games AS (
            SELECT DISTINCT
              rc.player_id,
              rc.match_id,
              m.winner,
              m.blue_ids,
              m.red_ids
            FROM rating_changes rc
            JOIN matches m ON m.match_id = rc.match_id
            WHERE m.status = 'completed'
          ),
          outcomes AS (
            SELECT
              pg.player_id,
              COUNT(*) AS games,
              SUM(CASE
                WHEN pg.winner = 'BLUE' AND EXISTS (
                  SELECT 1 FROM json_each(pg.blue_ids)
                  WHERE CAST(value AS TEXT) = CAST(pg.player_id AS TEXT)
                ) THEN 1
                WHEN pg.winner = 'RED' AND EXISTS (
                  SELECT 1 FROM json_each(pg.red_ids)
                  WHERE CAST(value AS TEXT) = CAST(pg.player_id AS TEXT)
                ) THEN 1
                ELSE 0
              END) AS wins,
              SUM(CASE
                WHEN pg.winner = 'BLUE' AND EXISTS (
                  SELECT 1 FROM json_each(pg.red_ids)
                  WHERE CAST(value AS TEXT) = CAST(pg.player_id AS TEXT)
                ) THEN 1
                WHEN pg.winner = 'RED' AND EXISTS (
                  SELECT 1 FROM json_each(pg.blue_ids)
                  WHERE CAST(value AS TEXT) = CAST(pg.player_id AS TEXT)
                ) THEN 1
                ELSE 0
              END) AS losses
            FROM player_games pg
            GROUP BY pg.player_id
          )
          SELECT
            o.player_id,
            COALESCE(r.display_name, o.player_id) AS player,
            ROUND(100.0 * o.wins / NULLIF(o.wins + o.losses, 0), 2) AS value,
            o.wins AS secondary,
            o.games AS matches
          FROM outcomes o
          LEFT JOIN ratings r ON r.player_id = o.player_id
          WHERE o.games >= ? AND (o.wins + o.losses) > 0
          ORDER BY value DESC, secondary DESC, matches DESC, player COLLATE NOCASE
          LIMIT ?
        `, MIN_PERFORMANCE_GAMES, limit));

        const perGame = timedAnalytics("analytics:perGame", () => ({
          kills: perGameMetric("kills"),
          deaths: perGameMetric("deaths"),
          damage: perGameMetric("enemy_damage", 0),
          captures: perGameMetric("flag_captures"),
          kills_per_round: perRoundMetric("kills"),
          damage_per_round: perRoundMetric("enemy_damage", 0),
          kdr: topRows(getPlayerTotals(), row => Number((Number(row.kills || 0) / Number(row.deaths || 1)).toFixed(2)), {
            filter: row => Number(row.matches || 0) >= MIN_PERFORMANCE_GAMES && Number(row.deaths || 0) > 0,
            secondary: row => Number(row.kills || 0)
          }),
          win_rate: winRate,
          mvp_efficiency: mvpRate
        }));

        const flags = timedAnalytics("analytics:flags", () => ({
          caps: topAggregateRows(getPlayerTotals(), "flag_captures"),
          touches: topAggregateRows(getPlayerTotals(), "flag_touches"),
          initial_touches: topAggregateRows(getPlayerTotals(), "initial_touches"),
          flag_time: topAggregateRows(getPlayerTotals(), "flag_time_seconds"),
          conversion: topRows(getPlayerTotals(), row => Number((100 * Number(row.flag_captures || 0) / Number(row.initial_touches || 1)).toFixed(1)), {
            filter: row => Number(row.initial_touches || 0) >= 10,
            secondary: row => Number(row.flag_captures || 0)
          })
        }));

        const roles = timedAnalytics("analytics:roles", () => {
          const classRowsSql = `${IDENTITY_CTES}
            SELECT
              MAX(player_id) AS player_id,
              MAX(player) AS player,
              LOWER(COALESCE(main_class, '')) AS class_name,
              SUM(kills) AS kills,
              SUM(enemy_damage) AS enemy_damage,
              SUM(flag_captures) AS flag_captures,
              SUM(flag_touches) AS flag_touches,
              COUNT(DISTINCT match_id) AS matches
            FROM player_stats
            WHERE identity IS NOT NULL AND identity != ''
            GROUP BY identity, class_name
          `;
          const roundRoleRowsSql = `${IDENTITY_CTES}
            SELECT
              MAX(player_id) AS player_id,
              MAX(player) AS player,
              LOWER(COALESCE(role, '')) AS role_name,
              SUM(kills) AS kills,
              SUM(enemy_damage) AS enemy_damage,
              SUM(sentry_kills) AS sentry_kills,
              COUNT(DISTINCT match_id) AS matches
            FROM round_stats
            WHERE identity IS NOT NULL AND identity != ''
            GROUP BY identity, role_name
          `;
          const sideRowsSql = `${IDENTITY_CTES}
            SELECT
              MAX(rs.player_id) AS player_id,
              MAX(rs.player) AS player,
              CASE
                WHEN LOWER(TRIM(rs.team_name)) = LOWER(TRIM(mr.offense_team)) THEN 'offense'
                WHEN LOWER(TRIM(rs.team_name)) = LOWER(TRIM(mr.defense_team)) THEN 'defense'
              END AS side,
              SUM(rs.enemy_damage) AS enemy_damage,
              SUM(rs.kills) AS kills,
              SUM(rs.flag_captures) AS flag_captures,
              SUM(rs.flag_touches) AS flag_touches,
              SUM(rs.initial_touches) AS initial_touches,
              SUM(rs.flag_time_seconds) AS flag_time_seconds,
              COUNT(DISTINCT rs.match_id) AS matches
            FROM round_stats rs
            JOIN match_rounds mr
              ON mr.match_id = rs.match_id
             AND mr.round_num = rs.round_num
            WHERE rs.identity IS NOT NULL
              AND rs.identity != ''
              AND (
                LOWER(TRIM(rs.team_name)) = LOWER(TRIM(mr.offense_team))
                OR LOWER(TRIM(rs.team_name)) = LOWER(TRIM(mr.defense_team))
              )
            GROUP BY side, rs.identity
          `;

          if (req.query.explain === "1") {
            logQueryPlan("analytics:roles:classPlan", classRowsSql);
            logQueryPlan("analytics:roles:roundRolePlan", roundRoleRowsSql);
            logQueryPlan("analytics:roles:sidePlan", sideRowsSql);
          }

          const classRows = timedAnalytics("analytics:roles:classBase", () => db.prepare(classRowsSql).all());
          const roundRoleRows = timedAnalytics("analytics:roles:roundRoleBase", () => db.prepare(roundRoleRowsSql).all());
          const sideRows = timedAnalytics("analytics:roles:sideBase", () => db.prepare(sideRowsSql).all());
          const roleContains = className => row => String(row.role_name || "").includes(className.toLowerCase());
          const sideIs = side => row => row.side === side;

          return {
            soldier_damage: topAggregateRows(classRows, "enemy_damage", null, row => row.class_name === "soldier"),
            soldier_kills: topAggregateRows(classRows, "kills", null, row => row.class_name === "soldier"),
            hwguy_damage: topAggregateRows(roundRoleRows, "enemy_damage", null, roleContains("hwguy")),
            hwguy_kills: topAggregateRows(roundRoleRows, "kills", null, roleContains("hwguy")),
            demoman_damage: topAggregateRows(roundRoleRows, "enemy_damage", null, roleContains("demoman")),
            demoman_kills: topAggregateRows(roundRoleRows, "kills", null, roleContains("demoman")),
            engineer_kills: topAggregateRows(roundRoleRows, "kills", null, roleContains("engineer")),
            medic_caps: topAggregateRows(classRows, "flag_captures", null, row => row.class_name === "medic"),
            medic_touches: topAggregateRows(classRows, "flag_touches", null, row => row.class_name === "medic"),
            scout_caps: topAggregateRows(classRows, "flag_captures", null, row => row.class_name === "scout"),
            scout_touches: topAggregateRows(classRows, "flag_touches", null, row => row.class_name === "scout"),
            engineer_sentry_kills: topAggregateRows(roundRoleRows, "sentry_kills"),
            dispenser_kills: dispenserKills,
            defense: topAggregateRows(sideRows, "enemy_damage", "kills", sideIs("defense")),
            offense: topAggregateRows(sideRows, "enemy_damage", "kills", sideIs("offense")),
            offensive_flag_captures: topAggregateRows(sideRows, "flag_captures", null, sideIs("offense")),
            offensive_flag_touches: topAggregateRows(sideRows, "flag_touches", null, sideIs("offense")),
            offensive_initial_touches: topAggregateRows(sideRows, "initial_touches", null, sideIs("offense")),
            offensive_flag_time: topAggregateRows(sideRows, "flag_time_seconds", null, sideIs("offense")),
            offensive_damage: topAggregateRows(sideRows, "enemy_damage", null, sideIs("offense"))
          };
        });

        const rounds = timedAnalytics("analytics:rounds", () => ({
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
        }));

        const matches = timedAnalytics("analytics:matches", () => {
          const matchRowsSql = `${IDENTITY_CTES}
            SELECT
              ms.player_id,
              ms.player,
              ms.match_id,
              m.map_name,
              m.hampalyzer_url,
              m.tfcstats_url,
              ms.kills,
              ms.enemy_damage,
              ms.flag_captures,
              ms.flag_touches,
              ms.initial_touches,
              ms.flag_time_seconds,
              ms.conc_jumps,
              ms.suicides,
              ms.team_kills,
              ms.team_damage,
              ms.deaths
            FROM match_stats ms
            LEFT JOIN matches m USING (match_id)
          `;

          if (req.query.explain === "1") {
            logQueryPlan("analytics:matches:plan", matchRowsSql);
          }

          const matchRows = timedAnalytics("analytics:matches:base", () => db.prepare(matchRowsSql).all());
          const topMatchRows = (valueFn, filterFn = () => true) => topRows(matchRows, valueFn, { filter: filterFn });

          return {
            kills: topMatchRows(row => row.kills),
            enemy_damage: topMatchRows(row => row.enemy_damage),
            caps: topMatchRows(row => row.flag_captures),
            touches: topMatchRows(row => row.flag_touches),
            initial_touches: topMatchRows(row => row.initial_touches),
            flag_time: topMatchRows(row => row.flag_time_seconds),
            conc_jumps: topMatchRows(row => row.conc_jumps),
            suicides: topMatchRows(row => row.suicides),
            team_kills: topMatchRows(row => row.team_kills),
            team_damage: topMatchRows(row => row.team_damage),
            deaths: topMatchRows(row => row.deaths),
            kdr: topMatchRows(
              row => Number((Number(row.kills || 0) / Number(row.deaths || 1)).toFixed(2)),
              row => Number(row.kills || 0) >= 10 && Number(row.deaths || 0) > 0
            )
          };
        });

        const chaos = timedAnalytics("analytics:chaos", () => {
          const roundChaosSql = `${IDENTITY_CTES}
            SELECT
              MAX(player_id) AS player_id,
              MAX(player) AS player,
              SUM(suicides) AS suicides,
              SUM(team_kills) AS team_kills,
              COUNT(DISTINCT match_id) AS matches
            FROM round_stats
            WHERE identity IS NOT NULL AND identity != ''
            GROUP BY identity
          `;

          if (req.query.explain === "1") {
            logQueryPlan("analytics:chaos:roundPlan", roundChaosSql);
          }

          const playerChaosRows = getPlayerTotals();
          const roundChaosRows = timedAnalytics("analytics:chaos:roundBase", () => db.prepare(roundChaosSql).all());
          const perMatchRows = (rows, valueKey) => topRows(rows, row => Number((Number(row[valueKey] || 0) / Number(row.matches || 1)).toFixed(2)), {
            filter: row => Number(row.matches || 0) >= 10
          });
          const worstKdr = topRows(playerChaosRows, row => Number((Number(row.kills || 0) / Number(row.deaths || 1)).toFixed(2)), {
            ascending: true,
            filter: row => Number(row.deaths || 0) > 0 && Number(row.kills || 0) + Number(row.deaths || 0) >= 25,
            secondary: row => Number(row.kills || 0) + Number(row.deaths || 0)
          });

          return {
            suicides: topAggregateRows(roundChaosRows, "suicides"),
            team_kills: topAggregateRows(roundChaosRows, "team_kills"),
            team_damage: topAggregateRows(playerChaosRows, "team_damage"),
            deaths: topAggregateRows(playerChaosRows, "deaths"),
            worst_kdr: worstKdr,
            team_kills_per_match: perMatchRows(roundChaosRows, "team_kills"),
            suicides_per_match: perMatchRows(roundChaosRows, "suicides")
          };
        });

        const weapons = timedAnalytics("analytics:weapons", () => {
          const totals = db.prepare(`
            SELECT
              weapon,
              SUM(COALESCE(kills, 0)) AS value,
              COUNT(DISTINCT match_id) AS matches
            FROM match_player_weapons
            WHERE weapon IS NOT NULL AND weapon != ''
            GROUP BY weapon
            HAVING value > 0
            ORDER BY value DESC, matches DESC, weapon COLLATE NOCASE
            LIMIT 12
          `).all().map(row => ({
            weapon: row.weapon,
            value: Number(row.value || 0),
            matches: Number(row.matches || 0)
          }));

          const leadersByWeapon = db.prepare(`${IDENTITY_CTES},
            weapon_player_totals AS (
              SELECT
                w.weapon,
                MAX(ps.player_id) AS player_id,
                MAX(ps.player) AS player,
                COALESCE(ps.identity, NULLIF(w.player_key, '')) AS identity,
                SUM(COALESCE(w.kills, 0)) AS value,
                COUNT(DISTINCT w.match_id) AS matches
              FROM match_player_weapons w
              LEFT JOIN player_stats ps
                ON ps.match_id = w.match_id
               AND ps.player_key = w.player_key
              WHERE w.weapon IS NOT NULL
                AND w.weapon != ''
                AND COALESCE(ps.identity, NULLIF(w.player_key, '')) IS NOT NULL
              GROUP BY w.weapon, COALESCE(ps.identity, w.player_key)
            ),
            ranked AS (
              SELECT
                *,
                ROW_NUMBER() OVER (
                  PARTITION BY weapon
                  ORDER BY value DESC, matches DESC, player COLLATE NOCASE
                ) AS position
              FROM weapon_player_totals
              WHERE value > 0
            )
            SELECT weapon, player_id, player, value, matches
            FROM ranked
            WHERE position <= ?
            ORDER BY weapon COLLATE NOCASE, position
          `).all(limit).map(row => ({
            weapon: row.weapon,
            ...serializeLeader(row)
          }));

          return { totals, leaders: leadersByWeapon };
        });

        const maps = timedAnalytics("analytics:maps", () => ({
          most_played: db.prepare(`
            SELECT map_name, COUNT(*) AS value, COUNT(*) AS matches
            FROM matches
            WHERE status = 'completed' AND map_name IS NOT NULL AND map_name != ''
            GROUP BY map_name
            ORDER BY value DESC, map_name COLLATE NOCASE
            LIMIT ?
          `).all(limit).map(serializeMapLeader),
          total_kills: db.prepare(`
            SELECT
              m.map_name,
              SUM(COALESCE(s.kills, 0)) AS value,
              COUNT(DISTINCT m.match_id) AS matches
            FROM matches m
            JOIN match_player_stats s ON s.match_id = m.match_id
            WHERE m.status = 'completed' AND m.map_name IS NOT NULL AND m.map_name != ''
            GROUP BY m.map_name
            ORDER BY value DESC, matches DESC, m.map_name COLLATE NOCASE
            LIMIT ?
          `).all(limit).map(serializeMapLeader),
          average_team_score: db.prepare(`
            SELECT
              map_name,
              ROUND(AVG((score_blue + score_red) / 2.0), 1) AS value,
              COUNT(*) AS matches
            FROM matches
            WHERE status = 'completed'
              AND map_name IS NOT NULL
              AND map_name != ''
              AND score_blue IS NOT NULL
              AND score_red IS NOT NULL
            GROUP BY map_name
            HAVING COUNT(*) >= ?
            ORDER BY value DESC, matches DESC, map_name COLLATE NOCASE
            LIMIT ?
          `).all(MIN_MAP_GAMES, limit).map(serializeMapLeader)
        }));

        return {
          ok: true,
          data: {
            generated_at: Math.floor(Date.now() / 1000),
            limit,
            qualification: {
              minimum_games: MIN_PERFORMANCE_GAMES,
              minimum_map_games: MIN_MAP_GAMES
            },
            summary: {
              matches: Number(summary.matches || 0),
              players: Number(summary.players || 0),
              rounds: Number(summary.rounds || 0),
              player_rounds: Number(summary.player_rounds || 0),
              total_kills: Number(summary.total_kills || 0)
            },
            activity,
            mvps,
            mvp_rate: mvpRate,
            per_game: perGame,
            combat,
            flags,
            roles,
            rounds,
            matches,
            chaos,
            weapons,
            maps
          }
        };
      });

      const cacheEntry = setAnalyticsCache(cacheKey, payload);
      res.setHeader("X-Analytics-Cache", "MISS");
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
      res.type("application/json");
      res.send(cacheEntry.body);
    } catch (error) {
      logRouteError("[/api/analytics]", error);
      sendError(res, 500, "analytics_failed");
    }
  });

  return router;
}

module.exports = { createAnalyticsRouter };
