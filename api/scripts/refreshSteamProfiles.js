"use strict";

const config = require("../src/config");
const { createDatabase } = require("../src/db");
const { refreshSteamProfiles } = require("../src/steam/profiles");

async function main() {
  const force = process.argv.includes("--force");
  const db = createDatabase(config.ELO_DB, config.ANALYTICS_RETENTION_DAYS);

  try {
    const result = await refreshSteamProfiles({
      db,
      apiKey: config.STEAM_API_KEY,
      force
    });
    console.log(JSON.stringify({ ok: true, force, ...result }, null, 2));
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(`[steam] Refresh failed: ${error.message}`);
  process.exitCode = 1;
});
