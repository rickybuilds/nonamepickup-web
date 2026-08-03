"use strict";

const { pickupError } = require("./errors");

const MIN_SCHEMA_VERSION = 2;
const CURRENT_SCHEMA_VERSION = 5;

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requireInteger(manifest, key, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = manifest[key];
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
}

function requireCountObject(manifest, key) {
  const value = manifest[key];
  if (!isPlainObject(value) || Object.keys(value).length > 128) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  for (const count of Object.values(value)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw pickupError(422, "invalid_manifest", { quarantine: true });
    }
  }
}

function validateManifest(value, expected) {
  if (!isPlainObject(value)) throw pickupError(422, "invalid_manifest", { quarantine: true });
  if (!Number.isSafeInteger(value.schema_version)) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  if (value.schema_version < MIN_SCHEMA_VERSION || value.schema_version > CURRENT_SCHEMA_VERSION) {
    throw pickupError(422, "unsupported_schema_version", { quarantine: true });
  }
  if (value.match_id !== expected.matchId || value.round !== expected.round) {
    throw pickupError(422, "manifest_header_mismatch", { quarantine: true });
  }
  if (typeof value.map !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(value.map)) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  if (typeof value.complete !== "boolean") {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  if (value.reason !== null &&
      (typeof value.reason !== "string" ||
       value.reason.length > 96 ||
       /[\0-\x1f\x7f]/.test(value.reason))) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  if (typeof value.write_error !== "boolean") {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  requireInteger(value, "started_at_epoch", { min: 1, max: 4102444800 });
  requireInteger(value, "ended_at_epoch", { min: 1, max: 4102444800 });
  requireInteger(value, "duration_ms", { max: 24 * 60 * 60 * 1000 });
  if (typeof value.sample_interval_seconds !== "number" ||
      !Number.isFinite(value.sample_interval_seconds) ||
      value.sample_interval_seconds <= 0 ||
      value.sample_interval_seconds > 65.535) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  requireInteger(value, "snapshots");
  requireInteger(value, "dropped_snapshots");
  requireCountObject(value, "rows");
  requireCountObject(value, "bytes");
  if (value.schema_version >= 3 &&
      (!Number.isSafeInteger(value.rows.render_models) ||
       !Number.isSafeInteger(value.rows.buildable_definitions) ||
       !Number.isSafeInteger(value.rows.buildables) ||
       !Number.isSafeInteger(value.bytes["render_models.csv"]) ||
       !Number.isSafeInteger(value.bytes["buildable_defs.csv"]) ||
       !Number.isSafeInteger(value.bytes["buildables.csv"]))) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  if (value.schema_version >= 4 &&
      (!Number.isSafeInteger(value.rows.brush_definitions) ||
       !Number.isSafeInteger(value.rows.brushes) ||
       !Number.isSafeInteger(value.bytes["brush_defs.csv"]) ||
       !Number.isSafeInteger(value.bytes["brushes.csv"]))) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  if (value.schema_version >= 5 &&
      (!Number.isSafeInteger(value.rows.entity_definitions) ||
       !Number.isSafeInteger(value.rows.entities) ||
       !Number.isSafeInteger(value.rows.entity_census) ||
       !Number.isSafeInteger(value.bytes["entity_defs.csv"]) ||
       !Number.isSafeInteger(value.bytes["entities.csv"]) ||
       !Number.isSafeInteger(value.bytes["entity_census.csv"]))) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  if (value.ended_at_epoch < value.started_at_epoch) {
    throw pickupError(422, "invalid_manifest", { quarantine: true });
  }
  if (expected.complete !== value.complete) {
    throw pickupError(422, "ready_marker_mismatch", { quarantine: true });
  }
  return value;
}

module.exports = { MIN_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION, validateManifest };
