"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const CACHE_MAGIC = Buffer.from("BCR1", "ascii");
const CACHE_HEADER_BYTES = CACHE_MAGIC.length + 32;
const CACHE_KEY_FIELDS = [
  "id", "run_id", "map", "route_id", "class_id", "config_version", "frame_interval", "tier_tag",
  "pos_frames", "proj_frames", "input_frames", "cmd_frames", "event_frames",
  "spool_pos_sha", "spool_proj_sha", "spool_input_sha", "spool_cmd_sha", "spool_event_sha"
];

function bootcampReplayCacheKey(record) {
  const identity = CACHE_KEY_FIELDS.map(field => record[field] ?? null);
  return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

class BootcampReplayCache {
  constructor(root, { publicRoot = null, maxBytes = 256 * 1024 * 1024, maxEntries = 1000, maxAgeMs = 30 * 86400 * 1000, now = Date.now } = {}) {
    this.root = root;
    this.publicRoot = publicRoot;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    this.lastPrunedAt = 0;
  }

  filePath(key) {
    if (!/^[a-f0-9]{64}$/.test(String(key))) throw new Error("invalid_bootcamp_replay_cache_key");
    return path.join(this.root, `${key}.tftr`);
  }

  async ensureReady() {
    const resolvedRoot = path.resolve(this.root || ".");
    const resolvedPublic = this.publicRoot ? path.resolve(this.publicRoot) : null;
    if (!this.root || !path.isAbsolute(this.root) || resolvedRoot === path.parse(resolvedRoot).root ||
        (resolvedPublic && (resolvedRoot === resolvedPublic || resolvedRoot.startsWith(`${resolvedPublic}${path.sep}`))))
      throw new Error("unsafe_bootcamp_replay_cache_path");
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const realRoot = await fs.realpath(this.root);
    if (realRoot === path.parse(realRoot).root) throw new Error("unsafe_bootcamp_replay_cache_path");
    if (resolvedPublic) {
      try {
        const realPublic = await fs.realpath(resolvedPublic);
        if (realRoot === realPublic || realRoot.startsWith(`${realPublic}${path.sep}`))
          throw new Error("unsafe_bootcamp_replay_cache_path");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }

  async get(key) {
    const file = this.filePath(key);
    await this.ensureReady();
    let stat;
    try { stat = await fs.stat(file); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!stat.isFile() || stat.size <= CACHE_HEADER_BYTES || stat.size > this.maxBytes + CACHE_HEADER_BYTES || this.now() - stat.mtimeMs > this.maxAgeMs) {
      await fs.rm(file, { force: true });
      return null;
    }
    const stored = await fs.readFile(file);
    if (!stored.subarray(0, CACHE_MAGIC.length).equals(CACHE_MAGIC)) {
      await fs.rm(file, { force: true });
      return null;
    }
    const data = stored.subarray(CACHE_HEADER_BYTES);
    const expected = stored.subarray(CACHE_MAGIC.length, CACHE_HEADER_BYTES);
    const actual = crypto.createHash("sha256").update(data).digest();
    if (data.length === 0 || !crypto.timingSafeEqual(expected, actual)) {
      await fs.rm(file, { force: true });
      return null;
    }
    return data;
  }

  async put(key, data) {
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > this.maxBytes) return false;
    const file = this.filePath(key);
    await this.ensureReady();
    const envelope = Buffer.concat([CACHE_MAGIC, crypto.createHash("sha256").update(data).digest(), data]);
    const temporary = `${file}.${crypto.randomUUID()}.part`;
    try {
      await fs.writeFile(temporary, envelope, { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    await this.prune();
    return true;
  }

  async prune() {
    const now = this.now();
    if (now - this.lastPrunedAt < 60_000) return;
    this.lastPrunedAt = now;
    await this.ensureReady();
    const entries = [];
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.tftr$/.test(entry.name)) continue;
      const file = path.join(this.root, entry.name);
      try {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs > this.maxAgeMs) await fs.rm(file, { force: true });
        else entries.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    while (entries.length > this.maxEntries || totalBytes > this.maxBytes + CACHE_HEADER_BYTES) {
      const oldest = entries.shift();
      totalBytes -= oldest.size;
      await fs.rm(oldest.file, { force: true });
    }
  }
}

module.exports = { BootcampReplayCache, bootcampReplayCacheKey };
