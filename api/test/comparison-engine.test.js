"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
  ExternalBaselineService
} = require("../src/speedruns/externalBaselineService");
const {
  SpeedrunComparisonRepository,
  COMPARISON_SNAPSHOT_SQL
} = require("../src/speedruns/comparisonRepository");
const {
  createSpeedrunComparisonsRouter
} = require("../src/routes/speedrunComparisons");
const {
  CLASS_NAMES,
  recordClassName,
  formatTimeMs,
  isValidRunTimeMs
} = require("../src/speedruns/domain");
const {
  SCENARIOS,
  boundedShares,
  largestRemainder,
  allocateTeamPool,
  replayFixedPool
} = require("../src/lib/eloReplay");

function row(overrides = {}) {
  return {
    mapKey: "aowconc",
    classId: 3,
    internalMapId: "aowconc",
    mapDisplayName: "AOW Conc",
    mapCategory: "conc",
    mapEnabled: 1,
    internalSteamId: "STEAM_0:1:1",
    internalDiscordId: "123",
    internalPlayerName: "Internal Runner",
    internalClassName: "Soldier",
    internalTimeMs: 31_442,
    internalAchievedAt: new Date("2026-07-01T00:00:00Z"),
    internalUpdatedAt: new Date("2026-07-01T00:00:00Z"),
    externalSource: "squishy",
    externalSourceUrl: "https://example.test/squishy/aowconc",
    externalMapNameRaw: "aowconc",
    externalMapNameNormalized: "aowconc",
    externalMapId: "aowconc",
    externalClassName: "SOLDIER",
    externalPlayerName: "External Runner",
    externalTimeRaw: "31.318",
    externalTimeMs: 31_318,
    externalScrapedAt: new Date("2026-07-28T00:00:00Z"),
    externalUpdatedAt: new Date("2026-07-28T00:00:00Z"),
    ...overrides
  };
}

function fixtureRows() {
  return [
    row(),
    row({
      externalSource: "churchofconc",
      externalSourceUrl: "https://example.test/church/aowconc",
      externalMapNameRaw: "aow_conc",
      externalMapNameNormalized: "aow_conc",
      externalPlayerName: "Church Runner",
      externalTimeRaw: "00:00:31.501",
      externalTimeMs: 31_501
    }),
    row({
      mapKey: "internal_only",
      classId: 5,
      internalMapId: "internal_only",
      mapDisplayName: "Internal Only",
      internalClassName: "Medic",
      internalTimeMs: 20_000,
      externalSource: null,
      externalSourceUrl: null,
      externalMapNameRaw: null,
      externalMapNameNormalized: null,
      externalMapId: null,
      externalClassName: null,
      externalPlayerName: null,
      externalTimeRaw: null,
      externalTimeMs: null,
      externalScrapedAt: null,
      externalUpdatedAt: null
    }),
    row({
      mapKey: "external_only",
      classId: 1,
      internalMapId: null,
      mapDisplayName: null,
      mapCategory: null,
      mapEnabled: null,
      internalSteamId: null,
      internalDiscordId: null,
      internalPlayerName: null,
      internalClassName: null,
      internalTimeMs: null,
      internalAchievedAt: null,
      internalUpdatedAt: null,
      externalMapNameRaw: "external_only",
      externalMapNameNormalized: "external_only",
      externalMapId: null,
      externalClassName: "SCOUT",
      externalTimeRaw: "42.000",
      externalTimeMs: 42_000
    }),
    row({
      mapKey: "matched_without_internal",
      classId: 5,
      internalMapId: "matched_without_internal",
      mapDisplayName: "Matched Without Internal",
      internalSteamId: null,
      internalDiscordId: null,
      internalPlayerName: null,
      internalClassName: null,
      internalTimeMs: null,
      internalAchievedAt: null,
      internalUpdatedAt: null,
      externalMapNameRaw: "matched_without_internal",
      externalMapNameNormalized: "matched_without_internal",
      externalMapId: "matched_without_internal",
      externalClassName: "MEDIC",
      externalTimeRaw: "50.000",
      externalTimeMs: 50_000
    })
  ];
}

function serviceFixture(options = {}) {
  let snapshotQueries = 0;
  const repository = {
    async fetchComparisonRows() {
      snapshotQueries += 1;
      return fixtureRows();
    },
    async fetchPlayerRecords(discordId) {
      return [{
        map: "aowconc",
        classId: 3,
        className: "Soldier",
        steamId: "STEAM_0:1:1",
        discordId,
        playerName: "Internal Runner",
        timeMs: 31_442,
        achievedAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z")
      }];
    }
  };
  const service = new ExternalBaselineService({
    repository,
    ruleset: 2,
    minimumValidTimeMs: options.minimumValidTimeMs || 1,
    cacheTtlMs: options.cacheTtlMs || 30_000,
    now: options.now || (() => Date.parse("2026-07-28T12:00:00Z"))
  });
  return { service, snapshotQueries: () => snapshotQueries };
}

test("shared speedrun domain preserves existing class and time behavior", () => {
  assert.equal(CLASS_NAMES[6], "Heavy");
  assert.equal(recordClassName({ class_id: 6, class_name: "-" }), "Heavy");
  assert.equal(recordClassName({ class_id: 3, class_name: "Soldier" }), "Soldier");
  assert.equal(formatTimeMs(31_442), "0:31.442");
  assert.equal(isValidRunTimeMs(2_000, 2_000), true);
  assert.equal(isValidRunTimeMs(1_999, 2_000), false);
});

test("compares one map/class and identifies the fastest source and signed delta", async () => {
  const { service } = serviceFixture();
  const comparison = await service.getMapClass("AOWCONC", 3);

  assert.equal(comparison.internal.time.milliseconds, 31_442);
  assert.deepEqual(comparison.externals.map(record => record.source.id), [
    "squishy",
    "churchofconc"
  ]);
  assert.equal(comparison.fastestExternal.source.id, "squishy");
  assert.equal(comparison.map.normalized, "aowconc");
  assert.equal(comparison.externals[1].externalMap.normalizedName, "aow_conc");
  assert.equal(comparison.fastestOverall.source.id, "squishy");
  assert.equal(comparison.difference.signedMilliseconds, 124);
  assert.equal(comparison.difference.display, "+0.124");
  assert.equal(comparison.difference.relation, "behind");
  assert.equal(comparison.status, "external_faster");
  assert.equal(comparison.internalIsFaster, false);
});

test("snapshot is set-based, cached, and supports summaries and external-only maps", async () => {
  const { service, snapshotQueries } = serviceFixture();
  const [summary, leaderboard, externalOnly, missingInternal] = await Promise.all([
    service.getSummary(),
    service.getLeaderboard(),
    service.getExternalOnlyMaps(),
    service.getMapsWithoutInternalRecords()
  ]);

  assert.equal(snapshotQueries(), 1);
  assert.equal(summary.totals.mapClasses, 4);
  assert.equal(summary.totals.externalFaster, 1);
  assert.equal(summary.totals.noExternalBaseline, 1);
  assert.equal(summary.totals.noInternalRecord, 2);
  assert.equal(summary.totals.externalOnlyMaps, 1);
  assert.equal(summary.totals.mapsWithNoInternalRecords, 2);
  assert.equal(leaderboard.items.length, 4);
  assert.equal(externalOnly.items.length, 1);
  assert.equal(externalOnly.items[0].map.normalized, "external_only");
  assert.deepEqual(
    missingInternal.items.map(item => item.map.normalized),
    ["external_only", "matched_without_internal"]
  );
});

test("player summaries compare personal bests without N+1 external queries", async () => {
  const { service, snapshotQueries } = serviceFixture();
  const player = await service.getPlayerSummary("123");

  assert.equal(snapshotQueries(), 1);
  assert.equal(player.player.name, "Internal Runner");
  assert.equal(player.summary.recordsCompared, 1);
  assert.equal(player.summary.behind, 1);
  assert.equal(player.summary.internalWorldRecords, 1);
  assert.equal(player.comparisons[0].difference.signedMilliseconds, 124);
});

test("repository owns reusable window-function SQL and passes bounded parameters", async () => {
  const calls = [];
  const repository = new SpeedrunComparisonRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return [];
    }
  });

  await repository.fetchComparisonRows(2, 2_000);
  await repository.fetchPlayerRecords("123", 2, 2_000);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, [2, 2_000, 2_000]);
  assert.deepEqual(calls[1].params, ["123", 2, 2_000]);
  assert.match(COMPARISON_SNAPSHOT_SQL, /ROW_NUMBER\(\) OVER/);
  assert.match(COMPARISON_SNAPSHOT_SQL, /comparison_keys/);
  assert.match(COMPARISON_SNAPSHOT_SQL, /best_time_ms >= \?/);
  assert.match(COMPARISON_SNAPSHOT_SQL, /time_ms >= \?/);
});

test("sub-threshold candidates cannot become comparison records or announcements", async () => {
  const { service } = serviceFixture({ minimumValidTimeMs: 2_000 });
  const result = await service.compareCandidate({
    map: "aowconc",
    classId: 3,
    timeMs: 1_999
  });

  assert.equal(result.eligible, false);
  assert.equal(result.minimumValidTimeMs, 2_000);
  assert.equal(result.candidate.time, null);
  assert.equal(result.difference.relation, "unknown");
  assert.equal(result.beatsExternal, null);
});

test("comparison HTTP routes remain thin service adapters", async t => {
  const calls = [];
  const fakeService = {
    async getSummary() {
      calls.push("summary");
      return { totals: { mapClasses: 3 } };
    },
    async getMapClass(map, classId) {
      calls.push(["mapClass", map, classId]);
      return { map: { id: map }, class: { id: classId } };
    }
  };
  const app = express();
  app.use("/api/speedruns/comparisons", createSpeedrunComparisonsRouter({
    service: fakeService,
    logRouteError() {}
  }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const summaryResponse = await fetch(`${base}/api/speedruns/comparisons/summary`);
  assert.equal(summaryResponse.status, 200);
  assert.deepEqual(await summaryResponse.json(), { totals: { mapClasses: 3 } });

  const mapResponse = await fetch(
    `${base}/api/speedruns/comparisons/maps/aowconc/classes/3`
  );
  assert.equal(mapResponse.status, 200);
  assert.deepEqual(await mapResponse.json(), {
    map: { id: "aowconc" },
    class: { id: 3 }
  });

  const invalidResponse = await fetch(
    `${base}/api/speedruns/comparisons/leaderboard?status=invalid`
  );
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(calls, ["summary", ["mapClass", "aowconc", 3]]);
});

function eloPlayers(scores = [10, 20, 30, 40]) {
  return scores.map((final_score, index) => ({ id: `p${index + 1}`, final_score }));
}

function replayMatch({ index = 1, winner = "BLUE", blueDelta = 16, redDelta = -20, available = true } = {}) {
  const blueIds = ["p1", "p2", "p3", "p4"];
  const redIds = ["p5", "p6", "p7", "p8"];
  const allIds = [...blueIds, ...redIds];
  return {
    match_id: `m${index}`,
    created_at: index,
    map_name: "2fort",
    winner,
    blue_ids: blueIds,
    red_ids: redIds,
    rating_changes: allIds.map((player_id, playerIndex) => {
      const delta = blueIds.includes(player_id) ? blueDelta : redDelta;
      const priorDelta = (index - 1) * delta;
      return {
        player_id,
        display_name: player_id.toUpperCase(),
        before: 1000 + playerIndex + priorDelta,
        delta,
        after: 1000 + playerIndex + priorDelta + delta
      };
    }),
    performance: {
      available,
      formula_version: "nn-mvp-v1",
      players: allIds.map((id, playerIndex) => ({
        player_key: `steam-${id}`,
        steam_id: `steam-${id}`,
        discord_id: id,
        display_name: id.toUpperCase(),
        final_score: 10 + (playerIndex % 4) * 10
      }))
    }
  };
}

test("Shadow Elo uses bounded softmax for positive winner pools", () => {
  const allocation = allocateTeamPool(64, eloPlayers(), SCENARIOS.wide);
  assert.equal(allocation.reduce((sum, row) => sum + row.delta, 0), 64);
  assert.ok(allocation.every(row => row.delta >= 0));
  assert.ok(allocation.every(row => row.share >= 0.15 - 1e-9 && row.share <= 0.35 + 1e-9));
  assert.ok(allocation[3].delta > allocation[0].delta);

  const scores = [10, 20, 30, 40];
  const mean = 25;
  const sd = Math.sqrt(scores.reduce((sum, score) => sum + ((score - mean) ** 2), 0) / 4);
  const weights = scores.map(score => Math.exp(0.35 * Math.max(-2, Math.min(2, (score - mean) / sd))));
  const expected = boundedShares(weights.map(weight => weight / weights.reduce((sum, item) => sum + item, 0)), 0.15, 0.35);
  allocation.forEach((row, index) => assert.ok(Math.abs(row.share - expected[index]) < 1e-10));
});

test("negative loser softmax reverses performance weighting", () => {
  const allocation = allocateTeamPool(-80, eloPlayers(), SCENARIOS.wide);
  assert.equal(allocation.reduce((sum, row) => sum + row.delta, 0), -80);
  assert.ok(allocation.every(row => row.delta <= 0));
  assert.ok(Math.abs(allocation[3].delta) < Math.abs(allocation[0].delta));
});

test("gentle softmax stays within 20%-30% and conserves the pool", () => {
  const allocation = allocateTeamPool(65, eloPlayers(), SCENARIOS.gentle);
  assert.equal(allocation.reduce((sum, row) => sum + row.delta, 0), 65);
  assert.ok(allocation.every(row => row.share >= 0.20 - 1e-9 && row.share <= 0.30 + 1e-9));
});

test("bounded redistribution fixes limits and proportionally redistributes mass", () => {
  const shares = boundedShares([0.90, 0.04, 0.03, 0.03], 0.15, 0.35);
  assert.ok(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 1) < 1e-10);
  assert.equal(shares[0], 0.35);
  assert.ok(shares.slice(1).every(share => share >= 0.15 && share <= 0.35));
  assert.ok(Math.abs(shares[1] / shares[2] - 4 / 3) < 1e-10);
});

test("largest-remainder rounding is deterministic and exact", () => {
  assert.deepEqual(largestRemainder(65, [0.25, 0.25, 0.25, 0.25], ["a", "b", "c", "d"]), [17, 16, 16, 16]);
  assert.deepEqual(largestRemainder(-65, [0.25, 0.25, 0.25, 0.25], ["a", "b", "c", "d"]), [-17, -16, -16, -16]);
});

test("invalid performance and zero variance use equal-share fallback", () => {
  const invalidReplay = replayFixedPool([replayMatch({ available: false })]);
  assert.equal(invalidReplay.games[0].fallback, true);
  assert.ok(invalidReplay.games[0].fallback_reasons.includes("statistics_unavailable"));
  assert.deepEqual(invalidReplay.games[0].players.filter(row => row.team === "BLUE").map(row => row.wide_delta), [16, 16, 16, 16]);

  const zeroVariance = replayMatch();
  zeroVariance.performance.players.forEach(player => { player.final_score = 50; });
  const zeroReplay = replayFixedPool([zeroVariance]);
  assert.ok(zeroReplay.games[0].fallback_reasons.includes("blue_team_standard_deviation_zero"));
  assert.deepEqual(zeroReplay.games[0].players.filter(row => row.team === "RED").map(row => row.gentle_delta), [-20, -20, -20, -20]);
});

test("missing, extra, and duplicated identity mappings trigger fallbacks", () => {
  const missing = replayMatch();
  missing.performance.players[0].discord_id = null;
  const extra = replayMatch({ index: 2 });
  extra.performance.players.push({ player_key: "steam-extra", steam_id: "steam-extra", discord_id: "extra", final_score: 50 });
  const duplicate = replayMatch({ index: 3 });
  duplicate.performance.players[1].discord_id = duplicate.performance.players[0].discord_id;
  const replay = replayFixedPool([missing, extra, duplicate]);
  assert.ok(replay.games[0].fallback_reasons.includes("performance_identity_unmapped"));
  assert.ok(replay.games[1].fallback_reasons.includes("performance_row_count_not_eight"));
  assert.ok(replay.games[2].fallback_reasons.includes("performance_identity_duplicated"));
});

test("fixed-pool replay is chronological, cumulative, separate, and read-only", () => {
  const fixture = [replayMatch({ index: 3 }), replayMatch({ index: 1 }), replayMatch({ index: 2 })];
  const original = structuredClone(fixture);
  const replay = replayFixedPool(fixture);
  assert.deepEqual(replay.games.map(game => game.match_id), ["m1", "m2", "m3"]);
  const player = replay.players.find(row => row.id === "p4");
  assert.equal(player.games, 3);
  assert.equal(player.actual, 1051);
  assert.notEqual(player.wide, player.actual);
  assert.notEqual(player.gentle, player.wide);
  assert.deepEqual(fixture, original, "the replay must not mutate source records");
});
