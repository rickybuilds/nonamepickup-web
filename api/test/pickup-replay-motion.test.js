const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "assets", "js", "pickup-replay.js"),
  "utf8"
);

test("pickup replay drives a continuous lower-body shader from traveled distance", () => {
  assert.match(source, /function installPlayerMotionShader\(material, motion\)/);
  assert.match(source, /replaySidePhase = replayPhase/);
  assert.match(source, /replayHipAngle = replayStride/);
  assert.match(source, /replayKneeAngle = -max/);
  assert.match(source, /distance \/ PLAYER_STRIDE_LENGTH/);
  assert.match(source, /1 - Math\.exp\(-elapsed \* PLAYER_MOTION_RESPONSE\)/);
  assert.match(source, /child\.material = child\.material\.clone\(\)/);
});

test("pickup replay tucks legs for recorded jumps and velocity-detected bhops", () => {
  assert.match(source, /frame\.sequence === 8 \|\| frame\.sequence === 9/);
  assert.match(source, /frame\.gaitsequence === 8 \|\| frame\.gaitsequence === 9/);
  assert.match(source, /Math\.abs\(frame\.vz\) > 32/);
  assert.match(source, /PLAYER_AIR_HOLD_SECONDS/);
  assert.match(source, /replayHipAngle = .*1\.02 \* replayTuck/);
  assert.match(source, /replayKneeAngle = .*1\.28 \* replayTuck/);
  assert.match(source, /updatePlayerMotion\(track, frame, crouched\)/);
});

test("player motion state resets deterministically after a seek", () => {
  assert.match(source, /const continuous = elapsed >= 0 && elapsed <= 0\.25/);
  assert.match(source, /track\.motionPhase = \(state\.playbackTime \* Math\.max\(horizontalSpeed, 80\)/);
  assert.match(source, /track\.motionLastTime = state\.playbackTime/);
});
