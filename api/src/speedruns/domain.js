"use strict";

const CLASS_NAMES = Object.freeze({
  0: "Civilian",
  1: "Scout",
  2: "Sniper",
  3: "Soldier",
  4: "Demoman",
  5: "Medic",
  6: "Heavy",
  7: "Pyro",
  8: "Spy",
  9: "Engineer",
  10: "Civilian",
  11: "Civilian"
});

function classNameForId(classId) {
  if (classId == null) return null;
  const parsed = Number(classId);
  if (!Number.isFinite(parsed)) return null;
  return CLASS_NAMES[parsed] || `Class ${parsed}`;
}

function recordClassName(row) {
  const existing = String(row?.class_name || row?.className || "").trim();
  if (existing && existing !== "-") return existing;
  return classNameForId(row?.class_id ?? row?.classId);
}

function formatTimeMs(value) {
  if (value == null) return null;
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function normalizeMapLookup(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = {
  CLASS_NAMES,
  classNameForId,
  recordClassName,
  formatTimeMs,
  normalizeMapLookup
};
