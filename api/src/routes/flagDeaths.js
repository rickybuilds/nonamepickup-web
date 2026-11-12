"use strict";
const express = require("express");
function createFlagDeathRouter({ db }) {
  const router = express.Router();
  // Replay color/slot numbers can follow offense/defense across rounds.
  // Match teams come from the round roster, independently of those slots.
  function addMatchTeams(rows, map, carriers = false) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_player_round_stats'").get();
    if (!exists) return;
    const roster = db.prepare(`SELECT s.match_id,s.round_num,s.steam_id,MIN(LOWER(TRIM(s.team_name))) AS team
      FROM match_player_round_stats s JOIN matches m ON m.match_id=s.match_id
      WHERE m.map_name=? COLLATE NOCASE AND s.steam_id<>''
      GROUP BY s.match_id,s.round_num,s.steam_id
      HAVING MIN(LOWER(TRIM(s.team_name)))=MAX(LOWER(TRIM(s.team_name)))`).all(map);
    const teams = new Map(roster.map(row => [JSON.stringify([row.match_id, row.round_num, row.steam_id]),
      ({ 'team a': 1, 'team b': 2, 'team 1': 1, 'team 2': 2 })[row.team] || null]));
    for (const row of rows) {
      row.attackerMatchTeam = teams.get(JSON.stringify([row.matchId, row.round, carriers ? row.attackerSteamId : row.steamId])) || null;
      row.victimMatchTeam = teams.get(JSON.stringify([row.matchId, row.round, row.victimSteamId || row.steamId])) || null;
    }
  }
  router.get("/map/:map/flag-deaths", (req, res) => {
    const map = String(req.params.map || "");
    if (!/^[a-z0-9_-]{1,64}$/i.test(map)) return res.status(400).json({ ok: false, error: "invalid_map" });
    try {
      const rounds = db.prepare("SELECT COUNT(*) AS count FROM pickup_flag_death_rounds WHERE map = ? COLLATE NOCASE").get(map).count;
      const matches = db.prepare(`
        SELECT r.match_id AS matchId, MAX(m.created_at) AS createdAt
        FROM pickup_flag_death_rounds r
        LEFT JOIN matches m ON m.match_id=r.match_id
        WHERE r.map = ? COLLATE NOCASE
        GROUP BY r.match_id
        ORDER BY COALESCE(MAX(m.created_at), 0) DESC, r.match_id DESC
      `).all(map);
      const rows = db.prepare(`WITH steam_links AS (
        SELECT steam_id, MIN(discord_id) AS discord_id, MAX(NULLIF(TRIM(display_name), '')) AS linked_name
        FROM player_steam_ids
        WHERE steam_id <> '' AND discord_id <> ''
        GROUP BY steam_id
        HAVING COUNT(DISTINCT discord_id) = 1
      )
      SELECT d.match_id AS matchId, d.round_number AS round, d.time_ms AS timeMs, m.created_at AS matchCreatedAt,
        d.steam_id AS steamId, sl.discord_id AS playerId,
        COALESCE(NULLIF(TRIM(rt.display_name), ''), sl.linked_name,
          NULLIF(TRIM(d.player_name), ''), 'Unknown player') AS playerName,
        d.x, d.y, d.z, k.weapon, k.attacker_team AS attackerTeam, k.victim_team AS victimTeam,
        k.attacker_name AS attackerName, k.attacker_steam_id AS attackerSteamId
        FROM pickup_flag_deaths d JOIN pickup_flag_death_rounds r
        ON r.match_id=d.match_id AND r.round_number=d.round_number
        LEFT JOIN pickup_kill_locations k ON k.match_id=d.match_id AND k.round_number=d.round_number
          AND k.session_id=d.session_id AND k.time_ms=d.time_ms
        LEFT JOIN matches m ON m.match_id=d.match_id
        LEFT JOIN steam_links sl ON sl.steam_id=d.steam_id
        LEFT JOIN ratings rt ON rt.player_id=sl.discord_id
        WHERE r.map = ? COLLATE NOCASE ORDER BY COALESCE(m.created_at, 0) DESC, d.match_id, d.round_number, d.time_ms LIMIT 100001`).all(map);
      const truncated = rows.length > 100000;
      if (truncated) rows.pop();
      addMatchTeams(rows, map, true);
      return res.json({ ok: true, rounds, matches, truncated, deaths: rows });
    } catch (error) {
      console.error("[flag deaths] query failed", error);
      return res.status(500).json({ ok: false, error: "flag_deaths_unavailable" });
    }
  });
  router.get("/map/:map/kills", (req, res) => {
    const map = String(req.params.map || "");
    const role = String(req.query.role || "");
    if (!/^[a-z0-9_-]{1,64}$/i.test(map)) return res.status(400).json({ ok: false, error: "invalid_map" });
    if (!["offense", "defense"].includes(role)) return res.status(400).json({ ok: false, error: "invalid_role" });
    try {
      const rounds = db.prepare("SELECT COUNT(*) AS count FROM pickup_kill_rounds WHERE map=? COLLATE NOCASE").get(map).count;
      const hasRoles = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('match_player_round_stats','match_rounds')").get().count === 2;
      // Reject conflicting round records instead of duplicating dots or guessing roles.
      const side = `CASE WHEN LOWER(TRIM(s.team_name))=LOWER(TRIM(mr.offense_team)) THEN 'offense'
        WHEN LOWER(TRIM(s.team_name))=LOWER(TRIM(mr.defense_team)) THEN 'defense' END`;
      const rolesCte = hasRoles ? `SELECT s.match_id,s.round_num,s.steam_id,
        MIN(${side}) AS role FROM match_player_round_stats s
        JOIN match_rounds mr ON mr.match_id=s.match_id AND mr.round_num=s.round_num
        JOIN pickup_kill_rounds r ON r.match_id=s.match_id AND r.round_number=s.round_num
        WHERE r.map=? COLLATE NOCASE AND s.steam_id<>''
          AND LOWER(TRIM(mr.offense_team))<>LOWER(TRIM(mr.defense_team))
        GROUP BY s.match_id,s.round_num,s.steam_id
        HAVING MIN(${side})=MAX(${side}) AND COUNT(${side})=COUNT(*)`
        : "SELECT NULL AS match_id,NULL AS round_num,NULL AS steam_id,NULL AS role WHERE 0 AND ? IS NOT NULL";
      const ctes = `WITH roles AS (${rolesCte}), steam_links AS (
        SELECT steam_id,MIN(discord_id) AS discord_id,MAX(NULLIF(TRIM(display_name),'')) AS linked_name
        FROM player_steam_ids WHERE steam_id<>'' AND discord_id<>'' GROUP BY steam_id
        HAVING COUNT(DISTINCT discord_id)=1
      ), located AS (
        SELECT k.*,s.role FROM pickup_kill_locations k
        JOIN pickup_kill_rounds r ON r.match_id=k.match_id AND r.round_number=k.round_number
        LEFT JOIN roles s ON s.match_id=k.match_id AND s.round_num=k.round_number AND s.steam_id=k.attacker_steam_id
        WHERE r.map=? COLLATE NOCASE
      )`;
      const coverage = db.prepare(`${ctes} SELECT COUNT(*) AS locatedKills,
        COALESCE(SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END),0) AS unclassifiedKills FROM located`).get(map, map);
      const matches = db.prepare(`${ctes} SELECT k.match_id AS matchId,MAX(m.created_at) AS createdAt
        FROM located k LEFT JOIN matches m ON m.match_id=k.match_id WHERE k.role=?
        GROUP BY k.match_id ORDER BY COALESCE(MAX(m.created_at),0) DESC,k.match_id DESC`).all(map, map, role);
      const rows = db.prepare(`${ctes}
        SELECT k.match_id AS matchId,k.round_number AS round,k.time_ms AS timeMs,m.created_at AS matchCreatedAt,
          k.attacker_steam_id AS steamId,sl.discord_id AS playerId,
          COALESCE(NULLIF(TRIM(rt.display_name),''),sl.linked_name,NULLIF(TRIM(k.attacker_name),''),'Unknown player') AS playerName,
          k.player_name AS victimName,k.steam_id AS victimSteamId,k.attacker_team AS attackerTeam,
          k.victim_team AS victimTeam,k.weapon,k.role,k.x,k.y,k.z
        FROM located k LEFT JOIN matches m ON m.match_id=k.match_id
        LEFT JOIN steam_links sl ON sl.steam_id=k.attacker_steam_id
        LEFT JOIN ratings rt ON rt.player_id=sl.discord_id WHERE k.role=?
        ORDER BY COALESCE(m.created_at,0) DESC,k.match_id,k.round_number,k.time_ms LIMIT 100001`).all(map, map, role);
      const truncated = rows.length > 100000;
      if (truncated) rows.pop();
      addMatchTeams(rows, map);
      return res.json({ ok: true, rounds, matches, truncated, ...coverage, kills: rows });
    } catch (error) {
      console.error("[map kills] query failed", error);
      return res.status(500).json({ ok: false, error: "map_kills_unavailable" });
    }
  });
  return router;
}
module.exports = { createFlagDeathRouter };
