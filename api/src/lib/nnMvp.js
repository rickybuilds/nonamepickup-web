"use strict";

const FORMULA_VERSION = "nn-mvp-v1";
const MIN_PLAYERS = 4;
const Z_CLAMP = 3;

const COMPONENTS = {
  combat: {
    kills: 22,
    enemy_damage: 12,
    kdr: 10
  },
  objective: {
    flag_touches: 14,
    initial_touches: 10,
    flag_captures: 6,
    flag_time_seconds: 3
  },
  impact: {
    conced_kills: 10,
    sentry_kills: 8,
    flag_carrier_kills: 8
  },
  penalty: {
    team_kills: -10,
    suicides: -5,
    deaths: -4,
    team_damage: -3
  }
};

const RANK_DESC_FIELDS = [
  "kills",
  "enemy_damage",
  "kdr",
  "flag_touches",
  "initial_touches",
  "flag_captures",
  "flag_time_seconds",
  "conced_kills",
  "sentry_kills",
  "flag_carrier_kills"
];

const RANK_ASC_FIELDS = [
  "team_kills",
  "deaths",
  "suicides",
  "team_damage"
];

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function roundScore(value) {
  return Math.round(num(value) * 100) / 100;
}

function roundDisplayScore(value) {
  return Math.round(num(value) * 10) / 10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function playerIdentity(row) {
  return String(row?.player_key || row?.steam_id || row?.display_name || "");
}

function emptyPayload(reason) {
  return {
    formula_version: FORMULA_VERSION,
    available: false,
    reason,
    winner: null,
    players: []
  };
}

function addToMap(map, key, values) {
  if (!key) return;
  const current = map.get(key) || {};
  for (const [name, value] of Object.entries(values)) {
    current[name] = num(current[name]) + num(value);
  }
  map.set(key, current);
}

function aggregateRoundStats(rows) {
  const byPlayer = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = playerIdentity(row);
    addToMap(byPlayer, key, {
      suicides: row.suicides,
      conced_kills: row.conced_kills,
      sentry_kills: row.sentry_kills
    });
  }
  return byPlayer;
}

function aggregateFlagCarrierKills(rows) {
  const byPlayer = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = playerIdentity(row) || String(row?.attacker_key || row?.attacker_steam_id || "");
    addToMap(byPlayer, key, {
      flag_carrier_kills: row.flag_carrier_kills
    });
  }
  return byPlayer;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stddev(values, avg) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function zScores(players, field) {
  const values = players.map(player => num(player.raw[field]));
  const avg = mean(values);
  const sd = stddev(values, avg);
  const out = new Map();
  for (const player of players) {
    const z = sd > 0 ? (num(player.raw[field]) - avg) / sd : 0;
    out.set(player.player_key, clamp(z, -Z_CLAMP, Z_CLAMP));
  }
  return out;
}

function rankPlayers(players, field, ascending = false) {
  const sorted = [...players].sort((a, b) => {
    const diff = ascending
      ? num(a.raw[field]) - num(b.raw[field])
      : num(b.raw[field]) - num(a.raw[field]);
    if (diff) return diff;
    return String(a.player_key).localeCompare(String(b.player_key));
  });
  const ranks = new Map();
  let previousValue = null;
  let previousRank = 0;
  sorted.forEach((player, index) => {
    const value = num(player.raw[field]);
    const rank = previousValue !== null && value === previousValue ? previousRank : index + 1;
    ranks.set(player.player_key, rank);
    previousValue = value;
    previousRank = rank;
  });
  return ranks;
}

function calculateComponent(players, player, component, zByField) {
  let score = 0;
  for (const [field, weight] of Object.entries(COMPONENTS[component])) {
    score += weight * num(zByField[field]?.get(player.player_key));
  }
  return score;
}

function displayScale(value, min, max) {
  if (max === min) return 12.5;
  return roundDisplayScore(((num(value) - min) / (max - min)) * 25);
}

function addDisplayScores(players) {
  const componentKeys = [
    ["combat", "combat"],
    ["objective", "objective"],
    ["impact", "impact"],
    ["penalty", "discipline"]
  ];

  for (const [rawKey, displayKey] of componentKeys) {
    const values = players.map(player => num(player.components[rawKey]));
    const min = Math.min(...values);
    const max = Math.max(...values);

    for (const player of players) {
      if (!player.display_components) player.display_components = {};
      player.display_components[displayKey] = displayScale(player.components[rawKey], min, max);
    }
  }

  for (const player of players) {
    player.display_score = roundDisplayScore(
      num(player.display_components.combat)
      + num(player.display_components.objective)
      + num(player.display_components.impact)
      + num(player.display_components.discipline)
    );
  }
}

function buildReasons(winner) {
  const reasons = [];
  const raw = winner.raw;
  const ranks = winner.ranks;
  const push = reason => {
    if (reasons.length < 5 && reason) reasons.push(reason);
  };

  if (ranks.kills === 1) push("#1 in kills");
  if (ranks.enemy_damage === 1) push("#1 in enemy damage");
  if (ranks.kdr === 1) push("#1 in KDR");
  if (ranks.flag_touches === 1) push("#1 in flag touches");
  if (ranks.initial_touches === 1) push("#1 in initial touches");
  if (num(raw.flag_captures) > 0 && ranks.flag_captures <= 3) push(`${num(raw.flag_captures)} captures`);
  if (num(raw.conced_kills) > 0 && ranks.conced_kills <= 3) push(`${num(raw.conced_kills)} conced kills`);
  if (num(raw.sentry_kills) > 0 && ranks.sentry_kills <= 3) push(`${num(raw.sentry_kills)} sentry kills`);
  if (num(raw.flag_carrier_kills) > 0 && ranks.flag_carrier_kills <= 3) push(`${num(raw.flag_carrier_kills)} flag carrier kills`);
  if (num(raw.team_kills) <= 1 && ranks.team_kills_low <= 3) push("low team kills");

  return reasons;
}

function publicPlayer(player, includeReasons = false) {
  const out = {
    player_key: player.player_key,
    steam_id: player.steam_id,
    display_name: player.display_name,
    rank: player.rank,
    final_score: roundScore(player.final_score),
    components: {
      combat: roundScore(player.components.combat),
      objective: roundScore(player.components.objective),
      impact: roundScore(player.components.impact),
      penalty: roundScore(player.components.penalty)
    },
    display_score: roundDisplayScore(player.display_score),
    display_components: {
      combat: roundDisplayScore(player.display_components?.combat),
      objective: roundDisplayScore(player.display_components?.objective),
      impact: roundDisplayScore(player.display_components?.impact),
      discipline: roundDisplayScore(player.display_components?.discipline)
    },
    raw: player.raw,
    ranks: player.ranks
  };
  if (includeReasons) out.reasons = player.reasons || [];
  return out;
}

function buildNnMvp({ playerStats, roundPlayerStats, flagCarrierKills }) {
  const statRows = Array.isArray(playerStats) ? playerStats : [];
  if (statRows.length < MIN_PLAYERS) {
    return emptyPayload("Not enough player stat rows");
  }

  const roundByPlayer = aggregateRoundStats(roundPlayerStats);
  const carrierByPlayer = aggregateFlagCarrierKills(flagCarrierKills);

  const players = statRows.map(row => {
    const key = playerIdentity(row);
    const roundStats = roundByPlayer.get(key) || {};
    const carrierStats = carrierByPlayer.get(key) || {};
    const kills = num(row.kills);
    const deaths = num(row.deaths);
    const raw = {
      kills,
      deaths,
      enemy_damage: num(row.enemy_damage ?? row.damage),
      team_damage: num(row.team_damage),
      team_kills: num(row.team_kills),
      flag_captures: num(row.flag_captures ?? row.caps),
      flag_touches: num(row.flag_touches ?? row.touches),
      initial_touches: num(row.initial_touches),
      flag_time_seconds: num(row.flag_time_seconds),
      kdr: kills / Math.max(deaths, 1),
      suicides: num(roundStats.suicides),
      conced_kills: num(roundStats.conced_kills),
      sentry_kills: num(roundStats.sentry_kills),
      flag_carrier_kills: num(carrierStats.flag_carrier_kills)
    };
    return {
      player_key: key,
      steam_id: row.steam_id || null,
      display_name: row.display_name || key || "Unknown",
      raw,
      ranks: {},
      components: {}
    };
  }).filter(player => player.player_key);

  if (players.length < MIN_PLAYERS) {
    return emptyPayload("Not enough player stat rows");
  }

  const zByField = {};
  for (const field of [
    ...Object.keys(COMPONENTS.combat),
    ...Object.keys(COMPONENTS.objective),
    ...Object.keys(COMPONENTS.impact),
    ...Object.keys(COMPONENTS.penalty)
  ]) {
    zByField[field] = zScores(players, field);
  }

  for (const field of RANK_DESC_FIELDS) {
    const ranks = rankPlayers(players, field, false);
    for (const player of players) player.ranks[field] = ranks.get(player.player_key);
  }

  for (const field of RANK_ASC_FIELDS) {
    const ranks = rankPlayers(players, field, true);
    for (const player of players) player.ranks[`${field}_low`] = ranks.get(player.player_key);
  }

  for (const player of players) {
    player.components.combat = calculateComponent(players, player, "combat", zByField);
    player.components.objective = calculateComponent(players, player, "objective", zByField);
    player.components.impact = calculateComponent(players, player, "impact", zByField);
    player.components.penalty = calculateComponent(players, player, "penalty", zByField);
    player.final_score = 50
      + player.components.combat
      + player.components.objective
      + player.components.impact
      + player.components.penalty;
  }

  addDisplayScores(players);

  players.sort((a, b) =>
    (num(b.final_score) - num(a.final_score)) ||
    (num(b.components.combat) - num(a.components.combat)) ||
    (num(b.components.objective) - num(a.components.objective)) ||
    (num(b.components.penalty) - num(a.components.penalty)) ||
    (num(b.raw.kills) - num(a.raw.kills)) ||
    String(a.player_key).localeCompare(String(b.player_key))
  );

  players.forEach((player, index) => {
    player.rank = index + 1;
  });

  const winner = players[0];
  winner.reasons = buildReasons(winner);

  return {
    formula_version: FORMULA_VERSION,
    available: true,
    winner: publicPlayer(winner, true),
    players: players.map(player => publicPlayer(player))
  };
}

module.exports = {
  FORMULA_VERSION,
  buildNnMvp
};
