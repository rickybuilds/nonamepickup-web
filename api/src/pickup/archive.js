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
const READY_FILES = new Set(["complete.ready", "aborted.ready"]);
const ALLOWED_FILES = new Set([...REQUIRED_FILES, RENDER_MODELS_FILE, ...READY_FILES]);
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

function safeTfcModelPath(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 255 ||
      value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value) ||
      value.split("/").some(part => !part || part === "." || part === "..") ||
      !/^models\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.mdl$/i.test(value)) {
    throw pickupError(422, "unsafe_render_model_path", { quarantine: true });
  }
  return value;
}

function validateRenderModels(document) {
  exactHeaders(document.headers, RENDER_MODEL_COLUMNS, "invalid_render_models_headers");
  const models = new Map();
  for (const row of document.rows) {
    const modelId = requiredInteger(row.model_id, "invalid_render_model_id", { min: 1 });
    if (models.has(modelId)) throw pickupError(422, "duplicate_render_model_id", { quarantine: true });
    if (row.kind !== "player" && row.kind !== "weapon") {
      throw pickupError(422, "invalid_render_model_kind", { quarantine: true });
    }
    models.set(modelId, {
      modelId,
      kind: row.kind,
      path: safeTfcModelPath(row.path),
      firstSeenMs: requiredInteger(row.first_seen_ms, "invalid_render_model_timestamp", { min: 0 })
    });
  }
  return models;
}

function validatePlayers(document, schemaVersion, renderModels) {
  exactHeaders(
    document.headers,
    schemaVersion === 2 ? PLAYERS_V2_COLUMNS : PLAYERS_V3_COLUMNS,
    "invalid_players_headers"
  );
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

  const hasRenderModels = extractor.files.has(RENDER_MODELS_FILE);
  if (manifest.schema_version === 3 && !hasRenderModels) {
    throw pickupError(422, "missing_render_models_file", { quarantine: true });
  }
  if (manifest.schema_version === 2 && hasRenderModels) {
    throw pickupError(422, "unexpected_archive_file", { quarantine: true });
  }
  const expectedFileCount = REQUIRED_FILES.length + 1 + (manifest.schema_version === 3 ? 1 : 0);
  if (extractor.files.size !== expectedFileCount) {
    throw pickupError(422, "unexpected_archive_file", { quarantine: true });
  }

  let renderModels = new Map();
  if (hasRenderModels) {
    const renderFile = extractor.files.get(RENDER_MODELS_FILE);
    if (manifest.bytes[RENDER_MODELS_FILE] !== renderFile.size) {
      throw pickupError(422, "render_models_manifest_mismatch", { quarantine: true });
    }
    const renderText = await fsp.readFile(renderFile.path, "utf8");
    const renderDocument = parseCsvDocument(renderText, "render_models");
    if (manifest.rows.render_models !== renderDocument.rows.length) {
      throw pickupError(422, "render_models_manifest_mismatch", { quarantine: true });
    }
    renderModels = validateRenderModels(renderDocument);
  }
  const playersText = await fsp.readFile(extractor.files.get("players.csv").path, "utf8");
  validatePlayers(parseCsvDocument(playersText, "players"), manifest.schema_version, renderModels);

  const rosterText = await fsp.readFile(extractor.files.get("roster.csv").path, "utf8");
  const roster = normalizeRoster(parseCsv(rosterText, "roster"));
  return { manifest, roster, complete, extractedBytes: extractor.totalBytes };
}

module.exports = {
  REQUIRED_FILES,
  RENDER_MODELS_FILE,
  PLAYERS_V2_COLUMNS,
  PLAYERS_V3_COLUMNS,
  RENDER_MODEL_COLUMNS,
  safeTfcModelPath,
  SafeTarExtractor,
  openZstdStream,
  validateArchive
};
