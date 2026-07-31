"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { TextDecoder } = require("node:util");
const { parseCsv, normalizeRoster } = require("./csv");
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
const READY_FILES = new Set(["complete.ready", "aborted.ready"]);
const ALLOWED_FILES = new Set([...REQUIRED_FILES, ...READY_FILES]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

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
  if (extractor.files.size !== REQUIRED_FILES.length + 1) {
    throw pickupError(422, "unexpected_archive_file", { quarantine: true });
  }
  if (extractor.files.get(markers[0]).size !== 0) {
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

  const rosterText = await fsp.readFile(extractor.files.get("roster.csv").path, "utf8");
  const roster = normalizeRoster(parseCsv(rosterText, "roster"));
  return { manifest, roster, complete, extractedBytes: extractor.totalBytes };
}

module.exports = {
  REQUIRED_FILES,
  SafeTarExtractor,
  openZstdStream,
  validateArchive
};
