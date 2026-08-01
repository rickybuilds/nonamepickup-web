const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "assets", "js", "pickup-replay.js"),
  "utf8"
);

test("carried objectives mount to the player's back instead of above their head", () => {
  assert.match(source, /const CARRIED_OBJECTIVE_BACK_OFFSET = 10/);
  assert.match(source, /const CARRIED_OBJECTIVE_STAND_HEIGHT = -18/);
  assert.match(source, /const CARRIED_OBJECTIVE_CROUCH_HEIGHT = -8/);
  assert.match(source, /position\.addScaledVector\(forward, -CARRIED_OBJECTIVE_BACK_OFFSET\)/);
  assert.doesNotMatch(source, /carrierFrame\.z \+ 48/);
});

test("carried objectives follow authoritative carrier body yaw and crouch state", () => {
  assert.match(source, /frame\.schemaVersion >= 3 \? frame\.bodyYaw : frame\.yaw/);
  assert.match(source, /isDucking\(frame\)[\s\S]*CARRIED_OBJECTIVE_CROUCH_HEIGHT/);
  assert.match(source, /yaw: bodyYaw \+ Math\.PI \/ 2/);
  assert.match(source, /const pose = carriedObjectivePose\(carrierFrame\)/);
  assert.match(source, /track\.mesh\.rotation\.y = pose\.yaw/);
});
