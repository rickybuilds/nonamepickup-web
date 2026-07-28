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
