"use strict";

const {
  classNameForId,
  normalizeMapLookup,
  isValidRunTimeMs
} = require("./domain");
const {
  sourceModel,
  mapModel,
  classModel,
  timeModel,
  internalRecordModel,
  externalRecordModel,
  differenceModel,
  comparisonModel,
  iso
} = require("./comparisonModels");

const VALID_STATUSES = new Set([
  "internal_faster",
  "external_faster",
  "tied",
  "no_internal",
  "no_external",
  "no_records"
]);

class ExternalBaselineService {
  constructor({ repository, ruleset, minimumValidTimeMs = 1, cacheTtlMs = 30_000, now = () => Date.now() }) {
    if (!repository) throw new TypeError("repository is required");
    this.repository = repository;
    this.ruleset = ruleset;
    this.minimumValidTimeMs = minimumValidTimeMs;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.cachedSnapshot = null;
    this.cachedAt = 0;
  }

  invalidate() {
    this.cachedSnapshot = null;
    this.cachedAt = 0;
  }

  async snapshot() {
    const now = this.now();
    if (this.cachedSnapshot && now - this.cachedAt < this.cacheTtlMs) {
      return this.cachedSnapshot;
    }

    this.cachedAt = now;
    this.cachedSnapshot = this.repository.fetchComparisonRows(this.ruleset, this.minimumValidTimeMs)
      .then(rows => this.buildSnapshot(rows, now))
      .catch(error => {
        this.invalidate();
        throw error;
      });
    return this.cachedSnapshot;
  }

  buildSnapshot(rows, generatedAtMs = this.now()) {
    const groups = new Map();

    for (const row of rows) {
      const map = mapModel(row);
      const classInfo = classModel(row.classId);
      const key = `${normalizeMapLookup(row.mapKey)}:${classInfo.id}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          map,
          classInfo,
          internal: internalRecordModel(row, map),
          externals: []
        };
        groups.set(key, group);
      } else if (!group.internal) {
        group.internal = internalRecordModel(row, group.map);
      }

      const external = externalRecordModel(row, group.map);
      if (external) group.externals.push(external);
    }

    const comparisons = [...groups.values()]
      .map(comparisonModel)
      .sort((a, b) =>
        a.map.name.localeCompare(b.map.name) ||
        a.class.id - b.class.id
      );
    const index = new Map(comparisons.map(comparison => [comparison.key, comparison]));

    return {
      generatedAt: new Date(generatedAtMs).toISOString(),
      ruleset: this.ruleset,
      comparisons,
      index
    };
  }

  async getMapClass(mapName, classId) {
    const snapshot = await this.snapshot();
    const normalizedMap = normalizeMapLookup(mapName);
    const parsedClassId = Number(classId);
    return snapshot.comparisons.find(comparison =>
      comparison.class.id === parsedClassId &&
      (
        normalizeMapLookup(comparison.map.id) === normalizedMap ||
        normalizeMapLookup(comparison.map.normalized) === normalizedMap ||
        normalizeMapLookup(comparison.map.name) === normalizedMap
      )
    ) || null;
  }

  async getMap(mapName) {
    const snapshot = await this.snapshot();
    const normalizedMap = normalizeMapLookup(mapName);
    return snapshot.comparisons.filter(comparison =>
      normalizeMapLookup(comparison.map.id) === normalizedMap ||
      normalizeMapLookup(comparison.map.normalized) === normalizedMap ||
      normalizeMapLookup(comparison.map.name) === normalizedMap
    );
  }

  async getFastestExternal(mapName, classId) {
    return (await this.getMapClass(mapName, classId))?.fastestExternal || null;
  }

  async getExternalBaselines(mapName, classId) {
    return (await this.getMapClass(mapName, classId))?.externals || [];
  }

  async getSummary() {
    const snapshot = await this.snapshot();
    const counts = Object.fromEntries([...VALID_STATUSES].map(status => [status, 0]));
    const mapStates = new Map();

    for (const comparison of snapshot.comparisons) {
      counts[comparison.status] += 1;
      const mapKey = comparison.map.normalized;
      const state = mapStates.get(mapKey) || {
        matched: comparison.map.matched,
        hasInternal: false,
        hasExternal: false
      };
      state.hasInternal ||= comparison.internal != null;
      state.hasExternal ||= comparison.externals.length > 0;
      mapStates.set(mapKey, state);
    }

    const states = [...mapStates.values()];
    return {
      generatedAt: snapshot.generatedAt,
      ruleset: snapshot.ruleset,
      totals: {
        mapClasses: snapshot.comparisons.length,
        maps: mapStates.size,
        internalFaster: counts.internal_faster,
        externalFaster: counts.external_faster,
        tied: counts.tied,
        noInternalRecord: counts.no_internal,
        noExternalBaseline: counts.no_external,
        mapsWithNoInternalRecords: states.filter(state => state.hasExternal && !state.hasInternal).length,
        externalOnlyMaps: states.filter(state => state.hasExternal && !state.matched).length
      },
      statuses: counts
    };
  }

  async getLeaderboard(options = {}) {
    const snapshot = await this.snapshot();
    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 100, 500));
    const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
    const status = options.status && VALID_STATUSES.has(options.status)
      ? options.status
      : null;
    const source = String(options.source || "").trim().toLowerCase();
    const query = normalizeMapLookup(options.query);

    let comparisons = snapshot.comparisons;
    if (status) comparisons = comparisons.filter(item => item.status === status);
    if (source) {
      comparisons = comparisons.filter(item =>
        item.externals.some(record => record.source.id === source)
      );
    }
    if (query) {
      comparisons = comparisons.filter(item =>
        normalizeMapLookup(`${item.map.name} ${item.map.id || ""} ${item.map.normalized}`).includes(query)
      );
    }

    if (options.sort === "gap") {
      comparisons = [...comparisons].sort((a, b) =>
        (Math.abs(b.difference.signedMilliseconds || 0) - Math.abs(a.difference.signedMilliseconds || 0)) ||
        a.map.name.localeCompare(b.map.name) ||
        a.class.id - b.class.id
      );
    }

    return {
      generatedAt: snapshot.generatedAt,
      ruleset: snapshot.ruleset,
      items: comparisons.slice(offset, offset + limit),
      pagination: {
        limit,
        offset,
        total: comparisons.length,
        hasMore: offset + limit < comparisons.length
      }
    };
  }

  async getExternalOnlyMaps(options = {}) {
    const snapshot = await this.snapshot();
    const maps = this.groupMaps(
      snapshot.comparisons,
      comparisons => !comparisons[0].map.matched && comparisons.some(item => item.externals.length)
    );
    return this.paginateMaps(snapshot.generatedAt, maps, options);
  }

  async getMapsWithoutInternalRecords(options = {}) {
    const snapshot = await this.snapshot();
    const maps = this.groupMaps(
      snapshot.comparisons,
      comparisons =>
        comparisons.some(item => item.externals.length) &&
        comparisons.every(item => item.internal == null)
    );
    return this.paginateMaps(snapshot.generatedAt, maps, options);
  }

  groupMaps(comparisons, includeGroup) {
    const grouped = new Map();
    for (const comparison of comparisons) {
      const current = grouped.get(comparison.map.normalized) || {
        map: comparison.map,
        classComparisons: [],
        sources: new Map()
      };
      current.classComparisons.push(comparison);
      for (const external of comparison.externals) {
        current.sources.set(external.source.id, external.source);
      }
      grouped.set(comparison.map.normalized, current);
    }

    return [...grouped.values()]
      .filter(item => includeGroup(item.classComparisons))
      .map(item => ({
        map: item.map,
        sources: [...item.sources.values()],
        classes: item.classComparisons.length,
        comparisons: item.classComparisons
      }))
      .sort((a, b) => a.map.name.localeCompare(b.map.name));
  }

  paginateMaps(generatedAt, maps, options) {
    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 100, 500));
    const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);

    return {
      generatedAt,
      items: maps.slice(offset, offset + limit),
      pagination: {
        limit,
        offset,
        total: maps.length,
        hasMore: offset + limit < maps.length
      }
    };
  }

  async getPlayerSummary(discordId) {
    const [snapshot, rows] = await Promise.all([
      this.snapshot(),
      this.repository.fetchPlayerRecords(discordId, this.ruleset, this.minimumValidTimeMs)
    ]);
    const entries = rows.map(row => {
      const comparison = snapshot.index.get(
        `${normalizeMapLookup(row.map)}:${Number(row.classId)}`
      ) || null;
      const personalBest = {
        recordType: "internal",
        source: sourceModel("internal", "internal"),
        map: comparison?.map || {
          id: row.map,
          name: row.map,
          normalized: normalizeMapLookup(row.map),
          category: null,
          enabled: null,
          matched: true
        },
        class: classModel(row.classId),
        player: {
          name: row.playerName || null,
          steamId: row.steamId || null,
          discordId: row.discordId || discordId
        },
        time: timeModel(row.timeMs),
        achievedAt: iso(row.achievedAt || row.updatedAt),
        sourceUrl: null
      };
      const fastestExternal = comparison?.fastestExternal || null;
      const difference = differenceModel(personalBest, fastestExternal);
      const isInternalWorldRecord = Boolean(
        comparison?.internal &&
        comparison.internal.time.milliseconds === personalBest.time.milliseconds &&
        comparison.internal.player.steamId === personalBest.player.steamId
      );
      return {
        map: personalBest.map,
        class: personalBest.class,
        personalBest,
        fastestExternal,
        difference,
        status: !fastestExternal
          ? "no_external"
          : difference.relation === "ahead"
            ? "ahead"
            : difference.relation === "behind" ? "behind" : "tied",
        isInternalWorldRecord
      };
    });

    return {
      generatedAt: snapshot.generatedAt,
      ruleset: snapshot.ruleset,
      player: {
        discordId,
        name: entries.find(entry => entry.personalBest.player.name)?.personalBest.player.name || null
      },
      summary: {
        recordsCompared: entries.length,
        ahead: entries.filter(entry => entry.status === "ahead").length,
        behind: entries.filter(entry => entry.status === "behind").length,
        tied: entries.filter(entry => entry.status === "tied").length,
        noExternal: entries.filter(entry => entry.status === "no_external").length,
        internalWorldRecords: entries.filter(entry => entry.isInternalWorldRecord).length
      },
      comparisons: entries
    };
  }

  async compareCandidate({ map, classId, timeMs }) {
    const eligible = isValidRunTimeMs(timeMs, this.minimumValidTimeMs);
    const comparison = await this.getMapClass(map, classId);
    const fastestExternal = comparison?.fastestExternal || null;
    const candidate = {
      time: eligible ? timeModel(timeMs) : null,
      class: { id: Number(classId), name: classNameForId(classId) }
    };
    return {
      baseline: comparison,
      candidate,
      eligible,
      minimumValidTimeMs: this.minimumValidTimeMs,
      difference: differenceModel(eligible ? candidate : null, fastestExternal),
      beatsExternal: eligible && fastestExternal
        ? Number(timeMs) < fastestExternal.time.milliseconds
        : null
    };
  }
}

module.exports = { VALID_STATUSES, ExternalBaselineService };
