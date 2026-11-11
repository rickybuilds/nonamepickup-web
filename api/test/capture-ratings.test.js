"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createStatsRouter } = require("../src/routes/stats");

function payload(matches, stats) {
  const db = { prepare(sql) { return { all() {
    if (sql.includes("FROM match_player_stats s")) return stats;
    if (sql.includes("FROM ratings")) return [{ player_id: "a", display_name: "Alpha" }];
    if (sql.includes("FROM matches")) return matches;
    throw new Error(sql);
  } }; } };
  const router = createStatsRouter({ db, cached: (key, fn) => fn(), sendError: () => assert.fail("API error"), logRouteError: (_, error) => { throw error; } });
  let result;
  router.stack.find(layer => layer.route?.path === "/stats/capture-ratings").route.stack[0].handle({}, { json(value) { result = value; } });
  return result.data;
}
const match = (id, createdAt = 100, map = "well") => ({ match_id: id, created_at: createdAt, map_name: map, blue_ids: '["a"]', red_ids: '["b"]' });
const row = (matchId, id, captures) => ({ match_id: matchId, player_key: id, flag_captures: captures });

test("capture API preserves team-game baseline, ratings, and chronological real observations", () => {
  const [map] = payload([match("later", 200), match("earlier", 100)], [row("later", "a", 8), row("later", "b", 2), row("earlier", "a", 4), row("earlier", "b", 2)]);
  assert.equal(map.games, 2);
  assert.equal(map.average, 4);
  assert.deepEqual(map.observations, [{ matchId: "earlier", createdAt: 100, blueCaps: 4, redCaps: 2 }, { matchId: "later", createdAt: 200, blueCaps: 8, redCaps: 2 }]);
  assert.deepEqual(map.players[0], { id: "a", player: "Alpha", games: 2, scored: 6, conceded: 2, offense: 2, defense: 2, net: 4 });
  assert.equal(map.players[1].offense, -2);
  assert.equal(map.players[1].defense, -2);
  assert.equal(map.players[1].net, -4);
});

test("capture API excludes incomplete, duplicate, ambiguous, invalid and overlapping rosters", () => {
  const ids = ["missing", "null", "negative", "fraction", "duplicate", "ambiguous", "overlap", "badjson"];
  const matches = ids.map(id => match(id));
  matches[6].red_ids = '["a"]';
  matches[7].blue_ids = "{";
  const stats = ids.flatMap(id => [row(id, "a", 1), row(id, "b", 0)]);
  stats.splice(stats.findIndex(r => r.match_id === "missing" && r.player_key === "b"), 1);
  stats.find(r => r.match_id === "null").flag_captures = null;
  stats.find(r => r.match_id === "negative").flag_captures = -1;
  stats.find(r => r.match_id === "fraction").flag_captures = 0.5;
  stats.push(row("duplicate", "a", 1));
  stats.find(r => r.match_id === "ambiguous").key_id = "b";
  assert.deepEqual(payload(matches, stats), []);
});

test("capture API retains genuine zero captures and separates maps without weighting by roster size", () => {
  const wide = match("wide", 200); wide.blue_ids = '["a","c"]';
  const maps = payload([wide, match("zero", null, "zero")], [row("wide", "a", 3), row("wide", "c", 5), row("wide", "b", 2), row("zero", "a", 0), row("zero", "b", 0)]);
  const zero = maps.find(m => m.map === "zero");
  assert.equal(zero.average, 0);
  assert.equal(zero.players[0].net, 0);
  assert.equal(zero.observations[0].createdAt, null);
  assert.equal(maps.find(m => m.map === "well").average, 5);
  assert.deepEqual(payload([], []), []);
});

test("capture SQL excludes unfinished/unknown maps and resolves Steam roster identities", () => {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE matches (match_id TEXT, created_at INTEGER, map_name TEXT, blue_ids TEXT, red_ids TEXT, status TEXT);
      CREATE TABLE match_player_stats (match_id TEXT, player_key TEXT, steam_id TEXT, flag_captures INTEGER);
      CREATE TABLE player_steam_ids (steam_id TEXT, discord_id TEXT);
      CREATE TABLE ratings (player_id TEXT, display_name TEXT);
      INSERT INTO player_steam_ids VALUES ('steam-a', 'a'), ('steam-b', 'b');
      INSERT INTO ratings VALUES ('a', 'Alpha');
    `);
    for (const [id, status, mapName] of [["good", "completed", "well"], ["active", "active", "well"], ["unknown", "completed", "(unknown)"], ["blank", "completed", "  "], ["null", "completed", null]]) {
      db.prepare("INSERT INTO matches VALUES (?, 100, ?, ?, ?, ?)").run(id, mapName, '["a"]', '["b"]', status);
      db.prepare("INSERT INTO match_player_stats VALUES (?, ?, ?, ?)").run(id, "steam-a", "steam-a", 6);
      db.prepare("INSERT INTO match_player_stats VALUES (?, ?, ?, ?)").run(id, "steam-b", "steam-b", 2);
    }
    const router = createStatsRouter({ db, cached: (_, fn) => fn(), sendError: () => assert.fail("API error"), logRouteError: (_, error) => { throw error; } });
    let result;
    router.stack.find(layer => layer.route?.path === "/stats/capture-ratings").route.stack[0].handle({}, { json(value) { result = value; } });
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].games, 1);
    assert.equal(result.data[0].average, 4);
    assert.equal(result.data[0].players[0].player, "Alpha");
    assert.deepEqual(result.data[0].observations, [{ matchId: "good", createdAt: 100, blueCaps: 6, redCaps: 2 }]);
  } finally { db.close(); }
});
