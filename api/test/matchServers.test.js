"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readMatchServers, serverKeyFromName, splitServerAddress } = require("../src/lib/matchServers");

test("server helpers normalize configured server metadata", () => {
  assert.equal(serverKeyFromName("NoName Central 2"), "central2");
  assert.equal(serverKeyFromName("Fun Stuff West"), "west");
  assert.deepEqual(splitServerAddress("144.202.48.25:27016"), {
    host: "144.202.48.25",
    port: 27016
  });
});

test("readMatchServers joins a live match id to its server key and IP", t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "match-servers-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dataDir, "servers.json"), JSON.stringify([
    { name: "Fun Stuff Central", ip: "144.202.48.25:27015" }
  ]));
  fs.writeFileSync(path.join(dataDir, "live_central.json"), JSON.stringify({
    active: true,
    match_id: "9TJEJH"
  }));

  assert.deepEqual(readMatchServers(dataDir).get("9TJEJH"), {
    serverKey: "central",
    serverIp: "144.202.48.25"
  });

  fs.rmSync(path.join(dataDir, "live_central.json"));
  assert.deepEqual(readMatchServers(dataDir).get("9TJEJH"), {
    serverKey: "central",
    serverIp: "144.202.48.25"
  });
});

test("readMatchServers tolerates missing and malformed metadata", t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "match-servers-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dataDir, "live_west.json"), "{");
  assert.deepEqual([...readMatchServers(dataDir)], []);
  assert.deepEqual([...readMatchServers(path.join(dataDir, "missing"))], []);
});
