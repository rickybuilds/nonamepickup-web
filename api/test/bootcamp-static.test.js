"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const { registerStaticFiles } = require("../src/middleware/staticFiles");

test("the Bootcamp hub opens a profile from the Steam-ID deep link", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "../../assets/js/bootcamp-hub.js"), "utf8");
  assert.match(script, /new URLSearchParams\(location\.search\)/);
  assert.match(script, /get\("steamid"\)/);
  assert.match(script, /profileForm\.requestSubmit\(\)/);
});

test("Bootcamp page and assets are disabled by default", async () => {
  const old = process.env.BOOTCAMP_API_ENABLED;
  delete process.env.BOOTCAMP_API_ENABLED;
  const app = express();
  registerStaticFiles(app, path.resolve(__dirname, "../.."));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + "/index.html")).status, 200);
    for (const file of ["/bootcamp.html", "/bootcamp-review.html", "/BOOTCAMP.HTML", "/bootcamp%2ehtml", "/assets/js/bootcamp-hub.js", "/assets/css/bootcamp-hub.css", "/assets/js/bootcamp-review.js", "/assets/css/bootcamp-review.css"]) {
      assert.equal((await fetch(base + file)).status, 404);
    }
    process.env.BOOTCAMP_API_ENABLED = "true";
    for (const file of ["/bootcamp.html", "/bootcamp-review.html", "/assets/js/bootcamp-hub.js", "/assets/css/bootcamp-hub.css", "/assets/js/bootcamp-review.js", "/assets/css/bootcamp-review.css"]) {
      assert.equal((await fetch(base + file)).status, 200);
    }
  } finally {
    if (old === undefined) delete process.env.BOOTCAMP_API_ENABLED;
    else process.env.BOOTCAMP_API_ENABLED = old;
    await new Promise(resolve => server.close(resolve));
  }
});
