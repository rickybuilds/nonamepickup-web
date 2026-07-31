"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { PassThrough, Readable } = require("node:stream");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const express = require("express");
const { validateArchive, REQUIRED_FILES } = require("../src/pickup/archive");
const {
  PickupIngestion,
  parseMetadata,
  streamRequestToFile,
  tokenMatches
} = require("../src/pickup/ingestion");
const { PickupStorage } = require("../src/pickup/storage");
const { pickupError } = require("../src/pickup/errors");
const { PickupRepository } = require("../src/pickup/repository");
const { createPickupReplaysRouter } = require("../src/routes/pickupReplays");
const { PickupReplayViewer, parseViewerIdentity } = require("../src/pickup/viewer");

const PLAYERS_V2_HEADER = "snapshot,time_ms,session_id,slot,alive,team,class,goalitem_flags,weapon,buttons,health,armor,x,y,z,vx,vy,vz,pitch,yaw,roll";
const PLAYERS_V2_ROW = "1,0,1,2,1,2,3,0,7,0,100,50,10,20,30,0,0,0,5,90,0";
const PLAYERS_V3_HEADER = `${PLAYERS_V2_HEADER},ducking,oldbuttons,player_model_id,weapon_model_id,body,skin,sequence,gaitsequence,frame,framerate,animtime,body_pitch,body_yaw,body_roll,controller0,controller1,controller2,controller3,blending0,blending1`;
const PLAYERS_V3_ROW = `${PLAYERS_V2_ROW},0,0,1,2,0,0,4,1,12.5,1,0,5,90,0,0,0,0,0,0,0`;
const RENDER_MODELS = "model_id,kind,path,first_seen_ms\n1,player,models/player/soldier/soldier.mdl,0\n2,weapon,models/p_rpg.mdl,0\n";

function octal(value, length) {
  return `${value.toString(8).padStart(length - 2, "0")}\0 `;
}

function tarEntry(name, content = "", type = "0", linkName = "") {
  const body = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o600, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(body.length, 12), 124, 12, "ascii");
  header.write(octal(0, 12), 136, 12, "ascii");
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write(linkName, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(octal(checksum, 8), 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

function validManifest(overrides = {}) {
  return {
    schema_version: 2,
    match_id: "pug-20260730-1842",
    round: 1,
    map: "2fort",
    complete: true,
    reason: "round_end",
    started_at_epoch: 1785440000,
    ended_at_epoch: 1785440900,
    duration_ms: 900000,
    sample_interval_seconds: 0.0199,
    snapshots: 3600,
    dropped_snapshots: 0,
    write_error: false,
    rows: { roster: 8, players: 100 },
    bytes: { roster: 100, players: 1000 },
    ...overrides
  };
}

function validV3Manifest(renderModels = RENDER_MODELS, overrides = {}) {
  return validManifest({
    schema_version: 3,
    rows: { roster: 8, players: 1, render_models: 2 },
    bytes: { roster: 100, players: 1000, "render_models.csv": Buffer.byteLength(renderModels) },
    ...overrides
  });
}

function archiveBuffer({
  manifest = validManifest(),
  marker = "complete.ready",
  markerContent = "",
  omit = [],
  renderModels = manifest.schema_version === 3 ? RENDER_MODELS : null,
  players = manifest.schema_version === 3
    ? `${PLAYERS_V3_HEADER}\n${PLAYERS_V3_ROW}\n`
    : `${PLAYERS_V2_HEADER}\n${PLAYERS_V2_ROW}\n`,
  extraEntries = []
} = {}) {
  const content = {
    "roster.csv": "session_id,slot,userid,steamid,name,initial_team,is_bot,joined_ms\n1,2,51,STEAM_0:1:1,Alice,2,0,0\n",
    "players.csv": players,
    "projectile_defs.csv": "id\n1\n",
    "projectiles.csv": "tick\n1\n",
    "objective_defs.csv": "id\n1\n",
    "objectives.csv": "tick\n1\n",
    "events.csv": "tick\n1\n",
    "manifest.json": JSON.stringify(manifest)
  };
  if (renderModels != null) content["render_models.csv"] = renderModels;
  const entries = [...REQUIRED_FILES, ...(renderModels == null ? [] : ["render_models.csv"])]
    .filter(name => !omit.includes(name))
    .map(name => tarEntry(name, content[name]));
  if (marker) entries.push(tarEntry(marker, markerContent));
  entries.push(...extraEntries);
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

function passthroughArchive(buffer) {
  return {
    stream: Readable.from(buffer),
    completion: Promise.resolve(),
    abort() {}
  };
}

async function tempContext(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pickup-ingestion-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const storage = new PickupStorage(root);
  await storage.ensureReady();
  return { root, storage };
}

async function validateBuffer(t, buffer, overrides = {}) {
  const { root } = await tempContext(t);
  const extractionPath = await fsp.mkdtemp(path.join(root, "incoming", "extract-"));
  return validateArchive({
    archivePath: path.join(root, "unused.tar.zst"),
    extractionPath,
    matchId: "pug-20260730-1842",
    round: 1,
    maxFiles: 32,
    maxBytes: 1024 * 1024,
    openArchive: () => passthroughArchive(buffer),
    ...overrides
  });
}

class MemoryRepository {
  constructor() {
    this.current = null;
    this.nextId = 123;
    this.failAfterPromotion = false;
  }

  async persist(input, promote) {
    if (this.current) {
      if (this.current.sha256 !== input.sha256) throw pickupError(409, "round_artifact_conflict");
      return { ...this.current, created: false };
    }
    const promotedPath = await promote();
    if (this.failAfterPromotion) {
      const error = new Error("database unavailable");
      error.promotedPath = promotedPath;
      error.createdStorage = true;
      throw error;
    }
    this.current = {
      artifactId: this.nextId,
      sha256: input.sha256,
      byteSize: input.byteSize,
      storageKey: input.storageKey
    };
    return { ...this.current, created: true, promotedPath, createdStorage: true };
  }
}

test("MariaDB repository targets the deployed pickup table contract", async () => {
  const statements = [];
  let committed = false;
  let released = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() {},
    release() { released = true; },
    async execute(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      assert.equal(
        params.length,
        (sql.match(/\?/g) || []).length,
        `placeholder mismatch: ${normalized}`
      );
      statements.push({ sql: normalized, params });
      if (normalized.startsWith("INSERT INTO pickup_matches")) return [{ insertId: 10 }];
      if (normalized.startsWith("INSERT INTO pickup_rounds")) return [{ insertId: 20 }];
      if (normalized.startsWith("SELECT id FROM pickup_rounds")) return [[{ id: 20 }]];
      if (normalized.includes("FROM pickup_artifacts")) return [[]];
      if (normalized.startsWith("INSERT INTO pickup_players")) return [{ insertId: 30 }];
      if (normalized.startsWith("INSERT INTO pickup_artifacts")) return [{ insertId: 123 }];
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new PickupRepository({
    async getConnection() { return connection; },
    async execute() { throw new Error("unexpected commit confirmation"); }
  });
  const result = await repository.persist({
    matchId: "pug-20260730-1842",
    serverId: "central-1",
    round: 1,
    sha256: "a".repeat(64),
    byteSize: 12345,
    storageKey: "2026/07/pug-20260730-1842/round-01-test.tar.zst",
    status: "complete",
    manifest: validManifest(),
    roster: [{
      steamId: "STEAM_0:1:1",
      playerName: "Alice",
      sessionIndex: 1,
      initialSlot: 1,
      teamNumber: 1,
      teamName: "Blue",
      primaryClassId: 3,
      isBot: false,
      joinedMs: 0,
      leftMs: 900000,
      kills: 10,
      deaths: 5,
      assists: 2,
      suicides: 0,
      damageDealt: 1000,
      damageTaken: 800,
      flagPickups: 1,
      flagDrops: 0,
      flagCaptures: 1,
      flagReturns: 0
    }]
  }, async () => "/private/artifact");

  assert.equal(result.artifactId, 123);
  assert.equal(committed, true);
  assert.equal(released, true);
  const sql = statements.map(entry => entry.sql).join("\n");
  assert.match(sql, /pickup_matches \(match_id, source_server/);
  assert.match(sql, /pickup_rounds \(match_pk, round_number, map/);
  assert.match(sql, /sample_interval_ms/);
  assert.match(sql, /pickup_players \(steamid, current_name/);
  assert.match(sql, /pickup_round_players \(round_pk, player_pk, session_id/);
  assert.match(sql, /pickup_artifacts \(round_pk, artifact_kind, status/);
  assert.match(sql, /manifest_json/);
  assert.doesNotMatch(sql, /\bround_id\b|\bplayer_id\b|\bserver_id\b|\bmap_name\b/);
  const roundInsert = statements.find(entry => entry.sql.startsWith("INSERT INTO pickup_rounds"));
  assert.equal(roundInsert.params[9], 20);
});

function createIngestion(storage, repository, overrides = {}) {
  return new PickupIngestion({
    config: {
      uploadToken: "test-secret-token",
      maxUploadBytes: 1024 * 1024,
      maxExtractedBytes: 1024 * 1024,
      maxArchiveFiles: 32,
      zstdCommand: "unused",
      ...overrides
    },
    storage,
    repository,
    openArchive: archivePath => passthroughArchive(fs.createReadStream(archivePath)),
    logger: { error() {} }
  });
}

function requestStream(buffer) {
  const stream = new PassThrough();
  process.nextTick(() => stream.end(buffer));
  return stream;
}

async function post(server, body, headers = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      method: "POST",
      path: "/api/pickup-replays",
      headers
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
      }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function uploadHeaders(body, overrides = {}) {
  return {
    Authorization: "Bearer test-secret-token",
    "X-Pickup-Server-Id": "central-1",
    "X-Pickup-Match-Id": "pug-20260730-1842",
    "X-Pickup-Round": "1",
    "X-Pickup-SHA256": crypto.createHash("sha256").update(body).digest("hex"),
    "Content-Length": String(body.length),
    "Content-Type": "application/zstd",
    ...overrides
  };
}

test("valid streaming upload returns 201 and promotes a private artifact", async t => {
  const { root, storage } = await tempContext(t);
  const repository = new MemoryRepository();
  const ingestion = createIngestion(storage, repository);
  const app = express();
  app.use("/api", createPickupReplaysRouter({ ingestion, logger: { error() {} } }));
  const server = app.listen(0, "127.0.0.1");
  await onceListening(server);
  t.after(() => server.close());

  const body = archiveBuffer();
  const response = await post(server, body, uploadHeaders(body));
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    ok: true,
    artifactId: 123,
    matchId: "pug-20260730-1842",
    round: 1,
    status: "complete",
    sha256: uploadHeaders(body)["X-Pickup-SHA256"],
    byteSize: body.length,
    storageKey: response.body.storageKey
  });
  assert.match(response.body.storageKey, /^\d{4}\/\d{2}\/pug-20260730-1842\/round-01-[a-f0-9]{64}\.tar\.zst$/);
  assert.equal(fs.existsSync(storage.artifactPath(response.body.storageKey)), true);
  assert.equal(fs.existsSync(path.join(root, "artifacts")), true);
});

test("field-tested recorder roster columns map to round sessions", async t => {
  const validated = await validateBuffer(t, archiveBuffer());
  assert.deepEqual({
    sessionIndex: validated.roster[0].sessionIndex,
    steamId: validated.roster[0].steamId,
    playerName: validated.roster[0].playerName,
    initialSlot: validated.roster[0].initialSlot,
    teamNumber: validated.roster[0].teamNumber,
    teamName: validated.roster[0].teamName,
    joinedMs: validated.roster[0].joinedMs
  }, {
    sessionIndex: 1,
    steamId: "STEAM_0:1:1",
    playerName: "Alice",
    initialSlot: 2,
    teamNumber: 2,
    teamName: "Red",
    joinedMs: 0
  });
});

test("field-tested schema-2 manifest accepts precise recorder sampling", async t => {
  const manifest = validManifest({
    match_id: "test",
    map: "cranked",
    complete: false,
    reason: "map_change",
    duration_ms: 943587,
    sample_interval_seconds: 0.0199,
    snapshots: 45194,
    dropped_snapshots: 9,
    flushes: 188,
    rows: {
      roster: 9,
      players: 360034,
      projectile_definitions: 6522,
      projectiles: 295376,
      objective_definitions: 2,
      objectives: 90390,
      events: 4660
    },
    bytes: {
      "roster.csv": 525,
      "players.csv": 32747084,
      "projectile_defs.csv": 434419,
      "projectiles.csv": 19307278,
      "objective_defs.csv": 229,
      "objectives.csv": 4760886,
      "events.csv": 207131
    }
  });
  const validated = await validateBuffer(t, archiveBuffer({
    manifest,
    marker: "aborted.ready",
    markerContent: "status=aborted\nreason=map_change\n"
  }), {
    matchId: "test"
  });
  assert.equal(validated.complete, false);
  assert.equal(validated.manifest.flushes, 188);
  assert.equal(validated.manifest.sample_interval_seconds, 0.0199);
});

function onceListening(server) {
  return new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

test("missing or invalid tokens fail fixed-length digest authentication", () => {
  assert.equal(tokenMatches(undefined, "secret"), false);
  assert.equal(tokenMatches("Bearer wrong", "secret"), false);
  assert.equal(tokenMatches("Bearer secret", "secret"), true);
});

test("missing and invalid token requests return 401 without retaining bodies", async t => {
  const { root, storage } = await tempContext(t);
  const ingestion = createIngestion(storage, new MemoryRepository());
  const app = express();
  app.use("/api", createPickupReplaysRouter({ ingestion, logger: { error() {} } }));
  const server = app.listen(0, "127.0.0.1");
  await onceListening(server);
  t.after(() => server.close());
  const body = archiveBuffer();

  const missing = await post(server, Buffer.alloc(0), {});
  const invalid = await post(server, body, {
    ...uploadHeaders(body),
    Authorization: "Bearer wrong"
  });
  assert.equal(missing.status, 401);
  assert.deepEqual(missing.body, { ok: false, error: "unauthorized" });
  assert.equal(invalid.status, 401);
  assert.deepEqual(invalid.body, { ok: false, error: "unauthorized" });
  assert.deepEqual(await fsp.readdir(path.join(root, "incoming")), []);
});

test("unsafe match IDs and invalid rounds are rejected before upload", () => {
  const body = Buffer.from("x");
  assert.throws(
    () => parseMetadata(Object.fromEntries(
      Object.entries(uploadHeaders(body, { "X-Pickup-Match-Id": "../escape" }))
        .map(([key, value]) => [key.toLowerCase(), value])
    ), { maxUploadBytes: 100 }),
    error => error.code === "invalid_match_id"
  );
  assert.throws(
    () => parseMetadata(Object.fromEntries(
      Object.entries(uploadHeaders(body, { "X-Pickup-Round": "10000" }))
        .map(([key, value]) => [key.toLowerCase(), value])
    ), { maxUploadBytes: 100 }),
    error => error.code === "invalid_round"
  );
});

test("oversized request bodies are stopped and partial files are removable", async t => {
  const { root } = await tempContext(t);
  const destination = path.join(root, "incoming", "oversize.part");
  const request = requestStream(Buffer.from("12345"));
  await assert.rejects(
    streamRequestToFile(request, destination, {
      contentLength: 5,
      sha256: crypto.createHash("sha256").update("12345").digest("hex")
    }, 4),
    error => error.code === "upload_too_large"
  );
  await fsp.rm(destination, { force: true });
  assert.equal(fs.existsSync(destination), false);
});

test("client disconnect aborts and does not complete a staged upload", async t => {
  const { root } = await tempContext(t);
  const destination = path.join(root, "incoming", "aborted.part");
  const request = new PassThrough();
  const pending = streamRequestToFile(request, destination, {
    contentLength: 10,
    sha256: "0".repeat(64)
  }, 100);
  request.write("123");
  request.emit("aborted");
  await assert.rejects(pending, error => error.code === "upload_aborted");
});

test("SHA-256 and Content-Length mismatches are rejected", async t => {
  const { root } = await tempContext(t);
  const shaPath = path.join(root, "incoming", "sha.part");
  await assert.rejects(
    streamRequestToFile(requestStream(Buffer.from("abc")), shaPath, {
      contentLength: 3,
      sha256: "0".repeat(64)
    }, 100),
    error => error.code === "sha256_mismatch"
  );
  const lengthPath = path.join(root, "incoming", "length.part");
  await assert.rejects(
    streamRequestToFile(requestStream(Buffer.from("abc")), lengthPath, {
      contentLength: 4,
      sha256: crypto.createHash("sha256").update("abc").digest("hex")
    }, 100),
    error => error.code === "content_length_mismatch"
  );
});

test("archive path traversal is rejected without writing outside extraction", async t => {
  const buffer = archiveBuffer({ extraEntries: [tarEntry("../escape", "bad")] });
  await assert.rejects(validateBuffer(t, buffer), error => error.code === "unsafe_archive_path");
});

test("archive symlink and hard-link entries are rejected", async t => {
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ extraEntries: [tarEntry("link", "", "2", "manifest.json")] })),
    error => error.code === "unsupported_archive_entry_type"
  );
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ extraEntries: [tarEntry("hard", "", "1", "manifest.json")] })),
    error => error.code === "unsupported_archive_entry_type"
  );
});

test("missing required files and multiple ready markers are rejected", async t => {
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ omit: ["events.csv"] })),
    error => error.code === "missing_required_file"
  );
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ extraEntries: [tarEntry("aborted.ready")] })),
    error => error.code === "invalid_ready_markers"
  );
});

test("manifest/header mismatch and unsupported future schema versions are rejected", async t => {
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ manifest: validManifest({ round: 2 }) })),
    error => error.code === "manifest_header_mismatch"
  );
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ manifest: validManifest({ schema_version: 4 }), renderModels: null })),
    error => error.code === "unsupported_schema_version"
  );
});

test("valid schema-v2 artifact keeps the exact original 21-column player contract", async t => {
  const validated = await validateBuffer(t, archiveBuffer());
  assert.equal(validated.manifest.schema_version, 2);
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ players: `${PLAYERS_V2_HEADER},ducking\n${PLAYERS_V2_ROW},0\n` })),
    error => error.code === "invalid_players_headers"
  );
});

test("valid schema-v3 artifact retains and validates render_models.csv", async t => {
  const validated = await validateBuffer(t, archiveBuffer({ manifest: validV3Manifest() }));
  assert.equal(validated.manifest.schema_version, 3);
  assert.equal(validated.manifest.rows.render_models, 2);
});

test("schema-v3 accepts model ID zero as unavailable", async t => {
  const players = `${PLAYERS_V3_HEADER}\n${PLAYERS_V3_ROW.replace(",1,2,0,0,4,", ",0,0,0,0,4,")}\n`;
  await validateBuffer(t, archiveBuffer({ manifest: validV3Manifest(), players }));
});

test("schema-v3 rejects undefined nonzero model IDs", async t => {
  const players = `${PLAYERS_V3_HEADER}\n${PLAYERS_V3_ROW.replace(",1,2,0,0,4,", ",1,99,0,0,4,")}\n`;
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ manifest: validV3Manifest(), players })),
    error => error.code === "undefined_render_model_id"
  );
});

test("schema-v3 rejects a missing render_models.csv", async t => {
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ manifest: validV3Manifest(), renderModels: null })),
    error => error.code === "missing_render_models_file"
  );
});

test("schema-v3 rejects traversal in render model paths", async t => {
  const renderModels = RENDER_MODELS.replace("models/p_rpg.mdl", "models/../p_rpg.mdl");
  await assert.rejects(
    validateBuffer(t, archiveBuffer({ manifest: validV3Manifest(renderModels), renderModels })),
    error => error.code === "unsafe_render_model_path"
  );
});

test("duplicate upload is idempotent and conflicting second artifact is rejected", async t => {
  const { storage } = await tempContext(t);
  const repository = new MemoryRepository();
  const ingestion = createIngestion(storage, repository);
  const firstBody = archiveBuffer();
  const firstMetadata = ingestion.metadata(Object.fromEntries(
    Object.entries(uploadHeaders(firstBody)).map(([key, value]) => [key.toLowerCase(), value])
  ));
  const first = await ingestion.ingest(requestStream(firstBody), firstMetadata);
  const second = await ingestion.ingest(requestStream(firstBody), firstMetadata);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.artifactId, first.artifactId);

  const conflictBody = archiveBuffer({
    manifest: validManifest({ reason: "different" })
  });
  const conflictMetadata = ingestion.metadata(Object.fromEntries(
    Object.entries(uploadHeaders(conflictBody)).map(([key, value]) => [key.toLowerCase(), value])
  ));
  await assert.rejects(
    ingestion.ingest(requestStream(conflictBody), conflictMetadata),
    error => error.code === "round_artifact_conflict"
  );
});

test("database failure removes the promoted link and quarantines the verified source", async t => {
  const { root, storage } = await tempContext(t);
  const repository = new MemoryRepository();
  repository.failAfterPromotion = true;
  const ingestion = createIngestion(storage, repository);
  const body = archiveBuffer();
  const metadata = ingestion.metadata(Object.fromEntries(
    Object.entries(uploadHeaders(body)).map(([key, value]) => [key.toLowerCase(), value])
  ));

  await assert.rejects(
    ingestion.ingest(requestStream(body), metadata),
    error => error.code === "ingestion_failed"
  );
  const artifactFiles = await fsp.readdir(path.join(root, "artifacts"), { recursive: true });
  assert.equal(artifactFiles.some(name => name.endsWith(".tar.zst")), false);
  const quarantined = await fsp.readdir(path.join(root, "quarantine"));
  assert.equal(quarantined.filter(name => name.endsWith(".tar.zst")).length, 1);
  assert.equal(quarantined.filter(name => name.endsWith(".json")).length, 1);
});

test("viewer validates public replay identities", () => {
  assert.deepEqual(parseViewerIdentity("test_match-1", "2"), {
    matchId: "test_match-1",
    round: 2
  });
  assert.throws(() => parseViewerIdentity("../test", "1"), error => {
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_match_id");
    return true;
  });
  assert.throws(() => parseViewerIdentity("test", "0"), error => {
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_round");
    return true;
  });
});

test("viewer returns verified primary metadata and allowlisted file URLs", async () => {
  let capturedSql = "";
  let capturedParams = null;
  const pool = {
    async execute(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return [[{
        artifact_id: 7,
        sha256: "a".repeat(64),
        byte_size: 123456,
        storage_key: `2026/07/test/round-01-${"a".repeat(64)}.tar.zst`,
        manifest_json: JSON.stringify({ schema_version: 2, map: "cranked" }),
        match_id: "test",
        source_server: "vultr",
        round_number: 1,
        map: "cranked",
        status: "aborted",
        completion_reason: "map_change",
        duration_ms: 943587,
        sample_interval_ms: 20,
        snapshot_count: 45194,
        dropped_snapshot_count: 9,
        player_row_count: 360034,
        projectile_row_count: 295376,
        objective_row_count: 90390,
        event_row_count: 4660
      }]];
    }
  };
  const viewer = new PickupReplayViewer({
    pool,
    storage: { artifactPath() { throw new Error("not used"); } }
  });

  const metadata = await viewer.metadata("test", 1);
  assert.deepEqual(capturedParams, ["test", 1]);
  assert.match(capturedSql, /a\.is_primary = 1/);
  assert.match(capturedSql, /a\.status = 'verified'/);
  assert.equal(metadata.artifactId, 7);
  assert.equal(metadata.status, "aborted");
  assert.equal(metadata.manifest.schema_version, 2);
  assert.equal(metadata.files.players, "/api/pickup-replays/viewer/test/1/files/players.csv");
  assert.equal(
    metadata.files.projectileDefs,
    "/api/pickup-replays/viewer/test/1/files/projectile_defs.csv"
  );
  assert.deepEqual(Object.keys(metadata.files).sort(), [
    "events",
    "objectiveDefs",
    "objectives",
    "players",
    "projectileDefs",
    "projectiles",
    "roster"
  ]);
});

test("schema-v3 viewer advertises render_models.csv", async () => {
  const pool = {
    async execute() {
      return [[{
        artifact_id: 9,
        sha256: "c".repeat(64),
        byte_size: 1,
        storage_key: "2026/07/test/round-01-v3.tar.zst",
        manifest_json: JSON.stringify({ schema_version: 3 }),
        match_id: "test",
        round_number: 1
      }]];
    }
  };
  const viewer = new PickupReplayViewer({ pool, storage: {} });
  const metadata = await viewer.metadata("test", 1);
  assert.equal(metadata.files.renderModels, "/api/pickup-replays/viewer/test/1/files/render_models.csv");
});

test("viewer extracts only an allowlisted CSV with fixed tar arguments", async t => {
  const { storage } = await tempContext(t);
  const storageKey = `2026/07/test/round-01-${"b".repeat(64)}.tar.zst`;
  const archivePath = storage.artifactPath(storageKey);
  await fsp.mkdir(path.dirname(archivePath), { recursive: true });
  await fsp.writeFile(archivePath, "private archive placeholder");

  const pool = {
    async execute() {
      return [[{
        artifact_id: 8,
        sha256: "b".repeat(64),
        byte_size: 27,
        storage_key: storageKey,
        manifest_json: "{}",
        match_id: "test",
        round_number: 1
      }]];
    }
  };
  let spawnCall = null;
  const spawnProcess = (command, args, options) => {
    spawnCall = { command, args, options };
    const child = new EventEmitter();
    child.stdout = Readable.from("snapshot,time_ms\n1,0\n");
    child.stderr = Readable.from("");
    child.kill = () => {};
    child.stdout.once("end", () => child.emit("close", 0));
    return child;
  };
  const viewer = new PickupReplayViewer({ pool, storage, spawnProcess });
  const response = new PassThrough();
  const chunks = [];
  response.status = code => {
    response.statusCode = code;
    return response;
  };
  response.type = contentType => {
    response.contentType = contentType;
    return response;
  };
  response.set = () => response;
  response.on("data", chunk => chunks.push(chunk));

  await viewer.streamFile("test", 1, "players.csv", response);
  if (!response.readableEnded) {
    await new Promise(resolve => response.once("end", resolve));
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/csv");
  assert.deepEqual(spawnCall, {
    command: "tar",
    args: ["--zstd", "-xOf", archivePath, "players.csv"],
    options: { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  });
  assert.equal(Buffer.concat(chunks).toString("utf8"), "snapshot,time_ms\n1,0\n");
  await assert.rejects(
    viewer.streamFile("test", 1, "../manifest.json", response),
    error => error.code === "replay_file_not_found"
  );
});
