"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { createBootcampReplayArchiveClient } = require("../src/services/bootcampReplayArchive");

const sidecar = Buffer.from("TFTR fixture data for a private archive");
const sha256 = crypto.createHash("sha256").update(sidecar).digest("hex");

test("archive client is unavailable unless explicitly enabled", () => {
  assert.equal(createBootcampReplayArchiveClient({ enabled: false }), null);
  assert.throws(() => createBootcampReplayArchiveClient({ enabled: true }), /URL and token/i);
});

test("archive client authenticates a ghost fetch and verifies its checksum", async () => {
  let request;
  const server = http.createServer((req, res) => {
    request = { method: req.method, url: req.url, authorization: req.headers.authorization };
    res.writeHead(200, { "Content-Type": "application/vnd.nn.ghost-sidecar", "X-TFTR-SHA256": sha256 });
    res.end(sidecar);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = createBootcampReplayArchiveClient({ enabled: true,
      baseUrl: `http://127.0.0.1:${server.address().port}`, token: "internal-test-token" });
    const result = await client.getTftr(42);
    assert.deepEqual(request, { method: "GET", url: "/v1/ghosts/42/tftr", authorization: "Bearer internal-test-token" });
    assert.deepEqual(result, { data: sidecar, sha256 });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("archive client rejects corrupt hashes and treats an absent object as a cache miss", async () => {
  let mode = "corrupt";
  const server = http.createServer((_req, res) => {
    if (mode === "missing") { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/vnd.nn.ghost-sidecar", "X-TFTR-SHA256": "0".repeat(64) }); res.end(sidecar);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = createBootcampReplayArchiveClient({ enabled: true,
      baseUrl: `http://127.0.0.1:${server.address().port}`, token: "internal-test-token" });
    await assert.rejects(client.getTftr(42), /checksum/i);
    mode = "missing";
    assert.equal(await client.getTftr(42), null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

