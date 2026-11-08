"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { recomputeBootcampLicense } = require("../src/services/bootcampLicenseStore");

function fixtureConnection() {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push({ sql: "BEGIN" }); },
    async commit() { calls.push({ sql: "COMMIT" }); },
    async rollback() { calls.push({ sql: "ROLLBACK" }); },
    release() { calls.push({ sql: "RELEASE" }); },
    async execute(sql, args = []) {
      calls.push({ sql, args });
      if (/SELECT level, endorsements, granted_at/i.test(sql)) return [[{ level: "none", endorsements: "", granted_at: null }], []];
      if (/SELECT id, map, slug, kind, class_id FROM bootcamp_drills/i.test(sql)) return [[{ id: 9, map: "2fort", slug: "tour_quiz", kind: "tour", class_id: 0 }], []];
      if (/SELECT id, map, slug, type, class_id FROM bootcamp_routes/i.test(sql)) return [[], []];
      if (/SELECT map, rotation_order FROM bootcamp_maps/i.test(sql)) return [[{ map: "2fort", rotation_order: 1 }], []];
      if (/SELECT target_type, target_id, class_id, tier FROM bootcamp_tiers/i.test(sql)) return [[{ target_type: "drill", target_id: 9, class_id: 5, tier: 1 }], []];
      if (/SELECT player_name FROM bootcamp_events/i.test(sql)) return [[{ player_name: "Runner" }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  return { connection, calls };
}

test("license recompute commits a new permit and exactly one rising event", async () => {
  const { connection, calls } = fixtureConnection();
  const result = await recomputeBootcampLicense(connection, "STEAM_0:1:4");
  assert.equal(result.license.level, "permit");
  assert.deepEqual(result.license.endorsements, []);
  assert.ok(result.license.progress.some(item => item.includes("live-target")));
  assert.equal(result.changed, true);
  assert.equal(calls[0].sql, "BEGIN");
  assert.ok(calls.some(call => /UPDATE bootcamp_licenses/i.test(call.sql)));
  assert.ok(calls.some(call => /INSERT INTO bootcamp_events/i.test(call.sql)));
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("license recompute rolls back on a storage failure", async () => {
  const { connection, calls } = fixtureConnection();
  connection.execute = async (sql, args = []) => {
    calls.push({ sql, args });
    if (/INSERT IGNORE INTO bootcamp_licenses/i.test(sql)) throw new Error("database write failed");
    return [[], []];
  };
  await assert.rejects(recomputeBootcampLicense(connection, "STEAM_0:1:4"), /database write failed/);
  assert.ok(calls.some(call => call.sql === "ROLLBACK"));
  assert.notEqual(calls.at(-1).sql, "COMMIT");
});
