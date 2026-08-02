"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const converter = fs.readFileSync(path.join(root, "scripts", "convert-goldsrc-bsp-to-glb.py"), "utf8");
const worker = fs.readFileSync(path.join(root, "assets", "js", "pickup-replay-worker.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "assets", "js", "pickup-replay.js"), "utf8");

test("BSP converter exports model-lump face ranges as named GLB nodes", () => {
  assert.match(converter, /LUMP_MODELS = 14/);
  assert.match(converter, /"name": "worldspawn" if not models else f"\*\{len\(models\)\}"/);
  assert.match(converter, /face_models\[face_index\] = model_index/);
  assert.match(converter, /"nodes": nodes/);
  assert.match(converter, /"goldsrcModel": name/);
});

test("BSP converter exports resolved GoldSrc beam entities for replay maps", () => {
  assert.match(converter, /def extract_entity_beams\(data, lump\):/);
  assert.match(converter, /"env_beam", "env_laser", "env_lightning"/);
  assert.match(converter, /"goldsrcBeams": entity_beams/);
  assert.match(renderer, /gltf\?\.userData\?\.goldsrcBeams/);
  assert.match(renderer, /THREE\.AdditiveBlending/);
  assert.match(renderer, /buildMapBeams\(gltf\)/);
  assert.match(converter, /"syncTargets": sorted\(sync_targets\)/);
  assert.match(renderer, /BEAM_CONTROLLER_CLASSES\.has\(brush\?\.classname\)/);
  assert.match(renderer, /visual\.visible = visual\.userData\.startsOn \? controllersAtBase : !controllersAtBase/);
});

test("BSP converter exports GoldSrc skyboxes and pickup replay loads all six faces", () => {
  assert.match(converter, /def extract_sky_name\(entities\):/);
  assert.match(converter, /def parse_tga_png\(path\):/);
  assert.match(converter, /"goldsrcSky": \{/);
  assert.match(renderer, /new THREE\.CubeTextureLoader\(\)/);
  assert.match(renderer, /gltf\?\.userData\?\.goldsrcSky/);
  assert.match(renderer, /buildMapSky\(gltf\)/);
});

test("pickup replay renders bounded and trigger-aware GoldSrc entity lighting", () => {
  assert.match(renderer, /gltf\?\.userData\?\.goldsrcEntities/);
  assert.match(renderer, /const MAX_ACTIVE_MAP_LIGHTS = 24/);
  assert.match(renderer, /new THREE\.PointLight/);
  assert.match(renderer, /new THREE\.SpotLight/);
  assert.match(renderer, /entity\?\.classname === "light_environment"/);
  assert.match(renderer, /LIGHT_STYLE_PATTERNS\[style\]/);
  assert.match(renderer, /controllersAtBase/);
  assert.match(renderer, /definition\.linkedBeams\.some\(beam => beam\.visible\)/);
  assert.match(renderer, /visual\.userData\.syncTargets = syncTargets/);
  assert.match(renderer, /brightness \* 12, 500, 4000/);
  assert.match(renderer, /buildMapLights\(gltf\)/);
  assert.match(renderer, /updateMapLights\(\)/);
  assert.match(renderer, /renderer\.toneMappingExposure = 1\.4/);
  assert.match(renderer, /1\.8 \+ brightness \/ 600/);
  assert.match(renderer, /2\.2 \+ brightness \/ 1000/);
});

test("BSP converter archives the complete entity lump for future replay features", () => {
  assert.match(converter, /"goldsrcEntityArchiveVersion": 1/);
  assert.match(converter, /"goldsrcEntityLump": goldsrc_entity_lump/);
  assert.match(converter, /"goldsrcEntities": goldsrc_entities/);
  assert.match(converter, /"entityCount": len\(entities\)/);
});

test("schema-v4 worker parses sparse brush definitions and transferable timelines", () => {
  assert.match(worker, /const BRUSH_DEFS_COLUMNS/);
  assert.match(worker, /const BRUSHES_COLUMNS/);
  assert.match(worker, /!\/\^\\\*\[1-9\]\\d\*\$\//);
  assert.match(worker, /brushId, stride: 23/);
  assert.match(worker, /schemaVersion === 4 \? await loadBrushes/);
  assert.match(worker, /\.\.\.brushes\.map\(track => track\.frames\.buffer\)/);
});

test("renderer binds brush IDs to submodel nodes and seeks sparse tracks deterministically", () => {
  assert.match(renderer, /nodes\.get\(track\.definition\?\.model\)/);
  assert.match(renderer, /trackFrame\(track, time, true, Number\.POSITIVE_INFINITY\)/);
  assert.match(renderer, /span > 0\.25 && !moving/);
  assert.match(renderer, /track\.node\.position\.set\(frame\.x, frame\.z, -frame\.y\)/);
  assert.match(renderer, /track\.node\.visible = Boolean\(frame\?\.active/);
  assert.match(renderer, /updateBuildables\(\);\s+updateBrushes\(\);/);
  assert.match(renderer, /20260731brushes2/);
});
