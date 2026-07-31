const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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
  assert.match(source, /setWeaponModel\(track, frame\.weaponModelId, frame\.classId\)/);
  assert.match(source, /\^p_\[A-Za-z0-9_\.-\]\+\\\.mdl\$/i);
  assert.doesNotMatch(source, /w_\*\.mdl/);
});

test("schema-v3 player visuals are persistent across weapons, crouch, death, and respawn", () => {
  assert.match(source, /for \(const track of state\.players\)[\s\S]*track\.weaponVisual = new THREE\.Group\(\)/);
  assert.match(source, /weaponModelKey === weaponKey/);
  assert.match(source, /track\.weaponVisual\.clear\(\);\s+if \(!modelId\) return/);
  assert.match(source, /boundaryIndexes = track\.schemaVersion === 3[\s\S]*\[10, 11, 12, 19, 20\]/);
  assert.match(source, /if \(frame\.schemaVersion === 2\) track\.mesh\.position\.y -=/);
  assert.doesNotMatch(source, /if \(frame\.schemaVersion === 3\) track\.mesh\.position\.y -=/);
  assert.match(source, /clonedPlayerModel\(asset, track\.schemaVersion === 2\)/);
  assert.match(source, /if \(alignFeetToOrigin\) model\.position\.y = -bounds\.min\.y \* scale/);
  assert.match(source, /fallbackPlayerMesh\(team, track\.schemaVersion === 3\)/);
  assert.match(source, /catalog\?\.heldVariants\?\.\[classKey\]/);
  assert.doesNotMatch(source, /playerVisualScaleY/);
  assert.doesNotMatch(source, /track\.playerVisual\.scale/);
  assert.match(source, /modelPose === pose/);
  assert.match(source, /poseSuffix = ducking \? "_crouch" : ""/);
  assert.match(source, /track\.playerVisual\.position\.y = crouched \? 2\.5 : 0/);
  assert.match(source, /track\.weaponVisual\.position\.y = crouched \? -18 : 0/);
});

test("schema-v3 crouch uses baked crouch_idle player geometry instead of scaling", () => {
  const root = path.resolve(__dirname, "..", "..");
  const playerRoot = path.join(root, "assets", "models", "player");
  const crouched = fs.readdirSync(playerRoot, { recursive: true })
    .filter(name => /_(?:blue|red|yellow|green)_crouch\.glb$/.test(name));
  assert.equal(crouched.length, 40);

  const glbHeight = file => {
    const bytes = fs.readFileSync(file);
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
    const vectors = document.accessors.filter(accessor => accessor.type === "VEC3" && accessor.min && accessor.max);
    return Math.max(...vectors.map(accessor => accessor.max[1])) -
      Math.min(...vectors.map(accessor => accessor.min[1]));
  };
  const standing = path.join(playerRoot, "engineer", "engineer2_blue.glb");
  const crouch = path.join(playerRoot, "engineer", "engineer2_blue_crouch.glb");
  assert.ok(glbHeight(crouch) > 40, "crouch remains a full articulated model");
  assert.ok(glbHeight(crouch) < glbHeight(standing) * 0.65, "crouch pose fits the crouched hull");

  const converter = fs.readFileSync(path.join(root, "scripts", "convert_goldsrc_player_models.py"), "utf8");
  const teamConverter = fs.readFileSync(path.join(root, "scripts", "convert_goldsrc_team_player_models.py"), "utf8");
  assert.match(converter, /sequence_name: str = "idle"/);
  assert.match(teamConverter, /sequence_name="crouch_idle"/);
});

test("schema-v3 buildables use stable IDs, model replacement, components, and terminal active state", () => {
  assert.match(source, /state\.buildableDefinitions = new Map/);
  assert.match(source, /track\.mesh\.userData\.buildableId = track\.buildableId/);
  assert.match(source, /modelKey === modelKey/);
  assert.match(source, /track\.visual\.clear\(\);/);
  assert.match(source, /value\(frame, 1, false\) !== 1/);
  assert.match(source, /ownerSession: frame\.ownerSession, team: frame\.team/);
  assert.match(source, /unsupportedGoldSrcState/);
  assert.match(source, /frame\.rendermode === 0\s+\? 1/);
  assert.match(source, /frame\.effects & 128/);
  assert.match(source, /catalog\?\.teamVariants\?\.\[teamKey\]/);
  assert.match(source, /const visualTeam = buildableVisualTeam\(track, frame, state\.playbackTime\)/);
  assert.match(source, /ownerFrame\?\.team/);
  assert.match(source, /track\.definition\?\.initialOwnerSession/);
  assert.match(source, /representedTeams\.size === 1/);
  assert.match(source, /team: frame\.team, visualTeam/);
  assert.match(source, /frame\.rendermode !== 0 && frame\.color\.some/);
});

test("buildable palette falls back to the only represented player team", () => {
  const body = source.match(/function buildableVisualTeam\(track, frame, time\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(body, "buildableVisualTeam source is present");
  const state = {
    playerBySession: new Map(),
    roster: [{ sessionId: 7, team: 1 }],
    players: [{ snapshot: { team: 1 } }]
  };
  const helper = vm.runInNewContext(`(${body})`, {
    state,
    playerSnapshot: player => player.snapshot
  });
  assert.equal(helper({ definition: { initialOwnerSession: 0 } }, { ownerSession: 0, team: 2 }, 45), 1);
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

test("catalog provides class-held weapons and distinct buildable team palettes", () => {
  const root = path.resolve(__dirname, "..", "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets", "tfc", "models", "manifest.json"), "utf8"));
  const nailgun = manifest.models["models/p_nailgun.mdl"];
  assert.equal(Object.keys(nailgun.heldVariants).length, 10);
  assert.match(nailgun.heldVariants.scout, /held\/scout\/p_nailgun\.glb$/);
  const sentry = manifest.models["models/sentry3.mdl"];
  assert.deepEqual(Object.keys(sentry.teamVariants), ["blue", "red", "yellow", "green"]);
  const blue = fs.readFileSync(path.join(root, sentry.teamVariants.blue.replace(/^\/assets\//, "assets/")));
  const red = fs.readFileSync(path.join(root, sentry.teamVariants.red.replace(/^\/assets\//, "assets/")));
  assert.notEqual(Buffer.compare(blue, red), 0);
  const converter = fs.readFileSync(path.join(root, "scripts", "convert_goldsrc_player_models.py"), "utf8");
  assert.match(converter, /driver_source/);
  assert.match(converter, /bip01 r clavicle.*bip01 r arm/);
  assert.match(converter, /force_team_recolor/);
  assert.match(source, /const TFC_MODEL_ASSET_VERSION = "20260731schema3fix5"/);
  assert.match(source, /url\?\.includes\("\/assets\/tfc\/models\/"\)/);
  assert.match(source, /loader\.load\(assetUrl/);
});
