"use strict";

const { loadDefenseRatings } = require("../src/lib/defenseRatings");
const { DatabaseSync } = require("node:sqlite");
const assert = require("node:assert/strict");
const test = require("node:test");

test("defense metadata never promotes aggregate class time or isolated role events into class ratings", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE matches (match_id TEXT, map_name TEXT, status TEXT);
      CREATE TABLE match_player_classes (match_id TEXT, class_name TEXT, seconds INTEGER);
      CREATE TABLE match_role_events (match_id TEXT, class_name TEXT, role_value TEXT, game_time_seconds INTEGER);
      INSERT INTO matches VALUES ('done','well','completed'), ('active','well','active'), ('unknown','(unknown)','completed');
      INSERT INTO match_player_classes VALUES ('done','soldier',1200), ('done','engineer',1), ('active','soldier',1500);
      INSERT INTO match_role_events VALUES ('done','soldier','defense',10), ('done','engineer','defense',20);`);
    const result = loadDefenseRatings(db);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.classes.map(c => c.id), ["soldier", "demoman", "hwguy", "engineer"]);
    assert.deepEqual(result.maps, [{ map: "well", completedMatches: 1, games: null, baseline: null, players: [], observations: [], status: "unavailable" }]);
    assert.equal(result.eligibleAppearances, null); assert.equal(result.qualifyingPlayers, null);
    assert.equal(result.coverage.sources.find(s => s.id === "match_player_classes").rows, 3);
    assert.equal(result.coverage.sources.find(s => s.id === "match_role_events").completedMatchCount, 1);
    assert.ok(result.methodology.missing.some(s => /coverage/i.test(s)));
    assert.equal(result.coverage.sources.find(s => s.id === "match_cap_events").available, false);
  } finally { db.close(); }
});

test("defense empty and missing telemetry remain unavailable rather than zero-rated", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE matches (match_id TEXT, map_name TEXT, status TEXT)");
    const result = loadDefenseRatings(db);
    assert.deepEqual(result.maps, []);
    assert.equal(result.coverage.completedMatches, 0);
    assert.equal(result.methodology.baseline, "unavailable");
    assert.equal(result.eligibleAppearances, null);
    assert.ok(result.coverage.sources.every(s => s.rows === null));
  } finally { db.close(); }
});

test("defense endpoint preserves API envelope and unavailable contract for every class/filter", () => {
  const { createStatsRouter } = require("../src/routes/stats");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE matches (match_id TEXT, map_name TEXT, status TEXT); INSERT INTO matches VALUES ('m','well','completed')");
    const keys = [];
    const router = createStatsRouter({ db, cachedFor: (key, ttl, fn) => { keys.push(key); assert.equal(ttl, 300000); return fn(); }, sendError: () => assert.fail("unexpected API error"), logRouteError: (_, error) => { throw error; } });
    const handler = router.stack.find(layer => layer.route?.path === "/stats/defense-ratings").route.stack[0].handle;
    for (const classId of ["soldier", "demoman", "hwguy", "engineer", "invalid"]) {
      let response;
      handler({ query: { class: classId, map: "well", minimum: "5", sort: "defense" } }, { json(value) { response = value; } });
      assert.equal(response.ok, true); assert.equal(response.data.status, "unavailable");
      assert.equal(response.data.maps[0].baseline, null); assert.deepEqual(response.data.maps[0].players, []);
      assert.equal(response.data.classes.length, 4);
    }
    assert.ok(keys.every(key => key === "defense_ratings_foundation_v1"));
  } finally { db.close(); }
});

test("defense endpoint reports failures without leaking internal errors", () => {
  const { createStatsRouter } = require("../src/routes/stats");
  const logged = [], errors = [];
  const router = createStatsRouter({ db: {}, cachedFor: () => { throw new Error("private database path"); }, logRouteError: (...args) => logged.push(args), sendError: (_, code, message) => errors.push({ code, message }) });
  router.stack.find(layer => layer.route?.path === "/stats/defense-ratings").route.stack[0].handle({}, {});
  assert.deepEqual(errors, [{ code: 500, message: "defense_ratings_failed" }]);
  assert.equal(logged.length, 1);
});
