#!/usr/bin/env node
"use strict";
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true });
const config = require("../src/config");
const { createDatabase } = require("../src/db");
const { createKillWeaponRepair } = require("../src/pickup/killWeaponAlignment");

const args = process.argv.slice(2);
const matchIndex = args.indexOf("--match");
const matchId = matchIndex < 0 ? null : args[matchIndex + 1];
if (matchIndex >= 0 && !/^[a-z0-9_-]{1,100}$/i.test(matchId || "")) {
  throw new Error("--match requires a match ID");
}
const db = createDatabase(config.ELO_DB, config.ANALYTICS_RETENTION_DAYS);
db.pragma("busy_timeout = 10000");
try {
  console.log(`Weapon repair database: ${config.ELO_DB}${args.includes("--dry-run") ? " (preview only)" : ""}`);
  const repair = createKillWeaponRepair(db);
  const rounds = db.prepare(`SELECT match_id,round_number FROM pickup_kill_rounds
    WHERE (? IS NULL OR match_id=?) ORDER BY match_id,round_number`).all(matchId, matchId);
  let changed = 0;
  for (const [index, round] of rounds.entries()) {
    const result = repair(round.match_id, round.round_number, args.includes("--dry-run"));
    changed += result.changed;
    console.log(`[${index + 1}/${rounds.length}] ${round.match_id} round ${round.round_number}: ` +
      (result.offsetSeconds == null ? result.reason : `offset ${result.offsetSeconds.toFixed(3)}s; ${result.matched}/${result.total} matched; ${result.changed} weapon values ${args.includes("--dry-run") ? "would change" : "updated"}`));
  }
  console.log(`Weapon repair ${args.includes("--dry-run") ? "preview" : "complete"}: ${changed} changes across ${rounds.length} rounds.`);
} finally { db.close(); }
