"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

let client;
async function loadClient() {
  if (!client) client = await import(pathToFileURL(path.join(__dirname, "../../assets/js/bootcamp-tftr-client.mjs")).href);
  return client;
}

function fixture() {
  const map = new TextEncoder().encode("openfire"), header = 27 + map.length;
  const buffer = new ArrayBuffer(header + 2 * 39 + 13), view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set([84, 70, 84, 82], 0);
  view.setUint16(4, 1, true);
  view.setUint8(6, map.length);
  bytes.set(map, 7);
  view.setUint32(7 + map.length, 4, true);
  view.setUint8(11 + map.length, 1);
  view.setUint32(12 + map.length, 2, true);
  view.setUint8(16 + map.length, 5);
  view.setUint16(17 + map.length, 30, true);
  view.setUint32(19 + map.length, 2, true);
  view.setUint32(23 + map.length, 1, true);
  let offset = header;
  for (const [tick, x, buttons, flags] of [[0, 1, 7, 12], [1, 2, 0, 0]]) {
    view.setUint32(offset, tick, true); offset += 4;
    for (const value of [x, 2, 3, 4, 5, 9, 10, 11]) { view.setFloat32(offset, value, true); offset += 4; }
    view.setUint16(offset, buttons, true); offset += 2;
    view.setUint8(offset, flags); offset += 1;
  }
  view.setUint32(offset, 15, true); offset += 4;
  view.setUint8(offset, 8); offset += 1;
  view.setInt32(offset, -2, true); offset += 4;
  view.setInt32(offset, 3, true);
  return buffer;
}

test("decodes and validates TFTR v1 metadata, movement, and typed events", async () => {
  const { decodeTftrReplay } = await loadClient();
  const decoded = decodeTftrReplay(fixture(), { map: "openfire", routeId: 2, classId: 5, configVersion: 4, frameCount: 2 });
  assert.equal(decoded.frames.length, 2);
  assert.equal(decoded.frames[1].t, 1 / 30);
  assert.equal(decoded.frames[0].x, 1);
  assert.deepEqual([decoded.frames[0].vx, decoded.frames[0].vy, decoded.frames[0].vz], [9, 10, 11]);
  assert.equal(decoded.frames[0].buttons, 7);
  assert.equal(decoded.frames[0].grenadePrimed, false);
  assert.deepEqual(decoded.events, [{ t: 0.5, code: 8, a: -2, b: 3 }]);
  assert.throws(() => decodeTftrReplay(fixture(), { map: "2fort", routeId: 2, classId: 5, configVersion: 4 }), /metadata mismatch/);
  assert.throws(() => decodeTftrReplay(fixture().slice(0, 24), { map: "openfire" }), /truncated/);
});

test("loads metadata and movement sidecar without downloading the JSON movement payload", async () => {
  const { fetchBootcampReplay, bootcampTftrPath, bootcampReplayMetadataPath } = await loadClient();
  assert.equal(bootcampTftrPath(12), "/api/bootcamp/replay/run/12/tftr");
  assert.equal(bootcampReplayMetadataPath(12), "/api/bootcamp/replay/run/12/metadata");
  assert.throws(() => bootcampTftrPath("../12"), /Invalid replay run ID/);
  const requests = [], metadata = { source: "bootcamp", runId: 12, ghostId: 7, map: "openfire", routeId: 2,
    routeName: "Ramp", classId: 5, playerName: "Runner", steamid: "STEAM_0:1:4", timeMs: 12000,
    configVersion: 4, frameInterval: 1 / 30, frameCount: 2 };
  const result = await fetchBootcampReplay(12, "/api/bootcamp/replay/run/12", async url => {
    requests.push(url);
    if (url.endsWith("/tftr")) return { ok: true, arrayBuffer: async () => fixture() };
    if (url.endsWith("/metadata")) return { ok: true, json: async () => metadata };
    throw new Error("The JSON movement endpoint should not be requested for a valid sidecar.");
  });
  assert.deepEqual(requests, ["/api/bootcamp/replay/run/12/tftr", "/api/bootcamp/replay/run/12/metadata"]);
  assert.equal(result.frameEncoding, "tftr-v1");
  assert.equal(result.frames[0].vx, 9);
  assert.equal(result.events[0].a, -2);
  assert.equal(result.playerName, "Runner");
});

test("falls back to JSON for unavailable or invalid TFTR sidecars", async () => {
  const { fetchBootcampReplay } = await loadClient();
  const path = "/api/bootcamp/replay/run/2", replay = { source: "bootcamp", runId: 2, frames: ["legacy"] };
  const fallback = async url => url.endsWith("/tftr") ? { ok: false, status: 406 } : { ok: true, json: async () => replay };
  assert.equal(await fetchBootcampReplay(2, path, fallback), replay);
  const invalidSidecar = async url => {
    if (url.endsWith("/tftr")) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    if (url.endsWith("/metadata")) return { ok: true, json: async () => ({ source: "bootcamp", runId: 2, map: "openfire",
      routeId: 2, classId: 5, configVersion: 4, frameCount: 2 }) };
    return { ok: true, json: async () => replay };
  };
  assert.equal(await fetchBootcampReplay(2, path, invalidSidecar), replay);
});
