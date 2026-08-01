const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

function activeGlbMaterials(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  let json;
  for (let offset = 12; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "JSON") {
      json = JSON.parse(
        buffer.subarray(offset + 8, offset + 8 + length)
          .toString("utf8")
          .replace(/\0/g, "")
          .trim()
      );
    }
    offset += 8 + length;
  }
  assert.ok(json, `${relativePath} must contain GLB JSON`);
  return (json.meshes || []).flatMap(mesh => mesh.primitives || [])
    .map(primitive => String(json.materials?.[primitive.material]?.name || "").toLowerCase());
}

test("pickup and speedrun replays use the same launcher projectile colors", () => {
  const pickup = read("assets/js/replay-projectile-visuals.js");
  const speedrun = read("assets/js/speedrun-replay.js");

  for (const source of [pickup, speedrun]) {
    assert.match(
      source,
      /key:\s*"pipe-yellow",\s*classnames:\s*\["tf_gl_pipebomb"\][^\n]+pipebomb_yellow_variant/
    );
    assert.match(
      source,
      /key:\s*"pipe-blue",\s*classnames:\s*\["tf_gl_grenade"\][^\n]+pipebomb_blue_variant/
    );
  }
});

test("pickup replay cache key exposes the latest projectile classifier", () => {
  const module = read("assets/js/pickup-replay.js");
  assert.match(module, /replay-projectile-visuals\.js\?v=20260731blood1/);
});

test("shared pipebomb model cannot override launcher entity class", () => {
  const pickup = read("assets/js/replay-projectile-visuals.js");
  const speedrun = read("assets/js/speedrun-replay.js");

  assert.match(
    pickup,
    /definition\.classnames\.includes\(classname\)[\s\S]+model !== "models\/pipebomb\.mdl"/
  );
  assert.match(
    speedrun,
    /def\.classnames\.some\([\s\S]+model === "models\/pipebomb\.mdl"\) continue/
  );
});

test("yellow pipebomb GLB does not render the blue remap primitive", () => {
  const yellowMaterials = activeGlbMaterials("assets/models/pipebomb_yellow.glb");
  const blueMaterials = activeGlbMaterials("assets/models/pipebomb_blue.glb");

  assert.ok(yellowMaterials.includes("remap_pbomb.bmp"));
  assert.ok(!yellowMaterials.includes("remap_pbomb2.bmp"));
  assert.ok(blueMaterials.includes("remap_pbomb2.bmp"));
});
