const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const moduleSource = fs.readFileSync(
  path.join(root, "assets", "js", "replay-map-materials.js"),
  "utf8"
);
const context = { module: { exports: {} } };
vm.runInNewContext(
  `${moduleSource.replace(/\bexport\s+/g, "")}
   module.exports = {
     replayMapMaterialOpacity,
     configureReplayMapMaterial,
     isReplayMapGroundMaterial
   };`,
  context
);
const {
  replayMapMaterialOpacity,
  configureReplayMapMaterial,
  isReplayMapGroundMaterial
} = context.module.exports;

test("classifies GoldSrc water and effect textures without matching signs", () => {
  assert.equal(replayMapMaterialOpacity("!water1"), 0.45);
  assert.equal(replayMapMaterialOpacity("+0water4b"), 0.45);
  assert.equal(replayMapMaterialOpacity("water4b"), 0.45);
  assert.equal(replayMapMaterialOpacity("sign_water1"), 1);
  assert.equal(replayMapMaterialOpacity("laser1"), 0.20);
  assert.equal(replayMapMaterialOpacity("red_laserbeam"), 0.20);
  assert.equal(replayMapMaterialOpacity("forcefield1"), 0.20);
  assert.equal(replayMapMaterialOpacity("e7beam02_red"), 0.20);
  assert.equal(replayMapMaterialOpacity("orc26r"), 0.20);
  assert.equal(replayMapMaterialOpacity("orc26b"), 0.20);
  assert.equal(replayMapMaterialOpacity("wood_beam"), 1);
});

test("configures translucent map materials without depth-writing walls", () => {
  const water = { name: "water4b", opacity: 1, transparent: false };
  configureReplayMapMaterial(water, "double");
  assert.equal(water.side, "double");
  assert.equal(water.transparent, true);
  assert.equal(water.opacity, 0.45);
  assert.equal(water.depthWrite, false);
  assert.equal(water.needsUpdate, true);
  assert.equal(isReplayMapGroundMaterial(water), false);

  const wall = { name: "crete4_flr01", opacity: 1, transparent: false };
  configureReplayMapMaterial(wall, "double");
  assert.equal(wall.depthWrite, true);
  assert.equal(isReplayMapGroundMaterial(wall), true);
});

test("BSP converter persists translucent material classifications", () => {
  const converter = fs.readFileSync(
    path.join(root, "scripts", "convert-goldsrc-bsp-to-glb.py"),
    "utf8"
  );
  assert.match(converter, /"goldsrcTextureKind": kind/);
  assert.match(converter, /if kind in \("water", "effect"\):/);
});
