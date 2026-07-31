const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

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
  assert.match(module, /replay-projectile-visuals\.js\?v=20260730pickup6/);
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
