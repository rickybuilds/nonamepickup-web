"use strict";

const { parseIdList } = require("../helpers/values");

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",");
}

function chunks(values, size = 400) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function createMatchPlayerLoader(db) {
  return function loadMatchPlayers(rows, options = {}) {
    if (!rows.length) return new Map();

    const includeRatings = options.includeRatings !== false;
    const revealHidden = options.revealHidden === true;
    const matchIds = rows.map(row => String(row.match_id));
    const byMatch = new Map(matchIds.map(id => [id, []]));
    const seenByMatch = new Map(matchIds.map(id => [id, new Set()]));
    const teamIdsByMatch = new Map();
    for (const row of rows) {
      const matchId = String(row.match_id);
      const blue = parseIdList(row.blue_ids);
      const red = parseIdList(row.red_ids);
      teamIdsByMatch.set(matchId, {
        blue,
        red,
        blueSet: new Set(blue),
        redSet: new Set(red)
      });
    }
    byMatch.teamIdsByMatch = teamIdsByMatch;

    for (const matchIdChunk of chunks(matchIds)) {
      const sql = `
      WITH primary_steam AS (
        SELECT discord_id, MIN(steam_id) AS steam_id
        FROM player_steam_ids
        WHERE is_primary = 1
        GROUP BY discord_id
      )
      SELECT
        rc.match_id,
        rc.player_id,
        rc.before,
        rc.after,
        rc.delta,
        COALESCE(r.display_name, rc.player_id) AS name,
        r.rating AS current_elo,
        COALESCE(up.hide_elo, 0) AS hide_elo,
        sp.profileurl,
        sp.avatar,
        sp.avatarmedium,
        sp.avatarfull
      FROM rating_changes rc
      LEFT JOIN ratings r ON r.player_id = rc.player_id
      LEFT JOIN user_prefs up ON up.player_id = rc.player_id
      LEFT JOIN primary_steam ps ON CAST(ps.discord_id AS TEXT) = CAST(rc.player_id AS TEXT)
      LEFT JOIN steam_profiles sp ON sp.steam_id = ps.steam_id
      WHERE rc.match_id IN (${placeholders(matchIdChunk.length)})
    `;

      for (const player of db.prepare(sql).all(...matchIdChunk)) {
        const id = String(player.match_id);
        const list = byMatch.get(id);
        if (!list) continue;
        const playerId = String(player.player_id);
        const seen = seenByMatch.get(id);
        if (seen?.has(playerId)) continue;
        seen?.add(playerId);
        list.push({
          id: playerId,
          name: player.name || playerId,
          before: player.hide_elo && !revealHidden ? null : player.before,
          after: player.hide_elo && !revealHidden ? null : player.after,
          delta: player.hide_elo && !revealHidden ? null : player.delta,
          profileurl: player.profileurl || null,
          avatar: player.avatar || null,
          avatarmedium: player.avatarmedium || null,
          avatarfull: player.avatarfull || null,
          ...(includeRatings ? {
            current_elo: player.hide_elo ? null : (player.current_elo ?? null),
            hidden: !!player.hide_elo
          } : {})
        });
      }
    }

    const missingIds = new Set();
    for (const row of rows) {
      const matchId = String(row.match_id);
      const known = new Set((byMatch.get(matchId) || []).map(player => player.id));
      const teamIds = teamIdsByMatch.get(matchId);
      for (const id of [...teamIds.blue, ...teamIds.red]) {
        if (!known.has(id)) missingIds.add(id);
      }
    }

    const fallbackPlayers = new Map();
    if (missingIds.size) {
      const ids = [...missingIds];
      for (const idChunk of chunks(ids)) {
        const fallbackSql = `
        WITH primary_steam AS (
          SELECT discord_id, MIN(steam_id) AS steam_id
          FROM player_steam_ids
          WHERE is_primary = 1
          GROUP BY discord_id
        )
        SELECT
          r.player_id,
          r.display_name,
          r.rating AS current_elo,
          COALESCE(up.hide_elo, 0) AS hide_elo,
          sp.profileurl,
          sp.avatar,
          sp.avatarmedium,
          sp.avatarfull
        FROM ratings r
        LEFT JOIN user_prefs up ON up.player_id = r.player_id
        LEFT JOIN primary_steam ps ON CAST(ps.discord_id AS TEXT) = CAST(r.player_id AS TEXT)
        LEFT JOIN steam_profiles sp ON sp.steam_id = ps.steam_id
        WHERE r.player_id IN (${placeholders(idChunk.length)})
      `;
        for (const row of db.prepare(fallbackSql).all(...idChunk)) {
          fallbackPlayers.set(String(row.player_id), {
            id: String(row.player_id),
            name: row.display_name || String(row.player_id),
            profileurl: row.profileurl || null,
            avatar: row.avatar || null,
            avatarmedium: row.avatarmedium || null,
            avatarfull: row.avatarfull || null,
            ...(includeRatings ? {
              current_elo: row.hide_elo ? null : (row.current_elo ?? null),
              hidden: !!row.hide_elo
            } : {})
          });
        }
      }
    }

    for (const row of rows) {
      const matchId = String(row.match_id);
      const players = byMatch.get(matchId) || [];
      const known = new Set(players.map(player => player.id));
      const seen = seenByMatch.get(matchId) || known;
      const teamIds = teamIdsByMatch.get(matchId);
      for (const id of [...teamIds.blue, ...teamIds.red]) {
        if (!seen.has(id)) {
          players.push(fallbackPlayers.get(id) || { id, name: id });
          seen.add(id);
        }
      }
      byMatch.set(matchId, players);
    }

    return byMatch;
  };
}

module.exports = { createMatchPlayerLoader };
