#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const FILE_ORDER = [
  "roster.csv",
  "render_models.csv",
  "players.csv",
  "projectile_defs.csv",
  "projectiles.csv",
  "objective_defs.csv",
  "objectives.csv",
  "buildable_defs.csv",
  "buildables.csv",
  "brush_defs.csv",
  "brushes.csv",
  "events.csv"
];
const MATCH_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ROUND_PATTERN = /^round-(\d{1,4})$/;
const SERVER_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

const config = {
  root: process.env.PICKUP_REPLAY_ROOT,
  ingestUrl: process.env.PICKUP_LIVE_INGEST_URL,
  serverId: process.env.PICKUP_SERVER_ID,
  curlConfig: process.env.PICKUP_CURL_CONFIG || "/root/.config/tfc/pickup-upload.curl",
  intervalMs: positiveInteger(process.env.PICKUP_LIVE_INTERVAL_MS, 500, 100, 5000),
  heartbeatMs: positiveInteger(process.env.PICKUP_LIVE_HEARTBEAT_MS, 5000, 1000, 30000),
  perFileBytes: positiveInteger(process.env.PICKUP_LIVE_PER_FILE_BYTES, 65536, 4096, 262144)
};

if (!config.root || !config.ingestUrl || !config.serverId) {
  throw new Error("PICKUP_REPLAY_ROOT, PICKUP_LIVE_INGEST_URL, and PICKUP_SERVER_ID are required.");
}
if (!SERVER_PATTERN.test(config.serverId)) throw new Error("PICKUP_SERVER_ID is invalid.");
if (!/^https:\/\//i.test(config.ingestUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?\//i.test(config.ingestUrl)) {
  throw new Error("PICKUP_LIVE_INGEST_URL must use HTTPS (or loopback HTTP for local development).");
}

const streams = new Map();
let stopping = false;
let rootReal = null;

function log(message) {
  process.stdout.write(`[pickup-live-forwarder] ${message}\n`);
}

function streamId() {
  return crypto.randomBytes(24).toString("base64url");
}

function createState(matchId, round, directory) {
  return {
    key: `${matchId}:${round}`,
    matchId,
    round,
    directory,
    streamId: streamId(),
    sequence: 0,
    schemaVersion: 2,
    offsets: new Map(),
    lastPostAt: 0,
    finalSent: false,
    posting: false
  };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function schemaVersion(directory) {
  if (await exists(path.join(directory, "brush_defs.csv.part")) || await exists(path.join(directory, "brush_defs.csv"))) return 4;
  if (await exists(path.join(directory, "render_models.csv.part")) || await exists(path.join(directory, "render_models.csv"))) return 3;
  return 2;
}

async function discover() {
  const matches = await fs.readdir(rootReal, { withFileTypes: true });
  for (const match of matches) {
    if (!match.isDirectory() || !MATCH_PATTERN.test(match.name)) continue;
    const matchDirectory = path.join(rootReal, match.name);
    const rounds = await fs.readdir(matchDirectory, { withFileTypes: true });
    for (const roundEntry of rounds) {
      const parsed = ROUND_PATTERN.exec(roundEntry.name);
      if (!roundEntry.isDirectory() || !parsed) continue;
      const round = Number(parsed[1]);
      if (round < 1 || round > 9999) continue;
      const key = `${match.name}:${round}`;
      if (streams.has(key)) continue;
      const directory = await fs.realpath(path.join(matchDirectory, roundEntry.name));
      if (!directory.startsWith(rootReal + path.sep)) continue;
      const names = await fs.readdir(directory);
      const active = names.some(name => name.endsWith(".csv.part"));
      const finalized = names.includes("complete.ready") || names.includes("aborted.ready");
      if (!active || finalized) continue;
      const state = createState(match.name, round, directory);
      state.schemaVersion = await schemaVersion(directory);
      streams.set(key, state);
      log(`discovered ${config.serverId}:${match.name}:${round} schema ${state.schemaVersion}`);
    }
  }
}

async function sourcePath(directory, fileName) {
  const part = path.join(directory, `${fileName}.part`);
  if (await exists(part)) return part;
  const final = path.join(directory, fileName);
  return await exists(final) ? final : null;
}

async function readCompleteLines(file, offset, maximumBytes) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (stat.size < offset) throw new Error("live_file_truncated");
    const available = Math.min(maximumBytes, stat.size - offset);
    if (available <= 0) return null;
    const buffer = Buffer.allocUnsafe(available);
    const { bytesRead } = await handle.read(buffer, 0, available, offset);
    if (!bytesRead) return null;
    const chunk = buffer.subarray(0, bytesRead);
    const boundary = chunk.lastIndexOf(0x0a);
    if (boundary < 0) return null;
    const complete = chunk.subarray(0, boundary + 1);
    return {
      start: offset,
      end: offset + complete.length,
      data: complete.toString("utf8")
    };
  } finally {
    await handle.close();
  }
}

async function finalized(directory) {
  return await exists(path.join(directory, "complete.ready")) || await exists(path.join(directory, "aborted.ready"));
}

async function collect(state) {
  state.schemaVersion = Math.max(state.schemaVersion, await schemaVersion(state.directory));
  const files = {};
  const nextOffsets = new Map(state.offsets);
  for (const fileName of FILE_ORDER) {
    if (state.schemaVersion < 3 && ["render_models.csv", "buildable_defs.csv", "buildables.csv"].includes(fileName)) continue;
    if (state.schemaVersion < 4 && ["brush_defs.csv", "brushes.csv"].includes(fileName)) continue;
    const file = await sourcePath(state.directory, fileName);
    if (!file) continue;
    const start = state.offsets.get(fileName) || 0;
    const chunk = await readCompleteLines(file, start, config.perFileBytes);
    if (!chunk) continue;
    files[fileName] = chunk;
    nextOffsets.set(fileName, chunk.end);
  }
  const isFinalized = await finalized(state.directory);
  const hasData = Object.keys(files).length > 0;
  return {
    body: { files, final: isFinalized && !hasData },
    nextOffsets,
    shouldPost: hasData || (isFinalized && !state.finalSent) || Date.now() - state.lastPostAt >= config.heartbeatMs
  };
}

function curlPost(state, body) {
  return new Promise((resolve, reject) => {
    const sequence = state.sequence + 1;
    const args = [
      "--config", config.curlConfig,
      "--silent", "--show-error",
      "--request", "POST", config.ingestUrl,
      "--header", "Content-Type: application/json",
      "--header", `X-Pickup-Server-Id: ${config.serverId}`,
      "--header", `X-Pickup-Match-Id: ${state.matchId}`,
      "--header", `X-Pickup-Round: ${state.round}`,
      "--header", `X-Pickup-Live-Stream-Id: ${state.streamId}`,
      "--header", `X-Pickup-Live-Sequence: ${sequence}`,
      "--header", `X-Pickup-Live-Schema: ${state.schemaVersion}`,
      "--data-binary", "@-",
      "--write-out", "\n%{http_code}"
    ];
    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= 64 * 1024) stdout.push(chunk);
    });
    child.stderr.on("data", chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 16 * 1024) stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("close", code => {
      if (code !== 0) return reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `curl exited ${code}`));
      const output = Buffer.concat(stdout).toString("utf8");
      const boundary = output.lastIndexOf("\n");
      const status = Number(output.slice(boundary + 1));
      let payload = {};
      try {
        payload = JSON.parse(output.slice(0, boundary) || "{}");
      } catch {
        return reject(new Error("live API returned invalid JSON"));
      }
      resolve({ status, payload, sequence });
    });
    child.stdin.end(JSON.stringify(body));
  });
}

function resetState(state, reason) {
  state.streamId = streamId();
  state.sequence = 0;
  state.offsets.clear();
  state.lastPostAt = 0;
  state.finalSent = false;
  log(`reset ${config.serverId}:${state.matchId}:${state.round} (${reason})`);
}

async function forward(state) {
  if (state.posting) return;
  state.posting = true;
  try {
    const pending = await collect(state);
    if (!pending.shouldPost) return;
    const result = await curlPost(state, pending.body);
    if (result.status === 409) {
      resetState(state, result.payload.error || "conflict");
      return;
    }
    if (result.status < 200 || result.status >= 300 || result.payload.ok !== true) {
      throw new Error(`live API rejected batch (${result.status}: ${result.payload.error || "unknown"})`);
    }
    state.sequence = result.sequence;
    state.offsets = pending.nextOffsets;
    state.lastPostAt = Date.now();
    if (pending.body.final) {
      state.finalSent = true;
      streams.delete(state.key);
      log(`finalized ${config.serverId}:${state.matchId}:${state.round} at sequence ${state.sequence}`);
    }
  } catch (error) {
    log(`forward failed for ${config.serverId}:${state.matchId}:${state.round}: ${error.message}`);
  } finally {
    state.posting = false;
  }
}

async function loop() {
  try {
    await discover();
    for (const state of streams.values()) await forward(state);
  } catch (error) {
    log(`scan failed: ${error.message}`);
  }
  if (!stopping) setTimeout(loop, config.intervalMs);
}

async function main() {
  rootReal = await fs.realpath(config.root);
  const curlStat = await fs.stat(config.curlConfig);
  if ((curlStat.mode & 0o077) !== 0) throw new Error("PICKUP_CURL_CONFIG must not be accessible by group or other users.");
  log(`watching ${rootReal} as ${config.serverId}`);
  await loop();
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

main().catch(error => {
  process.stderr.write(`[pickup-live-forwarder] fatal: ${error.message}\n`);
  process.exitCode = 1;
});
