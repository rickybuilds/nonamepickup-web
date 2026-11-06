"use strict";

const TIMED_DEFAULTS = Object.freeze({ platinum: 1.05, gold: 1.15, silver: 1.30, bronze: 1.60 });
const SCORED_DEFAULTS = Object.freeze({ platinum: 92, gold: 80, silver: 65, bronze: 50 });
const TIERS = Object.freeze(["platinum", "gold", "silver", "bronze"]);

function validateThresholds(thresholds, timed) {
  const values = TIERS.map(tier => thresholds?.[tier]);
  if (values.some(value => typeof value !== "number" || !Number.isFinite(value) || (timed ? value <= 0 : value < 0 || value > 100)) ||
      values.some((value, index) => index > 0 && (timed ? value < values[index - 1] : value > values[index - 1]))) {
    throw new RangeError("Invalid training tier thresholds");
  }
}

function timedTier(timeMs, referenceMs, thresholds = TIMED_DEFAULTS) {
  validateThresholds(thresholds, true);
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs <= 0 ||
      typeof referenceMs !== "number" || !Number.isFinite(referenceMs) || referenceMs <= 0) return null;
  return TIERS.find(tier => timeMs <= referenceMs * thresholds[tier]) ?? null;
}

function scoredTier(score, thresholds = SCORED_DEFAULTS) {
  validateThresholds(thresholds, false);
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) return null;
  return TIERS.find(tier => score >= thresholds[tier]) ?? null;
}

function scoredSetTier(scores, expectedCount, thresholds = SCORED_DEFAULTS) {
  validateThresholds(thresholds, false);
  if (!Number.isSafeInteger(expectedCount) || expectedCount <= 0 || !Array.isArray(scores) || scores.length !== expectedCount ||
      scores.some(score => typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100)) return null;
  return scoredTier(scores.reduce((sum, score) => sum + score, 0) / expectedCount, thresholds);
}

module.exports = { TIMED_DEFAULTS, SCORED_DEFAULTS, timedTier, scoredTier, scoredSetTier };
