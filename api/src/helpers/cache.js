"use strict";

const _cache = new Map();
const CACHE_TTL = 10 * 1000;
const CACHE_MAX_ENTRIES = 500;

function pruneCache(now = Date.now()) {
  for (const [key, entry] of _cache) {
    if (now >= entry.expiresAt) _cache.delete(key);
  }

  while (_cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = _cache.keys().next().value;
    if (oldestKey === undefined) break;
    _cache.delete(oldestKey);
  }
}

function cached(key, fn) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && (now - hit.ts) < CACHE_TTL) return hit.val;
  if (hit) _cache.delete(key);
  const val = fn();
  pruneCache(now);
  _cache.set(key, {
    val,
    ts: now,
    expiresAt: now + CACHE_TTL
  });
  return val;
}

function cachedFor(key, ttl, fn) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && (now - hit.ts) < ttl) return hit.val;
  if (hit) _cache.delete(key);
  const val = fn();
  pruneCache(now);
  _cache.set(key, {
    val,
    ts: now,
    expiresAt: now + ttl
  });
  return val;
}

function invalidateCache() {
  _cache.clear();
}

module.exports = { cached, cachedFor, invalidateCache };
