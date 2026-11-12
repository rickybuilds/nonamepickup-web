#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { fork } = require("node:child_process");
const Database = require("better-sqlite3");
const { prepareRound, finishRound, CONVERTER } = require("../src/pickup/gameDetailsPilot");

async function discover(root, matchFilter) {
  const groups = new Map();
  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const archive = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(archive); continue; }
      const parsed = /^round-(\d{1,4})-([a-f0-9]{64})\.tar\.zst$/i.exec(entry.name);
      const match = path.basename(directory);
      if (!parsed || !/^[a-z0-9_-]{1,64}$/i.test(match) || (matchFilter && match !== matchFilter)) continue;
      const round = Number(parsed[1]), sha = parsed[2].toLowerCase();
      if (round < 1) continue;
      const key = `${match}:${round}`;
      if (!groups.has(key)) groups.set(key, new Map());
      groups.get(key).set(sha, { archive, match, round, sha });
    }
  }
  await visit(root);
  const jobs = [], conflicts = [];
  for (const versions of groups.values()) {
    if (versions.size === 1) jobs.push([...versions.values()][0]);
    else conflicts.push({ ...[...versions.values()][0], error: "Multiple different source hashes for the same match/round; select the intended archive with the single-round CLI", archives: [...versions.values()].map(job => job.archive) });
  }
  return { jobs, conflicts };
}

function storedRounds(destination) {
  if (!fs.existsSync(destination)) return [];
  const db = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma("application_id", { simple: true }) !== 1195656268 || db.pragma("user_version", { simple: true }) !== 1) throw new Error("Output is not a game-details database");
    return db.prepare(`SELECT r.match_id,r.round_number,r.source_sha256,r.converter
      FROM detail_rounds r JOIN detail_packages p ON p.round_id=r.id
      WHERE p.format='game-details-pilot-v1' AND p.encoding='json+gzip'`).all();
  } finally { db.close(); }
}

async function canonicalOutput(file) {
  const full = path.resolve(file);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  return fsp.realpath(full).catch(async error => {
    if (error.code !== "ENOENT") throw error;
    return path.join(await fsp.realpath(path.dirname(full)), path.basename(full));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node api/scripts/importGameDetails.js --root PATH --elo SNAPSHOT [--db PATH] [--workers 4] [--match ID] [--limit N] [--status] [--report PATH.jsonl]");
    console.log("Recursively imports supported schema 2–7 recordings. Four converter processes, one database writer. Rerun to resume; Ctrl+C finishes current rounds then stops.");
    console.log("--status only inventories archives/current converter coverage; per-round ELO revisions are checked during import. No archives or ELO data are modified.");
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!["--root", "--elo", "--db", "--workers", "--match", "--limit", "--status", "--report"].includes(key) || Object.hasOwn(options, key)) throw new Error("Invalid/duplicate arguments; use --help");
    if (key === "--status") options[key] = true;
    else { if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing ${key} value`); options[key] = args[++i]; }
  }
  if (!options["--root"] || (!options["--elo"] && !options["--status"])) throw new Error("--root and --elo are required for import; use --help");
  const root = await fsp.realpath(options["--root"]), elo = options["--elo"] ? await fsp.realpath(options["--elo"]) : null;
  const workersText = options["--workers"] || "4", limitText = options["--limit"] || "1000000";
  if (!/^(?:[1-9]|10)$/.test(workersText) || !/^[1-9]\d{0,6}$/.test(limitText)) throw new Error("Workers must be 1–10 and limit a positive integer");
  if (options["--match"] && !/^[a-z0-9_-]{1,64}$/i.test(options["--match"])) throw new Error("Invalid match ID");
  const destination = await canonicalOutput(options["--db"] || path.join(root, "game-details.db"));
  if (elo && path.relative(elo, destination) === "") throw new Error("Output must differ from ELO snapshot");
  const inventory = await discover(root, options["--match"]);
  const jobs = inventory.jobs.slice(0, Number(limitText));
  const stored = storedRounds(destination);
  const current = new Set(stored.filter(row => row.converter === CONVERTER).map(row => `${row.match_id}:${row.round_number}:${row.source_sha256}`));
  const covered = jobs.filter(job => current.has(`${job.match}:${job.round}:${job.sha}`)).length;
  console.log(`${jobs.length} unique rounds selected; ${covered} stored by ${CONVERTER}; ${jobs.length - covered} not yet stored by this converter; ${inventory.conflicts.length} source conflicts.`);
  console.log("Existing rounds are also checked against current per-round ELO references during import.");
  if (options["--status"]) return;
  // Validate the snapshot immediately; worker failures should describe individual
  // recordings, rather than repeat a bad/missing ELO path hundreds of times.
  const snapshot = new Database(elo, { readonly: true, fileMustExist: true });
  try { snapshot.prepare("SELECT 1 FROM match_kill_events LIMIT 1").get(); } finally { snapshot.close(); }
  const report = await canonicalOutput(options["--report"] || path.join(root, "game-details-import.jsonl"));
  if (!report.toLowerCase().endsWith(".jsonl") || [destination, elo, ...jobs.map(job => job.archive)].some(file => path.relative(file, report) === "")) throw new Error("Report must be a separate .jsonl file");
  const record = data => fs.appendFileSync(report, JSON.stringify({ at: new Date().toISOString(), converter: CONVERTER, ...data }) + "\n", { mode: 0o600 });
  let imported = 0, skipped = 0, failed = 0, cursor = 0, completed = 0, stopping = false;
  record({ status: "started", destination, selected: jobs.length });
  for (const conflict of inventory.conflicts) { failed++; record({ status: "failed", ...conflict }); console.error(`${conflict.match} round ${conflict.round}: ${conflict.error}`); }
  const stop = () => { stopping = true; console.log("Stopping after current rounds finish. Rerun the same command to resume."); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const started = Date.now();
  function progress(job, status, detail) {
    completed++;
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`[${completed}/${jobs.length} · ${jobs.length - completed} remaining · ${seconds}s] ${job.match} round ${job.round}: ${status}${detail ? " · " + detail : ""}`);
  }
  function lane() {
    return new Promise(resolve => {
      let active = null, finished = false, laneError = null;
      const child = fork(__filename, ["--worker"], { stdio: ["ignore", "ignore", "inherit", "ipc"], serialization: "advanced", windowsHide: true });
      function next() {
        if (stopping || cursor >= jobs.length) { child.disconnect(); return; }
        active = jobs[cursor++];
        child.send({ ...active, destination, elo }, error => { if (error) child.kill(); });
      }
      child.on("message", message => {
        const job = active;
        if (!job) return;
        try {
          if (message.error) throw new Error(message.error);
          if (message.prepared.skipped) {
            skipped++; record({ status: "skipped", ...job, revision: message.prepared.revision }); progress(job, "unchanged");
          } else {
            const result = finishRound(destination, message.prepared);
            imported++; record({ status: "imported", ...result });
            progress(job, "imported", `${(result.compressedBytes / 1048576).toFixed(2)} MiB package; ${result.quality.weaponAlignment.matched}/${result.quality.weaponAlignment.total} weapons aligned`);
          }
        } catch (error) { failed++; record({ status: "failed", ...job, error: error.message }); progress(job, "FAILED", error.message); }
        active = null;
        next();
      });
      child.on("error", error => {
        laneError = error;
        console.error("Worker error:", error.message);
        if (!child.pid) finishLane(null, null);
        else child.kill();
      });
      function finishLane(code, signal) {
        if (finished) return; finished = true;
        if (active) { failed++; record({ status: "failed", ...active, error: laneError?.message || `Worker exited ${code ?? signal}` }); progress(active, "FAILED", "worker exited"); }
        else if (laneError) { failed++; record({ status: "worker_error", error: laneError.message }); }
        resolve();
      }
      child.once("exit", finishLane);
      next();
    });
  }
  try { await Promise.all(Array.from({ length: Math.min(Number(workersText), jobs.length) }, lane)); }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
  const summary = { status: stopping ? "stopped" : "finished", imported, skipped, failed, remaining: jobs.length - completed, destination, report };
  record(summary);
  console.log(`Import ${summary.status}: ${imported} imported, ${skipped} unchanged, ${failed} failed, ${summary.remaining} unprocessed. Report: ${report}`);
  if (failed || summary.remaining) process.exitCode = stopping ? 130 : 1;
}

if (process.argv[2] === "--worker" && process.send) {
  process.on("SIGINT", () => {}); // Let the parent drain active conversions.
  process.on("disconnect", () => process.exit(0));
  process.on("message", async job => {
    try {
      const prepared = await prepareRound({ ...job, skipExisting: true, log() {} });
      process.send({ prepared }, error => { if (error) process.exit(1); });
    } catch (error) { process.send({ error: error.message }, sendError => { if (sendError) process.exit(1); }); }
  });
} else main().catch(error => { console.error("Game details import failed:", error.message); process.exitCode = 1; });
