const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "assets", "js", "pickup-replay.js"),
  "utf8"
);

test("pickup replay creates corpses only on alive-to-dead transitions", () => {
  assert.match(source, /const CORPSE_LIFETIME_SECONDS = 15;/);
  assert.match(source, /previousAlive && !alive/);
  assert.match(source, /endsAt: frames\[offset\] \+ CORPSE_LIFETIME_SECONDS/);
});

test("pickup replay corpse visibility is deterministic while seeking", () => {
  assert.match(source, /state\.playbackTime >= corpse\.startsAt/);
  assert.match(source, /state\.playbackTime < corpse\.endsAt/);
  assert.match(source, /updatePlayers\(\);\s+updateCorpses\(\);/);
});
