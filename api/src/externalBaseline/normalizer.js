"use strict";

const CLASS_IDS = new Map([
  ["scout", 1],
  ["sniper", 2],
  ["soldier", 3],
  ["demoman", 4],
  ["demo", 4],
  ["medic", 5],
  ["heavy", 6],
  ["heavyweaponsguy", 6],
  ["heavyweapons", 6],
  ["hwguy", 6],
  ["hw", 6],
  ["pyro", 7],
  ["spy", 8],
  ["engineer", 9],
  ["engy", 9],
  ["civilian", 11]
]);

function cleanRaw(value) {
  return String(value == null ? "" : value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMapName(value) {
  return cleanRaw(value)
    .normalize("NFKC")
    .replace(/^.*[\\/]/, "")
    .replace(/\.bsp$/i, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function normalizeClassId(value) {
  const key = cleanRaw(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  return CLASS_IDS.get(key) ?? null;
}

function parseTimeMs(value) {
  const raw = cleanRaw(value);
  if (!raw || /^[-–—]$/.test(raw)) return null;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0
      ? Math.round(seconds * 1000)
      : null;
  }

  const parts = raw.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) {
    return null;
  }

  let seconds = 0;
  for (const part of parts) seconds = (seconds * 60) + Number(part);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1000)
    : null;
}

function normalizeRecord(input) {
  const mapNameRaw = cleanRaw(input.map_name_raw);
  const classNameRaw = cleanRaw(input.class_name_raw);
  const timeRaw = cleanRaw(input.time_raw);
  const mapNameNormalized = normalizeMapName(mapNameRaw);
  const classId = normalizeClassId(classNameRaw);
  const timeMs = parseTimeMs(timeRaw);

  if (!mapNameRaw || !mapNameNormalized) throw new Error("missing map name");
  if (classId == null) throw new Error(`unknown class: ${classNameRaw || "(empty)"}`);
  if (timeMs == null) throw new Error(`invalid time: ${timeRaw || "(empty)"}`);

  return {
    source: cleanRaw(input.source),
    source_url: cleanRaw(input.source_url),
    map_name_raw: mapNameRaw,
    map_name_normalized: mapNameNormalized,
    class_name_raw: classNameRaw,
    class_id: classId,
    player_name: cleanRaw(input.player_name) || null,
    time_raw: timeRaw,
    time_ms: timeMs
  };
}

function recordKey(record) {
  return `${record.source}\u0000${record.map_name_normalized}\u0000${record.class_id}`;
}

function deduplicateRecords(records) {
  const unique = new Map();

  for (const record of records) {
    const key = recordKey(record);
    const current = unique.get(key);
    if (
      !current ||
      record.time_ms < current.time_ms ||
      (record.time_ms === current.time_ms && !current.player_name && record.player_name)
    ) {
      unique.set(key, record);
    }
  }

  return [...unique.values()];
}

module.exports = {
  cleanRaw,
  normalizeMapName,
  normalizeClassId,
  parseTimeMs,
  normalizeRecord,
  recordKey,
  deduplicateRecords
};
