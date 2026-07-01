"use strict";

const { parseIdList } = require("../helpers/values");
const { safePublicUrl } = require("../helpers/urls");

function matchColumns(alias = "m") {
  return `
    ${alias}.match_id,
    ${alias}.created_at,
    ${alias}.map_name,
    ${alias}.winner,
    ${alias}.status,
    ${alias}.blue_ids,
    ${alias}.red_ids,
    ${alias}.hampalyzer_url,
    ${alias}.tfcstats_url,
    ${alias}.score_blue,
    ${alias}.score_red
  `;
}

function serializeMatch(row, playersByMatch, options = {}) {
  const matchId = String(row.match_id);
  const cachedTeamIds = playersByMatch.teamIdsByMatch?.get(matchId);
  const blueIds = cachedTeamIds?.blueSet || new Set(parseIdList(row.blue_ids));
  const redIds = cachedTeamIds?.redSet || new Set(parseIdList(row.red_ids));
  const players = playersByMatch.get(String(row.match_id)) || [];
  const blueTeam = [];
  const redTeam = [];
  for (const player of players) {
    const playerId = String(player.id);
    if (blueIds.has(playerId)) blueTeam.push(player);
    else if (redIds.has(playerId)) redTeam.push(player);
  }

  return {
    id: row.match_id,
    created_at: row.created_at,
    map_name: row.map_name,
    winner: row.winner,
    status: row.status,
    blueTeam,
    redTeam,
    hampalyzer_url: safePublicUrl(row.hampalyzer_url),
    ...(options.includeTfcstats !== false
      ? { tfcstats_url: safePublicUrl(row.tfcstats_url) }
      : {}),
    score_blue: row.score_blue ?? null,
    score_red: row.score_red ?? null
  };
}

module.exports = { matchColumns, serializeMatch };
