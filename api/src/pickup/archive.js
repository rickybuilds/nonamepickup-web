"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { TextDecoder } = require("node:util");
const { parseCsv, parseCsvDocument, normalizeRoster } = require("./csv");
const { validateManifest } = require("./manifest");
const { pickupError } = require("./errors");

const REQUIRED_FILES = Object.freeze([
  "roster.csv",
  "players.csv",
  "projectile_defs.csv",
  "projectiles.csv",
  "objective_defs.csv",
  "objectives.csv",
  "events.csv",
  "manifest.json"
]);
const RENDER_MODELS_FILE = "render_models.csv";
const BUILDABLE_DEFS_FILE = "buildable_defs.csv";
const BUILDABLES_FILE = "buildables.csv";
const READY_FILES = new Set(["complete.ready", "aborted.ready"]);
const SCHEMA_V3_FILES = Object.freeze([RENDER_MODELS_FILE, BUILDABLE_DEFS_FILE, BUILDABLES_FILE]);
const ALLOWED_FILES = new Set([...REQUIRED_FILES, ...SCHEMA_V3_FILES, ...READY_FILES]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

const PLAYERS_V2_COLUMNS = Object.freeze([
  "snapshot", "time_ms", "session_id", "slot", "alive", "team", "class",
  "goalitem_flags", "weapon", "buttons", "health", "armor", "x", "y", "z",
  "vx", "vy", "vz", "pitch", "yaw", "roll"
]);
const PLAYERS_V3_COLUMNS = Object.freeze([...PLAYERS_V2_COLUMNS,
  "ducking", "oldbuttons", "player_model_id", "weapon_model_id", "body", "skin",
  "sequence", "gaitsequence", "frame", "framerate", "animtime", "body_pitch",
  "body_yaw", "body_roll", "controller0", "controller1", "controller2", "controller3",
  "blending0", "blending1"
]);
const RENDER_MODEL_COLUMNS = Object.freeze(["model_id", "kind", "path", "first_seen_ms"]);
const RENDER_MODEL_KINDS = new Set(["player", "weapon", "projectile", "objective", "buildable"]);
const PROJECTILE_DEFS_V2_COLUMNS = Object.freeze([
  "projectile_id", "entity", "owner_session", "classname", "model", "spawned_ms"
]);
const PROJECTILE_DEFS_V3_COLUMNS = Object.freeze([
  "projectile_id", "entity", "owner_session", "classname", "model_id", "spawned_ms"
]);
const OBJECTIVE_DEFS_V2_COLUMNS = Object.freeze([
  "objective_id", "entity", "classname", "model", "targetname", "base_x", "base_y", "base_z", "base_yaw", "first_seen_ms"
]);
const OBJECTIVE_DEFS_V3_COLUMNS = Object.freeze([
  "objective_id", "entity", "classname", "model_id", "targetname", "base_x", "base_y", "base_z", "base_yaw", "first_seen_ms"
]);
const BUILDABLE_DEFS_COLUMNS = Object.freeze([
  "buildable_id", "entity", "kind", "classname", "initial_owner_session", "first_seen_ms"
]);
const BUILDABLES_COLUMNS = Object.freeze([
  "snapshot", "time_ms", "buildable_id", "entity", "active", "owner_session", "owner_entity", "team",
  "model_id", "colormap", "movetype", "solid", "effects", "health", "x", "y", "z", "vx", "vy", "vz",
  "pitch", "yaw", "roll", "body", "skin", "sequence", "gaitsequence", "frame", "framerate", "animtime",
  "scale", "rendermode", "renderamt", "renderfx", "render_r", "render_g", "render_b", "controller0",
  "controller1", "controller2", "controller3", "blending0", "blending1", "aiment"
]);
const PROJECTILES_COLUMNS = Object.freeze([
  "snapshot", "time_ms", "projectile_id", "state", "x", "y", "z", "vx", "vy", "vz", "pitch", "yaw", "roll"
]);
const OBJECTIVES_COLUMNS = Object.freeze([
  "snapshot", "time_ms", "objective_id", "state", "carrier_session", "solid", "effects", "x", "y", "z", "yaw"
]);
const DEFAULT_MODEL_CATALOG = path.resolve(__dirname, "../../../assets/tfc/models/manifest.json");

function exactHeaders(actual, expected, code) {
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw pickupError(422, code, { quarantine: true });
  }
}

function requiredInteger(value, code, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^-?\d+$/.test(String(value))) throw pickupError(422, code, { quarantine: true });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw pickupError(422, code, { quarantine: true });
  }
  return parsed;
}

function validateNumericColumns(document, excluded = new Set()) {
  for (const row of document.rows) {
    for (const header of document.headers) {
      if (excluded.has(header)) continue;
      if (row[header] === "" || !Number.isFinite(Number(row[header]))) {
        throw pickupError(422, "invalid_csv_number", { quarantine: true });
      }
    }
  }
}

function safeTfcModelPath(value) {
  if (typeof value !== "string" || value.includes("\0") || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) ||
      /^[A-Za-z]:/.test(value)) {
    throw pickupError(422, "unsafe_render_model_path", { quarantine: true });
  }
  const normalized = value.trim().replace(/\\/g, "/").toLowerCase();
  if (normalized.length < 12 || normalized.length > 255 || path.posix.isAbsolute(normalized) ||
      normalized.split("/").some(part => !part || part === "." || part === "..") ||
      !/^models\/[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*\.mdl$/.test(normalized)) {
    throw pickupError(422, "unsafe_render_model_path", { quarantine: true });
  }
  return normalized;
}

function validateRenderModels(document, catalog) {
  exactHeaders(document.headers, RENDER_MODEL_COLUMNS, "invalid_render_models_headers");
  const models = new Map();
  for (const row of document.rows) {
    const modelId = requiredInteger(row.model_id, "invalid_render_model_id", { min: 1 });
    if (models.has(modelId)) throw pickupError(422, "duplicate_render_model_id", { quarantine: true });
    if (!RENDER_MODEL_KINDS.has(row.kind)) {
      throw pickupError(422, "invalid_render_model_kind", { quarantine: true });
    }
    const normalizedPath = safeTfcModelPath(row.path);
    const catalogEntry = catalog.get(normalizedPath);
    if (!catalogEntry) {
      throw pickupError(422, "render_model_not_allowlisted", { quarantine: true });
    }
    if (catalogEntry.kind !== row.kind) {
      throw pickupError(422, "render_model_catalog_kind_mismatch", { quarantine: true });
    }
    models.set(modelId, {
      modelId,
      kind: row.kind,
      path: normalizedPath,
      firstSeenMs: requiredInteger(row.first_seen_ms, "invalid_render_model_timestamp", { min: 0 })
    });
  }
  return models;
}

async function loadModelCatalog(catalog = null) {
  if (catalog instanceof Map) return catalog;
  if (catalog && typeof catalog === "object") return new Map(Object.entries(catalog));
  try {
    const parsed = JSON.parse(await fsp.readFile(DEFAULT_MODEL_CATALOG, "utf8"));
    return new Map(Object.entries(parsed.models || parsed));
  } catch (error) {
    throw pickupError(503, "render_model_catalog_unavailable", { cause: error });
  }
}

function validateUniqueIds(document, columns, idColumn, code) {
  exactHeaders(document.headers, columns, `invalid_${code}_headers`);
  const ids = new Set();
  for (const row of document.rows) {
    const id = requiredInteger(row[idColumn], `invalid_${code}_id`, { min: 1 });
    if (ids.has(id)) throw pickupError(422, `duplicate_${code}_id`, { quarantine: true });
    ids.add(id);
  }
  return ids;
}

function validateModelReferences(document, column, kind, renderModels) {
  for (const row of document.rows) {
    const id = requiredInteger(row[column], "invalid_render_model_reference", { min: 0 });
    if (id === 0) continue;
    const model = renderModels.get(id);
    if (!model) throw pickupError(422, "undefined_render_model_id", { quarantine: true });
    if (model.kind !== kind) throw pickupError(422, "render_model_kind_mismatch", { quarantine: true });
  }
}

function validateOrdered(document, idColumn, { terminalActive = false } = {}) {
  const last = new Map();
  const removed = new Set();
  for (const row of document.rows) {
    const id = requiredInteger(row[idColumn], "invalid_timeline_id", { min: 1 });
    const snapshot = requiredInteger(row.snapshot, "invalid_timeline_snapshot", { min: 0 });
    const time = requiredInteger(row.time_ms, "invalid_timeline_timestamp", { min: 0 });
    const previous = last.get(id);
    if (previous && (snapshot < previous.snapshot || time < previous.time)) {
      throw pickupError(422, "unordered_timeline", { quarantine: true });
    }
    if (removed.has(id)) throw pickupError(422, "state_after_terminal_removal", { quarantine: true });
    if (terminalActive && requiredInteger(row.active, "invalid_buildable_active", { min: 0, max: 1 }) === 0) {
      removed.add(id);
    }
    last.set(id, { snapshot, time });
  }
}

function validatePlayers(document, schemaVersion, renderModels) {
  exactHeaders(
    document.headers,
    schemaVersion === 2 ? PLAYERS_V2_COLUMNS : PLAYERS_V3_COLUMNS,
    "invalid_players_headers"
  );
  validateNumericColumns(document);
  if (schemaVersion === 2) return;
  for (const row of document.rows) {
    for (const [column, kind] of [["player_model_id", "player"], ["weapon_model_id", "weapon"]]) {
      const id = requiredInteger(row[column], "invalid_render_model_reference", { min: 0 });
      if (id === 0) continue;
      const model = renderModels.get(id);
      if (!model) throw pickupError(422, "undefined_render_model_id", { quarantine: true });
      if (model.kind !== kind) throw pickupError(422, "render_model_kind_mismatch", { quarantine: true });
    }
  }
}

function decodeTarString(buffer) {
  const nul = buffer.indexOf(0);
  const bytes = nul === -1 ? buffer : buffer.subarray(0, nul);
  try {
    return utf8.decode(bytes);
  } catch {
    throw pickupError(422, "invalid_archive_header", { quarantine: true });
  }
}

function parseTarNumber(buffer) {
  if (buffer[0] & 0x80) throw pickupError(422, "unsupported_archive_header", { quarantine: true });
  const text = buffer.toString("ascii").replace(/\0.*$/, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw pickupError(422, "invalid_archive_header", { quarantine: true });
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw pickupError(422, "invalid_archive_header", { quarantine: true });
  }
  return value;
}

function verifyChecksum(header) {
  const expected = parseTarNumber(header.subarray(148, 156));
  let actual = 0;
  for (let i = 0; i < header.length; i += 1) {
    actual += i >= 148 && i < 156 ? 32 : header[i];
  }
  if (actual !== expected) {
    throw pickupError(422, "invalid_archive_checksum", { quarantine: true });
  }
}

function parseHeader(header) {
  verifyChecksum(header);
  const name = decodeTarString(header.subarray(0, 100));
  const prefix = decodeTarString(header.subarray(345, 500));
  const archivePath = prefix ? `${prefix}/${name}` : name;
  const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
  const size = parseTarNumber(header.subarray(124, 136));

  if (!archivePath ||
      archivePath.includes("\\") ||
      archivePath.includes("\0") ||
      path.posix.isAbsolute(archivePath) ||
      archivePath.split("/").some(part => part === ".." || part === "." || part === "") ||
      archivePath.includes("/")) {
    throw pickupError(422, "unsafe_archive_path", { quarantine: true });
  }
  if (type !== "0") {
    throw pickupError(422, "unsupported_archive_entry_type", { quarantine: true });
  }
  if (!ALLOWED_FILES.has(archivePath)) {
    throw pickupError(422, "unexpected_archive_file", { quarantine: true });
  }
  return { name: archivePath, size };
}

class SafeTarExtractor extends Writable {
  constructor(destination, limits) {
    super();
    this.destination = destination;
    this.maxFiles = limits.maxFiles;
    this.maxBytes = limits.maxBytes;
    this.pending = Buffer.alloc(0);
    this.files = new Map();
    this.current = null;
    this.padding = 0;
    this.totalBytes = 0;
    this.zeroBlocks = 0;
    this.ended = false;
  }

  _write(chunk, _encoding, callback) {
    this.process(chunk).then(() => callback(), callback);
  }

  async process(chunk) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    while (this.pending.length) {
      if (this.ended) {
        if (this.pending.some(byte => byte !== 0)) {
          throw pickupError(422, "trailing_archive_data", { quarantine: true });
        }
        this.pending = Buffer.alloc(0);
        return;
      }

      if (this.current) {
        if (this.current.remaining > 0) {
          if (!this.pending.length) return;
          const count = Math.min(this.current.remaining, this.pending.length);
          const bytes = this.pending.subarray(0, count);
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await this.current.handle.write(
              bytes,
              offset,
              bytes.length - offset,
              null
            );
            if (bytesWritten < 1) throw pickupError(500, "archive_write_failed");
            offset += bytesWritten;
          }
          this.pending = this.pending.subarray(count);
          this.current.remaining -= count;
          if (this.current.remaining > 0) return;
        }
        if (this.current.handle) {
          await this.current.handle.close();
          this.current.handle = null;
        }
        if (this.padding > 0) {
          const count = Math.min(this.padding, this.pending.length);
          this.pending = this.pending.subarray(count);
          this.padding -= count;
          if (this.padding > 0) return;
        }
        this.current = null;
        continue;
      }

      if (this.pending.length < 512) return;
      const header = this.pending.subarray(0, 512);
      this.pending = this.pending.subarray(512);
      if (header.every(byte => byte === 0)) {
        this.zeroBlocks += 1;
        if (this.zeroBlocks >= 2) this.ended = true;
        continue;
      }
      if (this.zeroBlocks > 0) {
        throw pickupError(422, "invalid_archive_terminator", { quarantine: true });
      }

      const entry = parseHeader(header);
      if (this.files.has(entry.name)) {
        throw pickupError(422, "duplicate_archive_file", { quarantine: true });
      }
      if (this.files.size + 1 > this.maxFiles) {
        throw pickupError(413, "archive_file_limit_exceeded", { quarantine: true });
      }
      if (entry.size > this.maxBytes - this.totalBytes) {
        throw pickupError(413, "archive_extracted_size_exceeded", { quarantine: true });
      }

      this.totalBytes += entry.size;
      const outputPath = path.join(this.destination, entry.name);
      const handle = await fsp.open(outputPath, "wx", 0o600);
      this.files.set(entry.name, { path: outputPath, size: entry.size });
      this.current = { ...entry, remaining: entry.size, handle };
      this.padding = (512 - (entry.size % 512)) % 512;
    }
  }

  _final(callback) {
    const finish = async () => {
      if (this.current?.handle) await this.current.handle.close();
      if (this.current || this.pending.length || !this.ended) {
        throw pickupError(422, "truncated_archive", { quarantine: true });
      }
    };
    finish().then(() => callback(), callback);
  }

  _destroy(error, callback) {
    if (!this.current?.handle) return callback(error);
    this.current.handle.close().then(() => callback(error), () => callback(error));
  }
}

function openZstdStream(archivePath, command = "zstd") {
  const child = spawn(command, ["-d", "--stdout", "--no-progress", "--", archivePath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stderr.resume();
  const completion = new Promise((resolve, reject) => {
    child.once("error", error => reject(pickupError(500, "archive_tool_unavailable", { cause: error })));
    child.once("close", code => {
      if (code === 0) resolve();
      else reject(pickupError(422, "invalid_compressed_archive", { quarantine: true }));
    });
  });
  return { stream: child.stdout, completion, abort: () => child.kill("SIGKILL") };
}

async function validateArchive({
  archivePath,
  extractionPath,
  matchId,
  round,
  maxFiles,
  maxBytes,
  zstdCommand,
  modelCatalog = null,
  openArchive = openZstdStream
}) {
  const source = openArchive(archivePath, zstdCommand);
  const extractor = new SafeTarExtractor(extractionPath, { maxFiles, maxBytes });
  try {
    await Promise.all([pipeline(source.stream, extractor), source.completion]);
  } catch (error) {
    source.abort?.();
    if (error?.code && error?.status) throw error;
    throw pickupError(500, "archive_extraction_failed", { cause: error });
  }

  for (const required of REQUIRED_FILES) {
    if (!extractor.files.has(required)) {
      throw pickupError(422, "missing_required_file", { quarantine: true });
    }
  }
  const markers = [...READY_FILES].filter(name => extractor.files.has(name));
  if (markers.length !== 1) {
    throw pickupError(422, "invalid_ready_markers", { quarantine: true });
  }
  if (extractor.files.get(markers[0]).size > 4096) {
    throw pickupError(422, "invalid_ready_marker", { quarantine: true });
  }
  if (extractor.files.get("manifest.json").size > 1024 * 1024 ||
      extractor.files.get("roster.csv").size > 16 * 1024 * 1024) {
    throw pickupError(413, "archive_metadata_too_large", { quarantine: true });
  }
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(extractor.files.get("manifest.json").path, "utf8"));
  } catch {
    throw pickupError(422, "invalid_manifest_json", { quarantine: true });
  }
  const complete = markers[0] === "complete.ready";
  validateManifest(manifest, { matchId, round, complete });

  const missingSchemaFiles = SCHEMA_V3_FILES.filter(name => !extractor.files.has(name));
  if (manifest.schema_version === 3 && missingSchemaFiles.length) {
    const code = missingSchemaFiles.includes(RENDER_MODELS_FILE)
      ? "missing_render_models_file"
      : "missing_buildable_streams";
    throw pickupError(422, code, { quarantine: true });
  }
  if (manifest.schema_version === 2 && SCHEMA_V3_FILES.some(name => extractor.files.has(name))) {
    throw pickupError(422, "unexpected_archive_file", { quarantine: true });
  }
  const expectedFileCount = REQUIRED_FILES.length + 1 + (manifest.schema_version === 3 ? SCHEMA_V3_FILES.length : 0);
  if (extractor.files.size !== expectedFileCount) {
    throw pickupError(422, "unexpected_archive_file", { quarantine: true });
  }

  let renderModels = new Map();
  if (manifest.schema_version === 3) {
    const allowlistedModels = await loadModelCatalog(modelCatalog);
    const renderFile = extractor.files.get(RENDER_MODELS_FILE);
    if (manifest.bytes[RENDER_MODELS_FILE] !== renderFile.size) {
      throw pickupError(422, "render_models_manifest_mismatch", { quarantine: true });
    }
    const renderText = await fsp.readFile(renderFile.path, "utf8");
    const renderDocument = parseCsvDocument(renderText, "render_models");
    if (manifest.rows.render_models !== renderDocument.rows.length) {
      throw pickupError(422, "render_models_manifest_mismatch", { quarantine: true });
    }
    renderModels = validateRenderModels(renderDocument, allowlistedModels);
  }
  const playersText = await fsp.readFile(extractor.files.get("players.csv").path, "utf8");
  const playersDocument = parseCsvDocument(playersText, "players");
  validatePlayers(playersDocument, manifest.schema_version, renderModels);
  validateOrdered(playersDocument, "session_id");

  const projectileDefs = parseCsvDocument(
    await fsp.readFile(extractor.files.get("projectile_defs.csv").path, "utf8"),
    "projectile_definitions"
  );
  validateUniqueIds(
    projectileDefs,
    manifest.schema_version === 2 ? PROJECTILE_DEFS_V2_COLUMNS : PROJECTILE_DEFS_V3_COLUMNS,
    "projectile_id",
    "projectile"
  );
  validateNumericColumns(projectileDefs, new Set(["classname", manifest.schema_version === 2 ? "model" : "model_id"]));
  if (manifest.schema_version === 3) {
    for (const row of projectileDefs.rows) requiredInteger(row.model_id, "invalid_render_model_reference", { min: 0 });
  }
  if (manifest.schema_version === 3) validateModelReferences(projectileDefs, "model_id", "projectile", renderModels);

  const objectiveDefs = parseCsvDocument(
    await fsp.readFile(extractor.files.get("objective_defs.csv").path, "utf8"),
    "objective_definitions"
  );
  validateUniqueIds(
    objectiveDefs,
    manifest.schema_version === 2 ? OBJECTIVE_DEFS_V2_COLUMNS : OBJECTIVE_DEFS_V3_COLUMNS,
    "objective_id",
    "objective"
  );
  validateNumericColumns(objectiveDefs, new Set(["classname", "targetname", manifest.schema_version === 2 ? "model" : "model_id"]));
  if (manifest.schema_version === 3) {
    for (const row of objectiveDefs.rows) requiredInteger(row.model_id, "invalid_render_model_reference", { min: 0 });
  }
  if (manifest.schema_version === 3) validateModelReferences(objectiveDefs, "model_id", "objective", renderModels);

  const projectiles = parseCsvDocument(
    await fsp.readFile(extractor.files.get("projectiles.csv").path, "utf8"), "projectiles"
  );
  exactHeaders(projectiles.headers, PROJECTILES_COLUMNS, "invalid_projectiles_headers");
  validateNumericColumns(projectiles);
  validateOrdered(projectiles, "projectile_id");
  const objectives = parseCsvDocument(
    await fsp.readFile(extractor.files.get("objectives.csv").path, "utf8"), "objectives"
  );
  exactHeaders(objectives.headers, OBJECTIVES_COLUMNS, "invalid_objectives_headers");
  validateNumericColumns(objectives);
  validateOrdered(objectives, "objective_id");

  if (manifest.schema_version === 3) {
    const buildableDefsFile = extractor.files.get(BUILDABLE_DEFS_FILE);
    const buildablesFile = extractor.files.get(BUILDABLES_FILE);
    if (manifest.bytes[BUILDABLE_DEFS_FILE] !== buildableDefsFile.size ||
        manifest.bytes[BUILDABLES_FILE] !== buildablesFile.size) {
      throw pickupError(422, "buildable_manifest_mismatch", { quarantine: true });
    }
    const buildableDefs = parseCsvDocument(await fsp.readFile(buildableDefsFile.path, "utf8"), "buildable_definitions");
    const definitionIds = validateUniqueIds(buildableDefs, BUILDABLE_DEFS_COLUMNS, "buildable_id", "buildable");
    for (const row of buildableDefs.rows) {
      if (!["sentry", "dispenser", "building"].includes(row.kind)) {
        throw pickupError(422, "invalid_buildable_kind", { quarantine: true });
      }
    }
    validateNumericColumns(buildableDefs, new Set(["kind", "classname"]));
    const buildables = parseCsvDocument(await fsp.readFile(buildablesFile.path, "utf8"), "buildables");
    exactHeaders(buildables.headers, BUILDABLES_COLUMNS, "invalid_buildables_headers");
    validateNumericColumns(buildables);
    if (manifest.rows.buildable_definitions !== buildableDefs.rows.length ||
        manifest.rows.buildables !== buildables.rows.length) {
      throw pickupError(422, "buildable_manifest_mismatch", { quarantine: true });
    }
    for (const row of buildables.rows) {
      const id = requiredInteger(row.buildable_id, "invalid_buildable_id", { min: 1 });
      if (!definitionIds.has(id)) throw pickupError(422, "undefined_buildable_id", { quarantine: true });
    }
    validateModelReferences(buildables, "model_id", "buildable", renderModels);
    validateOrdered(buildables, "buildable_id", { terminalActive: true });
  }

  const rosterText = await fsp.readFile(extractor.files.get("roster.csv").path, "utf8");
  const roster = normalizeRoster(parseCsv(rosterText, "roster"));
  return { manifest, roster, complete, extractedBytes: extractor.totalBytes };
}

module.exports = {
  REQUIRED_FILES,
  RENDER_MODELS_FILE,
  BUILDABLE_DEFS_FILE,
  BUILDABLES_FILE,
  PLAYERS_V2_COLUMNS,
  PLAYERS_V3_COLUMNS,
  RENDER_MODEL_COLUMNS,
  BUILDABLE_DEFS_COLUMNS,
  BUILDABLES_COLUMNS,
  safeTfcModelPath,
  SafeTarExtractor,
  openZstdStream,
  validateArchive
};
