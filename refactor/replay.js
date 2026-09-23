const byId = (id) => document.getElementById(id);
const syncSkip = () => {
  document.querySelector(".skip").href = `${location.pathname}${location.search}#content`;
};
syncSkip();
const recordExport = byId("record-export");
const viewerExport = byId("replay-export");
recordExport.addEventListener("click", () => viewerExport.click());
new MutationObserver(() => {
  recordExport.disabled = viewerExport.disabled;
  recordExport.textContent = viewerExport.disabled ? "Recording replay…" : "Export replay ↓";
}).observe(viewerExport, { attributes: true, attributeFilter: ["disabled"] });

const clock = () => {
  byId("clock").textContent = `${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} LOCAL`;
};
clock();
setInterval(clock, 30000);

const route = (view, id) =>
  `./refactor/?view=${encodeURIComponent(view)}${id ? `&id=${encodeURIComponent(id)}` : ""}`;
const formatTime = (ms) => {
  if (!Number.isFinite(Number(ms))) return "—";
  const value = Number(ms);
  return `${Math.floor(value / 60000)}:${String(Math.floor(value % 60000 / 1000)).padStart(2, "0")}.${String(Math.floor(value % 1000)).padStart(3, "0")}`;
};

document.addEventListener("speedrun-replay:ready", async ({ detail }) => {
  syncSkip();
  recordExport.disabled = false;
  const { replay, frameCount, projectileCount } = detail;
  byId("record-map").textContent = replay.map || "Unknown map";
  byId("record-time").textContent = formatTime(replay.timeMs);
  byId("record-runner").textContent = replay.playerName || replay.steamid || "Unknown runner";
  byId("record-class").textContent = replay.className || `Class ${replay.classId ?? "—"}`;
  byId("record-run").textContent = replay.runId ? `RUN #${replay.runId}` : "RUN ID UNAVAILABLE";
  byId("record-frames").textContent = `${frameCount.toLocaleString()} FRAMES / ${projectileCount.toLocaleString()} PROJECTILES`;
  byId("record-map-link").href = route("speedrun-map", replay.map);
  byId("record-map-link").textContent = `← ${replay.map || "Speedruns"} map record`;

  if (!replay.steamid) return;
  const runnerLink = byId("record-runner-link");
  runnerLink.href = route("speedrun-player", replay.steamid);
  runnerLink.hidden = false;
  try {
    const [runnerResponse, supporterResponse] = await Promise.all([
      fetch(`/api/speedruns/players/${encodeURIComponent(replay.steamid)}`),
      fetch("/api/supporters"),
    ]);
    if (!runnerResponse.ok || !supporterResponse.ok) return;
    const runner = await runnerResponse.json();
    const supporters = await supporterResponse.json();
    const discordId = runner.player?.discordId;
    if (discordId && (supporters.supporters || []).map(String).includes(String(discordId))) {
      const diamond = document.createElement("span");
      diamond.className = "supporter-diamond";
      diamond.setAttribute("role", "img");
      diamond.setAttribute("aria-label", "Server Supporter");
      diamond.title = "Server Supporter";
      diamond.textContent = "💎";
      byId("record-runner").append(" ", diamond);
    }
  } catch {
    // Replay playback remains available if identity metadata cannot load.
  }
});

document.addEventListener("speedrun-replay:error", ({ detail }) => {
  byId("record-map").textContent = "Replay unavailable";
  byId("record-runner").textContent = detail.error?.message || "The replay could not be loaded.";
});

const layer = byId("search-layer");
const input = byId("player-search");
let searchTrigger;
let searchRequest = 0;
let searchTimer;
function closeSearch() {
  searchRequest++;
  layer.hidden = true;
  document.body.style.overflow = "";
  searchTrigger?.focus();
}
function openSearch() {
  searchTrigger = document.activeElement;
  layer.hidden = false;
  document.body.style.overflow = "hidden";
  input.value = "";
  byId("search-results").textContent = "Start typing to search the player record.";
  input.focus();
}
byId("header-search").addEventListener("click", openSearch);
byId("close-search").addEventListener("click", closeSearch);
layer.addEventListener("click", (event) => {
  if (event.target === layer) closeSearch();
});
document.addEventListener("keydown", (event) => {
  if (layer.hidden) {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      openSearch();
    }
    return;
  }
  if (event.key === "Escape") closeSearch();
  if (event.key === "Tab") {
    const focusable = [...layer.querySelectorAll("button, input, a")];
    const current = focusable.indexOf(document.activeElement);
    if ((event.shiftKey && current <= 0) || (!event.shiftKey && current === focusable.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
    }
  }
});
input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const request = ++searchRequest;
  const value = input.value.trim();
  if (value.length < 2) {
    byId("search-results").textContent = "Enter at least two characters.";
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const response = await fetch(`/api/players/search?q=${encodeURIComponent(value)}&limit=8`);
      if (!response.ok) throw Error("Search unavailable");
      const data = await response.json();
      if (request !== searchRequest || layer.hidden) return;
      const results = byId("search-results");
      results.replaceChildren();
      for (const player of data.data || []) {
        const item = document.createElement("a");
        item.href = route("player", player.id);
        const name = document.createElement("strong");
        name.textContent = player.player || player.name || player.id;
        item.append(name);
        results.append(item);
      }
      if (!results.childElementCount) results.textContent = "No players found.";
    } catch {
      if (request === searchRequest && !layer.hidden) byId("search-results").textContent = "Search unavailable. Try again.";
    }
  }, 220);
});
