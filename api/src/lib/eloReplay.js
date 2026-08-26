"use strict";

const SCENARIOS = {
  wide: { key: "wide", label: "15%-35%", alpha: 0.35, minShare: 0.15, maxShare: 0.35 },
  gentle: { key: "gentle", label: "20%-30%", alpha: 0.20, minShare: 0.20, maxShare: 0.30 }
};

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function boundedShares(rawShares, minShare, maxShare) {
  const shares = Array(rawShares.length).fill(0);
  const active = new Set(rawShares.map((_, index) => index));
  let remainingMass = 1;

  while (active.size) {
    const activeWeight = [...active].reduce((sum, index) => sum + rawShares[index], 0);
    const proposed = new Map([...active].map(index => [
      index,
      activeWeight > 0 ? (rawShares[index] / activeWeight) * remainingMass : remainingMass / active.size
    ]));
    const violations = [...active].map(index => {
      const share = proposed.get(index);
      if (share < minShare) return { index, fixed: minShare, distance: minShare - share };
      if (share > maxShare) return { index, fixed: maxShare, distance: share - maxShare };
      return null;
    }).filter(Boolean).sort((a, b) => b.distance - a.distance || a.index - b.index);
    if (!violations.length) {
      for (const index of active) shares[index] = proposed.get(index);
      break;
    }
    const violation = violations[0];
    shares[violation.index] = violation.fixed;
    remainingMass -= violation.fixed;
    active.delete(violation.index);
  }

  const drift = 1 - shares.reduce((sum, share) => sum + share, 0);
  if (Math.abs(drift) > 1e-12) {
    const index = shares.findIndex(share => share + drift >= minShare - 1e-12 && share + drift <= maxShare + 1e-12);
    if (index >= 0) shares[index] += drift;
  }
  return shares;
}

function largestRemainder(pool, shares, ids) {
  const magnitude = Math.abs(Math.trunc(pool));
  if (!magnitude) return shares.map(() => 0);
  const quotas = shares.map(share => share * magnitude);
  const values = quotas.map(Math.floor);
  let remaining = magnitude - values.reduce((sum, value) => sum + value, 0);
  const order = quotas.map((quota, index) => ({
    index,
    remainder: quota - values[index],
    id: String(ids[index])
  })).sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  for (let index = 0; index < remaining; index += 1) values[order[index].index] += 1;
  return values.map(value => pool < 0 ? -value : value);
}

function allocateTeamPool(poolValue, players, scenario, equalShare = false) {
  const pool = Math.trunc(number(poolValue) || 0);
  const config = typeof scenario === "string" ? SCENARIOS[scenario] : scenario;
  if (!config) throw new Error("Unknown Elo allocation scenario");
  if (!Array.isArray(players) || players.length !== 4) throw new Error("A team must contain exactly four players");

  let shares = players.map(() => 0.25);
  if (!equalShare) {
    const scores = players.map(player => number(player.final_score));
    if (scores.some(score => score == null)) throw new Error("Every player requires a final_score");
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + ((score - mean) ** 2), 0) / scores.length;
    const standardDeviation = Math.sqrt(variance);
    if (standardDeviation > 0) {
      const direction = pool < 0 ? -1 : 1;
      const weights = scores.map(score => {
        const zScore = clamp((score - mean) / standardDeviation, -2, 2);
        return Math.exp(direction * config.alpha * zScore);
      });
      const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
      const rawShares = weights.map(weight => weight / weightTotal);
      shares = boundedShares(rawShares, config.minShare, config.maxShare);
    }
  }

  const deltas = largestRemainder(pool, shares, players.map(player => player.id));
  return players.map((player, index) => ({
    id: String(player.id),
    share: shares[index],
    delta: deltas[index]
  }));
}

function unique(values) {
  return new Set(values.map(String)).size === values.length;
}

function fallbackReasons(match) {
  const reasons = [];
  const blueIds = match.blue_ids.map(String);
  const redIds = match.red_ids.map(String);
  const roster = [...blueIds, ...redIds];
  const performance = Array.isArray(match.performance?.players) ? match.performance.players : [];
  const mappedIds = performance.map(player => player.discord_id == null ? "" : String(player.discord_id));

  if (blueIds.length !== 4 || redIds.length !== 4 || !unique(blueIds) || !unique(redIds) || !unique(roster)) {
    reasons.push("official_roster_not_four_per_team");
  }
  if (!match.performance?.available) reasons.push("statistics_unavailable");
  if (match.performance?.formula_version !== "nn-mvp-v1") reasons.push("formula_version_not_nn_mvp_v1");
  if (performance.length !== 8) reasons.push("performance_row_count_not_eight");
  if (performance.some(player => !player.player_key || !player.steam_id)) reasons.push("missing_steam_or_player_identity");
  if (mappedIds.some(id => !id)) reasons.push("performance_identity_unmapped");
  if (mappedIds.filter(Boolean).length !== new Set(mappedIds.filter(Boolean)).size) reasons.push("performance_identity_duplicated");
  if (roster.length === 8 && (mappedIds.length !== 8 || roster.some(id => !mappedIds.includes(id)))) {
    reasons.push("performance_roster_mapping_incomplete");
  }
  if (performance.some(player => number(player.final_score) == null)) reasons.push("final_score_missing");
  const scoresById = new Map(performance.filter(player => player.discord_id != null).map(player => [String(player.discord_id), number(player.final_score)]));
  for (const [team, ids] of [["blue", blueIds], ["red", redIds]]) {
    const scores = ids.map(id => scoresById.get(id));
    if (scores.length === 4 && scores.every(score => score != null)) {
      const mean = scores.reduce((sum, score) => sum + score, 0) / 4;
      const variance = scores.reduce((sum, score) => sum + ((score - mean) ** 2), 0) / 4;
      if (variance === 0) reasons.push(`${team}_team_standard_deviation_zero`);
    }
  }
  return [...new Set(reasons)];
}

function replayFixedPool(inputMatches) {
  const matches = [...inputMatches].sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0) || String(a.match_id).localeCompare(String(b.match_id)));
  const states = new Map();
  const validation = [];
  const outputGames = [];
  const labels = ["Start", ...matches.map(match => String(match.match_id))];

  function stateFor(id, name, before, gameIndex) {
    const key = String(id);
    if (!states.has(key)) {
      if (number(before) == null) return null;
      const start = number(before);
      const padding = Array(gameIndex + 1).fill(null);
      padding[0] = start;
      states.set(key, {
        id: key,
        name: name || key,
        start,
        actual: start,
        games: 0,
        paths: { actual: [...padding] }
      });
    }
    return states.get(key);
  }

  matches.forEach((match, gameIndex) => {
    const blueIds = (match.blue_ids || []).map(String);
    const redIds = (match.red_ids || []).map(String);
    const roster = [...blueIds, ...redIds];
    const changesById = new Map();
    for (const change of match.rating_changes || []) {
      const id = String(change.player_id);
      const list = changesById.get(id) || [];
      list.push(change);
      changesById.set(id, list);
    }
    for (const [id, rows] of changesById) {
      if (rows.length > 1) validation.push({ match_id: String(match.match_id), player_id: id, type: "duplicate_rating_change", detail: `${rows.length} rows` });
    }
    for (const id of roster) {
      if (!changesById.has(id)) validation.push({ match_id: String(match.match_id), player_id: id, type: "missing_rating_change", detail: "Official roster player has no recorded V1 row" });
    }

    const changes = new Map([...changesById].map(([id, rows]) => [id, rows[0]]));
    const poolFor = ids => ids.reduce((sum, id) => sum + (number(changes.get(id)?.delta) || 0), 0);
    const pools = { BLUE: poolFor(blueIds), RED: poolFor(redIds) };
    const reasons = fallbackReasons({ ...match, blue_ids: blueIds, red_ids: redIds });
    const fallback = reasons.length > 0;
    const invalidPerformance = reasons.some(reason => !reason.endsWith("_team_standard_deviation_zero"));
    const performanceById = new Map((match.performance?.players || []).filter(player => player.discord_id != null).map(player => [String(player.discord_id), player]));

    const actualAllocations = {};
    for (const [team, ids] of [["BLUE", blueIds], ["RED", redIds]]) {
      if (ids.length !== 4) continue;
      const teamPlayers = ids.map(id => ({ id, final_score: performanceById.get(id)?.final_score }));
      actualAllocations[team] = allocateTeamPool(pools[team], teamPlayers, SCENARIOS.gentle, invalidPerformance || reasons.includes(`${team.toLowerCase()}_team_standard_deviation_zero`));
      const allocation = actualAllocations[team];
      const allocatedPool = allocation.reduce((sum, row) => sum + row.delta, 0);
      if (allocatedPool !== pools[team]) {
        validation.push({ match_id: String(match.match_id), player_id: null, type: "team_pool_not_conserved", detail: `${team} actual: ${allocatedPool} != ${pools[team]}` });
      }
      if (allocation.some(row => row.share < SCENARIOS.gentle.minShare - 1e-9 || row.share > SCENARIOS.gentle.maxShare + 1e-9)) {
        validation.push({ match_id: String(match.match_id), player_id: null, type: "share_bound_violation", detail: `${team} actual` });
      }
      const winner = String(match.winner || "").toUpperCase();
      const isWinner = winner === team;
      const isLoser = (winner === "BLUE" || winner === "RED") && winner !== team;
      if (isWinner && allocation.some(row => row.delta < 0)) {
        validation.push({ match_id: String(match.match_id), player_id: null, type: "winner_sign_violation", detail: `${team} actual` });
      }
      if (isLoser && allocation.some(row => row.delta > 0)) {
        validation.push({ match_id: String(match.match_id), player_id: null, type: "loser_sign_violation", detail: `${team} actual` });
      }
    }

    const playerRows = [];
    for (const [team, ids] of [["BLUE", blueIds], ["RED", redIds]]) {
      const ranked = ids.map(id => ({ id, score: number(performanceById.get(id)?.final_score) }))
        .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.id.localeCompare(b.id));
      const rankById = new Map(ranked.map((player, index) => [player.id, index + 1]));
      for (const id of ids) {
        const change = changes.get(id);
        const performance = performanceById.get(id) || {};
        const state = stateFor(id, change?.display_name || performance.display_name, change?.before, gameIndex);
        const actual = actualAllocations[team]?.find(row => row.id === id) || { delta: 0, share: 0.25 };
        const historicalBefore = number(change?.before);
        const historicalAfter = number(change?.after);
        const historicalDelta = number(change?.delta);
        const simulatedStart = state ? { actual: state.actual } : null;

        if (change && historicalBefore != null && historicalDelta != null && historicalAfter != null && historicalBefore + historicalDelta !== historicalAfter) {
          validation.push({ match_id: String(match.match_id), player_id: id, type: "rating_row_arithmetic", detail: `${historicalBefore} + ${historicalDelta} != ${historicalAfter}` });
        }
        if (state) {
          state.name = change?.display_name || performance.display_name || state.name;
          state.games += 1;
          state.actual += actual.delta;
        }

        playerRows.push({
          id,
          name: change?.display_name || performance.display_name || id,
          team,
          before: historicalBefore,
          simulated_start: simulatedStart,
          nn_score: number(performance.final_score),
          rank: rankById.get(id) || null,
          actual_delta: actual.delta,
          actual_share: actual.share
        });
      }
    }

    for (const state of states.values()) state.paths.actual.push(state.actual);

    const winner = String(match.winner || "").toUpperCase();
    if ((winner === "BLUE" && pools.BLUE < 0) || (winner === "RED" && pools.RED < 0)) {
      validation.push({ match_id: String(match.match_id), player_id: null, type: "winner_pool_sign", detail: `${winner} recorded pool is negative` });
    }
    outputGames.push({
      match_id: String(match.match_id),
      created_at: Number(match.created_at || 0),
      map_name: match.map_name || null,
      winner: match.winner || null,
      pools,
      fallback,
      fallback_reasons: reasons,
      incomplete: roster.some(id => !states.has(id)),
      players: playerRows
    });
  });

  const players = [...states.values()].sort((a, b) => b.actual - a.actual || a.name.localeCompare(b.name));
  const fallbackCounts = {};
  for (const game of outputGames.filter(game => game.fallback)) {
    for (const reason of game.fallback_reasons) fallbackCounts[reason] = (fallbackCounts[reason] || 0) + 1;
  }

  return {
    mode: "fixed_pool",
    scenarios: { actual: { ...SCENARIOS.gentle, key: "actual", label: "20%-30%" } },
    labels,
    players,
    games: outputGames,
    validation,
    summary: {
      matches_requested: matches.length,
      matches_simulated: outputGames.filter(game => !game.incomplete).length,
      fallback_matches: outputGames.filter(game => game.fallback).length,
      fallback_reasons: fallbackCounts,
      validation_discrepancies: validation.length
    }
  };
}

module.exports = {
  SCENARIOS,
  boundedShares,
  largestRemainder,
  allocateTeamPool,
  replayFixedPool
};
