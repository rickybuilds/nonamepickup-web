"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("replay paths and compatibility isolate Bootcamp from speedrun data", async () => {
  const { replayRunPath, bootcampRunsCompatible } = await import(pathToFileURL(path.join(__dirname, "../../assets/js/replay-context.mjs")).href);
  assert.equal(replayRunPath(12, "bootcamp"), "/api/bootcamp/replay/run/12");
  assert.equal(replayRunPath(12, "speedrun"), "/api/speedruns/replay/run/12");
  assert.throws(() => replayRunPath("../12", "bootcamp"));
  const a = { source: "bootcamp", map: "openfire", classId: 5, routeId: 4, configVersion: 2 };
  assert.equal(bootcampRunsCompatible(a, { ...a }), true);
  for (const change of [{ routeId: 5 }, { configVersion: 3 }, { classId: 1 }, { map: "other" }, { source: "speedrun" }])
    assert.equal(bootcampRunsCompatible(a, { ...a, ...change }), false);
  assert.equal(bootcampRunsCompatible({ ...a, configVersion: null }, a), false);
});
