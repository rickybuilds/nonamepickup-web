const MAX_FRAMES = 3600;
const MAX_EVENTS = 512;

function viewOf(value) {
  if (value instanceof ArrayBuffer) return new DataView(value);
  if (ArrayBuffer.isView(value)) return new DataView(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Invalid TFTR binary payload.");
}

function requireBytes(view, length) {
  if (view.byteLength < length) throw new Error("TFTR sidecar is truncated.");
}

function mismatch(expected, actual) {
  return expected != null && String(expected) !== String(actual);
}

export function bootcampTftrPath(runId) {
  const value = String(runId);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid replay run ID.");
  return `/api/bootcamp/replay/run/${encodeURIComponent(value)}/tftr`;
}

export function bootcampReplayMetadataPath(runId) {
  const value = String(runId);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid replay run ID.");
  return `/api/bootcamp/replay/run/${encodeURIComponent(value)}/metadata`;
}

export function decodeTftrReplay(binary, expected = {}) {
  const view = viewOf(binary);
  requireBytes(view, 27);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "TFTR" || view.getUint16(4, true) !== 1) throw new Error("Unsupported TFTR sidecar format.");
  const mapLength = view.getUint8(6);
  if (!mapLength) throw new Error("Invalid TFTR map identifier.");
  const headerLength = 27 + mapLength;
  requireBytes(view, headerLength);
  let map;
  try { map = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(view.buffer, view.byteOffset + 7, mapLength)); }
  catch { throw new Error("Invalid TFTR map encoding."); }
  let offset = 7 + mapLength;
  const configVersion = view.getUint32(offset, true); offset += 4;
  const targetKind = view.getUint8(offset); offset += 1;
  const routeId = view.getUint32(offset, true); offset += 4;
  const classId = view.getUint8(offset); offset += 1;
  const sampleRate = view.getUint16(offset, true); offset += 2;
  const frameCount = view.getUint32(offset, true); offset += 4;
  const eventCount = view.getUint32(offset, true); offset += 4;
  if (targetKind !== 1 || sampleRate !== 30 || frameCount < 2 || frameCount > MAX_FRAMES || eventCount > MAX_EVENTS)
    throw new Error("Invalid TFTR route or sample counts.");
  if (mismatch(expected.map, map) || mismatch(expected.configVersion, configVersion) ||
      mismatch(expected.routeId, routeId) || mismatch(expected.classId, classId) ||
      mismatch(expected.frameCount, frameCount)) throw new Error("TFTR metadata mismatch.");
  const expectedLength = headerLength + frameCount * 39 + eventCount * 13;
  if (view.byteLength !== expectedLength) throw new Error("TFTR sidecar is truncated or has trailing data.");

  const frames = [];
  let previousTick = -1;
  for (let index = 0; index < frameCount; index++) {
    const tick = view.getUint32(offset, true); offset += 4;
    if (tick < previousTick) throw new Error("TFTR frame times are not ordered.");
    previousTick = tick;
    const values = [];
    for (let field = 0; field < 8; field++) {
      const value = view.getFloat32(offset, true); offset += 4;
      if (!Number.isFinite(value)) throw new Error("TFTR frame contains a non-finite value.");
      values.push(value);
    }
    const buttons = view.getUint16(offset, true); offset += 2;
    const flags = view.getUint8(offset); offset += 1;
    frames.push({ t: tick / sampleRate, x: values[0], y: values[1], z: values[2], pitch: values[3], yaw: values[4], roll: 0,
      vx: values[5], vy: values[6], vz: values[7], buttons, flags, onGround: Boolean(flags & 1), grenadePrimed: Boolean(flags & 2), viewmodel: null });
  }
  const events = [];
  previousTick = -1;
  for (let index = 0; index < eventCount; index++) {
    const tick = view.getUint32(offset, true); offset += 4;
    if (tick < previousTick) throw new Error("TFTR event times are not ordered.");
    previousTick = tick;
    events.push({ t: tick / sampleRate, code: view.getUint8(offset), a: view.getInt32(offset + 1, true), b: view.getInt32(offset + 5, true) });
    offset += 9;
  }
  return { version: 1, map, configVersion, targetKind, routeId, classId, sampleRate, frames, events };
}

export async function fetchBootcampReplay(runId, jsonPath, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("Replay fetch is unavailable.");
  try {
    const response = await fetchImpl(bootcampTftrPath(runId), { cache: "no-store" });
    if (response.ok) {
      const binary = await response.arrayBuffer();
      const metadataResponse = await fetchImpl(bootcampReplayMetadataPath(runId), { cache: "no-store" });
      if (metadataResponse.ok) {
        const metadata = await metadataResponse.json();
        if (metadata?.source !== "bootcamp" || Number(metadata.runId) !== Number(runId)) throw new Error("Replay metadata mismatch.");
        const decoded = decodeTftrReplay(binary, { map: metadata.map, routeId: metadata.routeId, classId: metadata.classId,
          configVersion: metadata.configVersion, frameCount: metadata.frameCount });
        return { ...metadata, frames: decoded.frames, events: decoded.events, frameEncoding: "tftr-v1" };
      }
    }
  } catch {
    // Fall back to the established JSON replay path below.
  }
  const fallback = await fetchImpl(jsonPath, { cache: "no-store" });
  const replay = await fallback.json().catch(() => ({}));
  if (!fallback.ok) throw new Error(replay?.error || `Replay request failed (${fallback.status})`);
  return replay;
}
