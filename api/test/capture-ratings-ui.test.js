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
  el("capture-established").checked = false;
  el("capture-trend-raw").checked = true;
  el("capture-trend-rolling").checked = true;
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

test("charts count actual team games and label incomplete timestamps with deterministic match ordering", async () => {
  const ui = await dashboard(maps);
  assert.match(ui.el("distribution").innerHTML, /across 6 team games/);
  assert.match(ui.el("distribution").innerHTML, /0–1 captures: 3 team games \(50.0%\)/);
  const trend = ui.el("trend").innerHTML;
  assert.ok(trend.indexOf("Match early") < trend.indexOf("Match later"));
  assert.match(trend, /Match undated · date unavailable/);
  assert.match(ui.el("trend-order").textContent, /Match ID order/);
  assert.match(trend, /Map baseline: 4.00/);
});

test("sample tier boundaries, established filter and full-population KPIs respect eligibility", async () => {
  const tiers = [player("five", 5, 1, 0), player("nine", 9, 2, 0), player("ten", 10, 3, 0), player("twentyfour", 24, 4, 0), player("twentyfive", 25, 5, 0), player("fortynine", 49, 6, 0), player("fifty", 50, 7, 0), player("ineligible", 4, 99, 99)];
  const ui = await dashboard([{ ...maps[0], players: tiers }]);
  for (const [id, tier] of [["five", "limited"], ["nine", "limited"], ["ten", "developing"], ["twentyfour", "developing"], ["twentyfive", "established"], ["fortynine", "established"], ["fifty", "extensive"]]) assert.match(ui.el("rows").children.find(r => r.dataset.player === id).innerHTML, new RegExp(`data-sample="${tier}"`));
  assert.doesNotMatch(ui.el("kpis").innerHTML, /ineligible/);
  assert.match(ui.el("kpis").innerHTML, /fifty/);
  ui.el("established").checked = true; ui.el("established").fire("change");
  assert.deepEqual(ui.ids(), ["fifty", "fortynine", "twentyfive"]);
  ui.el("minimum").value = "50"; ui.el("minimum").fire("change"); assert.deepEqual(ui.ids(), ["fifty"]);
  ui.el("minimum").value = "100"; ui.el("minimum").fire("change"); assert.deepEqual(ui.ids(), []); assert.equal(ui.el("empty").hidden, false);
});

test("row and selector inspection update spotlight and ranks independently of table sort", async () => {
  const ui = await dashboard([{ ...maps[0], players: [player("Alpha", 10, 2, 0), player("Bravo", 25, 1, 3), player("Charlie", 50, 2, 1)] }]);
  ui.el("rows").children.find(r => r.dataset.player === "Bravo").fire("click");
  assert.equal(ui.el("player").value, "Bravo");
  assert.match(ui.el("equations").innerHTML, /player.html\?id=Bravo/);
  assert.match(ui.el("equations").innerHTML, /25/);
  assert.match(ui.el("equations").innerHTML, /\+4.00/);
  assert.match(ui.el("equations").innerHTML, /Rank #3 of 3/);
  assert.match(ui.el("equations").innerHTML, /Rank #1 of 3/);
  const spotlight = ui.el("equations").innerHTML;
  ui.sorts.find(e => e.dataset.captureSort === "games").button.fire("click");
  assert.deepEqual(ui.ids(), ["Charlie", "Bravo", "Alpha"]);
  assert.equal(ui.el("equations").innerHTML, spotlight);
  ui.el("player").value = "Alpha"; ui.el("player").fire("change");
  assert.match(ui.el("equations").innerHTML, /player.html\?id=Alpha/);
  assert.match(ui.el("equations").innerHTML, /Offense<\/span>.*?Rank #1 of 3/);
  ui.el("established").checked = true; ui.el("established").fire("change");
  assert.equal(ui.el("player").value, "Charlie");
  assert.match(ui.el("equations").innerHTML, /Rank #1 of 2/);
});

test("rolling average uses trailing five actual match means and chart visibility toggles", async () => {
  const observations = [1, 2, 3, 4, 5, 6].map((mean, i) => ({ matchId: String(i + 1), createdAt: 100 + i, blueCaps: mean * 2, redCaps: 0 }));
  const ui = await dashboard([{ ...maps[0], observations: [...observations].reverse() }]);
  const trend = ui.el("trend").innerHTML;
  assert.match(trend, /capture-rolling-line/); assert.match(trend, /capture-trend-point/);
  assert.match(trend, /Match 1: rolling mean 1.00 caps\/team across 1 completed matches/);
  assert.match(trend, /Match 3: rolling mean 2.00 caps\/team across 3 completed matches/);
  assert.match(trend, /Match 6: rolling mean 4.00 caps\/team across 5 completed matches/);
  assert.equal(ui.el("trend-order").textContent, "Chronological match order");
  ui.el("trend-raw").checked = false; ui.el("trend-raw").fire("change"); assert.doesNotMatch(ui.el("trend").innerHTML, /class="capture-trend-point"/); assert.match(ui.el("trend").innerHTML, /capture-rolling-line/);
  ui.el("trend-rolling").checked = false; ui.el("trend-rolling").fire("change"); assert.doesNotMatch(ui.el("trend").innerHTML, /capture-rolling-line/);
});

test("small samples use available real observations and reject unavailable capture values", async () => {
  const ui = await dashboard([{ ...maps[0], observations: [{ matchId: "one", createdAt: 100, blueCaps: 2, redCaps: 4 }, { matchId: "missing", createdAt: 200, blueCaps: null, redCaps: 9 }] }]);
  assert.match(ui.el("trend").innerHTML, /Match one: rolling mean 3.00 caps\/team across 1 completed matches/);
  assert.doesNotMatch(ui.el("trend").innerHTML, /Match missing/);
  assert.match(ui.el("distribution").innerHTML, /across 2 team games/);
});

test("quick search matches partial names without changing eligibility, spotlight ranks or sorting", async () => {
  const ui = await dashboard(maps);
  ui.el('search').value = '  aLpH  '; ui.el('search').fire('input');
  assert.deepEqual(ui.ids(), ['a/b']);
  assert.match(ui.el('player-count').textContent, /1 matching \/ 2 qualifying/);
  ui.el('rows').children[0].fire('click');
  assert.match(ui.el('equations').innerHTML, /Alpha &lt;Ace&gt;/);
  assert.match(ui.el('equations').innerHTML, /of 2 qualifying/);
  ui.el('search').value = 'a'; ui.el('search').fire('input');
  ui.sorts.find(e => e.dataset.captureSort === 'net').button.fire('click');
  assert.deepEqual(ui.ids(), ['Bravo', 'a/b']);
  ui.el('search').value = 'alpha'; ui.el('search').fire('input');
  ui.el('minimum').value = '8'; ui.el('minimum').fire('change');
  assert.deepEqual(ui.ids(), []); assert.match(ui.el('empty').textContent, /No players match/);
  ui.el('search').focus = () => { ui.el('search').focused = true; };
  ui.el('search-clear').fire('click');
  assert.equal(ui.el('search').value, ''); assert.equal(ui.el('search').focused, true);
  assert.deepEqual(ui.ids(), ['Bravo']); assert.equal(ui.el('search-clear').disabled, true);
  ui.el('established').checked = true; ui.el('established').fire('change');
  ui.el('search').value = 'Bravo'; ui.el('search').fire('input');
  assert.deepEqual(ui.ids(), []);
  ui.el('established').checked = false; ui.el('established').fire('change');
  assert.deepEqual(ui.ids(), ['Bravo']);
  ui.el('map').value = 'empty'; ui.el('map').fire('change');
  assert.deepEqual(ui.ids(), []); assert.equal(ui.el('search').value, 'Bravo');
});
