(function () {
  "use strict";

  const nn = window.nnHelpers || {};
  const $ = id => document.getElementById(id);
  const escapeHtml = nn.escapeHtml || (value => String(value ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m])));
  const supporterBadge = nn.supporterBadge || (() => "");

  const state = {
    liveTimer: null,
    liveController: null,
    liveInFlight: false
  };

  const CLASS_ART_PATH = "assets/images/classes/";
  const CLASS_ART_MANIFEST = `${CLASS_ART_PATH}manifest.json`;

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value ?? "-";
  }

  function setHtml(id, value) {
    const el = $(id);
    if (el) el.innerHTML = value || "-";
  }

  function number(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function compact(value) {
    return number(value).toLocaleString("en-US");
  }

  function playerName(row) {
    return row?.player || row?.name || row?.display_name || row?.id || "Unknown";
  }

  function playerLink(row) {
    if (!row) return "-";
    const id = row.id || row.player_id;
    const name = escapeHtml(playerName(row));
    return id
      ? `<a href="player.html?id=${encodeURIComponent(id)}">${name}${supporterBadge(id)}</a>`
      : name;
  }

  function mapLink(map) {
    const clean = String(map || "").trim();
    return clean
      ? `<a href="map.html?map=${encodeURIComponent(clean)}">${escapeHtml(clean)}</a>`
      : "-";
  }

  function shuffled(values) {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  async function loadClassArtManifest() {
    try {
      const res = await fetch(CLASS_ART_MANIFEST, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const files = await res.json();
      if (!Array.isArray(files)) return [];
      return files
        .map(file => String(file || "").trim())
        .filter(file => file && !/[\\/]/.test(file));
    } catch {
      return [];
    }
  }

  async function assignKpiClassArt() {
    const slots = [...document.querySelectorAll(".mini-stat-card .kpi-class-art")];
    if (!slots.length) return;
    const art = shuffled(await loadClassArtManifest()).slice(0, slots.length);
    slots.forEach((img, index) => {
      const file = art[index];
      if (!file) return;
      img.src = `${CLASS_ART_PATH}${file}`;
      img.addEventListener("error", () => {
        img.hidden = true;
        img.removeAttribute("src");
      }, { once: true });
      img.hidden = false;
    });
  }

  function renderStreakFlavor(leaderboard) {
    const ranked = (Array.isArray(leaderboard) ? leaderboard : [])
      .filter(row => !row.hidden && row.elo != null && (number(row.games) || number(row.wins) + number(row.losses) + number(row.ties)) > 0)
      .sort((a, b) => number(b.elo) - number(a.elo))
      .slice(0, 5);
    const picked = shuffled(ranked)[0];
    setText("card-streak-flavor", picked ? `Carried by ${playerName(picked)}` : "Carried by Someone Else");
  }

  async function getJSON(url, signal) {
    if (typeof nn.fetchJSON === "function" && !signal) return nn.fetchJSON(url);
    try {
      const res = await fetch(url, { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (error.name !== "AbortError") console.error(`[home] ${url}`, error);
      return { ok: false, data: null };
    }
  }

  async function settled(urls) {
    const rows = await Promise.allSettled(urls.map(url => getJSON(url)));
    return rows.map(row => row.status === "fulfilled" ? row.value : { ok: false, data: null });
  }

  function epochMs(value) {
    const raw = number(value);
    if (!raw) return 0;
    return raw > 100000000000 ? raw : raw * 1000;
  }

  function monthYear(value) {
    const ms = epochMs(value);
    if (!ms) return "-";
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(ms));
  }

  function historyDisplay(firstMatchAt) {
    if (!firstMatchAt) return { value: "-", unit: "Years Active", since: "Since -" };
    const seconds = Math.max(0, (Date.now() - epochMs(firstMatchAt)) / 1000);
    const years = seconds / 31557600;
    if (years >= 1) {
      return { value: years.toFixed(1), unit: "Years Active", since: `Since ${monthYear(firstMatchAt)}` };
    }
    const months = Math.max(1, Math.round(seconds / 2629800));
    return { value: String(months), unit: `${months === 1 ? "Month" : "Months"} Active`, since: `Since ${monthYear(firstMatchAt)}` };
  }

  function estimateStart(queue) {
    const count = number(queue?.count ?? queue?.players?.length);
    const max = number(queue?.max || 8);
    if (queue?.estimatedStart) return String(queue.estimatedStart);
    if (count >= max) return "Ready when teams lock";
    if (count >= Math.ceil(max * .75)) return "Queue is filling up";
    if (count > 0) return `${max - count} more needed`;
    return "Waiting for players";
  }

  function queuePlayers(queue) {
    return Array.isArray(queue?.players) ? queue.players : [];
  }

  function primaryLiveState(queue, matches) {
    const liveStates = Array.isArray(queue?.liveMatches) ? queue.liveMatches : [];
    const dbLive = (matches || []).filter(m => m.status === "in_progress");
    const liveState = liveStates[0] || null;
    const liveMatch = liveState
      ? dbLive.find(m => String(m.id) === String(liveState.match_id)) || dbLive[0] || null
      : dbLive[0] || null;
    return { liveState, liveMatch };
  }

  function liveScore(liveState, liveMatch) {
    const blue = liveState?.score_blue ?? liveState?.blue_score ?? liveMatch?.score_blue ?? 0;
    const red = liveState?.score_red ?? liveState?.red_score ?? liveMatch?.score_red ?? 0;
    if (blue || red) return { blue: number(blue), red: number(red) };

    const round = number(liveState?.round);
    const current = number(liveState?.currentScore);
    const half = liveState?.halfScores?.[0];
    if (round <= 1) return { blue: current, red: 0 };
    return { blue: number(half?.blue || half?.red), red: current };
  }

  function renderQueueDots(count, max) {
    const box = $("live-queue-dots");
    if (!box) return;
    box.innerHTML = Array.from({ length: max }).map((_, index) =>
      `<span class="queue-dot ${index < count ? "filled" : ""}"></span>`
    ).join("");
  }

  function renderLive(queue, matches) {
    const max = number(queue?.max || 8);
    const count = Math.min(max, number(queue?.count ?? queuePlayers(queue).length));
    const { liveState, liveMatch } = primaryLiveState(queue, matches);
    const active = !!(liveState?.active || liveMatch);
    const map = liveState?.map || liveMatch?.map_name || "";
    const score = liveScore(liveState, liveMatch);
    const estimate = estimateStart(queue);

    setText("live-queue-count", `${count} / ${max}`);
    setText("live-estimate", estimate);
    setText("live-map", active ? (map || "Live match") : "No active match");
    setText("live-blue-score", score.blue);
    setText("live-red-score", score.red);

    renderQueueDots(count, max);
  }

  function renderHero(summary, players) {
    const total = summary?.totalMatches ?? 0;
    const unique = summary?.uniquePlayers ?? players?.uniquePlayers ?? 0;
    const history = historyDisplay(summary?.firstMatchAt);
    setText("hero-matches", compact(total));
    setText("hero-matches-1d", compact(summary?.matches1d || 0));
    setText("hero-matches-7d", compact(summary?.matches7d || 0));
    setText("hero-matches-30d", compact(summary?.matches30d || 0));
    setText("hero-players", compact(unique));
    setText("hero-players-1d", compact(summary?.uniquePlayers1d || 0));
    setText("hero-players-7d", compact(summary?.uniquePlayers7d || 0));
    setText("hero-players-30d", compact(summary?.uniquePlayers30d || players?.uniquePlayers30d || 0));
    setText("hero-years", history.value);
    setText("hero-history-unit", history.unit);
    setText("hero-history-since", history.since);
  }

  function renderCards(players, top, mvps, streaks, maps) {
    const topActive = players?.topActive || null;
    const streak = streaks?.currentStreak || null;
    const elo = (top || [])[0] || null;
    const mvpLeader = mvps?.leader || null;
    const rateLeader = mvps?.rateLeader || null;
    const topMap = (maps || [])[0] || null;

    setHtml("card-most-active", playerLink(topActive));
    setText("card-most-active-note", topActive ? `${number(topActive.games)} games · last 30 days` : "No 30 day activity");
    setHtml("card-streak", playerLink(streak));
    setText("card-streak-note", streak ? `${number(streak.wins)} wins · hot right now` : "No active streak");
    setHtml("card-elo-surge", playerLink(elo));
    setText("card-elo-note", elo ? `${number(elo.delta) >= 0 ? "+" : ""}${number(elo.delta)} Elo` : "No 30 day surge");
    setHtml("card-mvp-leader", playerLink(mvpLeader));
    setText("card-mvp-note", mvpLeader ? `${number(mvpLeader.mvp_games)} MVPs` : "No MVP data");
    setHtml("card-mvp-rate", playerLink(rateLeader));
    setText("card-mvp-rate-note", rateLeader ? `${number(rateLeader.mvp_pct).toFixed(1)}% · ${number(rateLeader.mvp_games)}/${number(rateLeader.games)} games` : "Minimum 25 games");
    setHtml("card-map", mapLink(topMap?.map));
    setText("card-map-note", topMap ? `${number(topMap.games)} games played` : "No map data");

  }

  function renderNewswire(players, top, mvps, streaks, maps) {
    // Newswire icon mapping: Elo=elobadge, MVP=mvp, streak=flame, map=mappin, MVP rate=trophy, activity=dogtags.
    const rows = [
      top?.[0] ? { icon: "elobadge.png", iconLabel: "Elo gain badge", fallback: "+", text: `${playerName(top[0])} gained ${number(top[0].delta) >= 0 ? "+" : ""}${number(top[0].delta)} Elo in the last 30 days`, time: "recent form" } : null,
      mvps?.leader ? { icon: "mvp.png", iconLabel: "MVP medal", fallback: "M", text: `${playerName(mvps.leader)} leads all-time MVPs with ${number(mvps.leader.mvp_games)}`, time: "MVP watch" } : null,
      streaks?.currentStreak ? { icon: "flame.png", iconLabel: "Win streak flame", fallback: "W", text: `${playerName(streaks.currentStreak)} is riding a ${number(streaks.currentStreak.wins)} win streak`, time: "hot hand" } : null,
      maps?.[0] ? { icon: "mappin.png", iconLabel: "Map pin", fallback: ">", text: `${maps[0].map} is the most played map`, time: `${number(maps[0].games)} games` } : null,
      mvps?.rateLeader ? { icon: "trophy.png", iconLabel: "MVP rate trophy", fallback: "%", text: `${playerName(mvps.rateLeader)} owns the highest MVP rate`, time: `${number(mvps.rateLeader.mvp_pct).toFixed(1)}%` } : null,
      players?.topActive ? { icon: "dogtags.png", iconLabel: "Activity dog tags", fallback: "A", text: `${playerName(players.topActive)} set the pace with ${number(players.topActive.games)} games in 30 days`, time: "activity" } : null
    ].filter(Boolean).slice(0, 5);

    const box = $("newswire-list");
    if (!box) return;
    box.innerHTML = rows.length ? rows.map(row => `
      <div class="milestone-row">
        <span class="milestone-icon newswire-icon" tabindex="0" role="img" aria-label="${escapeHtml(row.iconLabel || "Newswire icon")}">
          <img src="assets/images/icons/${escapeHtml(row.icon)}" alt="${escapeHtml(row.iconLabel || "Newswire icon")}" loading="lazy">
          <span class="newswire-icon-preview" aria-hidden="true">
            <img src="assets/images/icons/${escapeHtml(row.icon)}" alt="" loading="lazy">
          </span>
          <span class="icon-fallback">${escapeHtml(row.fallback || "?")}</span>
        </span>
        <div class="newswire-copy">
          <strong>${escapeHtml(row.text)}</strong>
          <small>${escapeHtml(row.time)}</small>
        </div>
      </div>
    `).join("") : `<div class="empty-state">Newswire stories will appear once stats are available.</div>`;
    box.querySelectorAll(".newswire-icon > img").forEach(img => {
      img.addEventListener("error", () => img.closest(".newswire-icon")?.classList.add("icon-missing"), { once: true });
    });
  }

  function renderSpotlight(players, top, mvps, streaks) {
    const rows = [
      ["Most Active", players?.topActive, players?.topActive ? `${number(players.topActive.games)} games (30d)` : "-"],
      ["Fastest Rising", top?.[0], top?.[0] ? `${number(top[0].delta) >= 0 ? "+" : ""}${number(top[0].delta)} Elo (30d)` : "-"],
      ["Longest Win Streak", streaks?.currentStreak, streaks?.currentStreak ? `${number(streaks.currentStreak.wins)} wins` : "-"],
      ["Best MVP Rate", mvps?.rateLeader, mvps?.rateLeader ? `${number(mvps.rateLeader.mvp_pct).toFixed(1)}%` : "-"],
      ["Most Improved This Month", top?.[1] || top?.[0], (top?.[1] || top?.[0]) ? `${number((top?.[1] || top?.[0]).delta) >= 0 ? "+" : ""}${number((top?.[1] || top?.[0]).delta)} Elo` : "-"]
    ];

    const box = $("spotlight-list");
    if (!box) return;
    box.innerHTML = rows.map(([label, player, value], index) => `
      <div class="spotlight-row">
        <span class="spotlight-icon">${index + 1}</span>
        <span>${escapeHtml(label)}</span>
        <strong>${playerLink(player)}</strong>
        <small>${escapeHtml(value)}</small>
      </div>
    `).join("");
  }

  function renderTopMaps(maps) {
    const rows = Array.isArray(maps) ? maps : [];
    const max = Math.max(...rows.map(row => number(row.games)), 1);
    const box = $("top-maps-list");
    if (!box) return;
    box.innerHTML = rows.length ? rows.map((row, index) => `
      <div class="top-map-row">
        <strong>${index + 1}.</strong>
        ${mapLink(row.map)}
        <div class="map-bar"><span style="--w:${Math.round((number(row.games) / max) * 100)}%"></span></div>
        <small>${number(row.games)}</small>
      </div>
    `).join("") : `<div class="empty-state">No map data available.</div>`;
  }

  function renderPlayerLegends(rows) {
    const box = $("legends-list");
    if (!box) return;
    const items = Array.isArray(rows) ? rows : [];
    box.innerHTML = items.length ? items.map(row => `
      <div class="record-row">
        <span class="legend-role">${escapeHtml(row.label || "Legend")}</span>
        <strong>${playerLink(row)}</strong>
        <small>${escapeHtml(row.display || `${row.unit === "Elo" && number(row.value) > 0 ? "+" : ""}${compact(row.value)} ${row.unit || ""}`)}</small>
      </div>
    `).join("") : `<div class="empty-state">Player legends will appear once history data loads.</div>`;
  }

  function renderStaticData(payloads) {
    const [homeJson, summaryJson, playersJson, topJson, mapsJson, mvpsJson, outcomesJson, streaksJson, leaderboardJson] = payloads;
    const home = homeJson?.data || {};
    const summary = home.summary || summaryJson?.data || {};
    const players = playersJson?.data || {};
    const top = Array.isArray(topJson?.data) ? topJson.data : [];
    const maps = Array.isArray(mapsJson?.data) ? mapsJson.data : [];
    const mvps = mvpsJson?.data || {};
    const outcomes = outcomesJson?.data || {};
    const streaks = streaksJson?.data || {};
    const leaderboard = Array.isArray(leaderboardJson?.data) ? leaderboardJson.data : [];

    renderHero(summary, players);
    renderStreakFlavor(leaderboard);
    renderCards(players, top, mvps, streaks, maps);
    renderNewswire(players, top, mvps, streaks, maps);
    renderSpotlight(players, top, mvps, streaks);
    renderTopMaps(maps);
    renderPlayerLegends(home.playerLegends);

    if (!mvps?.leader && outcomes?.total) {
      setText("card-mvp-note", `${number(outcomes.total)} completed outcomes`);
    }
  }

  async function refreshLive() {
    if (state.liveInFlight) return;
    state.liveInFlight = true;
    state.liveController?.abort();
    state.liveController = new AbortController();

    try {
      const [queue, matches] = await Promise.all([
        getJSON("/api/queue", state.liveController.signal),
        getJSON("/api/matches?limit=50&includePending=1", state.liveController.signal)
      ]);
      renderLive(queue || {}, Array.isArray(matches?.data) ? matches.data : []);
    } finally {
      state.liveInFlight = false;
    }
  }

  function scheduleLivePoll() {
    clearTimeout(state.liveTimer);
    state.liveTimer = setTimeout(async () => {
      if (!document.hidden) await refreshLive();
      scheduleLivePoll();
    }, 10000);
  }

  async function init() {
    assignKpiClassArt();
    const payloads = await settled([
      "/api/home",
      "/api/stats/summary",
      "/api/stats/players",
      "/api/topplayers?days=30&limit=15",
      "/api/mapaverages",
      "/api/stats/mvps?limit=10",
      "/api/stats/matchOutcomes",
      "/api/stats/streaks",
      "/api/leaderboard?limit=2000&days=7"
    ]);

    renderStaticData(payloads);
    await refreshLive();
    scheduleLivePoll();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshLive();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
