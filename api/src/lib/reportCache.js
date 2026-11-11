"use strict";

const path = require("node:path");
const { fork } = require("node:child_process");
const { createHash } = require("node:crypto");
const { storeFor } = require("./reportStore");

// Two report kinds, one child at a time, no recurring refresh timer.
class ReportCache {
  constructor({ run, revision, now = Date.now, ttlMs = 5_000, cooldownMs = 60_000, retryMs = 60_000,
    store, warn = message => console.warn(message) }) {
    Object.assign(this, { run, revision, now, ttlMs, cooldownMs, retryMs, store, warn });
    this.entries = new Map();
    this.pending = new Map();
    this.nextStart = 0;
    this.generation = 0;
  }

  invalidate() { this.generation++; }

  async get(kind, variant = "default") {
    if (!["analytics", "defense"].includes(kind)) throw new Error("Unknown report");
    if (kind === "analytics" && (!Number.isInteger(Number(variant)) || variant < 1 || variant > 10)) throw new Error("Invalid limit");
    let entry = this.entries.get(kind);
    const now = this.now();
    if (!entry) {
      entry = { checkedAt: -Infinity, generatedAt: 0, retryAt: 0, failures: 0 };
      this.entries.set(kind, entry);
      if (this.store) {
        entry.loading = this.store.load(kind).then(saved => {
          if (saved) Object.assign(entry, { bodies: saved.bodies, generatedAt: saved.generatedAt });
        }).catch(() => {}).finally(() => { delete entry.loading; });
      }
    }
    if (entry.loading) await entry.loading;
    if (entry.bodies && now - entry.checkedAt < this.ttlMs && entry.generation === this.generation) {
      return this.result(entry, variant, "HIT");
    }
    if (now < entry.retryAt) {
      if (entry.bodies) return this.result(entry, variant, "BACKOFF");
      throw new Error("Report refresh in backoff");
    }
    let revision;
    try { revision = `${this.generation}:${this.revision()}`; }
    catch (error) {
      this.failed(entry);
      if (entry.bodies) return this.result(entry, variant, "BACKOFF");
      throw error;
    }
    if (entry.bodies && entry.revision === revision) {
      entry.checkedAt = now;
      return this.result(entry, variant, "HIT");
    }
    const refresh = this.refresh(kind, entry, revision);
    if (entry.bodies) {
      // refresh owns failure bookkeeping; never reject a stale response.
      refresh.catch(() => {});
      return this.result(entry, variant, "STALE");
    }
    await refresh;
    return this.result(entry, variant, "MISS");
  }

  result(entry, variant, status) {
    return { body: entry.bodies[variant], status, age: Math.max(0, Math.floor((this.now() - entry.generatedAt) / 1000)),
      revision: entry.revision, validatedAt: Number.isFinite(entry.checkedAt) ? Math.floor(entry.checkedAt / 1000) : null,
      failed: entry.failures > 0 };
  }

  failed(entry) {
    entry.failures++;
    entry.retryAt = this.now() + Math.min(30 * 60_000, this.retryMs * 2 ** Math.min(entry.failures - 1, 5));
  }

  refresh(kind, entry, revision) {
    if (this.pending.has(kind)) return this.pending.get(kind);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Register before starting: concurrent requests and other kinds share this queue.
    this.pending.set(kind, promise);
    const task = { kind, entry, revision, resolve, reject, generation: this.generation };
    (this.queue ||= []).push(task);
    this.drain();
    return promise;
  }

  drain() {
    if (this.active || !this.queue?.length || this.timer) return;
    const delay = this.nextStart - this.now();
    const firstLoad = !this.queue[0].entry.bodies && this.queue[0].entry.failures === 0;
    // At most two first loads can skip the cooldown, only after success.
    // They still wait for the preceding child to close. Routine refreshes
    // and any work after a failure retain the full resource-protection delay.
    if (delay > 0 && !(firstLoad && this.lastRunSucceeded !== false)) {
      this.timer = setTimeout(() => { this.timer = null; this.drain(); }, delay);
      this.timer.unref?.();
      return;
    }
    const task = this.queue.shift();
    this.active = task;
    const complete = async (error, bodies) => {
      const entry = task.entry;
      if (error) {
        this.failed(entry);
        task.reject(error);
      } else {
        Object.assign(entry, { bodies, revision: task.revision, generation: task.generation,
          checkedAt: this.now(), generatedAt: this.now(), failures: 0, retryAt: 0 });
        if (this.store) {
          try { await this.store.save(task.kind, { bodies, generatedAt: entry.generatedAt }); }
          catch { this.warn(`[report-cache] ${task.kind} snapshot could not be saved; serving memory cache`); }
        }
        task.resolve();
      }
      this.pending.delete(task.kind);
      this.active = null;
      this.lastRunSucceeded = !error;
      this.nextStart = this.now() + this.cooldownMs;
      this.drain();
    };
    try { Promise.resolve(this.run(task.kind)).then(bodies => complete(null, bodies), error => complete(error)); }
    catch (error) { complete(error); }
  }
}

function runReport(databasePath, kind, { spawn = fork, timeoutMs = 30_000, onMetrics = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(__dirname, "../workers/reportRefresh.js"), [], {
      execArgv: ["--max-old-space-size=192"], env: { ...process.env, REPORT_DB: databasePath, REPORT_KIND: kind },
      stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true
    });
    let result, failure;
    const timer = setTimeout(() => { failure = new Error("Report refresh timed out"); child.kill("SIGKILL"); }, timeoutMs);
    child.on("message", message => {
      if (message.error) failure = new Error(message.error);
      else { result = message.bodies; if (message.metrics) onMetrics(message.metrics); }
    });
    child.on("error", error => { failure = error; });
    // Wait for actual process exit, including after SIGKILL, before releasing the slot.
    child.on("close", code => {
      clearTimeout(timer);
      if (failure || code !== 0 || !result) reject(failure || new Error("Report worker exited without a result"));
      else resolve(result);
    });
  });
}

function createRevisionReader(db, now = Date.now) {
  let checkedAt = -Infinity, cached, lastVersion, fallbackAt = now(), fallback = 0;
  return () => {
    const time = now();
    if (time - checkedAt < 5_000) return cached;
    const version = `${db.prepare("PRAGMA data_version").get().data_version}:${db.prepare("SELECT total_changes() AS n").get().n}`;
    if (version !== lastVersion && time - fallbackAt >= 15 * 60_000) {
      fallback++; fallbackAt = time; lastVersion = version;
    }
    if (lastVersion == null) lastVersion = version;
    const imports = db.prepare("SELECT COUNT(*) AS n, MAX(imported_at) AS latest, SUM(imported_at) AS stamp FROM match_stat_imports WHERE status='ok'").get();
    // Unavailable MVP retries touch computed_at without changing report data.
    const matches = db.prepare(`SELECT COUNT(*) AS n, MAX(created_at) AS latest,
      SUM(CASE WHEN nn_mvp_status='available' THEN 1 ELSE 0 END) AS mvps,
      SUM(CASE WHEN nn_mvp_status='available' THEN nn_mvp_computed_at ELSE 0 END) AS mvp
      FROM matches WHERE status='completed'`).get();
    const tfc = db.prepare("SELECT COUNT(*) AS n, MAX(imported_at) AS latest, SUM(imported_at) AS stamp FROM tfcstats_imports").get();
    cached = JSON.stringify([imports, matches, tfc, fallback, Math.floor(time / 3_600_000)]);
    checkedAt = time;
    return cached;
  };
}

const services = new WeakMap();
function reportsFor(db) {
  if (!services.has(db)) {
    if (!db.name || db.name === ":memory:") throw new Error("Report refresh requires a file-backed database");
    services.set(db, new ReportCache({ revision: createRevisionReader(db), run: kind => runReport(db.name, kind), store: storeFor(db.name) }));
  }
  return services.get(db);
}

function reportHeaders(res, report, prefix) {
  res.setHeader(`X-${prefix}-Cache`, report.status);
  res.setHeader(`X-${prefix}-Age`, String(report.age));
  if (report.validatedAt != null) res.setHeader(`X-${prefix}-Validated-At`, String(report.validatedAt));
  res.setHeader(`X-${prefix}-Refresh`, report.failed ? "failed" : "ok");
  res.setHeader(`X-${prefix}-Revision`, createHash("sha256").update(String(report.revision)).digest("hex").slice(0, 16));
  // Public caching remains bounded; the server retains the last successful value.
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  res.type("application/json");
}

async function coldWait(promise, ms = 1500) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("Report warming"), { code: "REPORT_WARMING" })), ms); })]); }
  finally { clearTimeout(timer); }
}

module.exports = { ReportCache, runReport, reportsFor, createRevisionReader, reportHeaders, coldWait };
