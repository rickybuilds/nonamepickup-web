"use strict";

const Database = require("better-sqlite3");
const config = require("../src/config");
const { initializeSchema } = require("../src/db/schema");
const { createGeoIpLookup } = require("../src/tracker/geolocation");

function parseArgs(argv) {
  const args = { dryRun: false, limit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    if (arg === "--limit") {
      const limit = Number.parseInt(argv[index + 1], 10);
      if (Number.isInteger(limit) && limit > 0) args.limit = limit;
      index += 1;
    }
  }
  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(config.ELO_DB, { readonly: args.dryRun });
  if (!args.dryRun) initializeSchema(db);

  const ips = db.prepare(`
    SELECT DISTINCT TRIM(ip) AS ip
    FROM steam_ip_history
    WHERE ip IS NOT NULL AND TRIM(ip) <> ''
    ORDER BY ip
  `).all();
  const limitedIps = args.limit ? ips.slice(0, args.limit) : ips;
  const hasGeoTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ip_geolocation'").get());
  const cached = new Set(
    hasGeoTable ? db.prepare("SELECT ip FROM ip_geolocation").all().map(row => String(row.ip)) : []
  );
  const lookup = createGeoIpLookup({
    dbPath: config.GEOIP_DB_PATH,
    databaseVersion: config.GEOIP_DATABASE_VERSION
  });
  const summary = {
    historical: ips.length,
    selected: limitedIps.length,
    cached: 0,
    skipped: 0,
    invalid: 0,
    private: 0,
    eligible: 0,
    resolved: 0,
    noMatch: 0,
    unavailable: 0,
    inserted: 0
  };

  const insert = args.dryRun ? null : db.prepare(`
    INSERT INTO ip_geolocation (
      ip, country_code, country, region, city, latitude, longitude, timezone,
      source, database_version, status, looked_up_at
    ) VALUES (
      @ip, @country_code, @country, @region, @city, @latitude, @longitude, @timezone,
      @source, @database_version, @status, @looked_up_at
    ) ON CONFLICT(ip) DO NOTHING
  `);
  const now = Math.floor(Date.now() / 1000);

  for (const row of limitedIps) {
    const ip = row.ip;
    if (cached.has(ip)) {
      summary.cached += 1;
      continue;
    }

    const classification = lookup.classifyIp(ip);
    if (classification.status === "invalid") summary.invalid += 1;
    if (classification.status === "private") summary.private += 1;
    if (classification.status === "eligible") summary.eligible += 1;

    let result = classification;
    if (classification.status === "eligible") {
      result = await lookup.lookup(ip);
      if (result.status === "resolved") summary.resolved += 1;
      else if (result.status === "no_match") summary.noMatch += 1;
      else if (result.status === "unavailable") summary.unavailable += 1;
    }

    if (args.dryRun) continue;
    if (result.status === "unavailable") continue;
    const inserted = insert.run({
      ip: result.ip,
      country_code: result.country_code || null,
      country: result.country || null,
      region: result.region || null,
      city: result.city || null,
      latitude: Number.isFinite(result.latitude) ? result.latitude : null,
      longitude: Number.isFinite(result.longitude) ? result.longitude : null,
      timezone: result.timezone || null,
      source: result.source || "dbip-lite-city",
      database_version: result.database_version || config.GEOIP_DATABASE_VERSION || null,
      status: result.status,
      looked_up_at: now
    });
    if (inserted.changes) {
      cached.add(ip);
      summary.inserted += 1;
    }
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      mode: "dry-run",
      ...summary,
      estimated_inserts: summary.invalid + summary.private + summary.resolved + summary.noMatch
    }, null, 2));
  } else {
    console.log(JSON.stringify({ mode: "backfill", ...summary }, null, 2));
  }
  if (summary.unavailable) {
    console.error("GeoIP lookup is unavailable. Set GEOIP_DB_PATH to a local DB-IP City Lite MMDB before retrying.");
    process.exitCode = 2;
  }
  db.close();
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
