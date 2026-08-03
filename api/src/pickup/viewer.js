"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { pickupError } = require("./errors");
const {
  REPLAY_FILES,
  replayFileAvailable,
  replayFilesForSchema
} = require("./replayContract");

const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const VIEWER_FILES = REPLAY_FILES;

function parseViewerIdentity(matchId, roundText) {
  if (!MATCH_ID_PATTERN.test(String(matchId || ""))) {
    throw pickupError(400, "invalid_match_id");
  }
  if (!/^\d{1,4}$/.test(String(roundText || ""))) {
    throw pickupError(400, "invalid_round");
  }
  const round = Number(roundText);
  if (round < 1 || round > 9999) throw pickupError(400, "invalid_round");
  return { matchId: String(matchId), round };
}

function parseManifest(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

class PickupReplayViewer {
  constructor({ pool, storage, tarCommand = "tar", spawnProcess = spawn }) {
    this.pool = pool;
    this.storage = storage;
    this.tarCommand = tarCommand;
    this.spawnProcess = spawnProcess;
  }

  async artifact(matchId, round) {
    const [rows] = await this.pool.execute(`
      SELECT
        a.id AS artifact_id,
        a.sha256,
        a.byte_size,
        a.storage_key,
        a.manifest_json,
        a.verified_at,
        m.match_id,
        m.source_server,
        r.round_number,
        r.map,
        r.status,
        r.completion_reason,
        r.duration_ms,
        r.sample_interval_ms,
        r.snapshot_count,
        r.dropped_snapshot_count,
        r.player_row_count,
        r.projectile_row_count,
        r.objective_row_count,
        r.event_row_count
      FROM pickup_artifacts a
      JOIN pickup_rounds r ON r.id = a.round_pk
      JOIN pickup_matches m ON m.id = r.match_pk
      WHERE m.match_id = ?
        AND r.round_number = ?
        AND a.artifact_kind = 'round_replay'
        AND a.status = 'verified'
        AND a.is_primary = 1
      LIMIT 1
    `, [matchId, round]);
    if (!rows[0]) throw pickupError(404, "replay_not_found");
    return rows[0];
  }

  async metadata(matchId, round) {
    const row = await this.artifact(matchId, round);
    const base = `/api/pickup-replays/viewer/${encodeURIComponent(matchId)}/${round}`;
    const manifest = parseManifest(row.manifest_json);
    const viewerFiles = replayFilesForSchema(manifest.schema_version);
    return {
      artifactId: Number(row.artifact_id),
      matchId: row.match_id,
      round: Number(row.round_number),
      map: row.map,
      status: row.status,
      reason: row.completion_reason,
      sourceServer: row.source_server,
      durationMs: Number(row.duration_ms || 0),
      sampleIntervalMs: Number(row.sample_interval_ms || 0),
      snapshots: Number(row.snapshot_count || 0),
      droppedSnapshots: Number(row.dropped_snapshot_count || 0),
      rowCounts: {
        players: Number(row.player_row_count || 0),
        projectiles: Number(row.projectile_row_count || 0),
        objectives: Number(row.objective_row_count || 0),
        events: Number(row.event_row_count || 0)
        ,buildableDefinitions: Number(manifest.rows?.buildable_definitions || 0)
        ,buildables: Number(manifest.rows?.buildables || 0)
        ,brushDefinitions: Number(manifest.rows?.brush_definitions || 0)
        ,brushes: Number(manifest.rows?.brushes || 0)
        ,entityDefinitions: Number(manifest.rows?.entity_definitions || 0)
        ,entities: Number(manifest.rows?.entities || 0)
        ,entityCensus: Number(manifest.rows?.entity_census || 0)
        ,entityMetadata: Number(manifest.rows?.entity_metadata || 0)
        ,sceneEvents: Number(manifest.rows?.scene_events || 0)
      },
      sha256: row.sha256,
      byteSize: Number(row.byte_size || 0),
      manifest,
      files: Object.fromEntries(viewerFiles.map(name => [
        name.replace(/\.csv$/, "").replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()),
        `${base}/files/${name}`
      ]))
    };
  }

  async streamFile(matchId, round, fileName, response) {
    if (!VIEWER_FILES.has(fileName)) throw pickupError(404, "replay_file_not_found");
    const row = await this.artifact(matchId, round);
    const manifest = parseManifest(row.manifest_json);
    if (!replayFileAvailable(fileName, manifest.schema_version)) {
      throw pickupError(404, "replay_file_not_found");
    }
    await this.storage.ensureReady();
    const archivePath = this.storage.artifactPath(row.storage_key);
    await fs.promises.access(archivePath, fs.constants.R_OK);

    response.status(200);
    response.type("text/csv");
    response.set("Cache-Control", "public, max-age=31536000, immutable");
    response.set("ETag", `"${row.sha256}-${fileName}"`);

    const child = this.spawnProcess(
      this.tarCommand,
      ["--zstd", "-xOf", archivePath, fileName],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );
    child.stderr.resume();
    child.stdout.pipe(response);
    await new Promise((resolve, reject) => {
      child.once("error", error => reject(pickupError(500, "replay_tool_unavailable", { cause: error })));
      child.once("close", code => {
        if (code === 0) resolve();
        else reject(pickupError(500, "replay_file_read_failed"));
      });
      response.once("close", () => {
        if (!response.writableEnded) child.kill("SIGKILL");
      });
    });
  }
}

module.exports = {
  VIEWER_FILES,
  PickupReplayViewer,
  parseViewerIdentity
};
