"use strict";

const express = require("express");
const compression = require("compression");
const { buildNnMvp } = require("../lib/nnMvp");
const { replayFixedPool } = require("../lib/eloReplay");
const { parseIdList } = require("../helpers/values");

const replayCache = new Map();
const CACHE_MS = 60_000;

function groupByMatch(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const id = String(row.match_id);
    const list = grouped.get(id) || [];
    list.push(row);
    grouped.set(id, list);
  }
  return grouped;
}

function selectMany(db, sql, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(sql.replace("__IDS__", placeholders)).all(...ids);
}

function optionalSelectMany(db, sql, ids, logRouteError, label) {
  try {
    return selectMany(db, sql, ids);
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("no such table") && !message.includes("no such column")) {
      logRouteError(label, error);
    }
    return [];
  }
}

function identityMap(db, statRows) {
  const identifiers = [...new Set(statRows.flatMap(row => [row.player_key, row.steam_id]).filter(Boolean).map(String))];
  const map = new Map();
  for (let offset = 0; offset < identifiers.length; offset += 400) {
    const chunk = identifiers.slice(offset, offset + 400);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT steam_id, discord_id
      FROM player_steam_ids
      WHERE steam_id IN (${placeholders})
    `).all(...chunk);
    for (const row of rows) {
      const key = String(row.steam_id);
      const ids = map.get(key) || new Set();
      if (row.discord_id != null) ids.add(String(row.discord_id));
      map.set(key, ids);
    }
  }
  return map;
}

function mapPerformancePlayers(mvp, rosterIds, links) {
  const roster = new Set(rosterIds.map(String));
  return (mvp.players || []).map(player => {
    const candidates = new Set();
    for (const identifier of [player.player_key, player.steam_id].filter(Boolean).map(String)) {
      if (roster.has(identifier)) candidates.add(identifier);
      for (const discordId of links.get(identifier) || []) candidates.add(discordId);
    }
    const rosterCandidates = [...candidates].filter(id => roster.has(id));
    return {
      ...player,
      discord_id: rosterCandidates.length === 1 ? rosterCandidates[0] : null
    };
  });
}

function buildReplay(db, limit, logRouteError) {
  const newestFirst = db.prepare(`
    SELECT match_id, created_at, map_name, winner, blue_ids, red_ids
    FROM matches m
    WHERE status = 'completed'
      AND EXISTS (SELECT 1 FROM rating_changes rc WHERE rc.match_id = m.match_id)
    ORDER BY created_at DESC, match_id DESC
    LIMIT ?
  `).all(limit);
  const matchRows = newestFirst.reverse();
  const ids = matchRows.map(row => String(row.match_id));

  const ratingRows = selectMany(db, `
    SELECT rc.match_id, rc.player_id, rc.before, rc.after, rc.delta, rc.ts,
           COALESCE(r.display_name, CAST(rc.player_id AS TEXT)) AS display_name
    FROM rating_changes rc
    LEFT JOIN ratings r ON r.player_id = rc.player_id
    WHERE rc.match_id IN (__IDS__)
    ORDER BY rc.ts, rc.player_id
  `, ids);

  const statRows = optionalSelectMany(db, `
    SELECT s.match_id, s.player_key, s.steam_id, s.display_name, s.kills, s.deaths,
           s.team_kills, s.enemy_damage, s.team_damage, s.flag_captures,
           s.flag_touches, s.initial_touches, s.flag_time_seconds
    FROM match_player_stats s
    WHERE s.match_id IN (__IDS__)
  `, ids, logRouteError, "[shadow-elo player stats]");

  const roundRows = optionalSelectMany(db, `
    SELECT match_id, player_key, steam_id, display_name, suicides, conced_kills, sentry_kills
    FROM match_player_round_stats
    WHERE match_id IN (__IDS__)
  `, ids, logRouteError, "[shadow-elo round stats]");

  const carrierRows = optionalSelectMany(db, `
    SELECT match_id, attacker_key AS player_key, attacker_steam_id AS steam_id,
           SUM(CASE WHEN is_enemy_kill = 1 AND is_flag_carrier_kill = 1 THEN 1 ELSE 0 END) AS flag_carrier_kills
    FROM match_kill_events
    WHERE match_id IN (__IDS__)
    GROUP BY match_id, attacker_key, attacker_steam_id
  `, ids, logRouteError, "[shadow-elo carrier kills]");

  const ratingsByMatch = groupByMatch(ratingRows);
  const statsByMatch = groupByMatch(statRows);
  const roundsByMatch = groupByMatch(roundRows);
  const carriersByMatch = groupByMatch(carrierRows);
  const links = identityMap(db, statRows);

  const replayMatches = matchRows.map(match => {
    const matchId = String(match.match_id);
    const blueIds = parseIdList(match.blue_ids);
    const redIds = parseIdList(match.red_ids);
    const roster = [...blueIds, ...redIds];
    const playerStats = statsByMatch.get(matchId) || [];
    const roundPlayerStats = roundsByMatch.get(matchId) || [];
    const mvp = buildNnMvp({
      playerStats,
      roundPlayerStats,
      flagCarrierKills: carriersByMatch.get(matchId) || []
    });
    return {
      match_id: matchId,
      created_at: Number(match.created_at || 0),
      map_name: match.map_name || null,
      winner: match.winner || null,
      blue_ids: blueIds,
      red_ids: redIds,
      rating_changes: ratingsByMatch.get(matchId) || [],
      performance: {
        available: mvp.available && playerStats.length === 8 && roundPlayerStats.length >= 8,
        formula_version: mvp.formula_version,
        reason: mvp.reason || (roundPlayerStats.length < 8 ? "Historical round statistics are unavailable" : null),
        players: mapPerformancePlayers(mvp, roster, links)
      }
    };
  });

  return replayFixedPool(replayMatches);
}

function createShadowEloRouter({ db, sendError, logRouteError }) {
  const router = express.Router();

  router.get("/shadow-elo", compression({ threshold: 1024 }), (req, res) => {
    try {
      const requested = Number.parseInt(req.query.limit, 10);
      const limit = [20, 50, 100].includes(requested) ? requested : 20;
      const cacheKey = String(limit);
      const cached = replayCache.get(cacheKey);
      let data;
      if (cached && Date.now() - cached.createdAt < CACHE_MS && req.query.refresh !== "1") {
        data = cached.data;
      } else {
        data = buildReplay(db, limit, logRouteError);
        replayCache.set(cacheKey, { createdAt: Date.now(), data });
      }

      res.setHeader("Cache-Control", "private, max-age=30");
      res.json({ ok: true, data });
    } catch (error) {
      logRouteError("[/api/shadow-elo]", error);
      sendError(res, 500, "shadow_elo_failed");
    }
  });

  return router;
}

module.exports = { createShadowEloRouter, buildReplay };
