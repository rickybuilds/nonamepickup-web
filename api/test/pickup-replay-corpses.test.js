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

test("schema-v3 player visuals are persistent across weapons, crouch, death, and respawn", () => {
  assert.match(source, /for \(const track of state\.players\)[\s\S]*track\.weaponVisual = new THREE\.Group\(\)/);
  assert.match(source, /if \(track\.mesh\.userData\.weaponModelId === modelId\) return/);
  assert.match(source, /track\.weaponVisual\.clear\(\);\s+if \(!modelId\) return/);
  assert.match(source, /boundaryIndexes = track\.schemaVersion === 3[\s\S]*\[10, 11, 12, 19, 20\]/);
  assert.match(source, /if \(frame\.schemaVersion === 2\) track\.mesh\.position\.y -=/);
  assert.doesNotMatch(source, /if \(frame\.schemaVersion === 3\) track\.mesh\.position\.y -=/);
});

test("schema-v3 buildables use stable IDs, model replacement, components, and terminal active state", () => {
  assert.match(source, /state\.buildableDefinitions = new Map/);
  assert.match(source, /track\.mesh\.userData\.buildableId = track\.buildableId/);
  assert.match(source, /if \(track\.mesh\.userData\.modelId === modelId\) return/);
  assert.match(source, /track\.visual\.clear\(\);/);
  assert.match(source, /value\(frame, 1, false\) !== 1/);
  assert.match(source, /ownerSession: frame\.ownerSession, team: frame\.team/);
  assert.match(source, /unsupportedGoldSrcState/);
});

test("worker streams large CSVs and branches projectile/objective definitions by schema", () => {
  const worker = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "assets", "js", "pickup-replay-worker.js"),
    "utf8"
  );
  assert.match(worker, /response\.body\?\.getReader\(\)/);
  assert.match(worker, /schemaVersion === 2[\s\S]*"model"[\s\S]*"model_id"/);
  assert.match(worker, /stride: 42/);
  assert.match(worker, /buildableDefinitions/);
});
