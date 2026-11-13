"use strict";

// Offline schema-2–7 conversion. This format is deliberately separate from the deployed
// tactical API format; the embedded playback retains that API's current shape.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { createHash } = require("node:crypto");
const { gzipSync, gunzipSync } = require("node:zlib");
const Database = require("better-sqlite3");
const { parseCsv, parseCsvDocument } = require("./csv");
const { validateManifest } = require("./manifest");
const { buildPlayback } = require("./tacticalPlayback");
const { alignKillWeapons } = require("./killWeaponAlignment");

const CONVERTER = "game-details-5";
const SMALL = ["roster.csv", "events.csv", "scene_events.csv", "entity_meta.csv",
  "projectile_defs.csv", "objective_defs.csv", "buildable_defs.csv", "render_models.csv",
  "entity_defs.csv", "brush_defs.csv"];
const FIELDS = {
  players: ["time_ms", "x", "y", "z", "vx", "vy", "vz", "pitch", "yaw", "roll",
    "alive", "health", "armor", "class", "team", "goalitem_flags", "weapon", "buttons",
    "oldbuttons", "ducking", "clip_ammo", "clip_max", "ammo_shells", "ammo_bullets",
    "ammo_cells", "ammo_rockets", "gren1_type", "gren1_count", "gren2_type", "gren2_count", "reload_state"],
  buildables: ["time_ms", "active", "owner_session", "owner_entity", "team", "health",
    "x", "y", "z", "vx", "vy", "vz", "pitch", "yaw", "roll"],
  projectiles: ["time_ms", "state", "x", "y", "z", "vx", "vy", "vz", "pitch", "yaw", "roll"],
  objectives: ["time_ms", "state", "carrier_session", "carrier_entity", "x", "y", "z", "vx", "vy", "vz", "pitch", "yaw", "roll"],
};
const digest = value => createHash("sha256").update(value).digest("hex");
const number = value => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const activeArchives = new Set();
function stopArchive(child) {
  if (process.platform === "win32" || !child.pid) { child.kill(); return; }
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") child.kill(); }
}
process.once("exit", () => { for (const child of activeArchives) stopArchive(child); });

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function member(archive, name, consume) {
  // Windows bsdtar autodetects zstd; GNU tar uses the explicit switch.
  const args = process.platform === "win32" ? ["-xOf", archive, name] : ["--zstd", "-xOf", archive, name];
  // Own process group keeps terminal Ctrl+C from interrupting an archive while
  // the parent drains active rounds. Pipes/exit remain awaited, not unref'ed.
  const child = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: true });
  activeArchives.add(child);
  child.once("close", () => activeArchives.delete(child));
  let errors = "";
  child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-4000); });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`${name}: tar exited ${code}: ${errors}`)));
  });
  // Attach a rejection handler before starting the consumer to cover spawn errors.
  done.catch(() => {});
  try { const result = await consume(child.stdout); await done; return result; }
  catch (error) { stopArchive(child); await done.catch(() => {}); throw error; }
}

async function textMember(archive, name, expectedBytes) {
  if (expectedBytes > 32 * 1024 * 1024) throw new Error(`${name} exceeds pilot text limit`);
  return member(archive, name, async input => {
    const chunks = []; let length = 0;
    for await (const chunk of input) {
      length += chunk.length;
      if (length > 32 * 1024 * 1024) throw new Error(`${name} exceeds pilot text limit`);
      chunks.push(chunk);
    }
    if (expectedBytes != null && length !== expectedBytes) throw new Error(`${name}: manifest byte count mismatch`);
    return Buffer.concat(chunks).toString("utf8");
  });
}

function loadReferences(elo, match, round) {
  if (!elo) return { kills: [], killRounds: [], analytics: [], rounds: [], playerRounds: [], supplied: false };
  const db = new Database(elo, { readonly: true, fileMustExist: true });
  try {
    return db.transaction(() => {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      const read = (table, roundColumn) => tables.has(table)
        ? db.prepare(`SELECT * FROM ${table} WHERE match_id=? AND ${roundColumn}=?`).all(match, round) : [];
      return { supplied: true, kills: read("pickup_kill_locations", "round_number"),
        killRounds: read("pickup_kill_rounds", "round_number"),
        analytics: read("match_kill_events", "round_num"), rounds: read("match_rounds", "round_num"),
        playerRounds: read("match_player_round_stats", "round_num") };
    })();
  } finally { db.close(); }
}

// Only numeric columns are sampled. Parse quoted CSV fields correctly so the
// optional held-weapon name cannot shift inventory columns.
async function sampledTrack(archive, manifest, file, idField, wanted, transitions, expectedRows) {
  const tracks = {}, prior = new Map(), weaponNames = {}, unknown = {};
  let fields, header, rows = 0, kept = 0, bytes = 0;
  await member(archive, file, async input => {
    input.on("data", chunk => { bytes += chunk.length; });
    for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
      if (!header) {
        header = line.replace(/^\uFEFF/, "");
        const headers = parseCsvDocument(header + "\n", file).headers;
        if (!headers.includes(idField) || !headers.includes("time_ms")) throw new Error(`${file}: missing track identity/time`);
        fields = wanted ? wanted.filter(field => headers.includes(field)) : headers.filter(field => ![idField, "snapshot"].includes(field));
        continue;
      }
      if (!line) continue;
      const row = parseCsv(header + "\n" + line, file)[0]; rows++;
      const id = number(row[idField]), time = number(row.time_ms);
      if (!Number.isSafeInteger(id) || id < 1 || time == null || time < 0 || time > manifest.duration_ms + 1000) {
        throw new Error(`${file}: invalid identity/time at row ${rows}`);
      }
      const frame = fields.map(field => number(row[field]));
      for (let i = 0; i < fields.length; i++) {
        const inventorySentinel = /^(?:clip_|ammo_|gren[12]_|reload_state)/.test(fields[i]);
        if (frame[i] == null || (inventorySentinel && frame[i] === -1)) unknown[fields[i]] = (unknown[fields[i]] || 0) + 1;
        if (row[fields[i]] !== "" && frame[i] == null) throw new Error(`${file}: nonnumeric ${fields[i]}`);
      }
      if (row.weapon_name) (weaponNames[id] ||= {})[row.weapon] = row.weapon_name;
      const last = prior.get(id);
      if (last && time < last.time) throw new Error(`${file}: out-of-order samples`);
      const changed = last && transitions.some(field => fields.includes(field) && frame[fields.indexOf(field)] !== last.frame[fields.indexOf(field)]);
      if (!last || time - last.time >= 100 || changed) {
        (tracks[id] ||= []).push(...frame); kept++;
        prior.set(id, { time, frame });
      }
    }
  });
  if (bytes !== manifest.bytes[file] || rows !== expectedRows) throw new Error(`${file}: manifest count mismatch`);
  if (!fields) throw new Error(`${file}: missing header`);
  return { fields, missingFields: wanted.filter(field => !fields.includes(field)),
    stride: fields.length, intervalMs: 100, tracks, weaponNames, sourceRows: rows, keptRows: kept, unknown };
}

function hasRevision(destination, revision) {
  if (!destination || !fs.existsSync(destination)) return false;
  const db = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma("application_id", { simple: true }) !== 1195656268 || db.pragma("user_version", { simple: true }) !== 1) {
      throw new Error("Output is not a game-details database");
    }
    return !!db.prepare(`SELECT 1 FROM detail_rounds r JOIN detail_packages p ON p.round_id=r.id
      WHERE r.revision=? AND p.format='game-details-pilot-v1' AND p.encoding='json+gzip'`).get(revision);
  } finally { db.close(); }
}

function historicalDeaths(playback, rows, analytics) {
  const players = new Map(playback.players.map(player => [player.id, player]));
  function teamAt(id, time) {
    const frames = players.get(id)?.frames || [], stride = playback.stride;
    let low = 0, high = frames.length / stride;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (frames[middle * stride] <= time) low = middle + 1; else high = middle; }
    return low ? frames[(low - 1) * stride + 9] : 0;
  }
  const deaths = rows.filter(row => row.event === "death").map(row => {
    const victim = number(row.target_session), attacker = number(row.actor_session), time = number(row.time_ms);
    const attackerTeam = teamAt(attacker, time), victimTeam = teamAt(victim, time);
    return { row, victim, attacker, time, enemy: attacker !== victim && attackerTeam > 0 && victimTeam > 0 && attackerTeam !== victimTeam,
      teamKill: attacker !== victim && attackerTeam > 0 && attackerTeam === victimTeam };
  }).filter(death => players.has(death.victim) && death.time != null);
  const candidates = deaths.filter(death => death.enemy).map(death => ({
    session_id: death.victim, time_ms: death.time, steam_id: players.get(death.victim).steamId,
    attacker_steam_id: players.get(death.attacker)?.steamId, weapon: death.row.text || "" }));
  const alignment = alignKillWeapons(candidates, analytics);
  const weapons = new Map([...alignment.weapons].map(([kill, weapon]) => [`${kill.session_id}:${kill.time_ms}`, weapon]));
  for (const player of players.values()) for (const life of player.lives) life.kills = 0;
  playback.events = playback.events.filter(event => event.type !== "death");
  for (const death of deaths) {
    playback.events.push({ time: death.time, type: "death", victim: death.victim, attacker: death.attacker,
      teamKill: death.teamKill, weapon: weapons.get(`${death.victim}:${death.time}`) || death.row.text || "" });
    if (death.enemy) {
      const life = players.get(death.attacker)?.lives.find(life => death.time >= life.startMs && death.time <= life.endMs);
      if (life) life.kills++;
    }
  }
  playback.events.sort((a, b) => a.time - b.time);
  return alignment;
}

function storeDatabase(destination, data) {
  const db = new Database(destination);
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    const version = db.pragma("user_version", { simple: true });
    if (version !== 0 && version !== 1) throw new Error("Unsupported game-details database version");
    if (version === 1 && db.pragma("application_id", { simple: true }) !== 1195656268) throw new Error("Output is not a game-details pilot database");
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (version === 0 && existing.length) throw new Error("Refusing a nonempty database without game-details schema version");
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS detail_rounds (
        id INTEGER PRIMARY KEY, match_id TEXT NOT NULL, round_number INTEGER NOT NULL,
        source_sha256 TEXT NOT NULL, revision TEXT NOT NULL UNIQUE, converter TEXT NOT NULL,
        map TEXT NOT NULL, quality_json TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS detail_packages (
        round_id INTEGER PRIMARY KEY REFERENCES detail_rounds(id), format TEXT NOT NULL,
        encoding TEXT NOT NULL, payload_sha256 TEXT NOT NULL, payload BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS detail_players (
        round_id INTEGER NOT NULL REFERENCES detail_rounds(id), session_id INTEGER NOT NULL,
        steam_id TEXT, name TEXT NOT NULL, PRIMARY KEY(round_id,session_id));
        CREATE TABLE IF NOT EXISTS detail_lives (
        round_id INTEGER NOT NULL REFERENCES detail_rounds(id), session_id INTEGER NOT NULL,
        life_number INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
        end_reason TEXT NOT NULL, PRIMARY KEY(round_id,session_id,life_number));
        CREATE TABLE IF NOT EXISTS detail_events (
        round_id INTEGER NOT NULL REFERENCES detail_rounds(id), stream TEXT NOT NULL,
        sequence INTEGER NOT NULL, time_ms INTEGER NOT NULL, type TEXT NOT NULL,
        actor_session INTEGER, target_session INTEGER, raw_json TEXT NOT NULL,
        PRIMARY KEY(round_id,stream,sequence));
        CREATE INDEX IF NOT EXISTS detail_round_lookup ON detail_rounds(match_id,round_number);
        CREATE INDEX IF NOT EXISTS detail_event_time ON detail_events(round_id,time_ms);
        CREATE INDEX IF NOT EXISTS detail_event_actor ON detail_events(round_id,actor_session,type);
        CREATE INDEX IF NOT EXISTS detail_event_target ON detail_events(round_id,target_session,type);
        PRAGMA user_version=1;
        PRAGMA application_id=1195656268;`);
      const found = db.prepare("SELECT id FROM detail_rounds WHERE revision=?").get(data.revision);
      if (found) return;
      const id = db.prepare(`INSERT INTO detail_rounds
        (match_id,round_number,source_sha256,revision,converter,map,quality_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(data.match, data.round, data.sha, data.revision, CONVERTER, data.map, JSON.stringify(data.quality), Math.floor(Date.now() / 1000)).lastInsertRowid;
      db.prepare("INSERT INTO detail_packages VALUES(?,?,?,?,?)")
        .run(id, "game-details-pilot-v1", "json+gzip", digest(data.compressed), data.compressed);
      const player = db.prepare("INSERT INTO detail_players VALUES(?,?,?,?)");
      const life = db.prepare("INSERT INTO detail_lives VALUES(?,?,?,?,?,?)");
      for (const item of data.playback.players) {
        player.run(id, item.id, item.steamId, item.name);
        for (const entry of item.lives) life.run(id, item.id, entry.number, entry.startMs, entry.endMs, entry.endReason);
      }
      const event = db.prepare("INSERT INTO detail_events VALUES(?,?,?,?,?,?,?,?)");
      for (const [stream, rows] of Object.entries(data.events)) rows.forEach((row, index) => {
        const time = number(row.time_ms);
        if (time == null || time < 0 || time > data.durationMs + 1000) throw new Error(`${stream}: invalid event time`);
        event.run(id, stream, index, time, row.event, number(row.actor_session), number(row.target_session), JSON.stringify(row));
      });
    })();
    const record = db.prepare(`SELECT r.id,p.payload,p.payload_sha256 FROM detail_rounds r
      JOIN detail_packages p ON p.round_id=r.id WHERE r.revision=?`).get(data.revision);
    if (!record || digest(record.payload) !== record.payload_sha256 || !record.payload.equals(data.compressed)) throw new Error("Stored package verification failed");
    const decoded = JSON.parse(gunzipSync(record.payload));
    if (decoded.source.sha256 !== data.sha) throw new Error("Stored package identity mismatch");
    return { players: db.prepare("SELECT COUNT(*) n FROM detail_players WHERE round_id=?").get(record.id).n,
      lives: db.prepare("SELECT COUNT(*) n FROM detail_lives WHERE round_id=?").get(record.id).n,
      events: db.prepare("SELECT COUNT(*) n FROM detail_events WHERE round_id=?").get(record.id).n };
  } finally { db.close(); }
}

async function prepareRound({ archive, destination, match, round, elo, skipExisting = false, log = console.log }) {
  const before = await fsp.stat(archive);
  const sha = await hashFile(archive);
  const filenameHash = /round-\d+-([a-f0-9]{64})\.tar\.zst$/i.exec(archive)?.[1];
  if (!filenameHash || filenameHash.toLowerCase() !== sha) throw new Error("Archive checksum mismatch; transfer may be incomplete");
  const references = loadReferences(elo, match, round);
  if (references.killRounds.some(row => row.artifact_sha256 && row.artifact_sha256 !== sha)) {
    throw new Error("ELO kill index refers to a different source archive; reconcile source identity before enriching");
  }
  const revision = digest(JSON.stringify({ sha, converter: CONVERTER, references }));
  if (skipExisting && hasRevision(destination, revision)) return { skipped: true, match, round, archive, revision };
  const manifest = JSON.parse(await textMember(archive, "manifest.json"));
  validateManifest(manifest, { matchId: match, round, complete: true });
  if (!manifest.complete || manifest.write_error) throw new Error("Requires a complete recording without write errors");
  const raw = {};
  for (const file of SMALL) if (Object.hasOwn(manifest.bytes, file)) raw[file] = await textMember(archive, file, manifest.bytes[file]);
  const kills = references.kills.map(kill => ({ ...kill }));
  const analytics = references.analytics.filter(event => event.is_enemy_kill === 1 && !event.is_team_kill);
  let alignment = alignKillWeapons(kills, analytics);
  for (const [kill, weapon] of alignment.weapons) kill.weapon = weapon;
  log(`Preparing ${match} round ${round} · ${manifest.map}; original ${(before.size / 1048576).toFixed(2)} MiB`);
  const playback = await buildPlayback({ metadata: { matchId: match, round, map: manifest.map,
    durationMs: manifest.duration_ms, sampleIntervalMs: Math.ceil(manifest.sample_interval_seconds * 1000), sha256: sha,
    files: { sceneEvents: !!raw["scene_events.csv"], renderModels: !!raw["render_models.csv"] } },
    indexedKills: kills, text: async file => raw[file], stream: (file, consume) => member(archive, file, consume) });
  if (!playback.players.length) throw new Error("No valid player movement; cannot produce usable tactical playback");
  const events = Object.fromEntries(["events.csv", "scene_events.csv"].filter(file => raw[file]).map(file => [file, parseCsv(raw[file], file)]));
  if (!(events["scene_events.csv"] || []).some(row => row.event === "death")) {
    alignment = historicalDeaths(playback, events["events.csv"] || [], analytics);
  }
  const tracks = {};
  tracks.players = await sampledTrack(archive, manifest, "players.csv", "session_id", FIELDS.players,
    FIELDS.players.slice(10), manifest.rows.players);
  // Gameplay tracks deliberately omit model animation/rendering fields.
  for (const [kind, id, count, changes] of [
    ["buildables", "buildable_id", "buildables", ["active", "owner_session", "team", "health"]],
    ["projectiles", "projectile_id", "projectiles", ["state", "owner_session"]],
    ["objectives", "objective_id", "objectives", ["state", "carrier_session"]],
  ]) if (Object.hasOwn(manifest.bytes, `${kind}.csv`)) {
    tracks[kind] = await sampledTrack(archive, manifest, `${kind}.csv`, id, FIELDS[kind], changes, manifest.rows[count]);
  }
  const deathRows = (events["events.csv"] || []).filter(row => row.event === "death");
  const quality = { sourceSchema: manifest.schema_version, originalBytes: before.size, referencesSupplied: references.supplied,
    weaponAlignment: { ...alignment, weapons: undefined },
    indexedWeapons: kills.filter(kill => kill.weapon && !/^unknown$/i.test(kill.weapon)).length,
    rawDeaths: deathRows.length, rawDeathsWithoutWeapon: deathRows.filter(row => !row.text?.trim()).length,
    playerSourceRows: tracks.players.sourceRows, playerKeptRows: tracks.players.keptRows,
    unknownPlayerValues: tracks.players.unknown,
    missingPlayerFields: tracks.players.missingFields, retainedStreams: Object.keys(raw),
    warnings: ["Experimental details package with embedded tactical playback.",
      "View pitch/yaw are preserved as recorded; correctness as true view angles is not established.",
      "Stable team roles require companion analytics; engine colors are not stable match teams.",
      "Conc endpoints are not confirmed detonations; historical missing values remain unknown.",
      ...(!elo ? ["No ELO snapshot: repaired weapon and round-role references are unavailable."] : [])] };
  const payload = { format: "game-details-pilot-v1", converter: CONVERTER,
    source: { sha256: sha, manifest }, quality, playback, tracks, rawCsv: raw, references };
  const compressed = gzipSync(JSON.stringify(payload));
  const after = await fsp.stat(archive);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || await hashFile(archive) !== sha) throw new Error("Archive changed during conversion; retry after transfer completes");
  // Frames are already compressed inside the payload. Persistence needs only
  // identities and lives; avoid transferring large duplicate arrays over IPC.
  return { match, round, archive, sha, revision, map: manifest.map, quality, compressed, events,
    originalBytes: before.size, durationMs: manifest.duration_ms,
    playback: { players: playback.players.map(({ id, steamId, name, lives }) => ({ id, steamId, name, lives })) } };
}

function finishRound(destination, prepared) {
  const stats = storeDatabase(destination, prepared);
  return { match: prepared.match, round: prepared.round, archive: prepared.archive, destination,
    revision: prepared.revision, originalBytes: prepared.originalBytes,
    compressedBytes: prepared.compressed.length, databaseBytes: fs.statSync(destination).size, ...stats, quality: prepared.quality };
}

async function convertRound(options) {
  const prepared = await prepareRound(options);
  return prepared.skipped ? prepared : finishRound(options.destination, prepared);
}

module.exports = { convertRound, prepareRound, finishRound, hashFile, CONVERTER };
