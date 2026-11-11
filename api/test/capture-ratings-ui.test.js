"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../assets/js/capture-ratings.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../../analytics.html"), "utf8");
class Element {
  constructor() { this.value = ""; this.dataset = {}; this.children = []; this.events = {}; this.attributes = {}; this.classList = { toggle() {} }; this.hidden = true; }
  addEventListener(name, fn) { this.events[name] = fn; }
  setAttribute(name, value) { this.attributes[name] = value; }
  replaceChildren(...children) { this.children = children; if (children.length && !children.some(c => c.value === this.value)) this.value = children[0].value; }
  appendChild(child) { this.children.push(child); }
  add(child) { this.appendChild(child); }
  querySelector() { return this.button; }
  fire(name) { this.events[name]?.({ target: { closest: () => null } }); }
}
async function dashboard(data) {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  el("capture-minimum").value = html.match(/<select id="capture-minimum">\s*<option value="(\d+)"/)[1]; el("capture-sort").value = "offense";
  const sorts = ["player", "games", "scored", "offense", "conceded", "defense", "net"].map(key => { const e = new Element(); e.dataset.captureSort = key; e.button = new Element(); return e; });
  const views = ["overview", "players", "trends", "distribution"].map(view => { const e = new Element(); e.dataset.captureView = view; return e; });
  let ready;
  const document = { addEventListener: (_, fn) => { ready = fn; }, getElementById: el, createElement: () => new Element(), querySelectorAll(selector) { if (selector === '[data-capture-sort]') return sorts; if (selector === '[data-capture-view]') return views; return el("capture-rows").children; }, querySelector(selector) { return sorts.find(e => selector.includes(`"${e.dataset.captureSort}"`)).button; } };
  vm.runInNewContext(source, { document, window: { nnHelpers: { fetchJSON: async () => ({ ok: true, data }) } }, Option: function(text, value) { this.text = text; this.value = value; }, console });
  await ready();
  return { el: id => el(`capture-${id}`), sorts, views, ids: () => el("capture-rows").children.map(row => row.dataset.player) };
}
const player = (id, games, offense, defense) => ({ id, player: id === "a/b" ? "Alpha <Ace>" : id, games, offense, defense, scored: 4 + offense, conceded: 4 - defense });
const maps = [{ map: "well", games: 8, average: 4, players: [player("a/b", 5, 2, -1), player("Bravo", 8, -1, 4), player("short", 4, 5, 5)], observations: [{ matchId: "later", createdAt: 200, blueCaps: 6, redCaps: 2 }, { matchId: "early", createdAt: 100, blueCaps: 0, redCaps: 8 }, { matchId: "undated", createdAt: null, blueCaps: 0, redCaps: 0 }] }, { map: "empty", games: 1, average: 0, players: [], observations: [] }];

test("dashboard filters minimum games, sorts both directions, computes net and escapes profile links", async () => {
  const ui = await dashboard(maps);
  assert.equal(ui.el("minimum").value, "5");
  assert.deepEqual(ui.ids(), ["a/b", "Bravo"]);
  assert.match(ui.el("rows").children[0].innerHTML, /player.html\?id=a%2Fb/);
  assert.match(ui.el("rows").children[0].innerHTML, /Alpha &lt;Ace&gt;/);
  const net = ui.sorts.find(e => e.dataset.captureSort === "net");
  net.button.fire("click"); assert.deepEqual(ui.ids(), ["Bravo", "a/b"]); assert.equal(net.attributes["aria-sort"], "descending");
  assert.match(ui.el("rows").children[0].innerHTML, /\+3.00/);
  net.button.fire("click"); assert.deepEqual(ui.ids(), ["a/b", "Bravo"]); assert.equal(net.attributes["aria-sort"], "ascending");
  ui.el("minimum").value = "8"; ui.el("minimum").fire("change"); assert.deepEqual(ui.ids(), ["Bravo"]);
});

test("dashboard views retain filters and map changes expose genuine empty states", async () => {
  const ui = await dashboard(maps);
  ui.el("minimum").value = "8"; ui.el("minimum").fire("change");
  ui.views.find(e => e.dataset.captureView === "trends").fire("click");
  assert.equal(ui.el("leaderboard").hidden, true); assert.equal(ui.el("trends-panel").hidden, false);
  assert.equal(ui.el("minimum").value, "8"); assert.equal(ui.el("map").value, "well");
  ui.views.find(e => e.dataset.captureView === "players").fire("click"); assert.equal(ui.el("leaderboard").hidden, false); assert.deepEqual(ui.ids(), ["Bravo"]);
  ui.el("map").value = "empty"; ui.el("map").fire("change"); assert.deepEqual(ui.ids(), []); assert.equal(ui.el("empty").hidden, false);
  assert.match(ui.el("trend").innerHTML, /unavailable/); assert.match(ui.el("distribution").innerHTML, /unavailable/);
  const none = await dashboard([]); assert.match(none.el("summary").textContent, /No matches/);
});

test("charts count actual team games and order only dated match observations", async () => {
  const ui = await dashboard(maps);
  assert.match(ui.el("distribution").innerHTML, /across 6 team games/);
  assert.match(ui.el("distribution").innerHTML, /0–1 captures: 3 team games \(50.0%\)/);
  const trend = ui.el("trend").innerHTML;
  assert.ok(trend.indexOf("Match early") < trend.indexOf("Match later"));
  assert.doesNotMatch(trend, /Match undated/);
  assert.match(trend, /Map baseline: 4.00/);
});
