const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "assets", "js", "pickup-replay.js"), "utf8");
const html = fs.readFileSync(path.join(root, "pickup-replay.html"), "utf8");

test("assault cannon fire requires weapon 13, +attack, and a living player", () => {
  const body = source.match(/function assaultCannonActive\(frame\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(body, "assaultCannonActive source is present");
  const active = vm.runInNewContext(`(${body})`, {
    ASSAULT_CANNON_WEAPON_ID: 13,
    IN_ATTACK: 1
  });
  assert.equal(active({ alive: true, weapon: 13, buttons: 1 }), true);
  assert.equal(active({ alive: true, weapon: 13, buttons: 0 }), false);
  assert.equal(active({ alive: true, weapon: 12, buttons: 1 }), false);
  assert.equal(active({ alive: false, weapon: 13, buttons: 1 }), false);
});

test("assault cannon tracers are deterministic, seekable, and map-clipped", () => {
  assert.match(source, /const AC_ROUNDS_PER_SECOND = 12/);
  assert.match(source, /Array\.from\(\{ length: 3 \}/);
  assert.match(source, /new THREE\.CylinderGeometry\(0\.55, 0\.55, 1/);
  assert.match(source, /Math\.floor\(time \* AC_ROUNDS_PER_SECOND\)/);
  assert.match(source, /deterministicSpread\(shot, 1\)/);
  assert.match(source, /acRaycaster\.intersectObject\(mapModel, true\)/);
  assert.match(source, /startDistance = Math\.min\(range, phase \* range\)/);
  assert.doesNotMatch(source, /Math\.random\(\)/);
});

test("assault cannon effects originate at the player muzzle and honor the projectile toggle", () => {
  assert.match(source, /sourcePoint\(frame\.x, frame\.y, frame\.z\)/);
  assert.match(source, /addScaledVector\(forward, 27\)/);
  assert.match(source, /addScaledVector\(right, 14\)/);
  assert.match(source, /state\.showProjectiles && assaultCannonActive\(frame\)/);
  assert.match(source, /updateAssaultCannonVisual\(track, frame, state\.playbackTime\)/);
  assert.match(source, /hitscanRoot\.visible = state\.showProjectiles/);
  assert.match(source, /if \(track\.acFireVisual\) track\.acFireVisual\.group\.visible = false/);
  assert.match(html, /pickup-replay\.js\?v=20260731schema3fix9/);
});
