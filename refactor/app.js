const root = document.querySelector("#content");
const params = new URLSearchParams(location.search);
const view = params.get("view") || "overview";
const id = params.get("id") || "";
const state = {
  page: 0,
  speedPage: 0,
  speedQuery: "",
  speedClass: "",
  period: 30,
  matchQuery: "",
  map: "",
  winner: "",
  playerQuery: "",
  mapQuery: "",
};
const link = (v, key, value) =>
  `./?view=${encodeURIComponent(v)}${key ? `&${key}=${encodeURIComponent(value)}` : ""}`;
const esc = (value) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (value) =>
  value == null || value === "" || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString();
const elo = (value) =>
  value == null || value === "" || !Number.isFinite(Number(value))
    ? "—"
    : String(Math.round(Number(value)));
const localTime = () =>
  new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const date = (value) => {
  if (value == null || value === "") return "Date unavailable";
  const n = Number(value);
  const d = new Date(Number.isFinite(n) && n < 1e12 ? n * 1000 : value);
  return Number.isNaN(d.getTime())
    ? "Date unavailable"
    : d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
};
const score = (m) =>
  `<span class="score"><span class="blue">${esc(m.score_blue ?? "—")}</span> <span class="muted">:</span> <span class="red">${esc(m.score_red ?? "—")}</span></span>`;
const liveRoundScore = (state) => {
  const value = (number) =>
    number == null || number === "" || !Number.isFinite(Number(number))
      ? null
      : Number(number);
  const round = Number(state?.round || 0);
  const current = value(state?.currentScore);
  const first = state?.halfScores?.[0];
  const firstRound = first
    ? Math.max(value(first.blue) ?? 0, value(first.red) ?? 0)
    : null;
  if (round === 1) return { team1: current, team2: 0 };
  if (round >= 2) return { team1: firstRound, team2: current };
  return {
    team1: value(state?.score_blue ?? state?.blue_score),
    team2: value(state?.score_red ?? state?.red_score),
  };
};
const liveRoundLabel = (state) => {
  const round = Number(state?.round || 0);
  const caps = state?.liveCaps == null ? null : Number(state.liveCaps);
  return [
    round ? `ROUND ${round}` : "ROUND UNKNOWN",
    caps != null && Number.isFinite(caps)
      ? `${caps} ${caps === 1 ? "CAP" : "CAPS"} THIS ROUND`
      : null,
  ].filter(Boolean).join(" / ");
};
const pageHead = (n, title, copy = "") =>
  `<div class="page-head"><div><span class="eyebrow">${esc(n)} / NONAME PICKUP</span><h1>${esc(title)}</h1></div><p>${esc(copy)}</p></div>`;
const section = (index, title, action = "") =>
  `<div class="section-heading"><h2>${esc(title)}</h2><div>${action || `<span class="section-index">${esc(index)}</span>`}</div></div>`;
const message = (text, type = "empty") =>
  `<div class="notice ${type}">${esc(text)}</div>`;
const get = async (path) => {
  const res = await fetch(`/api/${path}`, { cache: "no-store" });
  if (!res.ok) throw Error(`API ${res.status}`);
  const data = await res.json();
  if (data?.ok === false) throw Error(data.error || "Data unavailable");
  return data;
};
const safeUrl = (value) => {
  try {
    const u = new URL(value, location.origin);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
};
const old = (page) => `../${page}`;
let supporterIds = new Set();
const supporterMark = (discordId) =>
  discordId && supporterIds.has(String(discordId))
    ? '<span class="supporter-diamond" role="img" aria-label="Server Supporter" title="Server Supporter">💎</span>'
    : "";
const playerIdentity = (player, options = {}) => {
  const name = options.name ?? player?.playerName ?? player?.player ?? player?.name ?? player?.display_name ?? player?.id ?? "Unknown runner";
  const discordId = options.discordId ?? player?.discordId ?? player?.discord_id ?? player?.id;
  const target = options.href ?? (discordId ? link("player", "id", discordId) : "");
  const content = `<span class="identity-name">${esc(name)}</span>${supporterMark(discordId)}`;
  return target ? `<a class="player-identity" href="${esc(target)}">${content}</a>` : `<span class="player-identity">${content}</span>`;
};
const runnerUrl = (runner) => {
  const identifier = runner?.discordId || runner?.steamId || runner?.steamid;
  return identifier ? link("speedrun-player", "id", identifier) : "";
};
const replayUrl = (run, map = "") => {
  if (!run?.hasReplay) return "";
  const runId = run.runId ?? run.id;
  return runId != null
    ? `${old("speedrun-replay.html")}?runId=${encodeURIComponent(runId)}`
    : `${old("speedrun-replay.html")}?map=${encodeURIComponent(run.map || map)}&classId=${encodeURIComponent(run.classId ?? "")}&steamid=${encodeURIComponent(run.steamId || "")}`;
};
const replayAction = (run, map = "") => {
  const url = replayUrl(run, map);
  return url ? `<a class="record-action" href="${esc(url)}">Replay ↗</a>` : "";
};
const externalLink = (url, label) => {
  const href = url && safeUrl(url);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗ <span class="sr-external">EXTERNAL</span></a>` : esc(label);
};
const MIN_LEADERBOARD_GAMES = 10;
const qualifiedRatings = (rows) =>
  (rows || []).filter(
    (player) =>
      !player.hidden &&
      player.elo != null &&
      Number(player.games) >= MIN_LEADERBOARD_GAMES,
  );
const queueNamesMarkup = (queue) =>
  queue?.players?.length
    ? queue.players
        .map(
          (player) =>
            `<span title="${esc(player.name || player.id)}">${playerIdentity(player, { name: player.name || player.id, href: player.id ? link("player", "id", player.id) : "" })}</span>`,
        )
        .join("")
    : queue
      ? "No players queued"
      : "Queue data unavailable";
const matchStatus = (m) => {
  if (m.status === "admin") return "ADJUSTMENT";
  if (m.status === "in_progress") return "IN PROGRESS";
  if (m.status !== "completed")
    return String(m.status || "STATUS UNKNOWN").replaceAll("_", " ").toUpperCase();
  return m.winner === "TIE" ? "TIE" : `${m.winner || "—"} WON`;
};
const matchRow = (m) =>
  m.status === "admin"
    ? `<div class="match-row"><span class="match-date">${date(m.created_at)}</span><span class="match-map">Rating adjustment<small class="match-mobile-meta">${date(m.created_at)} / ADMIN</small></span><span class="score">${Number(m.delta) > 0 ? "+" : ""}${fmt(m.delta)}</span><span class="tag">ADMIN</span><span class="row-arrow"></span></div>`
    : `<a class="match-row" href="${link("match", "id", m.id)}"><span class="match-date">${date(m.created_at)}</span><span class="match-map">${esc(m.map_name || "Unknown map")}<small class="match-mobile-meta">${date(m.created_at)} / ${esc(matchStatus(m))}</small></span>${score(m)}<span class="tag">${esc(matchStatus(m))}</span><span class="row-arrow">↗</span></a>`;
const rankRow = (r, position) =>
  `<a class="rank-row" href="${link("player", "id", r.id)}"><span class="rank-number">${fmt(position + 1)}</span><span class="rank-name">${playerIdentity(r, { href: "" })}</span><span class="rank-elo">${elo(r.elo)}</span><span class="rank-games">${fmt(r.games)} G</span></a>`;
function set(html) {
  root.innerHTML = html;
  root.setAttribute("aria-busy", "false");
  const heading = root.querySelector("h1")?.textContent?.trim();
  document.title = `${heading || (view === "overview" ? "Overview" : view[0].toUpperCase() + view.slice(1))} / NoName Pickup 2080`;
  document.querySelector('link[rel="canonical"]').href = new URL(
    location.pathname + location.search,
    location.origin,
  ).href;
}
function loading() {
  set(
    '<div class="loading" role="status"><span class="loading-line"></span>Reading the record…</div>',
  );
  root.setAttribute("aria-busy", "true");
}
function fail(error) {
  set(
    `${pageHead("00", "Signal lost", "The data service did not answer.")} ${message(error.message || "Data unavailable", "error")}<div class="action-row"><button type="button" id="retry">Retry request ↗</button><a href="../index.html">Original site ↗</a></div>`,
  );
  document.querySelector("#retry")?.addEventListener("click", render);
}
function wireNav() {
  document.querySelectorAll(".primary-nav a").forEach((a) => {
    if (
      a.dataset.view === view ||
      (["match", "player", "map", "speedrun-map", "speedrun-player", "speedrun-catalog"].includes(view) &&
        a.dataset.view ===
          {
            match: "matches",
            player: "players",
            map: "maps",
            "speedrun-map": "speedruns",
            "speedrun-player": "speedruns",
            "speedrun-catalog": "speedruns",
          }[view])
    )
      a.setAttribute("aria-current", "page");
  });
  const clock = () =>
    (document.querySelector("#clock").textContent =
      `${localTime()} LOCAL`);
  clock();
  setInterval(clock, 30000);
}
async function overview() {
  const results = await Promise.allSettled([
    get("home"),
    get("queue"),
    get("matches?limit=6&includePending=1"),
    get("leaderboard?limit=500&days=0"),
  ]);
  const [home, queue, matches, leaders] = results.map((r) =>
    r.status === "fulfilled" ? r.value : null,
  );
  const unavailable = results.filter(
    (result) => result.status === "rejected",
  ).length;
  const summary = home?.data?.summary || {};
  const live = queue?.liveMatches?.[0];
  const matchRows = matches?.data || [];
  const ranking = qualifiedRatings(leaders?.data).slice(0, 6);
  const lastMatch = matchRows.find((match) => match.status === "completed");
  const railState = queue
    ? live
      ? "MATCH IN PROGRESS"
      : "QUEUE SNAPSHOT"
    : "STATUS UNAVAILABLE";
  const railLabel = live
    ? "NOW PLAYING"
    : lastMatch
      ? "LAST RESULT"
      : "NEXT PICKUP";
  const railMap =
    live?.map_name || live?.map || lastMatch?.map_name || "Awaiting a pickup";
  const railScore = live
    ? liveRoundScore(live)
    : lastMatch
      ? { team1: lastMatch.score_blue, team2: lastMatch.score_red }
      : null;
  const checked = queue ? `${localTime()} LOCAL` : "—";
  set(`<div class="lede"><span>01 / THE COMMUNITY FREQUENCY</span><span>QUEUE SNAPSHOT / MATCH RECORD</span></div>${unavailable ? message(`${unavailable} data source${unavailable === 1 ? "" : "s"} unavailable. The remaining figures were returned by this check.`, "error") : ""}
  <div class="overview-grid">
    <section class="primary-field"><span class="eyebrow">TEAM FORTRESS CLASSIC / PICKUP NETWORK</span><h1><span>NO</span><span>NAME<span class="slash">/</span></span></h1><div class="primary-sub"><p>Eight players. Two teams. The competitive TFC record.</p><a class="text-link" href="${link("matches")}">Browse matches ↗</a></div></section>
    <aside class="live-rail" data-live-match="${live ? "true" : "false"}"><div class="rail-top"><span>01 / QUEUE SNAPSHOT</span><span class="signal${queue ? "" : " unavailable"}"><span class="signal-dot"></span>${railState}</span></div>
      <div><div class="micro muted">PLAYERS QUEUED / ${esc(checked)}</div><div class="queue-number">${fmt(queue?.count)}<small> / ${fmt(queue?.max)}</small></div><div class="queue-peek">${queueNamesMarkup(queue)}</div></div>
      <hr class="rail-rule"><div><div class="micro muted">${railLabel}</div><div class="rail-map">${esc(railMap)}</div>${live ? `<div class="rail-context">${esc(liveRoundLabel(live))} / TEAM 1 : TEAM 2</div>` : lastMatch ? `<div class="rail-context">${date(lastMatch.created_at)} / ${esc(matchStatus(lastMatch))}</div>` : ""}</div>
      ${railScore ? `<div class="rail-scores"><span class="team-blue">${live ? "T1" : "BLUE"}</span><b class="team-blue">${esc(railScore.team1 ?? "—")}</b><span>:</span><b class="team-red">${esc(railScore.team2 ?? "—")}</b><span class="team-red">${live ? "T2" : "RED"}</span></div>` : ""}
      <a class="rail-action" href="${link("live")}"><span>VIEW QUEUE & SERVERS</span><span>↗</span></a></aside>
  </div>
  <div class="data-strip"><div class="strip-cell"><span class="micro">MATCHES / ALL TIME</span><strong>${fmt(summary.totalMatches)}</strong><small>completed 4v4 pickups</small></div><div class="strip-cell"><span class="micro">PLAYERS / ALL TIME</span><strong>${fmt(summary.uniquePlayers)}</strong><small>in the rating record</small></div><div class="strip-cell"><span class="micro">MATCHES / 7 DAYS</span><strong>${fmt(summary.matches7d)}</strong><small>recent activity</small></div><div class="strip-cell"><span class="micro">PLAYERS / 7 DAYS</span><strong>${fmt(summary.uniquePlayers7d)}</strong><small>active this week</small></div></div>
  <div class="split overview-ledgers"><section>${section("02", "Latest 4v4 pickups", `<a class="text-link" href="${link("matches")}">All matches ↗</a>`)}${matchRows.length ? matchRows.map(matchRow).join("") : message(matches ? "No pickups recorded yet." : "Match service unavailable.")}</section><section>${section("03", "Current ELO", `<a class="text-link" href="${link("players")}">Full standings ↗</a>`)}${ranking.length ? ranking.map(rankRow).join("") : message(leaders ? "No qualified visible ratings yet." : "Ranking service unavailable.")}<div class="rank-note">10+ completed games all time. ELO is current.</div></section></div>`);
}
async function live() {
  const q = await get("queue");
  const matches = q.liveMatches || [];
  const checked = `${localTime()} LOCAL`;
  const liveMatchRow = (m) => {
    const points = liveRoundScore(m);
    return `<div class="match-row"><span class="match-date">${esc(m.serverKey || "SERVER")}</span><span class="match-map">${esc(m.map_name || m.map || "Map unknown")}<small class="match-mobile-meta">${esc(liveRoundLabel(m))}</small></span><span class="live-score"><span class="score"><span class="blue">${esc(points.team1 ?? "—")}</span> : <span class="red">${esc(points.team2 ?? "—")}</span></span><small>TEAM 1 / TEAM 2</small></span><span class="tag">${esc(m.timeleft || "IN PROGRESS")}</span><a class="row-arrow" href="${old("live.html")}" aria-label="Open live spectator">↗</a></div>`;
  };
  set(
    `${pageHead("01", "Live", "Queue and game server state from the latest check.")}<div class="profile-ribbon"><span>QUEUE / ${fmt(q.count)} OF ${fmt(q.max)}</span><span>CHECKED ${checked}</span></div><div class="data-strip"><div class="strip-cell"><span class="micro">PLAYERS QUEUED</span><strong>${fmt(q.count)}</strong></div><div class="strip-cell"><span class="micro">SLOTS REMAINING</span><strong>${fmt(Math.max(0, (q.max || 8) - (q.count || 0)))}</strong></div><div class="strip-cell"><span class="micro">ACTIVE MATCHES</span><strong>${fmt(matches.length)}</strong></div><div class="strip-cell"><span class="micro">QUEUE CAPACITY</span><strong>${fmt(q.max || 8)}</strong></div></div>${section("02", "On the server")}${matches.length ? matches.map(liveMatchRow).join("") : message("No match is active on a connected server.")} ${section("03", "In queue")}${q.players?.length ? q.players.map((p, i) => `<div class="stat-line"><span><span class="number muted">${String(i + 1).padStart(2, "0")} / </span>${playerIdentity(p, { name: p.name || p.id })}</span><span class="number">QUEUED</span></div>`).join("") : message("No players are currently queued.")}<div class="live-actions" role="group" aria-label="Live actions"><button type="button" id="refresh-live"><span>01</span><strong>Refresh snapshot</strong><span>↻</span></button><a href="${old("live.html")}"><span>02</span><strong>Live spectator</strong><span>↗</span></a><a href="${old("pickup-live.html")}"><span>03</span><strong>Browser live viewer</strong><span>↗</span></a></div>`,
  );
  document.querySelector("#refresh-live").onclick = live;
}
async function matches() {
  const data = await get(
    `matches?limit=100&offset=${state.page * 100}&includePending=1`,
  );
  const rows = data.data || [];
  const maps = [...new Set(rows.map((m) => m.map_name).filter(Boolean))].sort();
  const filteredRows = () =>
    rows.filter(
      (m) =>
        (!state.map || m.map_name === state.map) &&
        (!state.winner || m.winner === state.winner) &&
        `${m.id} ${m.map_name} ${(m.blueTeam || []).map((p) => p.name).join(" ")} ${(m.redTeam || []).map((p) => p.name).join(" ")}`
          .toLowerCase()
          .includes(state.matchQuery),
    );
  const filtered = filteredRows();
  set(
    `${pageHead("02", "Matches", "Recorded 4v4 pickups, newest first.")}<div class="lede"><span>${fmt(data.total)} MATCHES IN ARCHIVE</span><span>PAGE ${state.page + 1} / ${fmt(rows.length)} LOADED</span></div><div class="control-bar"><input id="match-filter" type="search" placeholder="Filter loaded matches by ID, map, or player" aria-label="Filter loaded matches" value="${esc(state.matchQuery)}"><select id="map-filter" aria-label="Filter by map on this page"><option value="">All maps on page</option>${maps.map((m) => `<option value="${esc(m)}" ${state.map === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select><select id="winner-filter" aria-label="Filter by result on this page"><option value="">All results on page</option>${["BLUE", "RED", "TIE"].map((w) => `<option ${state.winner === w ? "selected" : ""}>${w}</option>`).join("")}</select><span class="micro" id="match-filter-count">${fmt(filtered.length)} SHOWN</span></div><div class="table-head matches-table"><span>ID</span><span>MAP</span><span>DATE</span><span>SCORE</span><span>RESULT</span><span></span></div><div id="match-table">${matchTable(filtered)}</div><div class="action-row"><button type="button" id="prev-page" ${state.page === 0 ? "disabled" : ""}>← Newer</button><span class="micro">${fmt(state.page * 100 + (rows.length ? 1 : 0))}–${fmt(state.page * 100 + rows.length)} / ${fmt(data.total)}</span><button type="button" id="next-page" ${rows.length < 100 ? "disabled" : ""}>Older →</button></div>`,
  );
  const applyFilters = () => {
    const visible = filteredRows();
    document.querySelector("#match-table").innerHTML = matchTable(visible);
    document.querySelector("#match-filter-count").textContent =
      `${fmt(visible.length)} SHOWN`;
  };
  document.querySelector("#match-filter").addEventListener("input", (e) => {
    state.matchQuery = e.target.value.toLowerCase();
    applyFilters();
  });
  for (const [id, key] of [
    ["map-filter", "map"],
    ["winner-filter", "winner"],
  ])
    document.getElementById(id).addEventListener("change", (e) => {
      state[key] = e.target.value;
      applyFilters();
    });
  document.querySelector("#prev-page").onclick = () => {
    state.page--;
    state.matchQuery = state.map = state.winner = "";
    matches();
  };
  document.querySelector("#next-page").onclick = () => {
    state.page++;
    state.matchQuery = state.map = state.winner = "";
    matches();
  };
}
function matchTable(rows) {
  return rows.length
    ? rows
        .map(
          (m) =>
            `<a class="table-row matches-table" href="${link("match", "id", m.id)}"><span class="number muted">${esc(m.id)}</span><span class="table-name" title="${esc(m.map_name || "Unknown")}">${esc(m.map_name || "Unknown")}<small class="table-mobile-meta">${date(m.created_at)} / ${esc(matchStatus(m))}</small></span><span class="number">${date(m.created_at)}</span>${score(m)}<span class="tag">${esc(matchStatus(m))}</span><span>↗</span></a>`,
        )
        .join("")
    : message("No matches fit this filter.");
}
async function match() {
  if (!id) throw Error("Match ID missing");
  const response = await get(`match/${encodeURIComponent(id)}`);
  const m = response.match;
  const team = (label, players) =>
    `<section class="detail-section">${section("", label)}${(players || []).length ? (players || []).map((p) => `<div class="stat-line"><a href="${link("player", "id", p.id)}">${playerIdentity(p, { name: p.name || p.player || p.id, href: "" })}</a><strong>${p.hidden ? "PRIVATE" : p.current_elo == null ? "" : elo(p.current_elo)}</strong></div>`).join("") : message("Roster unavailable.")}</section>`;
  set(
    `<div class="detail-hero"><div><span class="eyebrow">MATCH / ${esc(m.id)}</span><h1>${esc(m.map_name || "Unknown map")}</h1></div><div class="match-score"><div class="big-score"><span class="team-blue">${esc(m.score_blue ?? "—")}</span><span>:</span><span class="team-red">${esc(m.score_red ?? "—")}</span></div><small>BLUE : RED</small></div></div><div class="detail-meta"><span>${date(m.created_at)}</span><span>${esc(m.status)}</span><span>WINNER / ${esc(m.winner || "—")}</span></div><div class="detail-columns">${team("BLUE / ROSTER · CURRENT ELO", m.blueTeam)}${team("RED / ROSTER · CURRENT ELO", m.redTeam)}</div>${section("03", "Player performance")}<div class="table-head leaderboard-table"><span></span><span>PLAYER</span><span>KILLS</span><span>DEATHS</span><span>CAPS</span><span>DAMAGE</span></div>${(m.player_stats || []).map((p) => `<div class="table-row leaderboard-table"><span class="number ${String(p.team).toUpperCase().includes("BLUE") ? "team-blue" : "team-red"}">■</span><span class="table-name" title="${esc(p.display_name)}">${playerIdentity(p, { name: p.display_name, discordId: p.discord_id || p.id || "", href: "" })}<small class="table-mobile-meta">D ${fmt(p.deaths)} · C ${fmt(p.caps)} · DMG ${fmt(p.damage)}</small></span><span class="number" data-label="KILLS">${fmt(p.kills)}</span><span class="number">${fmt(p.deaths)}</span><span class="number">${fmt(p.caps)}</span><span class="number">${fmt(p.damage)}</span></div>`).join("") || message("Detailed player statistics unavailable.")}${section("04", "Rounds")}${(m.rounds || []).map((r) => `<div class="stat-line"><span>ROUND ${fmt(r.round_num)} / ${esc(r.map_name || m.map_name)}</span><strong>${fmt(r.team1_score)} : ${fmt(r.team2_score)}</strong></div>`).join("") || message("Round data unavailable.")}<div class="action-row inline-links"><a href="${old("match.html")}?id=${encodeURIComponent(id)}">Full legacy breakdown ↗</a>${m.hampalyzer_url ? `<a href="${esc(safeUrl(m.hampalyzer_url))}" target="_blank" rel="noopener noreferrer">Hampalyzer ↗</a>` : ""}${m.tfcstats_url ? `<a href="${esc(safeUrl(m.tfcstats_url))}" target="_blank" rel="noopener noreferrer">TFCStats ↗</a>` : ""}<a href="${old("pickup-replay.html")}?matchId=${encodeURIComponent(id)}&round=1">Round 1 replay ↗</a></div>`,
  );
}
async function players() {
  const [response, allTime] = await Promise.all([
    get(`leaderboard?limit=500&days=${state.period}`),
    state.period === 0
      ? Promise.resolve(null)
      : get("leaderboard?limit=500&days=0"),
  ]);
  const eligibleIds = new Set(
    qualifiedRatings((allTime || response).data).map((player) => player.id),
  );
  const rows = (response.data || [])
    .filter(
      (player) =>
        !player.hidden && player.elo != null && eligibleIds.has(player.id),
    )
    .map((player, index) => ({ ...player, visibleRank: index + 1 }));
  const filtered = rows.filter(
    (p) =>
      !state.playerQuery ||
      `${p.player} ${p.id}`.toLowerCase().includes(state.playerQuery),
  );
  set(
    `${pageHead("03", "Players", "Current ELO with match record and recent form.")}<div class="lede"><span>${fmt(rows.length)} QUALIFIED RATINGS / PRIVATE RATINGS OMITTED</span><span>RECORD WINDOW / ${state.period ? `${state.period} DAYS` : "ALL TIME"}</span></div><div class="control-bar"><input id="player-filter" type="search" placeholder="Filter qualified players" aria-label="Filter qualified players" value="${esc(state.playerQuery)}"><select id="period-filter" aria-label="Match record window"><option value="7" ${state.period === 7 ? "selected" : ""}>7-day record</option><option value="30" ${state.period === 30 ? "selected" : ""}>30-day record</option><option value="90" ${state.period === 90 ? "selected" : ""}>90-day record</option><option value="0" ${state.period === 0 ? "selected" : ""}>All-time record</option></select><button type="button" id="open-search">SEARCH ALL PLAYERS ↗</button></div><div class="rank-note">Standings require 10+ completed games all time. The record window changes games and form; ELO is current.</div><div class="table-head leaderboard-table"><span>ORDER</span><span>PLAYER</span><span>ELO</span><span>GAMES</span><span>RECORD</span><span>RECENT</span></div><div id="player-table">${playerTable(filtered)}</div>`,
  );
  document.querySelector("#player-filter").oninput = (e) => {
    state.playerQuery = e.target.value.toLowerCase();
    document.querySelector("#player-table").innerHTML = playerTable(
      rows.filter((p) =>
        `${p.player} ${p.id}`.toLowerCase().includes(state.playerQuery),
      ),
    );
  };
  document.querySelector("#period-filter").onchange = (e) => {
    state.period = Number(e.target.value);
    players();
  };
  document.querySelector("#open-search").onclick = openSearch;
}
function playerTable(rows) {
  return rows.length
    ? rows
        .map(
          (p) =>
            `<a class="table-row leaderboard-table" href="${link("player", "id", p.id)}"><span class="number muted">${fmt(p.visibleRank)}</span><span class="table-name" title="${esc(p.player)}">${playerIdentity(p, { href: "" })}<small class="table-mobile-meta">${fmt(p.games)} G · ${esc(p.record)} · ${esc((p.recent_results || []).join(" "))}</small></span><span class="number" data-label="ELO">${elo(p.elo)}</span><span class="number">${fmt(p.games)}</span><span class="number">${esc(p.record)}</span><span class="number">${esc((p.recent_results || []).join(" "))}</span></a>`,
        )
        .join("")
    : message("No player fits this filter.");
}
async function player() {
  if (!id) throw Error("Player ID missing");
  const [response, recent] = await Promise.all([
    get(`player/${encodeURIComponent(id)}/v3`),
    get(`player/${encodeURIComponent(id)}/recent?limit=10`).catch(() => null),
  ]);
  const d = response.data,
    p = d.player,
    r = d.ratings,
    h = d.hampalyzer;
  const recentRows = Array.isArray(recent?.data) ? recent.data : [];
  set(
    `<div class="profile-ribbon"><span>PLAYER FILE / ${esc(p.id)}</span><span>${r.hidden ? "RATING PRIVATE" : "CURRENT RATING"}</span></div><div class="detail-hero player-detail"><div><span class="eyebrow">IDENTITY / NONAME</span><h1 class="${String(p.name || "").length > 20 ? "very-long-title" : String(p.name || "").length > 12 ? "long-title" : ""}">${playerIdentity(p, { href: "" })}</h1></div><div class="detail-stat"><b>${r.hidden ? "PRIVATE" : elo(r.elo)}</b><small>CURRENT ELO</small></div></div><div class="profile-values"><div><small>MATCHES</small><b>${fmt(r.games)}</b></div><div><small>WIN RATE</small><b>${fmt(r.win_pct)}%</b></div><div><small>RECORD</small><b>${esc(r.record)}</b></div><div><small>PEAK ELO</small><b>${r.hidden ? "—" : elo(r.peak_elo)}</b></div></div><div class="detail-columns"><section class="detail-section">${section("02", "Combat")}${[
      ["Kills", h.kills],
      ["Deaths", h.deaths],
      ["K / D", h.kdr],
      ["Damage", h.damage],
      ["Captures", h.caps],
      ["Conc jumps", h.conc_jumps],
      ["MVP games", h.mvp_games],
    ]
      .map(
        ([name, value]) =>
          `<div class="stat-line"><span>${name}</span><strong>${fmt(value)}</strong></div>`,
      )
      .join(
        "",
      )}</section><section class="detail-section">${section("03", "Classes")}${
      (d.classes || []).length
        ? d.classes
            .slice(0, 9)
            .map(
              (c) =>
                `<div class="stat-line"><span>${esc(c.class)}</span><strong>${fmt(c.hours)} H / ${fmt(c.pct)}%</strong></div>`,
            )
            .join("")
        : message("No class data available.")
    }</section></div>${section("04", "Recent appearances")}${recentRows.length ? recentRows.map(matchRow).join("") : message(recent ? "No recent matches recorded." : "Recent match service unavailable.")}<div class="action-row inline-links"><a href="${old("player.html")}?id=${encodeURIComponent(id)}">Full player file ↗</a>${p.profileurl ? `<a href="${esc(safeUrl(p.profileurl))}" target="_blank" rel="noopener noreferrer">Steam profile ↗</a>` : ""}<a href="${link("compare")}&p1=${encodeURIComponent(id)}">Compare player ↗</a></div>`,
  );
}
async function maps() {
  const response = await get("mapaverages");
  const rows = (response.data || []).map((map, index) => ({
    ...map,
    order: index + 1,
  }));
  const filtered = rows.filter(
    (m) => !state.mapQuery || m.map.toLowerCase().includes(state.mapQuery),
  );
  set(
    `${pageHead("04", "Maps", "A map is a record of how the community plays.")}<div class="lede"><span>${fmt(rows.length)} MAPS IN THE PICKUP ARCHIVE</span><span>SORTED BY MATCHES</span></div><div class="control-bar"><input id="maps-filter" type="search" placeholder="Find a map" aria-label="Filter maps" value="${esc(state.mapQuery)}"></div><div class="table-head maps-table"><span>#</span><span>MAP</span><span>MATCHES</span><span>AVG TEAM SCORE</span><span></span></div><div id="maps-table">${mapTable(filtered)}</div>`,
  );
  document.querySelector("#maps-filter").oninput = (e) => {
    state.mapQuery = e.target.value.toLowerCase();
    document.querySelector("#maps-table").innerHTML = mapTable(
      rows.filter((m) => m.map.toLowerCase().includes(state.mapQuery)),
    );
  };
}
function mapTable(rows) {
  return rows.length
    ? rows
        .map(
          (m) =>
            `<a class="table-row maps-table" href="${link("map", "id", m.map)}"><span class="number muted">${String(m.order).padStart(2, "0")}</span><span class="table-name" title="${esc(m.map)}">${esc(m.map)}<small class="table-mobile-meta">AVG TEAM SCORE ${fmt(m.avgScorePerTeam)}</small></span><span class="number" data-label="MATCHES">${fmt(m.games)}</span><span class="number">${fmt(m.avgScorePerTeam)}</span><span>↗</span></a>`,
        )
        .join("")
    : message("No maps fit this filter.");
}
async function map() {
  if (!id) throw Error("Map name missing");
  const [playersResponse, matchesResponse, averagesResponse] =
    await Promise.all([
      get(`map/${encodeURIComponent(id)}/players`),
      get(`map/${encodeURIComponent(id)}/matches?limit=25`),
      get("mapaverages").catch(() => null),
    ]);
  const p = playersResponse.data || [],
    m = matchesResponse.data || [];
  const mapAverage = (averagesResponse?.data || []).find(
    (entry) => entry.map === id,
  );
  set(
    `<div class="detail-hero"><div><span class="eyebrow">MAP FILE / PICKUPS</span><h1>${esc(id)}</h1></div><div class="detail-stat"><b>${fmt(mapAverage?.games)}</b><small>COMPLETED MATCHES</small></div></div><div class="detail-meta"><span>RECENT MATCHES SHOWN / ${fmt(m.length)}</span><span>PLAYERS IN MAP RECORD / ${fmt(p.length)}</span><span>AVG TEAM SCORE / ${fmt(mapAverage?.avgScorePerTeam)}</span></div><div class="split"><section>${section("02", "Recent on this map")}${m.map(matchRow).join("") || message("No matches recorded.")}</section><section>${section("03", "Map regulars")}<div class="rank-note">Wins / games played on this map</div>${
      p
        .slice(0, 25)
        .map(
          (r, i) =>
            `<a class="rank-row" href="${link("player", "id", r.id)}"><span class="rank-number">${i + 1}</span><span class="rank-name">${playerIdentity(r, { href: "" })}</span><span class="rank-elo">${fmt(r.w)}</span><span class="rank-games">${fmt(r.gp)} G</span></a>`,
        )
        .join("") || message("No player data recorded.")
    }</section></div><div class="action-row"><a href="${old("map.html")}?map=${encodeURIComponent(id)}">Full map intel ↗</a></div>`,
  );
}
async function speedruns() {
  const summary = await get("speedruns/summary");
  const recentRecords = (summary.recentWorldRecords || []).slice(0, 8);
  const topRunners = (summary.topRunners || []).slice(0, 8);
  set(
    `${pageHead("05", "Speedruns", "Current timer records across conc, bhop, and other TFC maps.")}<div class="data-strip speedrun-summary"><div class="strip-cell"><span class="micro">MAPS / ENABLED</span><strong>${fmt(summary.maps)} / ${fmt(summary.enabledMaps)}</strong></div><div class="strip-cell"><span class="micro">COMPLETED RUNS</span><strong>${fmt(summary.runs)}</strong></div><div class="strip-cell"><span class="micro">RUNNERS</span><strong>${fmt(summary.runners)}</strong></div><div class="strip-cell"><span class="micro">CURRENT RECORDS</span><strong>${fmt(summary.records)}</strong></div></div>
    <div class="split speedrun-ledgers"><section>${section("02", "Recent world records")}${recentRecords.length ? recentRecords.map((record) => `<div class="sr-record-line"><a href="${link("speedrun-map", "id", record.map)}">${esc(record.map)}</a><span>${speedrunRunner(record)}<small>${esc(speedrunClass(record))} / ${date(record.achievedAt)}</small></span><strong>${esc(record.bestTimeDisplay)}</strong>${replayAction(record)}</div>`).join("") : message("No recent world records available.")}</section><section>${section("03", "Record holders")}${topRunners.length ? topRunners.map((runner, index) => `<a class="rank-row" href="${runnerUrl(runner)}"><span class="rank-number">${index + 1}</span><span class="rank-name" title="${esc(runner.playerName)}">${playerIdentity(runner, { href: "" })}</span><span class="rank-elo">${fmt(runner.currentRecords)}</span><span class="rank-games">RECORDS</span></a>`).join("") : message("Runner standings unavailable.")}</section></div>
    ${section("04", "Latest completions")}<div class="sr-run-ledger">${(summary.recentRuns || []).slice(0, 8).map((run) => speedrunLine(run)).join("") || message("No recent runs.")}</div>${section("05", "Most active maps")}<div class="sr-run-ledger">${(summary.popularMaps || []).slice(0, 8).map((map) => `<a class="sr-popular-line" href="${link("speedrun-map", "id", map.map)}"><strong>${esc(map.displayName || map.map)}</strong><span>${esc(map.category)} / ${fmt(map.totalRunners)} RUNNERS</span><b>${fmt(map.totalRuns)} RUNS ↗</b></a>`).join("") || message("No map activity.")}</div>
    ${section("06", "Map record index")}<div class="control-bar"><input id="speed-map-filter" type="search" placeholder="Search all speedrun maps" aria-label="Search speedrun maps" value="${esc(state.speedQuery)}"><select id="speed-class-map-filter" aria-label="Filter maps by class"><option value="">All classes</option>${[[1,"Scout"],[2,"Sniper"],[3,"Soldier"],[4,"Demoman"],[5,"Medic"],[6,"Heavy"],[7,"Pyro"],[8,"Spy"],[9,"Engineer"],["civilian","Civilian"]].map(([value,label]) => `<option value="${value}" ${state.speedClass === String(value) ? "selected" : ""}>${label}</option>`).join("")}</select><span class="micro">SERVER-SIDE SEARCH</span></div><div id="speed-map-list" aria-live="polite"></div><div class="action-row"><button type="button" id="speed-prev" disabled>← Previous maps</button><span class="micro" id="speed-page-status">LOADING MAPS</span><button type="button" id="speed-next" disabled>More maps →</button></div><div class="action-row"><a href="${link("speedrun-catalog")}">Server map catalogue ↗</a><a href="${old("speedruns.html")}">Full run archive ↗</a></div>`,
  );
  let timer;
  document.querySelector("#speed-map-filter").oninput = (e) => {
    clearTimeout(timer);
    speedRequest++;
    state.speedQuery = e.target.value;
    state.speedPage = 0;
    timer = setTimeout(loadSpeedrunMaps, 250);
  };
  document.querySelector("#speed-class-map-filter").onchange = (e) => {
    state.speedClass = e.target.value;
    state.speedPage = 0;
    loadSpeedrunMaps();
  };
  document.querySelector("#speed-prev").onclick = () => {
    state.speedPage--;
    loadSpeedrunMaps();
  };
  document.querySelector("#speed-next").onclick = () => {
    state.speedPage++;
    loadSpeedrunMaps();
  };
  await loadSpeedrunMaps();
}
let speedRequest = 0;
async function loadSpeedrunMaps() {
  const request = ++speedRequest;
  const list = document.querySelector("#speed-map-list");
  const previous = document.querySelector("#speed-prev");
  const next = document.querySelector("#speed-next");
  const status = document.querySelector("#speed-page-status");
  if (!list || !previous || !next || !status) return;
  previous.disabled = true;
  next.disabled = true;
  status.textContent = "READING MAPS";
  try {
    const response = await get(
      `speedruns/maps?limit=100&offset=${state.speedPage * 100}&paginated=1&q=${encodeURIComponent(state.speedQuery)}&class_id=${encodeURIComponent(state.speedClass)}`,
    );
    if (request !== speedRequest) return;
    const maps = response.items || [];
    list.innerHTML = speedMapList(maps);
    previous.disabled = state.speedPage === 0;
    next.disabled = !response.pagination?.hasNext;
    status.textContent = `${state.speedPage * 100 + (maps.length ? 1 : 0)}–${state.speedPage * 100 + maps.length} / PAGE ${state.speedPage + 1}`;
  } catch (error) {
    if (request !== speedRequest) return;
    list.innerHTML = `${message("Speedrun maps are unavailable.", "error")}<div class="action-row"><button type="button" id="retry-speed-map">Retry maps ↻</button></div>`;
    list.querySelector("#retry-speed-map").onclick = loadSpeedrunMaps;
    status.textContent = "MAP SERVICE UNAVAILABLE";
  }
}
function speedMapList(rows) {
  return rows.length
    ? rows
        .map(
          (m) =>
            `<a class="map-row" href="${link("speedrun-map", "id", m.map)}"><b>${esc(m.displayName || m.map)}</b><span>${esc(m.category || "OTHER")} / ${fmt(m.totalRuns)} RUNS</span><span>${esc(m.worldRecordDisplay || "—")}</span><span>↗</span></a>`,
        )
        .join("")
    : message("No speedrun maps fit this search.");
}
const speedrunClass = (row) => row?.class?.name || row?.className || `Class ${row?.classId ?? row?.class?.id ?? "—"}`;
const speedrunRunner = (row) => playerIdentity(row, {
  name: row?.playerName || row?.player?.name || row?.steamId || "Unknown runner",
  discordId: row?.discordId ?? row?.player?.discordId ?? "",
  href: runnerUrl({
    discordId: row?.discordId || row?.player?.discordId,
    steamId: row?.steamId || row?.player?.steamId,
  }),
});
const speedrunLine = (run, map = "") =>
  `<div class="sr-run-line"><a href="${link("speedrun-map", "id", run.map || map)}">${esc(run.map || map)}</a><span>${speedrunRunner(run)} / ${esc(speedrunClass(run))}</span><strong>${esc(run.timeDisplay || run.bestTimeDisplay || "—")}</strong>${replayAction(run, map)}</div>`;
function mapComparison(comparisons, classId) {
  const comparison = (comparisons || []).find((entry) => String(entry.class?.id) === String(classId));
  if (!comparison) return message("No imported comparison for this class.");
  const internal = comparison.internal;
  const externals = comparison.externals || [];
  return `<div class="sr-comparison"><div class="sr-comparison-head"><span class="eyebrow">${esc(comparison.class?.name || "CLASS")} / CURRENT RULESET</span><strong>${esc(String(comparison.status || "unavailable").replaceAll("_", " ").toUpperCase())}</strong></div><div class="sr-comparison-line"><span>NONAME RECORD</span><b>${esc(internal?.time?.display || "—")}</b><span>${internal ? speedrunRunner(internal) : "No local record"}</span></div>${externals.length ? externals.map((record) => `<div class="sr-comparison-line"><span>${esc(record.source?.label || record.source?.id || "EXTERNAL")}</span><b>${esc(record.time?.display || "—")}</b><span>${esc(record.player?.name || "Unknown runner")} / ${externalLink(record.sourceUrl, "Source record")}</span></div>`).join("") : `<div class="sr-comparison-line"><span>EXTERNAL BASELINE</span><b>—</b><span>No imported record for this class.</span></div>`}</div>`;
}
async function speedrunMap() {
  if (!id) throw Error("Speedrun map missing");
  const [m, comparisonResponse, progression] = await Promise.all([
    get(`speedruns/maps/${encodeURIComponent(id)}`),
    get(`speedruns/comparisons/maps/${encodeURIComponent(id)}`).catch(() => null),
    get(`speedruns/maps/${encodeURIComponent(id)}/progression`).catch(() => null),
  ]);
  const comparisons = comparisonResponse?.comparisons || [];
  const classes = [...new Map([
    ...(m.leaderboard || []).map((row) => [String(row.classId), speedrunClass(row)]),
    ...comparisons.map((row) => [String(row.class?.id), row.class?.name]),
  ]).entries()].filter(([key]) => key && key !== "undefined");
  const selected = classes.find(([key]) => comparisons.some((row) => String(row.class?.id) === key))?.[0] || classes[0]?.[0] || "";
  set(
    `<div class="detail-hero"><div><span class="eyebrow">SPEEDRUN MAP / ${esc(m.category)}</span><h1>${esc(m.displayName || m.map)}</h1></div><div class="detail-stat"><b>${esc(m.summary?.worldRecordDisplay || "—")}</b><small>WORLD RECORD TIME</small></div></div><div class="detail-meta"><span>${m.enabled ? "ENABLED" : "DISABLED"} / CURRENT TIMER</span><span>DIFFICULTY ${m.difficulty == null ? "—" : `D${esc(m.difficulty)}`}</span><span>LAST RUN ${date(m.summary?.lastRunAt)}</span></div><div class="profile-values"><div><small>COMPLETED RUNS</small><b>${fmt(m.summary?.totalRuns)}</b></div><div><small>ATTEMPTS</small><b>${fmt(m.summary?.totalAttempts)}</b></div><div><small>RUNNERS</small><b>${fmt(m.summary?.totalRunners)}</b></div><div><small>RECORDS</small><b>${fmt(m.summary?.totalRecords)}</b></div></div>${section("02", "Class record / community baseline")}<div class="control-bar"><select id="speed-class-filter" aria-label="Filter records and comparisons by class"><option value="">All classes</option>${classes.map(([key, label]) => `<option value="${esc(key)}" ${key === selected ? "selected" : ""}>${esc(label)}</option>`).join("")}</select><span class="micro">CURRENT RULESET / COMPLETED RUNS</span></div><div id="speed-comparison">${comparisonResponse ? mapComparison(comparisons, selected) : message("Imported comparisons unavailable.", "error")}</div>${section("03", "Leaderboard")}<div id="speed-leaderboard"></div>${section("04", "Recent completions")}<div class="sr-run-ledger">${(m.recentRuns || []).slice(0, 20).map((run) => speedrunLine(run, id)).join("") || message("No recent runs.")}</div>${section("05", "Record progression")}<div class="sr-run-ledger">${(m.worldRecordProgression || []).slice(0, 25).map((run) => speedrunLine(run, id)).join("") || message("No record breaks recorded.")}</div><div class="action-row"><a href="${old("speedrun-map.html")}?map=${encodeURIComponent(id)}">Full chart and history ↗</a><a href="${link("speedrun-catalog")}">Server map catalogue ↗</a></div>`,
  );
  const renderRecords = () => {
    const choice = document.querySelector("#speed-class-filter").value;
    const records = (m.leaderboard || []).filter((row) => !choice || String(row.classId) === choice);
    document.querySelector("#speed-leaderboard").innerHTML = records.length
      ? records.map((row) => `<div class="sr-record-line"><span class="number muted">#${fmt(row.rank)}</span><span>${speedrunRunner(row)}<small>${esc(speedrunClass(row))} / ${fmt(row.attempts)} ATTEMPTS / SET ${date(row.achievedAt)}</small></span><strong>${esc(row.bestTimeDisplay)}</strong>${replayAction(row, id)}</div>`).join("")
      : message("No records for this class.");
    document.querySelector("#speed-comparison").innerHTML = comparisonResponse ? mapComparison(comparisons, choice || selected) : message("Imported comparisons unavailable.", "error");
  };
  document.querySelector("#speed-class-filter").onchange = renderRecords;
  renderRecords();
}
async function speedrunPlayer() {
  if (!id) throw Error("Runner ID missing");
  const runner = await get(`speedruns/players/${encodeURIComponent(id)}`);
  const p = runner.player || {};
  const s = runner.summary || {};
  const personalBests = runner.personalBests || [];
  set(`<div class="profile-ribbon"><span>RUNNER FILE / CURRENT RULESET</span><span>${fmt(s.globalRank)} / ${fmt(s.globalRunnerCount)} RUNNERS</span></div><div class="detail-hero player-detail"><div><span class="eyebrow">SPEEDRUN / RUNNER</span><h1>${playerIdentity(p, { name: p.playerName || id, discordId: p.discordId, href: "" })}</h1></div><div class="detail-stat"><b>${fmt(s.currentRecords)}</b><small>CURRENT RECORDS</small></div></div><div class="detail-meta"><span>${(p.steamIds || []).map(esc).join(" / ") || "STEAM ID UNLINKED"}</span><span>LAST RUN ${date(s.lastRunAt)}</span></div><div class="profile-values"><div><small>COMPLETED RUNS</small><b>${fmt(s.totalRuns)}</b></div><div><small>MAPS COMPLETED</small><b>${fmt(s.mapsCompleted)}</b></div><div><small>WORLD RECORDS</small><b>${fmt(s.worldRecords)}</b></div><div><small>BEST RANK</small><b>${s.bestRecordRank ? `#${fmt(s.bestRecordRank)}` : "—"}</b></div></div>${section("02", "Personal bests")}<div class="sr-run-ledger">${personalBests.map((record) => `<div class="sr-record-line"><a href="${link("speedrun-map", "id", record.map)}">${esc(record.map)}</a><span>${esc(speedrunClass(record))}<small>RANK #${fmt(record.rank)} / ${fmt(record.attempts)} ATTEMPTS / SET ${date(record.achievedAt)}</small></span><strong>${esc(record.bestTimeDisplay)}</strong>${replayAction(record)}</div>`).join("") || message("No personal bests.")}</div>${section("03", "World records")}<div class="sr-run-ledger">${(runner.worldRecords || []).map((record) => `<div class="sr-record-line"><a href="${link("speedrun-map", "id", record.map)}">${esc(record.map)}</a><span>${esc(speedrunClass(record))}</span><strong>${esc(record.bestTimeDisplay)}</strong>${replayAction(record)}</div>`).join("") || message("No current world records.")}</div>${section("04", "Recent runs")}<div class="sr-run-ledger">${(runner.recentActivity || []).slice(0, 30).map((run) => speedrunLine(run)).join("") || message("No recent runs.")}</div><div class="action-row"><a href="${old("speedrun-player.html")}?id=${encodeURIComponent(id)}">Full runner history and progress ↗</a>${p.discordId ? `<a href="${link("player", "id", p.discordId)}">Pickup player file ↗</a>` : ""}</div>`);
}
async function speedrunCatalog() {
  const [maps, comparisons] = await Promise.all([
    get("speedruns/server-maps"),
    (async () => {
      const items = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const page = await get(`speedruns/comparisons/leaderboard?limit=500&offset=${offset}`);
        items.push(...(page.items || []));
        offset += page.items?.length || 0;
        hasMore = Boolean(page.pagination?.hasMore && page.items?.length);
      }
      return { items };
    })().catch(() => null),
  ]);
  const rows = Array.isArray(maps) ? maps : [];
  const byMap = new Map();
  for (const comparison of comparisons?.items || []) {
    const key = String(comparison.map?.id || "").toLowerCase();
    if (!key) continue;
    const sourceRows = byMap.get(key) || [];
    sourceRows.push(...(comparison.externals || []));
    byMap.set(key, sourceRows);
  }
  set(`${pageHead("05", "Server map catalogue", "Server coverage, timer setup, and imported community baselines.")}<div class="lede"><span>${fmt(rows.length)} SERVER MAPS</span><span>CURRENT TIMER / IMPORTED SOURCES</span></div>${section("02", "Community reference sources")}<div class="sr-reference-register"><div><span>SQUISHY'S BATCAVE</span>${externalLink("http://squishysbatcave.com/", "Source site")}</div><div><span>CHURCH OF CONC</span>${externalLink("https://churchofconc.servehalflife.com/CofC.php?tab=stats&subtab=speedruns", "Speedrun records")}</div></div>${section("03", "Server map inventory")}<div class="control-bar"><input id="catalog-search" type="search" placeholder="Find a server map" aria-label="Search server maps"><select id="catalog-status" aria-label="Filter timer setup"><option value="">All setup states</option><option value="logged">Logged in DB</option><option value="configured">Configured</option><option value="not_logged">Not logged</option><option value="missing_start">Missing start</option><option value="missing_finish">Missing finish</option><option value="needs_setup">Needs setup</option><option value="records">With records</option></select></div><div id="catalog-rows"></div><div class="action-row"><a href="${link("speedruns")}">← Speedruns</a><a href="${old("speedrun-maps.html")}">Full catalogue and map stats ↗</a></div>`);
  const draw = () => {
    const query = document.querySelector("#catalog-search").value.trim().toLowerCase();
    const filter = document.querySelector("#catalog-status").value;
    const visible = rows.filter((row) => {
      const status = row.setup_status || row.setupStatus || "";
      return (!query || `${row.map} ${(row.servers || []).join(" ")}`.toLowerCase().includes(query)) && (!filter || (filter === "records" ? Number(row.totalRecords) > 0 : filter === "needs_setup" ? status !== "configured" : filter === "logged" ? status !== "not_logged" : status === filter));
    });
    document.querySelector("#catalog-rows").innerHTML = visible.length ? visible.map((row) => {
      const records = byMap.get(String(row.map).toLowerCase()) || [];
      const fastest = (source) => records.filter((record) => record.source?.id === source).sort((a,b) => a.time.milliseconds - b.time.milliseconds)[0];
      const ref = (source, label) => {
        const record = fastest(source);
        return record ? `<span>${esc(label)} ${esc(record.time?.display || "—")} / ${externalLink(record.sourceUrl, "record")}</span>` : "";
      };
      return `<div class="sr-catalog-line"><a href="${link("speedrun-map", "id", row.map)}"><strong>${esc(row.map)}</strong><small>${esc(row.setup_status || row.setupStatus || "UNKNOWN")} / ${esc((row.servers || []).join(", ") || "SERVER UNKNOWN")}</small></a><span>${fmt(row.totalRuns)} RUNS / ${fmt(row.totalRecords)} RECORDS</span><div class="sr-catalog-refs">${ref("squishy", "SQUISHY")}${ref("churchofconc", "CHURCH OF CONC")}</div></div>`;
    }).join("") : message("No server maps fit this filter.");
  };
  document.querySelector("#catalog-search").oninput = draw;
  document.querySelector("#catalog-status").onchange = draw;
  draw();
}
async function analytics() {
  const response = await get("analytics?limit=10");
  const d = response.data || {},
    s = d.summary || {};
  const topMaps = d.maps?.most_played || [];
  set(
    `${pageHead("06", "Analytics", "The long view of a community that keeps playing.")}<div class="data-strip"><div class="strip-cell"><span class="micro">MATCHES</span><strong>${fmt(s.matches)}</strong></div><div class="strip-cell"><span class="micro">PLAYERS IN LOGS</span><strong>${fmt(s.players)}</strong></div><div class="strip-cell"><span class="micro">ROUNDS</span><strong>${fmt(s.rounds)}</strong></div><div class="strip-cell"><span class="micro">TOTAL KILLS</span><strong>${fmt(s.total_kills)}</strong></div></div>${section("02", "Most played maps")}${topMaps.length ? topMaps.map((m, i) => `<a class="map-row" href="${link("map", "id", m.map)}"><b>${String(i + 1).padStart(2, "0")} / ${esc(m.map)}</b><span>${fmt(m.matches || m.value)} GAMES</span><span></span><span>↗</span></a>`).join("") : message("Map analytics unavailable.")}<div class="action-row"><a href="${old("analytics.html")}">Full analytics instrument ↗</a></div>`,
  );
}
async function compare() {
  const p1 = params.get("p1") || "",
    p2 = params.get("p2") || "";
  let data = null,
    error = "";
  if (p1 && p2) {
    try {
      data = (
        await get(
          `compare?p1=${encodeURIComponent(p1)}&p2=${encodeURIComponent(p2)}`,
        )
      ).data;
    } catch (e) {
      error = e.message;
    }
  }
  set(
    `${pageHead("07", "Compare", "Two player histories, one shared record.")}<form class="compare-form" id="compare-form"><label>PLAYER ONE / NAME OR ID<input name="p1" required value="${esc(data?.players?.p1?.name || p1)}" autocomplete="off"></label><label>PLAYER TWO / NAME OR ID<input name="p2" required value="${esc(data?.players?.p2?.name || p2)}" autocomplete="off"></label><button type="submit">COMPARE ↗</button></form><div id="compare-input-error" class="notice empty">Enter exact player names or IDs. Duplicate names require IDs.</div>${error ? message(error, "error") : ""}${data ? `<div class="compare-versus"><div><span class="eyebrow">PLAYER / ONE</span><h2><a href="${link("player", "id", data.players.p1.id)}">${playerIdentity(data.players.p1, { href: "" })}</a></h2><b>${data.players.p1.hidden ? "PRIVATE" : elo(data.players.p1.elo)}</b></div><div><span class="eyebrow">PLAYER / TWO</span><h2><a href="${link("player", "id", data.players.p2.id)}">${playerIdentity(data.players.p2, { href: "" })}</a></h2><b>${data.players.p2.hidden ? "PRIVATE" : elo(data.players.p2.elo)}</b></div></div><div class="profile-values"><div><small>MATCHES TOGETHER</small><b>${fmt(data.stats.teammate.gp)}</b></div><div><small>WINS TOGETHER</small><b>${fmt(data.stats.teammate.w)}</b></div><div><small>HEAD TO HEAD</small><b>${fmt(data.stats.opponent.gp)}</b></div><div><small>H2H WINS</small><b>${fmt(data.stats.opponent.p1_w)}:${fmt(data.stats.opponent.p2_w)}</b></div></div>${section("03", "Shared matches")}${(data.matches || []).map(matchRow).join("") || message("No shared matches recorded.")}` : message("Choose two players to read shared matches and results.")}<div class="action-row"><a href="${old("compare.html")}">Original comparison ↗</a></div>`,
  );
  document.querySelector("#compare-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const button = e.currentTarget.querySelector("button");
    const feedback = document.querySelector("#compare-input-error");
    button.disabled = true;
    feedback.textContent = "Finding players…";
    try {
      const [first, second] = await Promise.all([
        resolveComparePlayer(form.get("p1")),
        resolveComparePlayer(form.get("p2")),
      ]);
      if (first === second) throw Error("Choose two different players.");
      location.href = `${link("compare")}&p1=${encodeURIComponent(first)}&p2=${encodeURIComponent(second)}`;
    } catch (error) {
      feedback.className = "notice error";
      feedback.textContent = error.message;
      button.disabled = false;
    }
  };
}
async function resolveComparePlayer(raw) {
  const value = String(raw || "").trim();
  if (!value) throw Error("Enter both players.");
  if (/^\d{10,25}$/.test(value)) return value;
  const response = await get(
    `players/search?q=${encodeURIComponent(value)}&limit=20`,
  );
  const exact = (response.data || []).filter(
    (player) => player.player.toLowerCase() === value.toLowerCase(),
  );
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1)
    throw Error(`More than one player is named ${value}. Use a player ID.`);
  throw Error(`No player named ${value} was found. Enter an exact name or ID.`);
}
function archive() {
  const items = [
    [
      "Analytics",
      "Community trends, combat, class, and map records",
      link("analytics"),
    ],
    ["Compare", "Head to head player comparisons", link("compare")],
    ["Tracker", "Linked player identities", old("tracker.html")],
    ["Missed votes", "Queue and voting record", old("kicked.html")],
    ["Vegas odds", "Match prediction history", old("vegasodds.html")],
    ["MVP breakdown", "Round and match standouts", old("mvp-breakdown.html")],
    ["Pickup replays", "Interactive match playback", old("pickup-replay.html")],
    [
      "Speedrun runner",
      "Runner history and personal bests",
      old("speedrun-player.html"),
    ],
    [
      "Server guide",
      "Build and server reference",
      old("docs/server-build.html"),
    ],
    ["Admin ELO", "Restricted rating controls", old("admin-elo.html")],
    ["Coolest dude", "Community honors", old("coolest-dude.html")],
    ["Browser spectator", "In browser TFC client", old("live/")],
  ];
  set(
    `${pageHead("08", "Archive", "Specialized instruments from the current NoName system.")}<div class="lede"><span>COMMUNITY INSTRUMENTS / STILL ACTIVE</span><span>COMPLETE RECORD</span></div><div class="archive-grid">${items.map(([title, copy, path], i) => `<a class="archive-link" href="${path}"><span class="eyebrow">${String(i + 1).padStart(2, "0")} / INSTRUMENT</span><strong>${esc(title)} ↗</strong><small>${esc(copy)}</small></a>`).join("")}</div>`,
  );
}
let searchTrigger = null;
let searchRequest = 0;
function openSearch() {
  const layer = document.querySelector("#search-layer");
  searchTrigger = document.activeElement;
  searchRequest++;
  layer.hidden = false;
  document.body.style.overflow = "hidden";
  const input = document.querySelector("#player-search");
  input.value = "";
  document.querySelector("#search-results").textContent =
    "Start typing to search the player record.";
  input.focus();
}
function closeSearch() {
  searchRequest++;
  document.querySelector("#search-layer").hidden = true;
  document.body.style.overflow = "";
  searchTrigger?.focus();
}
function setupSearch() {
  const layer = document.querySelector("#search-layer"),
    input = document.querySelector("#player-search");
  document.querySelector("#close-search").onclick = closeSearch;
  document.querySelector("#header-search").onclick = openSearch;
  layer.addEventListener("click", (e) => {
    if (e.target === layer) closeSearch();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !layer.hidden) closeSearch();
    if (e.key === "Tab" && !layer.hidden) {
      const focusable = [...layer.querySelectorAll("button, input, a")];
      const current = focusable.indexOf(document.activeElement);
      if (e.shiftKey && current <= 0) {
        e.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!e.shiftKey && current === focusable.length - 1) {
        e.preventDefault();
        focusable[0]?.focus();
      }
    }
    if (
      e.key === "/" &&
      layer.hidden &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
    ) {
      e.preventDefault();
      openSearch();
    }
  });
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const request = ++searchRequest;
    const q = input.value.trim();
    if (q.length < 2) {
      document.querySelector("#search-results").textContent =
        "Enter at least two characters.";
      return;
    }
    timer = setTimeout(async () => {
      try {
        const response = await get(
          `players/search?q=${encodeURIComponent(q)}&limit=8`,
        );
        if (request !== searchRequest || layer.hidden) return;
        document.querySelector("#search-results").innerHTML = response.data
          ?.length
          ? response.data
              .map(
                (p) =>
                  `<a href="${link("player", "id", p.id)}"><strong>${playerIdentity(p, { href: "" })}</strong><span class="number">${p.hidden ? "PRIVATE" : elo(p.elo)} ↗</span></a>`,
              )
              .join("")
          : message("No players found.");
      } catch {
        if (request !== searchRequest || layer.hidden) return;
        document.querySelector("#search-results").innerHTML = message(
          "Search unavailable. Try again.",
          "error",
        );
      }
    }, 220);
  });
}
async function render() {
  loading();
  try {
    try {
      const supporters = await get("supporters");
      supporterIds = new Set((supporters.supporters || []).map(String));
    } catch {
      supporterIds = new Set();
    }
    await (
      {
        overview,
        live,
        matches,
        match,
        players,
        player,
        maps,
        map,
        speedruns,
        "speedrun-map": speedrunMap,
        "speedrun-player": speedrunPlayer,
        "speedrun-catalog": speedrunCatalog,
        analytics,
        compare,
        archive,
      }[view] || overview
    )();
  } catch (error) {
    console.error(error);
    fail(error);
  }
}
function setupQueueToast() {
  if (view === "live") return;
  const toast = document.querySelector("#queue-toast");
  const countLabel = document.querySelector("#queue-toast-count");
  let currentCount = 0;
  let dismissedCount = null;
  let requestInFlight = false;
  document.querySelector("#dismiss-queue-toast").onclick = () => {
    dismissedCount = currentCount;
    toast.hidden = true;
  };
  const checkQueue = async () => {
    if (document.hidden || requestInFlight) return;
    requestInFlight = true;
    try {
      const queue = await get("queue");
      currentCount = Number(queue.count) || 0;
      if (view === "overview") {
        const rail = document.querySelector(".live-rail");
        if (rail) {
          rail.querySelector(".queue-number").innerHTML = `${fmt(queue.count)}<small> / ${fmt(queue.max)}</small>`;
          rail.querySelector(".queue-peek").innerHTML = queueNamesMarkup(queue);
          rail.querySelector(".micro.muted").textContent = `PLAYERS QUEUED / ${localTime()} LOCAL`;
          const active = queue.liveMatches?.[0];
          if (Boolean(active) !== (rail.dataset.liveMatch === "true")) {
            overview();
          } else if (active) {
            const points = liveRoundScore(active);
            const scoreNumbers = rail.querySelectorAll(".rail-scores b");
            rail.querySelector(".rail-map").textContent = active.map_name || active.map || "Awaiting a pickup";
            rail.querySelector(".rail-context").textContent = `${liveRoundLabel(active)} / TEAM 1 : TEAM 2`;
            if (scoreNumbers.length === 2) {
              scoreNumbers[0].textContent = points.team1 ?? "—";
              scoreNumbers[1].textContent = points.team2 ?? "—";
            }
          }
        }
      }
      if (currentCount < 5) dismissedCount = null;
      countLabel.textContent = `${currentCount}/${Number(queue.max) || 8} PLAYERS QUEUED`;
      toast.hidden = currentCount < 5 || dismissedCount === currentCount;
    } catch {
      toast.hidden = true;
    } finally {
      requestInFlight = false;
    }
  };
  document.addEventListener("visibilitychange", checkQueue);
  setInterval(checkQueue, 5000);
  checkQueue();
}
wireNav();
setupSearch();
setupQueueToast();
render();
