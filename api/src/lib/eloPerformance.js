"use strict";

const { buildNnMvp, FORMULA_VERSION } = require("./nnMvp");

// ELO is calculated from the match's official participants, regardless of
// their rating. Full-time offense, spectators and other extras stay in the
// public statistics but must not enter the performance distributions.
function buildEloPerformance({ blueIds, redIds, links, playerStats, roundPlayerStats, flagCarrierKills }) {
  const rosterIds = [...blueIds, ...redIds].map(String);
  const roster = new Set(rosterIds);
  const metadata = { scope: "official-roster", roster_ids: rosterIds };
  const unavailable = reason => ({ ...metadata, available: false, formula_version: FORMULA_VERSION, reason, players: [] });
  if (blueIds.length !== 4 || redIds.length !== 4 || roster.size !== 8) {
    return unavailable("official_roster_not_4v4");
  }

  const normalize = value => String(value || "").trim().toUpperCase();
  const owners = new Map();
  for (const [identifier, ids] of links) {
    const key = normalize(identifier);
    const candidates = owners.get(key) || new Set();
    for (const id of ids) if (roster.has(String(id))) candidates.add(String(id));
    owners.set(key, candidates);
  }
  const candidatesFor = row => {
    const candidates = new Set();
    for (const identifier of [row.player_key, row.steam_id]) {
      if (identifier != null && roster.has(String(identifier))) candidates.add(String(identifier));
      for (const id of owners.get(normalize(identifier)) || []) candidates.add(id);
    }
    return candidates;
  };
  const seen = new Set();
  const officialStats = [];
  for (const row of playerStats || []) {
    const candidates = candidatesFor(row);
    if (!candidates.size) continue;
    if (candidates.size !== 1) return unavailable("ambiguous_official_identity");
    const [id] = candidates;
    if (seen.has(id)) return unavailable("duplicate_official_stats");
    seen.add(id);
    officialStats.push(row);
  }
  if (seen.size !== roster.size) return unavailable("missing_official_stats");
  const officialRows = rows => (rows || []).filter(row => candidatesFor(row).size === 1);
  const performance = buildNnMvp({
    playerStats: officialStats,
    roundPlayerStats: officialRows(roundPlayerStats),
    flagCarrierKills: officialRows(flagCarrierKills),
  });
  if (!performance.available || performance.players.length !== roster.size) {
    return unavailable("incomplete_official_performance");
  }
  return { ...performance, ...metadata };
}

module.exports = { buildEloPerformance };
