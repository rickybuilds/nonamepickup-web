"use strict";

const crypto = require("node:crypto");

const TRACKS = ["pos", "proj", "input", "cmd", "event"];
const MAX_TRACK_CHUNKS = 512;
const MAX_TRACK_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES = 14000;

function invalid(message) {
  const error = new Error(message);
  error.status = 422;
  throw error;
}

function safeInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) invalid(`invalid_${label}`);
  return parsed;
}

function hash(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function validateTrack(record, track, rows) {
  const expectedFrames = safeInteger(record[`${track}_frames`], `${track}_frame_count`);
  const expectedHash = record[`spool_${track}_sha`];
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) invalid(`missing_${track}_integrity_hash`);
  if (!Array.isArray(rows) || rows.length > MAX_TRACK_CHUNKS) invalid(`invalid_${track}_chunks`);
  const chunks = [];
  const digest = crypto.createHash("sha256");
  let frames = 0, bytes = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (Number(row.chunk_id) !== index || typeof row.data !== "string" || !row.data.length) invalid(`invalid_${track}_chunk`);
    const chunkBytes = Buffer.byteLength(row.data, "utf8");
    if (chunkBytes > MAX_CHUNK_BYTES || !row.data.trimEnd().endsWith(";")) invalid(`invalid_${track}_chunk`);
    bytes += chunkBytes;
    if (bytes > MAX_TRACK_BYTES) invalid("replay_too_large");
    const count = (row.data.match(/;/g) || []).length;
    if (!count) invalid(`invalid_${track}_chunk`);
    frames += count;
    digest.update(row.data, "utf8");
    chunks.push(row.data);
  }
  if (frames !== expectedFrames || digest.digest("hex").toLowerCase() !== expectedHash.toLowerCase())
    invalid(`${track}_integrity_mismatch`);
  return chunks;
}

function parseRows(chunks, fieldCount, label, numericColumns, { legacyPosition = false } = {}) {
  const output = [];
  for (const chunk of chunks) for (const raw of chunk.split(";")) {
    const text = raw.trim();
    if (!text) continue;
    const columns = text.split(",");
    if (legacyPosition && columns.length >= 9 && columns.length < fieldCount) return null;
    if (columns.length < fieldCount) invalid(`malformed_${label}_sample`);
    const values = new Array(fieldCount).fill(0);
    for (const index of numericColumns) {
      values[index] = Number(columns[index]);
      if (!Number.isFinite(values[index])) invalid(`malformed_${label}_sample`);
    }
    output.push(values);
  }
  return output;
}

function encodeBootcampTftr(record, rows) {
  if (!record || Number(record.is_complete) !== 1 || !Number.isSafeInteger(Number(record.route_id)) || Number(record.route_id) < 1)
    invalid("replay_not_public");
  if (typeof record.map !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(record.map)) invalid("invalid_map");
  const classId = safeInteger(record.class_id, "class_id", 1, 255);
  const configVersion = safeInteger(record.config_version, "config_version", 0, 0xffffffff);
  const routeId = safeInteger(record.route_id, "route_id", 1, 0xffffffff);
  const sampleInterval = Number(record.frame_interval);
  if (!Number.isFinite(sampleInterval) || sampleInterval <= 0 || sampleInterval > 1) invalid("invalid_frame_interval");

  const chunks = {};
  let totalBytes = 0;
  for (const track of TRACKS) {
    chunks[track] = validateTrack(record, track, rows[track]);
    totalBytes += chunks[track].reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
    if (totalBytes > MAX_TRACK_BYTES) invalid("replay_too_large");
  }

  const frames = parseRows(chunks.pos, 13, "position", [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12], { legacyPosition: true });
  if (!frames) return { data: null, reason: "legacy_position_track_has_no_motion_fields" };
  const events = parseRows(chunks.event, 4, "event", [0, 1, 2, 3]);
  if (frames.length < 2 || frames.length !== Number(record.pos_frames)) invalid("invalid_position_frame_count");
  if (frames.length > 360000 || events.length > 100000) invalid("replay_too_large");

  const map = Buffer.from(record.map, "utf8");
  if (!map.length || map.length > 255) invalid("invalid_map");
  const headerBytes = 27 + map.length;
  const buffer = Buffer.alloc(headerBytes + frames.length * 39 + events.length * 13);
  let offset = 0;
  buffer.write("TFTR", offset, "ascii"); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt8(map.length, offset); offset += 1;
  map.copy(buffer, offset); offset += map.length;
  buffer.writeUInt32LE(configVersion, offset); offset += 4;
  buffer.writeUInt8(1, offset); offset += 1; // route replay
  buffer.writeUInt32LE(routeId, offset); offset += 4;
  buffer.writeUInt8(classId, offset); offset += 1;
  buffer.writeUInt16LE(30, offset); offset += 2;
  buffer.writeUInt32LE(frames.length, offset); offset += 4;
  buffer.writeUInt32LE(events.length, offset); offset += 4;
  for (const values of frames) {
    const tick = Math.max(0, Math.round(values[0] * 30));
    if (!Number.isSafeInteger(tick) || tick > 0xffffffff) invalid("invalid_position_tick");
    buffer.writeUInt32LE(tick, offset); offset += 4;
    for (const value of [values[1], values[2], values[3], values[4], values[5], values[9], values[10], values[11]]) {
      if (!Number.isFinite(value) || Math.abs(value) > 3.4028234e38) invalid("invalid_position_value");
      buffer.writeFloatLE(value, offset); offset += 4;
    }
    const buttons = Math.trunc(values[7]), flags = Math.trunc(values[12]);
    if (!Number.isSafeInteger(buttons) || buttons < 0 || buttons > 0x7fffffff || !Number.isInteger(flags) || flags < 0 || flags > 255)
      invalid("invalid_position_flags");
    buffer.writeUInt16LE(buttons & 0xffff, offset); offset += 2;
    buffer.writeUInt8(flags | ((buttons & 0x40000000) ? 2 : 0), offset); offset += 1;
  }
  for (const [seconds, type, a, b] of events) {
    if (!Number.isInteger(type) || type < 0 || type > 255 || [a, b].some(value => !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff))
      invalid("invalid_event_payload");
    const tick = Math.max(0, Math.round(seconds * 30));
    if (!Number.isSafeInteger(tick) || tick > 0xffffffff) invalid("invalid_event_tick");
    buffer.writeUInt32LE(tick, offset); offset += 4;
    buffer.writeUInt8(type, offset); offset += 1;
    buffer.writeInt32LE(a, offset); offset += 4;
    buffer.writeInt32LE(b, offset); offset += 4;
  }
  return { data: buffer, reason: null, sha256: hash(buffer) };
}

module.exports = { TRACKS, encodeBootcampTftr };
