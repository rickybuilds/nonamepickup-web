"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { BootcampReplayCache, bootcampReplayCacheKey } = require("../src/services/bootcampReplayCache");

async function withCache(run, options = {}) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bootcamp-replay-cache-"));
  const cache = new BootcampReplayCache(path.join(temporaryRoot, "private", "cache"), options);
  try { await run(cache, temporaryRoot); }
  finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
}

test("Bootcamp sidecar cache stores verified bytes and expires stale files", async () => {
  let now = Date.now();
  await withCache(async cache => {
    const key = "a".repeat(64), sidecar = Buffer.from("TFTR replay fixture");
    assert.equal(await cache.get(key), null);
    assert.equal(await cache.put(key, sidecar), true);
    assert.deepEqual(await cache.get(key), sidecar);
    const file = cache.filePath(key);
    const corrupt = await fs.readFile(file);
    corrupt[corrupt.length - 1] ^= 0xff;
    await fs.writeFile(file, corrupt);
    assert.equal(await cache.get(key), null);
    assert.equal(await cache.put(key, sidecar), true);
    now += 20_000;
    assert.equal(await cache.get(key), null);
  }, { maxAgeMs: 10_000, now: () => now });
});

test("Bootcamp cache keys bind a sidecar to its recording and current route geometry", () => {
  const record = { id: 4, run_id: 8, map: "openfire", route_id: 2, class_id: 5,
    config_version: 7, frame_interval: 1 / 30, tier_tag: 3, pos_frames: 2,
    proj_frames: 2, input_frames: 2, cmd_frames: 2, event_frames: 1,
    spool_pos_sha: "a", spool_proj_sha: "b", spool_input_sha: "c", spool_cmd_sha: "d", spool_event_sha: "e" };
  const key = bootcampReplayCacheKey(record);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(bootcampReplayCacheKey({ ...record }), key);
  assert.notEqual(bootcampReplayCacheKey({ ...record, config_version: 8 }), key);
  assert.notEqual(bootcampReplayCacheKey({ ...record, spool_pos_sha: "changed" }), key);
});

test("Bootcamp cache rejects unsafe keys, filesystem roots and public cache directories", async () => {
  await withCache(async (cache, root) => {
    await assert.rejects(cache.get("../outside"), /invalid_bootcamp_replay_cache_key/);
    const publicRoot = path.join(root, "public");
    const exposed = new BootcampReplayCache(path.join(publicRoot, "cache"), { publicRoot });
    await assert.rejects(exposed.ensureReady(), /unsafe_bootcamp_replay_cache_path/);
  });
  const unsafe = new BootcampReplayCache(path.parse(process.cwd()).root);
  await assert.rejects(unsafe.ensureReady(), /unsafe_bootcamp_replay_cache_path/);
});
