#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { convertRound } = require("../src/pickup/gameDetailsPilot");

async function discover(root, match, round) {
  const found = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (path.basename(directory).toUpperCase() === match.toUpperCase() &&
          new RegExp(`^round-0*${round}-[a-f0-9]{64}\\.tar\\.zst$`, "i").test(entry.name)) found.push(target);
    }
  }
  await visit(root);
  if (found.length > 1) throw new Error("Multiple matching archives found; select one explicitly with --archive PATH");
  return found[0];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node api/scripts/pilotGameDetails.js --root PATH [--match HDPVET] [--round 1] [--db PATH] [--elo SNAPSHOT] [--archive PATH]");
    console.log("Offline schema-7 pilot. Originals and optional ELO snapshot are read only. No MariaDB or .env required.");
    console.log("Without --elo, historical weapons and round-role references remain unavailable. Output defaults to ROOT/game-details.db.");
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--root", "--match", "--round", "--db", "--elo", "--archive"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid arguments; use --help");
    if (options[args[i]]) throw new Error(`Duplicate ${args[i]}`);
    options[args[i]] = args[i + 1];
  }
  if (!options["--root"]) throw new Error("--root is required; use --help");
  const root = await fs.realpath(options["--root"]), match = options["--match"] || "HDPVET";
  const roundText = options["--round"] || "1";
  if (!/^[a-z0-9_-]{1,64}$/i.test(match) || !/^[1-9]\d{0,3}$/.test(roundText)) throw new Error("Invalid match/round");
  const round = Number(roundText);
  const archive = options["--archive"] ? await fs.realpath(options["--archive"]) : await discover(root, match, round);
  if (!archive) {
    console.log(`Waiting: ${match} round ${round} original archive is not present under ${root}. No database was opened or changed.`);
    process.exitCode = 2;
    return;
  }
  const destination = path.resolve(options["--db"] || path.join(root, "game-details.db"));
  const elo = options["--elo"] ? await fs.realpath(options["--elo"]) : null;
  const resolvedDestination = await fs.realpath(destination).catch(error => { if (error.code !== "ENOENT") throw error; return destination; });
  if ([elo, archive].filter(Boolean).some(file => path.relative(file, resolvedDestination) === "")) throw new Error("Output must be separate from the ELO snapshot and source archive");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const result = await convertRound({ archive, destination, match, round, elo });
  console.log(`Stored and verified: ${result.players} players, ${result.lives} lives, ${result.events} raw events (event/scene streams kept distinct).`);
  console.log(`Original: ${(result.originalBytes / 1048576).toFixed(2)} MiB; compressed detail package: ${(result.compressedBytes / 1048576).toFixed(2)} MiB; database: ${(result.databaseBytes / 1048576).toFixed(2)} MiB.`);
  console.log(`Database: ${destination}`);
  for (const warning of result.quality.warnings) console.log(`Note: ${warning}`);
  // Console output is also a machine-readable quality/identity record for the pilot.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error("Game details pilot failed:", error.message); process.exitCode = 1; });
