"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { tokenMatches } = require("./ingestion");
const { pickupError } = require("./errors");
const {
  DICTIONARY_FILES,
  REPLAY_FILE_ORDER,
  replayFileAvailable
} = require("./replayContract");

const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SERVER_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const STREAM_ID_PATTERN = /^[A-Za-z0-9_-]{16,96}$/;
const LIVE_FILE_ORDER = REPLAY_FILE_ORDER;

function cleanIdentity(serverId, matchId, roundText) {
  if (!SERVER_ID_PATTERN.test(String(serverId || ""))) throw pickupError(400, "invalid_server_id");
  if (!MATCH_ID_PATTERN.test(String(matchId || ""))) throw pickupError(400, "invalid_match_id");
  if (!/^\d{1,4}$/.test(String(roundText || ""))) throw pickupError(400, "invalid_round");
  const round = Number(roundText);
  if (round < 1 || round > 9999) throw pickupError(400, "invalid_round");
  return { serverId: String(serverId).toLowerCase(), matchId: String(matchId), round };
}

function parseIngestMetadata(headers) {
  const identity = cleanIdentity(
    headers["x-pickup-server-id"],
    headers["x-pickup-match-id"],
    headers["x-pickup-round"]
  );
  const streamId = headers["x-pickup-live-stream-id"];
  const sequenceText = headers["x-pickup-live-sequence"];
  const schemaText = headers["x-pickup-live-schema"];
  if (typeof streamId !== "string" || !STREAM_ID_PATTERN.test(streamId)) {
    throw pickupError(400, "invalid_stream_id");
  }
  if (typeof sequenceText !== "string" || !/^[1-9]\d{0,9}$/.test(sequenceText)) {
    throw pickupError(400, "invalid_sequence");
  }
  if (typeof schemaText !== "string" || !/^[23456]$/.test(schemaText)) {
    throw pickupError(400, "invalid_schema_version");
  }
  return {
    ...identity,
    streamId,
    sequence: Number(sequenceText),
    schemaVersion: Number(schemaText)
  };
}

function streamKey(identity) {
  return `${identity.serverId}:${identity.matchId}:${identity.round}`;
}

function digestBatch(body) {
  return crypto.createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
}

function headerAndBody(data) {
  const boundary = data.indexOf("\n");
  if (boundary < 0) throw pickupError(422, "live_header_incomplete");
  return {
    header: data.slice(0, boundary).replace(/\r$/, "") + "\n",
    body: data.slice(boundary + 1)
  };
}

class PickupLiveService {
  constructor({
    uploadToken,
    dataDir,
    fsPromises,
    bufferSeconds = 120,
    staleSeconds = 30,
    maxBatchBytes = 1024 * 1024,
    logger = console
  }) {
    this.uploadToken = uploadToken;
    this.dataDir = dataDir;
    this.fs = fsPromises;
    this.bufferMs = bufferSeconds * 1000;
    this.staleMs = staleSeconds * 1000;
    this.maxBatchBytes = maxBatchBytes;
    this.logger = logger;
    this.streams = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), 15_000);
    this.cleanupTimer.unref();
  }

  authenticated(header) {
    return tokenMatches(header, this.uploadToken);
  }

  metadata(headers) {
    return parseIngestMetadata(headers);
  }

  newStream(metadata) {
    const now = Date.now();
    return {
      ...metadata,
      key: streamKey(metadata),
      sequence: 0,
      lastDigest: null,
      createdAt: now,
      updatedAt: now,
      final: false,
      offsets: new Map(),
      headers: new Map(),
      dictionaries: new Map(),
      batches: [],
      subscribers: new Set()
    };
  }

  validateBody(body, schemaVersion) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw pickupError(400, "invalid_live_batch");
    }
    if (typeof body.final !== "boolean" || !body.files || typeof body.files !== "object" || Array.isArray(body.files)) {
      throw pickupError(400, "invalid_live_batch");
    }
    let byteSize = 0;
    const chunks = [];
    for (const [fileName, chunk] of Object.entries(body.files)) {
      if (!replayFileAvailable(fileName, schemaVersion) || !chunk ||
          typeof chunk !== "object" || Array.isArray(chunk)) {
        throw pickupError(422, "invalid_live_file");
      }
      const { start, end, data } = chunk;
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end <= start ||
          typeof data !== "string" || !data.endsWith("\n") || data.includes("\0")) {
        throw pickupError(422, "invalid_live_chunk");
      }
      const dataBytes = Buffer.byteLength(data, "utf8");
      if (end - start !== dataBytes) throw pickupError(422, "live_offset_mismatch");
      byteSize += dataBytes;
      chunks.push({ fileName, start, end, data });
    }
    if (byteSize > this.maxBatchBytes) throw pickupError(413, "live_batch_too_large");
    return { final: body.final, chunks, byteSize };
  }

  ingest(metadata, body) {
    const key = streamKey(metadata);
    const validated = this.validateBody(body, metadata.schemaVersion);
    const digest = digestBatch(body);
    let stream = this.streams.get(key);

    if (!stream || stream.streamId !== metadata.streamId) {
      if (metadata.sequence !== 1) throw pickupError(409, "live_stream_reset_required");
      if (stream) this.resetSubscribers(stream);
      stream = this.newStream(metadata);
      this.streams.set(key, stream);
    }

    if (metadata.sequence === stream.sequence) {
      if (digest !== stream.lastDigest) throw pickupError(409, "live_sequence_conflict");
      return this.ingestResult(stream, true, validated.byteSize);
    }
    if (metadata.sequence !== stream.sequence + 1) {
      throw pickupError(409, "live_sequence_gap");
    }
    if (metadata.schemaVersion !== stream.schemaVersion) {
      throw pickupError(409, "live_schema_conflict");
    }

    const outgoingFiles = {};
    const outgoingHeaders = {};
    for (const chunk of validated.chunks.sort((a, b) => LIVE_FILE_ORDER.indexOf(a.fileName) - LIVE_FILE_ORDER.indexOf(b.fileName))) {
      const expectedOffset = stream.offsets.get(chunk.fileName) || 0;
      if (chunk.start !== expectedOffset) throw pickupError(409, "live_file_offset_gap");
      let bodyText = chunk.data;
      if (chunk.start === 0) {
        const split = headerAndBody(chunk.data);
        stream.headers.set(chunk.fileName, split.header);
        outgoingHeaders[chunk.fileName] = split.header;
        bodyText = split.body;
      } else if (!stream.headers.has(chunk.fileName)) {
        throw pickupError(409, "live_file_header_missing");
      }
      stream.offsets.set(chunk.fileName, chunk.end);
      if (DICTIONARY_FILES.has(chunk.fileName)) {
        const previous = stream.dictionaries.get(chunk.fileName) || stream.headers.get(chunk.fileName) || "";
        stream.dictionaries.set(chunk.fileName, previous + bodyText);
      }
      if (bodyText) outgoingFiles[chunk.fileName] = bodyText;
    }

    const now = Date.now();
    const batch = {
      sequence: metadata.sequence,
      receivedAt: now,
      files: outgoingFiles,
      headers: outgoingHeaders,
      final: validated.final
    };
    stream.sequence = metadata.sequence;
    stream.lastDigest = digest;
    stream.updatedAt = now;
    stream.final = validated.final;
    stream.batches.push(batch);
    this.trim(stream, now);
    this.broadcast(stream, "batch", batch, metadata.sequence);
    if (stream.final) this.broadcast(stream, "final", { sequence: stream.sequence }, stream.sequence);
    return this.ingestResult(stream, false, validated.byteSize);
  }

  ingestResult(stream, duplicate, byteSize) {
    return {
      ok: true,
      duplicate,
      serverId: stream.serverId,
      matchId: stream.matchId,
      round: stream.round,
      streamId: stream.streamId,
      sequence: stream.sequence,
      byteSize,
      final: stream.final
    };
  }

  trim(stream, now = Date.now()) {
    const cutoff = now - this.bufferMs;
    while (stream.batches.length > 1 && stream.batches[0].receivedAt < cutoff) stream.batches.shift();
  }

  async liveState(stream) {
    if (!this.dataDir || !this.fs) return {};
    try {
      const file = path.join(this.dataDir, `live_${stream.serverId}.json`);
      const parsed = JSON.parse(await this.fs.readFile(file, "utf8") || "{}");
      const matchId = String(parsed.match_id || parsed.matchId || "");
      if (matchId !== stream.matchId) return {};
      return parsed;
    } catch {
      return {};
    }
  }

  find(identity) {
    const stream = this.streams.get(streamKey(identity));
    if (!stream) throw pickupError(404, "live_stream_not_found");
    return stream;
  }

  async viewerMetadata(identity) {
    const stream = this.find(identity);
    const live = await this.liveState(stream);
    return {
      serverId: stream.serverId,
      sourceServer: stream.serverId,
      matchId: stream.matchId,
      round: stream.round,
      streamId: stream.streamId,
      sequence: stream.sequence,
      schemaVersion: stream.schemaVersion,
      map: live.map || live.map_name || null,
      active: !stream.final && Date.now() - stream.updatedAt <= this.staleMs,
      final: stream.final,
      updatedAt: stream.updatedAt,
      bufferSeconds: Math.round(this.bufferMs / 1000),
      snapshot: `/api/pickup-live/viewer/${encodeURIComponent(stream.serverId)}/${encodeURIComponent(stream.matchId)}/${stream.round}/snapshot`,
      events: `/api/pickup-live/viewer/${encodeURIComponent(stream.serverId)}/${encodeURIComponent(stream.matchId)}/${stream.round}/events`
    };
  }

  snapshot(identity) {
    const stream = this.find(identity);
    this.trim(stream);
    const files = {};
    for (const fileName of LIVE_FILE_ORDER) {
      const header = stream.headers.get(fileName);
      if (!header) continue;
      if (DICTIONARY_FILES.has(fileName)) {
        files[fileName] = stream.dictionaries.get(fileName) || header;
      } else {
        files[fileName] = header + stream.batches.map(batch => batch.files[fileName] || "").join("");
      }
    }
    return {
      serverId: stream.serverId,
      matchId: stream.matchId,
      round: stream.round,
      streamId: stream.streamId,
      schemaVersion: stream.schemaVersion,
      sequence: stream.sequence,
      final: stream.final,
      files
    };
  }

  subscribe(identity, afterSequence, response) {
    const stream = this.find(identity);
    this.trim(stream);
    const firstAvailable = stream.batches[0]?.sequence || stream.sequence;
    if (afterSequence && afterSequence < firstAvailable - 1) {
      this.writeEvent(response, "reset", { reason: "cursor_expired" });
    } else {
      for (const batch of stream.batches) {
        if (batch.sequence > afterSequence) this.writeEvent(response, "batch", batch, batch.sequence);
      }
    }
    stream.subscribers.add(response);
    const heartbeat = setInterval(() => {
      if (!response.destroyed) response.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15_000);
    heartbeat.unref();
    const cleanup = () => {
      clearInterval(heartbeat);
      stream.subscribers.delete(response);
    };
    response.once("close", cleanup);
    response.once("error", cleanup);
  }

  writeEvent(response, event, data, id) {
    if (response.destroyed || response.writableEnded) return;
    if (id != null) response.write(`id: ${id}\n`);
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  broadcast(stream, event, data, id) {
    for (const response of stream.subscribers) this.writeEvent(response, event, data, id);
  }

  resetSubscribers(stream) {
    for (const response of stream.subscribers) {
      this.writeEvent(response, "reset", { reason: "stream_restarted" });
      response.end();
    }
    stream.subscribers.clear();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, stream] of this.streams) {
      const retention = stream.final ? 15 * 60_000 : Math.max(this.staleMs * 20, 10 * 60_000);
      if (now - stream.updatedAt <= retention) continue;
      this.resetSubscribers(stream);
      this.streams.delete(key);
    }
  }

  close() {
    clearInterval(this.cleanupTimer);
    for (const stream of this.streams.values()) this.resetSubscribers(stream);
    this.streams.clear();
  }
}

module.exports = {
  DICTIONARY_FILES,
  LIVE_FILE_ORDER,
  PickupLiveService,
  cleanIdentity,
  parseIngestMetadata,
  streamKey
};
