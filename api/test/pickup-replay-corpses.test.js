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

test("pickup replay grounds corpses against the nearest BSP surface below", () => {
  assert.match(source, /new THREE\.Raycaster\(\)/);
  assert.match(source, /new THREE\.Vector3\(0, -1, 0\)/);
  assert.match(source, /intersectObject\(mapModel, true\)\.find/);
  assert.match(source, /isReplayMapGroundMaterial/);
  assert.match(source, /corpse\.mesh\.position\.y = ground\.y \+ 1/);
  assert.match(source, /world\.add\(mapModel\);\s+settleCorpses\(\);/);
});

test("pickup replay keeps explicit schema-v2 fallback and schema-v3 render state", () => {
  const worker = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "assets", "js", "pickup-replay-worker.js"),
    "utf8"
  );
  assert.match(worker, /stride: schemaVersion === 3 \? 37 : 17/);
  assert.match(worker, /schemaVersion === 2 \? PLAYERS_V2_COLUMNS : PLAYERS_V3_COLUMNS/);
  assert.match(worker, /id !== 0 && models\.get\(id\)\?\.kind !== kind/);
  assert.match(source, /frame\.schemaVersion === 3 \? frame\.ducking/);
  assert.match(source, /frame\.schemaVersion === 3 \? frame\.bodyYaw : frame\.yaw/);
  assert.match(source, /setWeaponModel\(track, frame\.weaponModelId\)/);
  assert.match(source, /\^p_\[A-Za-z0-9_\.-\]\+\\\.mdl\$/i);
  assert.doesNotMatch(source, /w_\*\.mdl/);
});
