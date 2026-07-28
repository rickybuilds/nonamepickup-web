"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeMapName,
  normalizeClassId,
  parseTimeMs,
  deduplicateRecords
} = require("../src/externalBaseline/normalizer");
const {
  findMapPages,
  parseSquishyMapHtml
} = require("../src/externalBaseline/importers/squishy");
const {
  parseChurchOfConcHtml
} = require("../src/externalBaseline/importers/churchofconc");
const {
  ExternalRecordRepository
} = require("../src/externalBaseline/repository");

test("normalizes map names, TFC classes, and source time formats", () => {
  assert.equal(normalizeMapName(" Maps\\AOWCONC.BSP "), "aowconc");
  assert.equal(normalizeMapName("  The  Climb  "), "the_climb");
  assert.equal(normalizeClassId("HWGuy"), 6);
  assert.equal(normalizeClassId("Heavy Weapons Guy"), 6);
  assert.equal(normalizeClassId("Engineer"), 9);
  assert.equal(normalizeClassId("unknown"), null);
  assert.equal(parseTimeMs("40.9859"), 40_986);
  assert.equal(parseTimeMs("00:01:34"), 94_000);
  assert.equal(parseTimeMs("1:02.250"), 62_250);
  assert.equal(parseTimeMs("-"), null);
});

test("Squishy index and map parsers use semantic table headers", () => {
  const indexHtml = `
    <table><tr><td>Unrelated</td></tr></table>
    <table>
      <tr><th>Fastest (Seconds.microseconds)</th><th>Map</th></tr>
      <tr><td>40.9859</td><td><a href="/map/102/">AOWCONC</a></td></tr>
      <tr><td>-</td><td><a href="/map/999/">unfinished</a></td></tr>
    </table>`;
  assert.deepEqual(findMapPages(indexHtml), [{
    mapName: "AOWCONC",
    url: "http://squishysbatcave.com/map/102/"
  }]);

  const mapHtml = `
    <table>
      <tr>
        <td>Common Name</td><td>Class</td>
        <td>Fastest (Seconds.microseconds)</td><td>Steam ID</td>
      </tr>
      <tr><td>hello? pig pls</td><td>SOLDIER</td><td>40.9859</td><td>STEAM_0:1:1</td></tr>
      <tr><td>-</td><td>SNIPER</td><td>-</td><td>-</td></tr>
    </table>`;
  const records = parseSquishyMapHtml(mapHtml, findMapPages(indexHtml)[0]);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    source: "squishy",
    source_url: "http://squishysbatcave.com/map/102/",
    map_name_raw: "AOWCONC",
    map_name_normalized: "aowconc",
    class_name_raw: "SOLDIER",
    class_id: 3,
    player_name: "hello? pig pls",
    time_raw: "40.9859",
    time_ms: 40_986
  });
});

test("Church parser finds reordered record columns and deduplicates snapshots", () => {
  const html = `
    <table>
      <tr><th>Runtime</th><th>Class</th><th>Nickname</th><th>Map</th></tr>
      <tr><td>00:01:34</td><td>Scout</td><td>Reni</td><td>&nbsp;anticonc</td></tr>
    </table>
    <table>
      <tr><th>Map</th><th>Nickname</th><th>Class</th><th>Runtime</th></tr>
      <tr><td>anticonc</td><td>Older</td><td>Scout</td><td>00:01:40</td></tr>
    </table>`;
  const parsed = parseChurchOfConcHtml(html);
  const records = deduplicateRecords(parsed);
  assert.equal(parsed.length, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].player_name, "Reni");
  assert.equal(records[0].time_ms, 94_000);
});

test("repository resolves maps and reports insert, update, and failure outcomes", async () => {
  const existingRows = [{
    source: "churchofconc",
    source_url: "old",
    map_name_raw: "AOWCONC",
    map_name_normalized: "aowconc",
    map_id: "aowconc",
    class_name_raw: "Scout",
    class_id: 1,
    player_name: "Old",
    time_raw: "00:01:10",
    time_ms: 70_000
  }];
  const executed = [];
  const pool = {
    async query(sql) {
      if (sql.includes("SELECT 1")) return [[{ ok: 1 }]];
      if (sql.includes("CREATE TABLE")) return [{ affectedRows: 0 }];
      if (sql.includes("SELECT map FROM speedrun_maps")) return [[{ map: "aowconc" }]];
      if (sql.includes("FROM speedrun_external_records")) return [existingRows];
      throw new Error(`unexpected query: ${sql}`);
    },
    async execute(_sql, params) {
      executed.push(params);
      if (params[3] === "broken") throw new Error("row rejected");
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new ExternalRecordRepository(pool, { logger: { error() {}, warn() {} } });
  await repository.initialize();
  const base = {
    source: "churchofconc",
    source_url: "new",
    map_name_raw: "AOWCONC",
    map_name_normalized: "aowconc",
    class_name_raw: "Scout",
    class_id: 1,
    player_name: "Reni",
    time_raw: "00:01:05",
    time_ms: 65_000
  };
  const records = [
    base,
    { ...base, source: "squishy", source_url: "map-url" },
    { ...base, map_name_raw: "Broken", map_name_normalized: "broken", class_id: 3 }
  ];
  const summary = await repository.upsert(records);
  assert.deepEqual(summary, {
    processed: 3,
    inserted: 1,
    updated: 1,
    unchanged: 0,
    failed: 1
  });
  assert.equal(executed[0][4], "aowconc");
  assert.equal(executed[2][4], null);
});
