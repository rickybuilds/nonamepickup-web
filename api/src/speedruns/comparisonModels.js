"use strict";

const { classNameForId, formatTimeMs } = require("./domain");

const SOURCE_LABELS = Object.freeze({
  internal: "NoName",
  squishy: "Squishy's Batcave",
  churchofconc: "Church of Conc"
});

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function sourceModel(id, kind) {
  const sourceId = String(id || "");
  return {
    id: sourceId,
    label: SOURCE_LABELS[sourceId] || sourceId,
    kind
  };
}

function mapModel(row) {
  const internalId = row.internalMapId || null;
  // mapKey is canonical: an internal speedrun_maps.map value when matched,
  // otherwise the external normalized map name.
  const normalized = String(row.mapKey || "").toLowerCase();
  return {
    id: internalId,
    name: row.mapDisplayName || internalId || row.externalMapNameRaw || row.mapKey,
    normalized,
    category: row.mapCategory || null,
    enabled: row.mapEnabled == null ? null : Number(row.mapEnabled) === 1,
    matched: internalId != null
  };
}

function classModel(classId) {
  const id = Number(classId);
  return { id, name: classNameForId(id) };
}

function timeModel(value, raw = null) {
  if (value == null) return null;
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return null;
  return {
    milliseconds,
    display: formatTimeMs(milliseconds),
    raw: raw == null ? null : String(raw)
  };
}

function internalRecordModel(row, map = mapModel(row)) {
  if (row.internalTimeMs == null) return null;
  return {
    recordType: "internal",
    source: sourceModel("internal", "internal"),
    map,
    class: classModel(row.classId),
    player: {
      name: row.internalPlayerName || null,
      steamId: row.internalSteamId || null,
      discordId: row.internalDiscordId || null
    },
    time: timeModel(row.internalTimeMs),
    achievedAt: iso(row.internalAchievedAt || row.internalUpdatedAt),
    sourceUrl: null
  };
}

function externalRecordModel(row, map = mapModel(row)) {
  if (!row.externalSource || row.externalTimeMs == null) return null;
  return {
    recordType: "external",
    source: sourceModel(row.externalSource, "external"),
    map,
    class: classModel(row.classId),
    player: {
      name: row.externalPlayerName || null,
      steamId: null,
      discordId: null
    },
    time: timeModel(row.externalTimeMs, row.externalTimeRaw),
    achievedAt: null,
    scrapedAt: iso(row.externalScrapedAt),
    updatedAt: iso(row.externalUpdatedAt),
    sourceUrl: row.externalSourceUrl || null,
    externalMap: {
      rawName: row.externalMapNameRaw || null,
      normalizedName: row.externalMapNameNormalized || null,
      matchedMapId: row.externalMapId || null
    }
  };
}

function differenceModel(internal, fastestExternal) {
  if (!internal || !fastestExternal) {
    return {
      signedMilliseconds: null,
      absoluteMilliseconds: null,
      display: null,
      relation: "unknown"
    };
  }
  const signedMilliseconds = internal.time.milliseconds - fastestExternal.time.milliseconds;
  const relation = signedMilliseconds < 0 ? "ahead" : signedMilliseconds > 0 ? "behind" : "tied";
  const sign = signedMilliseconds > 0 ? "+" : signedMilliseconds < 0 ? "-" : "";
  return {
    signedMilliseconds,
    absoluteMilliseconds: Math.abs(signedMilliseconds),
    display: `${sign}${(Math.abs(signedMilliseconds) / 1000).toFixed(3)}`,
    relation
  };
}

function comparisonModel({ map, classInfo, internal, externals }) {
  const orderedExternals = [...externals].sort((a, b) =>
    (a.time.milliseconds - b.time.milliseconds) ||
    a.source.id.localeCompare(b.source.id)
  );
  const fastestExternal = orderedExternals[0] || null;
  const candidates = [internal, ...orderedExternals].filter(Boolean);
  const fastestMs = candidates.length
    ? Math.min(...candidates.map(record => record.time.milliseconds))
    : null;
  const fastestOverallLeaders = fastestMs == null
    ? []
    : candidates.filter(record => record.time.milliseconds === fastestMs);
  const difference = differenceModel(internal, fastestExternal);

  let status = "no_records";
  if (internal && !fastestExternal) status = "no_external";
  else if (!internal && fastestExternal) status = "no_internal";
  else if (difference.relation === "ahead") status = "internal_faster";
  else if (difference.relation === "behind") status = "external_faster";
  else if (difference.relation === "tied") status = "tied";

  return {
    key: `${map.normalized}:${classInfo.id}`,
    map,
    class: classInfo,
    internal,
    externals: orderedExternals,
    fastestExternal,
    fastestOverall: fastestOverallLeaders[0] || null,
    fastestOverallLeaders,
    difference,
    status,
    internalIsFaster: internal && fastestExternal ? difference.relation === "ahead" : null,
    externalOwner: fastestExternal?.source || null
  };
}

module.exports = {
  SOURCE_LABELS,
  iso,
  sourceModel,
  mapModel,
  classModel,
  timeModel,
  internalRecordModel,
  externalRecordModel,
  differenceModel,
  comparisonModel
};
