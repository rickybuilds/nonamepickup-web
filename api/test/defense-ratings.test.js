"use strict";

const { loadDefenseRatings } = require("../src/lib/defenseRatings");
const { DatabaseSync } = require("node:sqlite");
const assert = require("node:assert/strict");
const test = require("node:test");

test('shared ratings names use Discord display names rather than game aliases',()=>{
  const {loadDiscordDisplayNames}=require('../src/lib/discordDisplayNames');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE ratings(player_id TEXT,display_name TEXT);
      CREATE TABLE discord_names(discord_id TEXT,display_name TEXT,global_name TEXT,username TEXT);
      INSERT INTO ratings VALUES ('1','Cached Discord'),('2','Fallback Discord');
      INSERT INTO discord_names VALUES ('1','Server Display','Global Name','username');`);
    const names=loadDiscordDisplayNames(db);assert.equal(names.get('1'),'Server Display');assert.equal(names.get('2'),'Fallback Discord');
  }finally{db.close();}
});

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

test("defense ratings use linked round role and class data as clearly labeled estimates", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE matches (match_id TEXT, map_name TEXT, status TEXT, created_at INTEGER);
      CREATE TABLE match_player_classes (match_id TEXT, player_key TEXT, round_num INTEGER, class_name TEXT, seconds INTEGER);
      CREATE TABLE match_player_round_stats (match_id TEXT, player_key TEXT, display_name TEXT, round_num INTEGER, team_name TEXT, role TEXT, flag_captures INTEGER);
      CREATE TABLE match_rounds (match_id TEXT, round_num INTEGER, duration_seconds INTEGER, team1_score INTEGER, team2_score INTEGER, offense_team TEXT, defense_team TEXT);
      CREATE TABLE player_steam_ids (steam_id TEXT, discord_id TEXT);
      CREATE TABLE ratings (player_id TEXT,display_name TEXT);
      CREATE TABLE discord_names (discord_id TEXT,display_name TEXT,global_name TEXT,username TEXT);
      INSERT INTO matches VALUES ('m','phantom_lg','completed',1);
      INSERT INTO player_steam_ids VALUES ('STEAM_TEST','123');
      INSERT INTO ratings VALUES ('123','Cached Alice');
      INSERT INTO discord_names VALUES ('123','Discord Alice','Global Alice','alice');
      INSERT INTO match_rounds VALUES ('m',1,900,70,20,'Team A','Team B');
      INSERT INTO match_player_round_stats VALUES ('m','STEAM_TEST','Alice',1,'Team B','Soldier',0),('m','OFFENSE','Bob',1,'Team A','Medic',7);
      INSERT INTO match_player_classes VALUES ('m','STEAM_TEST',1,'soldier',800),('m','STEAM_TEST',1,'medic',20);`);
    const result=loadDefenseRatings(db); const map=result.maps[0]; const soldier=map.classes.soldier;
    assert.equal(result.status,'estimated'); assert.equal(soldier.status,'estimated'); assert.equal(soldier.games,1);
    assert.equal(soldier.baseline,7); assert.equal(soldier.players[0].player,'Discord Alice'); assert.equal(soldier.players[0].profileId,'123'); assert.equal(soldier.players[0].defense,0);
    assert.equal(soldier.players[0].estimated,true); assert.equal(result.methodology.threshold.dominantClass,.7);
    assert.deepEqual(soldier.observations[0].playerIds,['STEAM_TEST']);
    for(const className of ['demoman','hwguy','engineer','soldier']) {
      db.prepare("UPDATE match_player_round_stats SET role=? WHERE player_key='STEAM_TEST'").run(className);
      db.prepare("UPDATE match_player_classes SET class_name=? WHERE player_key='STEAM_TEST' AND class_name!='medic'").run(className);
      assert.equal(loadDefenseRatings(db).maps[0].classes[className].players[0].games,1);
    }
    // A second defender shares the outcome; it must not double-weight the baseline.
    db.exec(`INSERT INTO player_steam_ids VALUES ('SECOND','456');
      INSERT INTO match_player_round_stats VALUES ('m','SECOND','Second',1,'Team B','Soldier',0);
      INSERT INTO match_player_classes VALUES ('m','SECOND',1,'soldier',900);`);
    const shared=loadDefenseRatings(db).maps[0].classes.soldier;
    assert.equal(shared.games,1);assert.equal(shared.baseline,7);assert.equal(shared.players.length,2);
    assert.equal(shared.observations[0].playerIds.length,2);
    db.exec("UPDATE match_player_classes SET seconds=1000 WHERE player_key='SECOND'");
    assert.equal(loadDefenseRatings(db).coverage.exclusions.invalidDuration,1);
    db.exec("UPDATE match_player_classes SET seconds=700 WHERE player_key='SECOND'; INSERT INTO match_player_classes VALUES ('m','SECOND',1,'medic',200)");
    assert.equal(loadDefenseRatings(db).coverage.exclusions.suspiciousClass,1);
    db.exec("UPDATE match_player_round_stats SET flag_captures=NULL WHERE player_key='OFFENSE'");
    assert.equal(loadDefenseRatings(db).status,'unavailable');
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
    assert.ok(keys.every(key => key === "defense_ratings_estimated_v3"));
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
