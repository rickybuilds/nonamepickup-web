"use strict";

const os = require("node:os");
// Lower scheduling priority before opening SQLite or loading report code.
try { os.setPriority(0, os.constants.priority.PRIORITY_LOW); }
catch { process.exit(1); } // Fail closed if the shared host cannot deprioritize us.

const Database = require("better-sqlite3");
const { buildAnalytics } = require("../lib/analytics");
const { projectAnalytics } = require("../lib/analyticsProjection");
const { loadDefenseRatings } = require("../lib/defenseRatings");

let db;
const start = process.hrtime.bigint();
const cpu = process.cpuUsage();
try {
  db = new Database(process.env.REPORT_DB, { readonly: true, fileMustExist: true, timeout: 1000 });
  db.pragma("query_only = ON");
  db.pragma("cache_size = -8192");
  db.pragma("temp_store = FILE");
  db.exec("BEGIN");
  const bodies = {};
  if (process.env.REPORT_KIND === "analytics") {
    const payload = buildAnalytics(db, 10);
    for (let limit = 1; limit <= 10; limit++) bodies[limit] = JSON.stringify(projectAnalytics(payload, limit));
  } else if (process.env.REPORT_KIND === "defense") {
    bodies.default = JSON.stringify({ ok: true, data: loadDefenseRatings(db) });
  } else throw new Error("Unknown report kind");
  db.exec("COMMIT");
  db.close(); db = null;
  const used = process.cpuUsage(cpu);
  process.send({ bodies, metrics: { elapsedMs: Number(process.hrtime.bigint() - start) / 1e6,
    cpuMs: (used.user + used.system) / 1000, rssMiB: process.memoryUsage().rss / 1048576,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    priority: os.getPriority(0) } }, () => process.disconnect());
} catch {
  if (db) db.close();
  if (process.connected) process.send({ error: "Report refresh failed" }, () => process.disconnect());
  process.exitCode = 1;
}
