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
