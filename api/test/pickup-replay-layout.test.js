const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "pickup-replay.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "css", "pickup-replay.css"), "utf8");
const source = fs.readFileSync(path.join(root, "assets", "js", "pickup-replay.js"), "utf8");

test("pickup replay uses one bottom dock for playback and team rosters", () => {
  assert.match(html, /class="pickup-bottom-hud"[\s\S]*class="replay-controls pickup-controls"[\s\S]*class="pickup-roster-panel"/);
  assert.match(css, /\.pickup-bottom-hud \{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.pickup-team-players \{[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(source, /group\.className = "pickup-team-group"/);
  assert.match(source, /players\.className = "pickup-team-players"/);
});

test("playback buttons stack beside a timeline with three speeds below", () => {
  assert.match(html, /class="pickup-control-stack"[\s\S]*replay-play[\s\S]*replay-restart[\s\S]*replay-camera[\s\S]*replay-effects/);
  assert.deepEqual([...html.matchAll(/data-speed="([^"]+)"/g)].map(match => match[1]), ["0.5", "1", "4"]);
  assert.match(css, /\.pickup-control-stack \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.pickup-timeline-controls \{[\s\S]*grid-template-rows: 1fr auto/);
});

test("one effects button controls projectiles and objectives together", () => {
  assert.doesNotMatch(html, /id="replay-projectiles"|id="replay-objectives"/);
  assert.match(source, /\$\("replay-effects"\)\.addEventListener/);
  assert.match(source, /state\.showProjectiles = enabled;\s+state\.showObjectives = enabled/);
});

test("selected player is centered near the top and event feed stays compact", () => {
  assert.match(css, /\.pickup-selected-player \{[\s\S]*left: 50%;[\s\S]*top: 8\.4rem/);
  assert.match(css, /\.pickup-event-panel \{[\s\S]*width: 17rem/);
});
