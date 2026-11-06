"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { timedTier, scoredTier, scoredSetTier } = require("../src/training/tiers");

test("timed tiers use inclusive fixed-reference thresholds", () => {
  for (const [time, tier] of [[10500, "platinum"], [10501, "gold"], [11500, "gold"], [13000, "silver"], [16000, "bronze"], [16001, null]]) {
    assert.equal(timedTier(time, 10000), tier);
  }
});

test("scored tiers use inclusive thresholds and reject invalid inputs", () => {
  for (const [score, tier] of [[92, "platinum"], [91, "gold"], [80, "gold"], [65, "silver"], [50, "bronze"], [49, null]]) {
    assert.equal(scoredTier(score), tier);
  }
  for (const value of [null, -1, 101, NaN, Infinity, "65"]) assert.equal(scoredTier(value), null);
  for (const value of [null, 0, -1, NaN, Infinity, "10000"]) {
    assert.equal(timedTier(value, 10000), null);
    assert.equal(timedTier(10000, value), null);
  }
});

test("route and drill thresholds can be customized and malformed thresholds fail closed", () => {
  assert.equal(timedTier(12000, 10000, { platinum: 1, gold: 1.1, silver: 1.2, bronze: 1.4 }), "silver");
  assert.equal(scoredTier(70, { platinum: 95, gold: 85, silver: 70, bronze: 40 }), "silver");
  assert.throws(() => timedTier(10000, 10000, { platinum: 1.1, gold: 1, silver: 1.3, bronze: 1.6 }), RangeError);
  assert.throws(() => scoredTier(70, { platinum: 92, gold: 80, silver: 65 }), RangeError);
});

test("randomized drills award tiers only for a complete set's average", () => {
  assert.equal(scoredSetTier([100, 30], 2), "silver");
  assert.equal(scoredSetTier([100], 2), null);
  assert.equal(scoredSetTier([100, 90, 80], 2), null);
  assert.equal(scoredSetTier([100, NaN], 2), null);
  assert.equal(scoredSetTier([], 0), null);
  assert.equal(scoredSetTier([100, 80], 2, { platinum: 95, gold: 90, silver: 70, bronze: 40 }), "gold");
});
