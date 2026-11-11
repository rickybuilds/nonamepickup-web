"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const mapSelect = document.getElementById("capture-map");
  const minimum = document.getElementById("capture-minimum");
  const sort = document.getElementById("capture-sort");
  const summary = document.getElementById("capture-summary");
  const rows = document.getElementById("capture-rows");
  const table = rows.closest(".capture-table-wrap");
  let maps = [];
  const format = value => Number(value).toFixed(2);
  const rating = value => `${value > 0.0001 ? "+" : value < -0.0001 ? "−" : ""}${format(Math.abs(value))}`;
  const cell = (row, text, className) => {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    row.appendChild(td);
    return td;
  };
  function render() {
    rows.replaceChildren();
    const map = maps.find(item => item.map === mapSelect.value);
    if (!map) { table.hidden = true; return; }
    const players = map.players.filter(player => player.games >= Number(minimum.value));
    players.sort((a, b) => b[sort.value] - a[sort.value] || b.games - a.games || a.player.localeCompare(b.player));
    summary.textContent = `${map.map}: ${format(map.average)} caps per team per game across ${map.games.toLocaleString()} eligible ${map.games === 1 ? "match" : "matches"}. ${players.length.toLocaleString()} players shown.`;
    table.hidden = !players.length;
    if (!players.length) { summary.textContent += " No players meet this minimum."; return; }
    for (const player of players) {
      const row = document.createElement("tr");
      const name = cell(row, "");
      const link = document.createElement("a");
      link.href = `player.html?id=${encodeURIComponent(player.id)}`;
      link.textContent = player.player;
      name.appendChild(link);
      cell(row, player.games.toLocaleString());
      cell(row, format(player.scored));
      cell(row, rating(player.offense), player.offense >= 0 ? "capture-positive" : "capture-negative");
      cell(row, format(player.conceded));
      cell(row, rating(player.defense), player.defense >= 0 ? "capture-positive" : "capture-negative");
      rows.appendChild(row);
    }
  }
  try {
    const response = await window.nnHelpers.fetchJSON("/api/stats/capture-ratings");
    if (!response || !response.ok || !Array.isArray(response.data)) throw new Error("Invalid response");
    maps = response.data;
    mapSelect.replaceChildren();
    if (!maps.length) {
      mapSelect.add(new Option("No eligible maps", ""));
      summary.textContent = "No matches have complete capture records yet.";
      table.hidden = true;
      return;
    }
    for (const map of maps) mapSelect.add(new Option(`${map.map} (${map.games} matches)`, map.map));
    mapSelect.disabled = false;
    [mapSelect, minimum, sort].forEach(control => control.addEventListener("change", render));
    render();
  } catch (error) {
    mapSelect.replaceChildren(new Option("Unavailable", ""));
    summary.textContent = "Capture ratings could not be loaded. Refresh the page to try again.";
    table.hidden = true;
  }
});
