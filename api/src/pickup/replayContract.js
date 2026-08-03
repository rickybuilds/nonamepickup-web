"use strict";

const REPLAY_FILE_ORDER = Object.freeze([
  "roster.csv",
  "render_models.csv",
  "players.csv",
  "projectile_defs.csv",
  "projectiles.csv",
  "objective_defs.csv",
  "objectives.csv",
  "buildable_defs.csv",
  "buildables.csv",
  "brush_defs.csv",
  "brushes.csv",
  "entity_defs.csv",
  "entities.csv",
  "entity_census.csv",
  "events.csv"
]);

const REPLAY_FILES = new Set(REPLAY_FILE_ORDER);
const DICTIONARY_FILES = new Set([
  "roster.csv",
  "render_models.csv",
  "projectile_defs.csv",
  "objective_defs.csv",
  "buildable_defs.csv",
  "brush_defs.csv",
  "entity_defs.csv",
  "entity_census.csv"
]);

const MINIMUM_SCHEMA_BY_FILE = Object.freeze({
  "render_models.csv": 3,
  "buildable_defs.csv": 3,
  "buildables.csv": 3,
  "brush_defs.csv": 4,
  "brushes.csv": 4,
  "entity_defs.csv": 5,
  "entities.csv": 5,
  "entity_census.csv": 5
});

function replayFileAvailable(fileName, schemaVersion) {
  return REPLAY_FILES.has(fileName) &&
    Number(schemaVersion) >= (MINIMUM_SCHEMA_BY_FILE[fileName] || 2);
}

function replayFilesForSchema(schemaVersion) {
  return REPLAY_FILE_ORDER.filter(fileName => replayFileAvailable(fileName, schemaVersion));
}

module.exports = {
  DICTIONARY_FILES,
  REPLAY_FILE_ORDER,
  REPLAY_FILES,
  replayFileAvailable,
  replayFilesForSchema
};
