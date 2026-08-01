const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "assets", "js", "pickup-replay.js"), "utf8");
const html = fs.readFileSync(path.join(root, "pickup-replay.html"), "utf8");

test("assault cannon fire requires the recorded AC model, +attack, and a living player", () => {
  const body = source.match(/function assaultCannonActive\(frame\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(body, "assaultCannonActive source is present");
  const active = vm.runInNewContext(`(${body})`, {
    IN_ATTACK: 1,
    state: { renderModels: new Map([
      [41, { path: "models/p_mini.mdl" }],
      [42, { path: "models/p_mini2.mdl" }],
      [43, { path: "models/p_rpg.mdl" }]
    ]) }
  });
  assert.equal(active({ alive: true, weaponModelId: 41, buttons: 1 }), true);
  assert.equal(active({ alive: true, weaponModelId: 42, buttons: 1 }), true);
  assert.equal(active({ alive: true, weaponModelId: 41, buttons: 0 }), false);
  assert.equal(active({ alive: true, weaponModelId: 43, buttons: 1 }), false);
  assert.equal(active({ alive: false, weaponModelId: 41, buttons: 1 }), false);
});

test("assault cannon tracers are deterministic, seekable, and map-clipped", () => {
  assert.match(source, /const AC_ROUNDS_PER_SECOND = 12/);
  assert.match(source, /Array\.from\(\{ length: 3 \}/);
  assert.match(source, /new THREE\.CylinderGeometry\(0\.34, 0\.34, 1/);
  assert.match(source, /Math\.floor\(time \* AC_ROUNDS_PER_SECOND\)/);
  assert.match(source, /deterministicSpread\(shot, 1\)/);
  assert.match(source, /acRaycaster\.intersectObject\(mapModel, true\)/);
  assert.match(source, /startDistance = offset === 0 \? 0 : Math\.min\(range, phase \* range\)/);
  assert.match(source, /tracerLength = offset === 0 \? 72 : 48/);
  assert.doesNotMatch(source, /Math\.random\(\)/);
});

test("assault cannon effects originate at the player muzzle and honor the projectile toggle", () => {
  assert.match(source, /track\.weaponModel\.localToWorld\(track\.weaponMuzzleLocal\.clone\(\)\)/);
  assert.match(source, /track\.weaponMuzzleLocal = modelBarrelTip\(model\)/);
  assert.match(source, /vertex\.x >= maxX - 1\.5/);
  assert.match(source, /sourcePoint\(frame\.x, frame\.y, frame\.z\)/);
  assert.match(source, /addScaledVector\(forward, 27\)/);
  assert.match(source, /addScaledVector\(right, 14\)/);
  assert.match(source, /state\.showProjectiles && assaultCannonActive\(frame\)/);
  assert.match(source, /new THREE\.ConeGeometry\(2\.1, 6, 8, 1, true\)/);
  assert.match(source, /visual\.flash\.position\.copy\(muzzle\)\.addScaledVector\(forward, 3\)/);
  assert.match(source, /visual\.flash\.quaternion\.setFromUnitVectors\(segmentUp, forward\)/);
  assert.match(source, /flashPulse = 1 \+ .* \* 0\.2/);
  assert.match(source, /updateAssaultCannonVisual\(track, frame, state\.playbackTime\)/);
  assert.match(source, /hitscanRoot\.visible = state\.showProjectiles/);
  assert.match(source, /if \(track\.acFireVisual\) track\.acFireVisual\.group\.visible = false/);
  assert.match(html, /pickup-replay\.js\?v=20260731playermotion1/);
});

test("held weapons inherit the normalized player model scale", () => {
  assert.match(source, /model\.userData\.replayScale = scale/);
  assert.match(source, /track\.weaponVisual\.scale\.setScalar\(model\.userData\.replayScale \|\| 1\)/);

  const glbBounds = file => {
    const bytes = fs.readFileSync(file);
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
    const vectors = document.accessors.filter(accessor => accessor.type === "VEC3" && accessor.min && accessor.max);
    return {
      height: Math.max(...vectors.map(accessor => accessor.max[1])) -
        Math.min(...vectors.map(accessor => accessor.min[1])),
      maxX: Math.max(...vectors.map(accessor => accessor.max[0]))
    };
  };
  const player = glbBounds(path.join(root, "assets", "models", "player", "hvyweapon", "hvyweapon2_red.glb"));
  const cannon = glbBounds(path.join(root, "assets", "tfc", "models", "held", "hvyweapon", "p_mini.glb"));
  const playerScale = 72 / player.height;
  assert.ok(playerScale > 0.9 && playerScale < 0.95);
  assert.ok(cannon.maxX * playerScale < cannon.maxX, "the oversized raw cannon is reduced with its player");
});
