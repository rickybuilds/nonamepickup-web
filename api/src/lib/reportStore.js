"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

// Increment whenever report semantics change incompatibly. Never load an old
// formula's persisted result after an incompatible deployment.
const VERSION = 1;

function validBodies(kind, bodies) {
  if (!bodies || typeof bodies !== "object" || Array.isArray(bodies)) return false;
  const keys = kind === "analytics" ? Array.from({ length: 10 }, (_, i) => String(i + 1)) : ["default"];
  if (Object.keys(bodies).length !== keys.length) return false;
  return keys.every(key => {
    if (typeof bodies[key] !== "string") return false;
    const payload = JSON.parse(bodies[key]);
    return payload?.ok === true && (kind === "analytics" ? payload.data?.limit === Number(key)
      : Array.isArray(payload.data?.maps) && Array.isArray(payload.data?.classes));
  });
}

class ReportStore {
  constructor({ directory, databaseKey, now = Date.now, maxAgeMs = 24 * 60 * 60_000, maxBytes = 32 * 1024 * 1024 }) {
    Object.assign(this, { directory, databaseKey, now, maxAgeMs, maxBytes });
  }

  file(kind) {
    if (!["analytics", "defense"].includes(kind)) throw new Error("Unknown report snapshot");
    return path.join(this.directory, `${kind}.json`);
  }

  async load(kind) {
    let handle;
    try {
      handle = await fs.open(this.file(kind), "r");
      if ((await handle.stat()).size > this.maxBytes) return null;
      const saved = JSON.parse(await handle.readFile("utf8"));
      if (saved.version !== VERSION || saved.databaseKey !== this.databaseKey ||
          !Number.isFinite(saved.generatedAt) || saved.generatedAt > this.now() + 60_000 ||
          this.now() - saved.generatedAt > this.maxAgeMs || !validBodies(kind, saved.bodies)) return null;
      return { generatedAt: saved.generatedAt, bodies: saved.bodies };
    } catch { return null; } // Missing, unreadable or incomplete snapshots are cold starts.
    finally { if (handle) await handle.close(); }
  }

  async save(kind, value) {
    const body = JSON.stringify({ version: VERSION, databaseKey: this.databaseKey, ...value });
    if (Buffer.byteLength(body) > this.maxBytes) throw new Error("Report snapshot too large");
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(kind);
    // One API instance and one serialized refresh: fixed temp names keep disk
    // usage bounded to two successes plus two interrupted writes across restarts.
    const temporary = `${file}.tmp`;
    let handle;
    try {
      await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(body);
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, file);
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temporary).catch(() => {});
    }
  }
}

function storeFor(databasePath) {
  // Use a DB-file identity, not its changing size/mtime. A replaced DB at the
  // same pathname must not inherit another database's successful payload.
  let store;
  const ready = fs.stat(databasePath).then(stat => {
    const databaseKey = createHash("sha256").update(JSON.stringify([
      path.resolve(databasePath), stat.dev, stat.ino, stat.birthtimeMs
    ])).digest("hex");
    store = new ReportStore({ directory: process.env.REPORT_CACHE_DIR || path.resolve(__dirname, "../../.cache/reports"), databaseKey });
  });
  // Attach handlers through each call; avoid an unhandled stat rejection when
  // the DB is moved before any request reaches this service.
  ready.catch(() => {});
  return {
    async load(kind) { await ready; return store.load(kind); },
    async save(kind, value) { await ready; return store.save(kind, value); }
  };
}

module.exports = { ReportStore, storeFor };
