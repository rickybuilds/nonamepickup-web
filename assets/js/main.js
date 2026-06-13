// =============================================
// NoName TFC Pickups main.js
// Path: /assets/js/main.js
// =============================================

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`Failed: ${url}`, e);
    return { ok: false, data: [] };
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function avatarInitial(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function avatarHtml(name, avatarUrl, sizeClass = "nn-avatar-sm") {
  const fallback = `<span class="nn-avatar-fallback">${escapeHtml(avatarInitial(name))}</span>`;
  const image = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  return `<span class="nn-avatar ${sizeClass}" aria-hidden="true">${fallback}${image}</span>`;
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(Number(ts) * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function calcWinPct(record) {
  const [w, l, t] = String(record || "0-0-0").split("-").map(n => Number(n) || 0);
  const total = w + l + t;
  return total ? `${Math.round((w / total) * 100)}%` : "—";
}

function winnerRowClass(winner) {
  const w = String(winner || "").toUpperCase();
  if (w === "BLUE") return "winner-blue";
  if (w === "RED") return "winner-red";
  if (w === "TIE") return "winner-tie";
  return "";
}

function formatSeconds(sec) {
  const s = Math.max(0, Number(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;

  if (h) return `${h}h ${m}m ${r}s`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

function normName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const WEAPON_NAMES = {
  "weapon-1": "Grenade",
  "weapon-2": "Nailgren",
  "weapon-3": "MIRV",
  "weapon-4": "EMP",
  "weapon-5": "Super Nailgun",
  "weapon-6": "Nails",
  "weapon-7": "Crowbar",
  "weapon-8": "Spanner",
  "weapon-9": "Medkit",
  "weapon-10": "Single Shotgun",
  "weapon-11": "Super Shotgun",
  "weapon-12": "Rocket Launcher",
  "weapon-13": "Assault Cannon",
  "weapon-15": "Sentry Gun",
  "weapon-16": "Dispenser",
  "weapon-18": "Yellow Gren Launcher",
  "weapon-19": "Blue Gren Launcher",
  "weapon-20": "DetPack",
  "weapon-21": "Flamethrower",
  "weapon-24": "Hallucination Grenade",
  "weapon-25": "Knife",
  "weapon-26": "Headshot Sniper Rifle",
  "weapon-27": "Sniper Rifle",
  "weapon-28": "Auto Sniper Rifle",
  "weapon-29": "Infection"
};

function weaponName(id) {
  return WEAPON_NAMES[id] || id;
}

function mapImageSources(mapName, options = {}) {
  const encoded = encodeURIComponent(String(mapName || "").trim());
  const localBase = options.localBase || "assets/images/maps";
  const remoteBase = options.remoteBase || "https://tfcmaps.net/images/maps/source";

  return [
    `${localBase}/${encoded}.webp`,
    `${localBase}/${encoded}.jpg`,
    `${remoteBase}/${encoded}.jpg`
  ];
}

function setMapImageFromName(el, mapName, options = {}) {
  const img = typeof el === "string" ? document.querySelector(el) : el;
  if (!img) return null;

  const clean = String(mapName || "").trim();
  const container = options.container
    || (options.containerSelector ? img.closest(options.containerSelector) : img.parentElement);
  const noImageClass = options.noImageClass || "no-image";
  const requestKey = encodeURIComponent(clean);

  if (!clean) {
    delete img.dataset.currentMap;
    container?.classList.add(noImageClass);
    return null;
  }

  if (img.dataset.currentMap === requestKey) return clean;

  img.dataset.currentMap = requestKey;
  img.alt = options.alt || `${clean} map preview`;
  container?.classList.remove(noImageClass);

  const sources = mapImageSources(clean, options);
  if (options.fallbackSrc) sources.push(options.fallbackSrc);
  let sourceIndex = 0;

  img.onerror = () => {
    if (img.dataset.currentMap !== requestKey) return;
    sourceIndex += 1;

    if (sourceIndex < sources.length) {
      img.src = sources[sourceIndex];
      return;
    }

    container?.classList.add(noImageClass);
    options.onError?.(clean);
  };

  img.onload = () => {
    if (img.dataset.currentMap !== requestKey) return;
    container?.classList.remove(noImageClass);
    options.onLoad?.(clean, img.src);
  };

  img.src = sources[sourceIndex];
  return clean;
}

// Decorative cards only. Specific-map UI must use setMapImageFromName.
function applyRandomMapBackground(el, options = {}) {
  const target = typeof el === "string" ? document.querySelector(el) : el;
  if (!target) return null;

  const playedMaps = options.playedMaps || window.nnPlayedMaps || [];
  const mapNames = playedMaps
    .map(map => typeof map === "string" ? map : map?.map_name || map?.map || map?.name)
    .map(map => String(map || "").trim())
    .filter(Boolean);

  if (!mapNames.length) {
    target.classList.add(options.noImageClass || "no-image");
    return null;
  }

  const random = typeof options.random === "function" ? options.random : Math.random;
  const randomIndex = Math.min(mapNames.length - 1, Math.floor(random() * mapNames.length));
  const mapName = mapNames[Math.max(0, randomIndex)];
  const loader = new Image();

  setMapImageFromName(loader, mapName, {
    ...options,
    container: target,
    alt: "",
    onLoad: (_loadedMap, src) => {
      target.style.removeProperty("background-image");
      target.style.setProperty("--nn-map-bg-image", `url("${src}")`);
      target.dataset.backgroundMap = mapName;
      options.onLoad?.(mapName, src);
    }
  });

  return mapName;
}

window.nnHelpers = {
  ...(window.nnHelpers || {}),
  escapeHtml,
  formatDate,
  winnerRowClass,
  formatSeconds,
  normName,
  WEAPON_NAMES,
  weaponName,
  avatarHtml,
  setMapImageFromName,
  applyRandomMapBackground
};
window.setMapImageFromName = setMapImageFromName;
window.applyRandomMapBackground = applyRandomMapBackground;

// ==================== GLOBAL SEARCH ====================
function initGlobalSearch() {
  const input = document.getElementById("global-search");
  if (!input) return;

  let matches = [];
  let activeIndex = -1;
  let searchTimer = null;
  let searchController = null;

  const wrap = document.createElement("div");
  wrap.className = "search-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const dropdown = document.createElement("div");
  dropdown.id = "search-dropdown";
  wrap.appendChild(dropdown);

  async function searchPlayers(query) {
    searchController?.abort();
    searchController = new AbortController();
    try {
      const res = await fetch(
        `/api/players/search?q=${encodeURIComponent(query)}&limit=8`,
        { cache: "no-store", signal: searchController.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        return (j.data || []).map(r=>({
        id:String(r.id||r.player_id),
        name:String(r.player||r.name||r.display_name||r.id),
        elo:r.elo??null,
        hidden:!!r.hidden,
        record:r.record||`${r.wins||0}-${r.losses||0}-${r.ties||0}`,
        win_pct:r.win_pct??r.winPct??null,
        avatar:r.avatarmedium||r.avatar||null,
        profileurl:r.profileurl||null
      }));
    } catch (error) {
      if (error.name !== "AbortError") console.error("Player search failed", error);
      return [];
    }
  }

  function goToPlayer(p) {
    if (!p) return;
    window.location.href = `player.html?id=${encodeURIComponent(p.id)}`;
  }

  function renderDropdown() {
    if (!matches.length) {
      dropdown.innerHTML = `<div class="search-empty">No players found</div>`;
      dropdown.classList.add("show");
      activeIndex = -1;
      return;
    }

    dropdown.innerHTML = matches.map((p,i)=>{
    return `
    <div class="search-result ${i===activeIndex?"active":""}" data-id="${escapeHtml(p.id)}">
    <div class="search-result-player">
      ${avatarHtml(p.name,p.avatar)}
      <div>
        <strong>${escapeHtml(p.name)}${supporterBadge(p.id)}</strong>
        <small>
        ${p.hidden
        ? "Elo Hidden"
        : (p.record || "0-0-0")
        }
        </small>
      </div>
    </div>
    <span>${p.elo??"—"}</span>
    </div>
    `;
    }).join("");

    dropdown.classList.add("show");

    dropdown.querySelectorAll(".search-result").forEach((el, i) => {
      el.addEventListener("mousedown", e => {
        e.preventDefault();
        goToPlayer(matches[i]);
      });
    });
  }

  async function runSearch() {
    const q = input.value.trim();
    if (!q) {
      matches = [];
      dropdown.classList.remove("show");
      dropdown.innerHTML = "";
      activeIndex = -1;
      return;
    }
    matches = await searchPlayers(q);
    activeIndex = -1;
    renderDropdown();
  }

  input.addEventListener("focus", () => {
    if (input.value.trim()) runSearch();
  });

  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 180);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, matches.length - 1);
      renderDropdown();
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderDropdown();
    }

    if (e.key === "Enter") {
      e.preventDefault();

      const selected = matches[activeIndex] || matches[0];
      if (selected) goToPlayer(selected);
      else if (input.value.trim()) {
        window.location.href = `player.html?id=${encodeURIComponent(input.value.trim())}`;
      }
    }

    if (e.key === "Escape") {
      dropdown.classList.remove("show");
    }
  });

  document.addEventListener("click", e => {
    if (!wrap.contains(e.target)) {
      dropdown.classList.remove("show");
    }
  });
}

// ==================== INDEX PAGE ====================
async function loadIndex() {
  try {
    const longestStreakEl = document.getElementById("longest-streak");
    if (longestStreakEl) {
      longestStreakEl.innerHTML = `<span class="kpi-sub">Loading...</span>`;
    }

    const [summary, players, top, maps, mvps, outcomes] = await Promise.all([
      fetchJSON("/api/stats/summary"),
      fetchJSON("/api/stats/players"),
      fetchJSON("/api/topplayers?days=30&limit=15"),
      fetchJSON("/api/mapaverages"),
      fetchJSON("/api/stats/mvps?limit=10"),
      fetchJSON("/api/stats/matchOutcomes")
    ]);

    const s = summary.data || {};
    const p = players.data || {};

    document.getElementById("kpi-1d").textContent = s.matches1d ?? "—";
    document.getElementById("kpi-7d").textContent = s.matches7d ?? "—";
    document.getElementById("kpi-30d").textContent = s.matches30d ?? "—";
    document.getElementById("total-matches").textContent = s.totalMatches ?? "—";

    document.getElementById("close-games").textContent =
  (outcomes.data?.under15 || 0) +
  (outcomes.data?.ties || 0);
    const total = outcomes.data?.total || 1;

    document.getElementById("ties-count").innerHTML =
    `${outcomes.data?.ties ?? 0} • ${(((outcomes.data?.ties ?? 0)/total)*100).toFixed(1)}%`;

    document.getElementById("under-15-count").innerHTML =
    `${outcomes.data?.under15 ?? 0} • ${(((outcomes.data?.under15 ?? 0)/total)*100).toFixed(1)}%`;

    document.getElementById("under-25-count").innerHTML =
    `${outcomes.data?.under25 ?? 0} • ${(((outcomes.data?.under25 ?? 0)/total)*100).toFixed(1)}%`;

    document.getElementById("blowout-count").innerHTML =
    `${outcomes.data?.blowouts ?? 0} • ${(((outcomes.data?.blowouts ?? 0)/total)*100).toFixed(1)}%`;

    document.getElementById("unique-players").textContent = p.uniquePlayers ?? "—";
	document.getElementById("unique-players-30d").textContent = p.uniquePlayers30d ?? "—";

    document.getElementById("most-active").innerHTML = p.topActive
      ? `${escapeHtml(p.topActive.player)}<br><span class="kpi-sub">(${p.topActive.games} games)</span>`
      : "—";

    const mvpLeader=mvps.data?.leader||null;
    const mvpLeaders=Array.isArray(mvps.data?.leaders)?mvps.data.leaders:[];
    const mvpLeaderEl=document.getElementById("mvp-leader");
    const mvpLeaderNote=document.getElementById("mvp-leader-note");

    if(mvpLeader&&mvpLeaderEl){
      const name=escapeHtml(mvpLeader.player||"Unknown");
      mvpLeaderEl.innerHTML=mvpLeader.id
        ? `<a href="player.html?id=${encodeURIComponent(mvpLeader.id)}">${name}</a>`
        : name;

      const tiedCount=mvpLeaders.filter(row=>
        Number(row.mvp_games||0)===Number(mvpLeader.mvp_games||0)
      ).length-1;
      if(mvpLeaderNote){
        mvpLeaderNote.textContent=
          `${Number(mvpLeader.mvp_games||0)} game MVPs`+
          (tiedCount>0?` • Tied with ${tiedCount} player${tiedCount===1?"":"s"}`:"");
      }
    }else{
      if(mvpLeaderEl)mvpLeaderEl.textContent="—";
      if(mvpLeaderNote)mvpLeaderNote.textContent="No MVP data yet";
    }

    const topBody = document.getElementById("top-players-body");
    topBody.innerHTML = (top.data || []).slice(0, 15).map(row => `
      <tr class="border-b border-gray-800 hover:bg-gray-900">
        <td class="py-3 px-2">${row.rank}</td>
        <td class="py-3 px-2">
          <a href="player.html?id=${encodeURIComponent(row.id)}">${escapeHtml(row.player)}${supporterBadge(row.id)}</a>
        </td>
        <td class="py-3 px-2 text-center">${escapeHtml(row.record || "0-0-0")}</td>
        <td class="py-3 px-2 text-center">${calcWinPct(row.record)}</td>
        <td class="py-3 px-2 text-right ${row.delta > 0 ? "text-emerald-400" : row.delta < 0 ? "text-red-400" : ""}">
          ${row.delta > 0 ? "+" : ""}${row.delta ?? 0}
        </td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="py-6 text-center text-gray-500">No data</td></tr>`;

    const mapBody = document.getElementById("map-averages-body");
    mapBody.innerHTML = (maps.data || []).map(row => `
      <tr class="border-b border-gray-800 hover:bg-gray-900">
        <td class="py-3 px-2">
          <a href="map.html?map=${encodeURIComponent(row.map)}">${escapeHtml(row.map)}</a>
        </td>
        <td class="py-3 px-2 text-center">${row.games ?? 0}</td>
        <td class="py-3 px-2 text-right">${row.avgScorePerTeam ?? "—"}</td>
      </tr>
    `).join("") || `<tr><td colspan="3" class="py-6 text-center text-gray-500">No map data</td></tr>`;

// Replace the streak part with this:
fetchJSON("/api/stats/streaks").then(streaks => {
  const el = document.getElementById("longest-streak");
  if (!el) return;

  if (streaks.data?.currentStreak) {
    el.innerHTML = `${escapeHtml(streaks.data.currentStreak.player)}<br><span class="kpi-sub">(${streaks.data.currentStreak.wins} wins)</span>`;
  } else {
    el.textContent = "—";
  }
}).catch(e => {
  console.error("Streak load failed:", e);
  const el = document.getElementById("longest-streak");
  if (el) el.textContent = "—";
});
  } catch (e) {
    console.error("Index load failed:", e);
  }
}

//supporters
let SUPPORTERS = new Set();

async function loadSupporters(){
  try{
    const res = await fetch("/api/supporters");
    const json = await res.json();
    SUPPORTERS = new Set((json.supporters || []).map(String));
  }catch{
    SUPPORTERS = new Set();
  }
}

function supporterBadge(id){
  return SUPPORTERS.has(String(id))
    ? '<span class="supporter-badge" title="Server Supporter">💎</span>'
    : "";
}

// ==================== LEADERBOARD PAGE ====================
async function loadLeaderboard() {
  const body = document.getElementById("leaderboard-body");
  if (!body) return;

  const filter = document.getElementById("leaderboard-filter");
  const visibleCount = document.getElementById("leaderboard-visible-count");
	const MIN_GAMES = 10;

	const j = await fetchJSON(`/api/leaderboard?limit=2000&days=0`);
	const ranked = (j.data || [])
	  .filter(row => !row.hidden && row.elo != null)
	  .map(row => ({
		...row,
		games: Number(row.wins || 0) + Number(row.losses || 0) + Number(row.ties || 0)
	  }))
	  .filter(row => row.games >= MIN_GAMES)
	  .sort((a, b) => Number(b.elo) - Number(a.elo))
	  .map((row, index) => ({
		...row,
		rank: index + 1
	  }));

  function render() {
    const query = filter?.value.trim().toLowerCase() || "";
    const rows = query
      ? ranked.filter(row =>
          String(row.player || "").toLowerCase().includes(query) ||
          String(row.id || "").toLowerCase().includes(query)
        )
      : ranked;

    body.innerHTML = rows.map(row => `
      <tr>
        <td class="leaderboard-rank">#${row.rank}</td>
        <td>
          <a class="leaderboard-player-link" href="player.html?id=${encodeURIComponent(row.id)}">
            ${avatarHtml(row.player,row.avatarmedium||row.avatar)}
            <span>${escapeHtml(row.player)}${supporterBadge(row.id)}</span>
          </a>
        </td>
        <td>${row.games.toLocaleString()}</td>
        <td>${escapeHtml(row.record || "0-0-0")}</td>
        <td>${calcWinPct(row.record)}</td>
        <td class="leaderboard-elo">${Number(row.elo)}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" class="leaderboard-empty">No ranked players found.</td></tr>`;

    if (visibleCount) {
      visibleCount.textContent = query
        ? `${rows.length} of ${ranked.length} ranked players`
        : `${ranked.length} active ranked players`;
    }
  }

  const totalGames = ranked.reduce((sum, row) => sum + row.games, 0);
  document.getElementById("leaderboard-player-count").textContent =
    ranked.length.toLocaleString();
  document.getElementById("leaderboard-top-elo").textContent =
    ranked[0] ? Number(ranked[0].elo) : "—";
  document.getElementById("leaderboard-total-games").textContent =
    totalGames.toLocaleString();
  filter?.addEventListener("input", render);
  render();
}

// ==================== GLOBAL QUEUE TOAST ====================
function initQueueToast(){
  if(document.getElementById("queue-toast"))return;

  const isLivePage=window.location.pathname.includes("live.html");

  const toast=document.createElement("a");
  toast.id="queue-toast";
  toast.href="live.html";
  toast.innerHTML=`
    <strong>🔥 Queue heating up</strong>
    <span id="queue-toast-text">5/8 players ready</span>
  `;

  document.body.appendChild(toast);

	function getActivePlayerIds(queue){
	  const ids=new Set();
	  (queue?.liveMatches||[]).forEach(live=>{
		[
		  live.blue,live.red,live.team1,live.team2,
		  live.blueTeam,live.redTeam,live.players,
		  live.rosters?.blue,live.rosters?.red
		].flat(Infinity).filter(Boolean).forEach(p=>{
		  if(p?.id)ids.add(String(p.id));
		  if(p?.discord_id)ids.add(String(p.discord_id));
		  if(p?.player_id)ids.add(String(p.player_id));
		});
	  });
	  return ids;
	}

  function renderQueueToast(queue,activeIds=new Set()){
    const players=(queue?.players||[]).filter(
      player=>!activeIds.has(String(player.id))
    );

    const count=players.length;
    const max=Number(queue?.max||8);

    const text=document.getElementById("queue-toast-text");
    if(text)text.textContent=`${count}/${max} players ready`;

    toast.classList.toggle("show",count>=5);
  }

  window.addEventListener("tfcbot:live-snapshot",event=>{
    const queue=event.detail?.queue||{};
    const activeIds=new Set(event.detail?.activePlayerIds||[]);
    renderQueueToast(queue,activeIds);
  });

  if(isLivePage)return;

  let pollTimer=null;
  let requestInFlight=false;

  async function checkQueue(){
    if(requestInFlight||document.hidden)return;

    requestInFlight=true;

    try{
      const queue=await fetchJSON("/api/queue");
      renderQueueToast(queue,getActivePlayerIds(queue));
    }finally{
      requestInFlight=false;
    }
  }

  function scheduleQueuePoll(){
    clearTimeout(pollTimer);

    pollTimer=setTimeout(async()=>{
      await checkQueue();
      scheduleQueuePoll();
    },5000);
  }

  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden)checkQueue();
  });

  checkQueue();
  scheduleQueuePoll();
}
// ==================== COMPARE PAGE ====================
async function loadCompare() {
  const p1Input = document.getElementById("compare-player-1");
  const p2Input = document.getElementById("compare-player-2");
  const runBtn = document.getElementById("compare-run");
  if (!p1Input || !p2Input || !runBtn) return;

  let selectedP1 = null;
  let selectedP2 = null;

  async function searchPlayers(query, limit = 12) {
    const q = String(query || "").trim();
    if (!q) return [];
    const j = await fetchJSON(
      `/api/players/search?q=${encodeURIComponent(q)}&limit=${limit}`
    );
    return (j.data || []).map(r => ({
      id: String(r.id || r.player_id),
      name: String(r.player || r.name || r.display_name || r.id)
    }));
  }

  function setupBox(input, resultsEl, selectedEl, onSelect) {
    let searchTimer = null;
    let requestNumber = 0;
    let currentMatches = [];

    async function render() {
      const q = input.value.trim();
      if (!q) {
        currentMatches = [];
        resultsEl.classList.remove("show");
        resultsEl.innerHTML = "";
        return;
      }

      const thisRequest = ++requestNumber;
      const matches = await searchPlayers(q);
      if (thisRequest !== requestNumber) return;
      currentMatches = matches;
      resultsEl.innerHTML = currentMatches.map(p => `
        <div class="compare-result-item" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">
          ${escapeHtml(p.name)}${supporterBadge(p.id)}
        </div>
      `).join("") || `<div class="compare-result-item">No players found</div>`;

      resultsEl.classList.add("show");
    }

    function choose(player) {
      input.value = player.name;
      selectedEl.innerHTML = `Selected: ${escapeHtml(player.name)}${supporterBadge(player.id)}`;
      resultsEl.classList.remove("show");
      onSelect(player);
    }

    input.addEventListener("focus", () => {
      if (input.value.trim()) render();
    });

    input.addEventListener("input", () => {
      onSelect(null);
      selectedEl.innerHTML = "No player selected";
      clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 180);
    });

    input.addEventListener("keydown", async e => {
      if (e.key !== "Enter") return;
      e.preventDefault();

      const q = input.value.trim().toLowerCase();
      const players = currentMatches.length
        ? currentMatches
        : await searchPlayers(q);
      const match =
        players.find(p => p.name.toLowerCase() === q) ||
        players.find(p => p.id === q) ||
        players.find(p => p.name.toLowerCase().includes(q));

      if (match) choose(match);
    });

    resultsEl.addEventListener("mousedown", e => {
      const item = e.target.closest(".compare-result-item");
      if (!item || !item.dataset.id) return;

      choose({
        id: item.dataset.id,
        name: item.dataset.name
      });
    });

    document.addEventListener("click", e => {
      if (!input.contains(e.target) && !resultsEl.contains(e.target)) {
        resultsEl.classList.remove("show");
      }
    });
  }

  setupBox(
    p1Input,
    document.getElementById("compare-player-1-results"),
    document.getElementById("compare-player-1-selected"),
    p => selectedP1 = p
  );

  setupBox(
    p2Input,
    document.getElementById("compare-player-2-results"),
    document.getElementById("compare-player-2-selected"),
    p => selectedP2 = p
  );

  async function resolveTyped(input, selected) {
    if (selected) return selected;

    const q = input.value.trim().toLowerCase();
    if (!q) return null;

    const players = await searchPlayers(q);
    return players.find(p => p.name.toLowerCase() === q) ||
           players.find(p => p.id === q) ||
           players.find(p => p.name.toLowerCase().includes(q)) ||
           null;
  }

  async function runCompare() {
    const p1 = await resolveTyped(p1Input, selectedP1);
    const p2 = await resolveTyped(p2Input, selectedP2);

    if (!p1 || !p2) {
      document.getElementById("compare-empty").textContent = "Pick two valid players first.";
      return;
    }

    if (p1.id === p2.id) {
      document.getElementById("compare-empty").textContent = "Pick two different players.";
      return;
    }

    selectedP1 = p1;
    selectedP2 = p2;

    window.history.replaceState(null, "", `compare.html?p1=${encodeURIComponent(p1.id)}&p2=${encodeURIComponent(p2.id)}`);

    document.getElementById("compare-empty").textContent = "Loading comparison...";
    document.getElementById("compare-empty").classList.remove("hidden");
    document.getElementById("compare-results").classList.add("hidden");

    const j = await fetchJSON(`/api/compare?p1=${encodeURIComponent(p1.id)}&p2=${encodeURIComponent(p2.id)}`);

    if (!j.ok || !j.data) {
      document.getElementById("compare-empty").textContent = j.error || "Comparison failed.";
      return;
    }

    renderCompare(j.data);
  }

  runBtn.addEventListener("click", runCompare);

  const params = new URLSearchParams(window.location.search);
  const urlP1 = params.get("p1");
  const urlP2 = params.get("p2");

  if (urlP1 && urlP2) {
    const [p1Matches, p2Matches] = await Promise.all([
      searchPlayers(urlP1),
      searchPlayers(urlP2)
    ]);

    selectedP1 = p1Matches.find(p => p.id === urlP1) || { id: urlP1, name: urlP1 };
    selectedP2 = p2Matches.find(p => p.id === urlP2) || { id: urlP2, name: urlP2 };

    p1Input.value = selectedP1.name;
    p2Input.value = selectedP2.name;

    document.getElementById("compare-player-1-selected").innerHTML = `Selected: ${escapeHtml(selectedP1.name)}${supporterBadge(selectedP1.id)}`;
    document.getElementById("compare-player-2-selected").innerHTML = `Selected: ${escapeHtml(selectedP2.name)}${supporterBadge(selectedP2.id)}`;
    await runCompare();
  }
}

function renderCompare(data) {
  const p1 = data.players?.p1 || {};
  const p2 = data.players?.p2 || {};
  const teammate = data.stats?.teammate || {};
  const opponent = data.stats?.opponent || {};
  const matches = data.matches || [];

  document.getElementById("compare-empty").classList.add("hidden");
  document.getElementById("compare-results").classList.remove("hidden");

  document.getElementById("compare-name-1").innerHTML =
    `${escapeHtml(p1.name || "Player One")}${supporterBadge(p1.id)}`;

  document.getElementById("compare-name-2").innerHTML =
    `${escapeHtml(p2.name || "Player Two")}${supporterBadge(p2.id)}`;

  document.getElementById("compare-elo-1").textContent = p1.hidden ? "Elo Hidden" : `${p1.elo ?? "—"} Elo`;
  document.getElementById("compare-elo-2").textContent = p2.hidden ? "Elo Hidden" : `${p2.elo ?? "—"} Elo`;

  document.getElementById("compare-together-gp").textContent = teammate.gp ?? 0;
  document.getElementById("compare-together-record").textContent =
    `${teammate.w || 0}-${teammate.l || 0}-${teammate.t || 0} · ${teammate.win_pct || 0}% win rate`;

  document.getElementById("compare-h2h-gp").textContent = opponent.gp ?? 0;
  document.getElementById("compare-h2h-record").textContent =
    `${p1.name || "P1"} ${opponent.p1_w || 0} · ${p2.name || "P2"} ${opponent.p2_w || 0} · Ties ${opponent.t || 0}`;

  document.getElementById("compare-p1-wins-label").textContent = `${p1.name || "P1"} Wins`;
  document.getElementById("compare-p2-wins-label").textContent = `${p2.name || "P2"} Wins`;

  document.getElementById("compare-p1-wins").textContent = opponent.p1_w ?? 0;
  document.getElementById("compare-p2-wins").textContent = opponent.p2_w ?? 0;

  document.getElementById("compare-teammate-body").innerHTML = `
    <tr><td>Games as teammates</td><td class="text-right font-bold">${teammate.gp || 0}</td></tr>
    <tr><td>Wins together</td><td class="text-right text-emerald-400 font-bold">${teammate.w || 0}</td></tr>
    <tr><td>Losses together</td><td class="text-right text-red-400 font-bold">${teammate.l || 0}</td></tr>
    <tr><td>Ties together</td><td class="text-right text-gray-400 font-bold">${teammate.t || 0}</td></tr>
    <tr><td>Team win rate</td><td class="text-right font-bold">${teammate.win_pct || 0}%</td></tr>
  `;

  document.getElementById("compare-opponent-body").innerHTML = `
    <tr><td>Games as opponents</td><td class="text-right font-bold">${opponent.gp || 0}</td></tr>
    <tr><td>${escapeHtml(p1.name || "Player One")} wins</td><td class="text-right text-blue-400 font-bold">${opponent.p1_w || 0}</td></tr>
    <tr><td>${escapeHtml(p2.name || "Player Two")} wins</td><td class="text-right text-red-400 font-bold">${opponent.p2_w || 0}</td></tr>
    <tr><td>Ties</td><td class="text-right text-gray-400 font-bold">${opponent.t || 0}</td></tr>
    <tr><td>${escapeHtml(p1.name || "P1")} win rate</td><td class="text-right font-bold">${opponent.p1_win_pct || 0}%</td></tr>
    <tr><td>${escapeHtml(p2.name || "P2")} win rate</td><td class="text-right font-bold">${opponent.p2_win_pct || 0}%</td></tr>
  `;

  const body = document.getElementById("compare-matches-body");

  body.innerHTML = matches.map(m => {
    const winner = String(m.winner || "").toUpperCase();
    const relationText = m.relation === "teammate" ? "Teammates" : "Opponents";
    const relationClass = m.relation === "teammate" ? "relation-team" : "relation-opponent";

    return `
      <tr class="${winnerRowClass(winner)}">
        <td>${formatDate(m.created_at)}</td>
        <td><a href="map.html?map=${encodeURIComponent(m.map_name || "")}">${escapeHtml(m.map_name || "Unknown")}</a></td>
        <td class="${relationClass}">${relationText}</td>
        <td class="blue-team">${(m.blueTeam || []).map(x => `<a href="player.html?id=${encodeURIComponent(x.id)}">${escapeHtml(x.name)}${supporterBadge(x.id)}</a>`).join(" • ") || "—"}</td>
        <td class="red-team">${(m.redTeam || []).map(x => `<a href="player.html?id=${encodeURIComponent(x.id)}">${escapeHtml(x.name)}${supporterBadge(x.id)}</a>`).join(" • ") || "—"}</td>
        <td class="font-mono text-center">${m.score_blue ?? "?"} - ${m.score_red ?? "?"}</td>
        <td class="text-center font-bold">${winner || "—"}</td>
        <td class="font-bold">${escapeHtml(m.result || "—")}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="8" class="py-6 text-center text-gray-500">These two players have no shared completed matches.</td></tr>`;
}

window.fetchJSON=fetchJSON;
window.escapeHtml=escapeHtml;
window.formatDate=formatDate;
window.calcWinPct=calcWinPct;
window.winnerRowClass=winnerRowClass;
window.loadSupporters=loadSupporters;
window.supporterBadge=supporterBadge;

// ==================== INIT ====================
document.addEventListener("DOMContentLoaded",async()=>{
  // loadSupporters once, before any page-specific loaders
  await loadSupporters();
  initQueueToast();
  initGlobalSearch();

  const path=window.location.pathname;

  if(path.endsWith("/")||path.includes("index.html")) loadIndex();
  else if(path.includes("leaderboard.html")) loadLeaderboard();
  else if(path.includes("compare.html")) loadCompare();  // only here, no duplicate top-level call
});
