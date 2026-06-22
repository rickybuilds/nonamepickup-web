(() => {
  "use strict";

  const PAGE_SIZE_DEFAULT = 50;
  const ALL_MATCH_LIMIT = 5000;

  const state = {
    all: [],
    filtered: [],
    currentPage: 1,
    pageSize: PAGE_SIZE_DEFAULT,
    loadedAt: null,
    expandedMatchId: null,
    detailsById: new Map(),
    detailLoadingIds: new Set(),
    mobileDrawerOpen: false,
    mobileDrawerCollapsed: false
  };

  const $ = (id) => document.getElementById(id);

  function isMobileDock() {
    return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 900px)").matches;
  }

  async function getJSON(url) {
    if (typeof window.nnHelpers?.fetchJSON === "function") {
      return window.nnHelpers.fetchJSON(url);
    }
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`[matches2] failed: ${url}`, err);
      return { ok: false, data: [] };
    }
  }

  const fallbackEscapeHtml = value =>
    String(value ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  const escapeHtml = window.nnHelpers?.escapeHtml || fallbackEscapeHtml;
  const escapeAttr = window.nnHelpers?.escapeAttr || (value =>
    escapeHtml(String(value ?? "").replace(/[\r\n]/g, ""))
  );
  const supporterBadge = window.nnHelpers?.supporterBadge;

  function fmtDate(ts) {
    if (!ts) return "—";
    const n = Number(ts);
    const date = String(ts).length < 13 && Number.isFinite(n) ? new Date(n * 1000) : new Date(n || ts);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  const winnerClass = window.nnHelpers.winnerRowClass;

  function normalizeMatch(m) {
    const blue = Array.isArray(m.blueTeam) ? m.blueTeam : [];
    const red = Array.isArray(m.redTeam) ? m.redTeam : [];
    const scoreBlue = m.score_blue == null ? null : Number(m.score_blue);
    const scoreRed = m.score_red == null ? null : Number(m.score_red);
    const winner = String(m.winner || "").toUpperCase();
    const status = String(m.status || (winner ? "completed" : "pending")).toLowerCase();

    return {
      id: String(m.id || m.match_id || "—"),
      created_at: Number(m.created_at || m.createdAt || 0),
      map_name: String(m.map_name || m.map || "Unknown"),
      winner,
      status,
      blueTeam: blue,
      redTeam: red,
      score_blue: Number.isFinite(scoreBlue) ? scoreBlue : null,
      score_red: Number.isFinite(scoreRed) ? scoreRed : null,
      hampalyzer_url: m.hampalyzer_url || null,
      tfcstats_url: m.tfcstats_url || null
    };
  }

  function playerId(p) {
    return p?.id || p?.player_id || p?.discord_id || "";
  }

  function playerName(p) {
    const id = playerId(p);
    return p?.name || p?.display_name || p?.player || id || "unknown";
  }

  function playerLink(p, className = "") {
    const id = playerId(p);
    const href = escapeAttr(`player.html?id=${encodeURIComponent(id)}`);
    const classAttr = className ? ` class="${escapeAttr(className)}"` : "";
    const supporter = supporterBadge ? supporterBadge(id) : "";
    return `<a${classAttr} href="${href}">${escapeHtml(playerName(p))}${supporter}</a>`;
  }

  function rosterHtml(players,teamClass){
  if(!Array.isArray(players)||!players.length)return "—";
  return `<div class="team-list ${teamClass}">${players.map(p=>
    playerLink(p)
  ).join(" <span class=\"score-dash\">•</span> ")}</div>`;
  }

  function scoreHtml(m) {
    const b = m.score_blue == null ? "?" : m.score_blue;
    const r = m.score_red == null ? "?" : m.score_red;
    return `
      <span class="score-wrap">
        <span class="score-pill score-blue">${escapeHtml(b)}</span>
        <span class="score-dash">-</span>
        <span class="score-pill score-red">${escapeHtml(r)}</span>
      </span>
    `;
  }

  function winnerBadge(m) {
    const w = String(m.winner || "").toUpperCase();
    if (m.status === "pending" || !w) return `<span class="winner-badge badge-pending">PENDING</span>`;
    if (w === "BLUE") return `<span class="winner-badge badge-blue">BLUE</span>`;
    if (w === "RED") return `<span class="winner-badge badge-red">RED</span>`;
    if (w === "TIE") return `<span class="winner-badge badge-tie">TIE</span>`;
    return `<span class="winner-badge badge-pending">${escapeHtml(w)}</span>`;
  }

  function reportCount(m) {
    return (m.hampalyzer_url ? 1 : 0) + (m.tfcstats_url ? 1 : 0);
  }

  function selectedMatch() {
    if (!state.expandedMatchId) return null;
    return state.filtered.find(m => m.id === state.expandedMatchId) ||
      state.all.find(m => m.id === state.expandedMatchId) ||
      null;
  }

  function currentPageRows() {
    const start = (state.currentPage - 1) * state.pageSize;
    return state.filtered.slice(start, start + state.pageSize);
  }

  function ensureSelectedMatch() {
    const rows = currentPageRows();
    if (!rows.length) {
      state.expandedMatchId = null;
      return;
    }
    if (!rows.some(m => m.id === state.expandedMatchId)) {
      state.expandedMatchId = rows[0].id;
    }
  }

  function combinedScore(m) {
    return Number(m.score_blue || 0) + Number(m.score_red || 0);
  }

  function scoreDiff(m) {
    if (m.score_blue == null || m.score_red == null) return null;
    return Math.abs(Number(m.score_blue) - Number(m.score_red));
  }

  function isCloseOrTie(m) {
    const diff = scoreDiff(m);
    return m.winner === "TIE" || (diff != null && diff < 15);
  }

  function isWithin25(m) {
    const diff = scoreDiff(m);
    return diff != null && diff <= 25;
  }

  function isBlowout(m) {
    const diff = scoreDiff(m);
    return diff != null && diff > 25 && m.winner !== "TIE";
  }

  function buildSearchBlob(m) {
    const players = [...(m.blueTeam || []), ...(m.redTeam || [])]
      .map(p => p.name || p.display_name || p.player || p.id || "")
      .join(" ");
    return `${m.id} ${m.map_name} ${m.winner} ${m.status} ${players}`.toLowerCase();
  }

  function applyFilters(resetPage = true) {
    const q = $("m2-search")?.value.trim().toLowerCase() || "";
    const map = $("m2-map-filter")?.value || "all";
    const winner = $("m2-winner-filter")?.value || "all";
    const outcome = $("m2-outcome-filter")?.value || "all";
    const sort = $("m2-sort-filter")?.value || "newest";

    let rows = [...state.all];

    if (q) rows = rows.filter(m => buildSearchBlob(m).includes(q));
    if (map !== "all") rows = rows.filter(m => m.map_name === map);
    if (winner !== "all") rows = rows.filter(m => m.winner === winner);

    if (outcome === "close") rows = rows.filter(isCloseOrTie);
    if (outcome === "under25") rows = rows.filter(isWithin25);
    if (outcome === "blowout") rows = rows.filter(isBlowout);
    if (outcome === "pending") rows = rows.filter(m => m.status === "pending");

    rows.sort((a, b) => {
      if (sort === "oldest") return (a.created_at || 0) - (b.created_at || 0);
      if (sort === "score-high") return combinedScore(b) - combinedScore(a) || (b.created_at || 0) - (a.created_at || 0);
      if (sort === "score-low") return combinedScore(a) - combinedScore(b) || (b.created_at || 0) - (a.created_at || 0);
      return (b.created_at || 0) - (a.created_at || 0);
    });

    state.filtered = rows;
    if (resetPage) state.currentPage = 1;

    if (state.expandedMatchId && !rows.some(m => m.id === state.expandedMatchId)) {
      state.expandedMatchId = null;
    }

    render();
  }

  function deltaClass(delta) {
    const d = Number(delta || 0);
    if (d > 0) return "m2-delta-pos";
    if (d < 0) return "m2-delta-neg";
    return "m2-delta-zero";
  }

  function fmtDelta(delta) {
    const d = Number(delta || 0);
    return d > 0 ? `+${d}` : String(d);
  }

	function isEloHidden(p){
	  return p.hide_elo === 1 || p.hide_elo === "1" || p.hidden === true || p.elo_hidden === 1;
	}

	function eloRows(players, side) {
	  if (!Array.isArray(players) || !players.length) {
		return `<div class="m2-elo-empty">No ${side} player data available.</div>`;
	  }

	  return players.map(p => {
		const hidden = isEloHidden(p);
		const before = hidden ? "Hidden" : (p.before ?? "—");
		const after = hidden ? "" : ` → ${escapeHtml(p.after ?? "—")}`;
		const delta = p.delta ?? 0;

		return `
		  <div class="m2-elo-player">
			${playerLink(p, "m2-elo-name")}
			<span class="m2-elo-before-after">${escapeHtml(before)}${after}</span>
			<span class="m2-elo-delta ${hidden ? "m2-delta-zero" : deltaClass(delta)}">${hidden ? "Hidden" : fmtDelta(delta)}</span>
		  </div>
		`;
	  }).join("");
	}

  function matchButtons(m) {
    const buttons = [];

    if (m.hampalyzer_url) {
      buttons.push(`
        <a class="m2-report-btn m2-report-hamp" href="${escapeAttr(m.hampalyzer_url)}" target="_blank" rel="noopener noreferrer">
          Open Hampalyzer ↗
        </a>
      `);
    }

    if (m.tfcstats_url) {
      buttons.push(`
        <a class="m2-report-btn m2-report-tfc" href="${escapeAttr(m.tfcstats_url)}" target="_blank" rel="noopener noreferrer">
          Open TFC Stats ↗
        </a>
      `);
    }

    if (!buttons.length) {
      return `<span class="m2-no-report">No match report links saved yet.</span>`;
    }

    return buttons.join("");
  }

	function teamDeltaTotal(players) {
	  return (players || []).reduce((sum, p) => {
		if (isEloHidden(p)) return sum;
		if (p.before == null || p.after == null || p.delta == null) return sum;
		return sum + (Number(p.delta) || 0);
	  }, 0);
	}
  
  function expandedCardHtml(m) {
    return `
          <div class="m2-expanded-card" id="match-card-detail-${escapeAttr(m.id)}">
            <div class="m2-expanded-top">
              <div>
                <p class="m2-expanded-kicker">MATCH REPORT</p>
                <h3>${escapeHtml(m.map_name)} <span>${scoreHtml(m)}</span></h3>
                <small>${escapeHtml(m.id)} · ${fmtDate(m.created_at)} · ${escapeHtml(m.status)}</small>
              </div>
              <div class="m2-report-actions">
                ${matchButtons(m)}
              </div>
            </div>

            <div class="m2-expanded-grid">
              <div class="m2-elo-panel m2-blue-panel">
                <div class="m2-elo-header">
                  <span>Blue Elo Changes</span>
                  <strong>${teamDeltaTotal(m.blueTeam) >= 0 ? "+" : ""}${teamDeltaTotal(m.blueTeam)}</strong>
                </div>

                ${eloRows(m.blueTeam, "blue")}
              </div>

              <div class="m2-elo-panel m2-red-panel">
                <div class="m2-elo-header">
                  <span>Red Elo Changes</span>
                  <strong>${teamDeltaTotal(m.redTeam) >= 0 ? "+" : ""}${teamDeltaTotal(m.redTeam)}</strong>
                </div>

                ${eloRows(m.redTeam, "red")}
              </div>
            </div>
          </div>
    `;
  }

  function matchCardHtml(m, cardClasses, matchId, reportIcon) {
    return `
      <article
        class="${cardClasses}"
        data-match-id="${escapeAttr(m.id)}"
        title="Click card to expand match details"
        aria-expanded="${state.expandedMatchId === m.id ? "true" : "false"}"
      >
        <div class="m2-card-accent" aria-hidden="true"></div>

        <div class="m2-card-main">
          <div class="m2-card-meta">
            <span class="m2-expand-caret">${state.expandedMatchId === m.id ? "v" : ">"}</span>
            <div>
              <div class="m2-card-id-row">${matchId}${reportIcon}</div>
              <time>${fmtDate(m.created_at)}</time>
            </div>
          </div>

          <a class="map-link m2-card-map" href="map.html?map=${encodeURIComponent(m.map_name || "")}">${escapeHtml(m.map_name)}</a>

          <div class="m2-card-score">
            ${scoreHtml(m)}
            ${winnerBadge(m)}
          </div>
        </div>

        <div class="m2-card-teams" aria-label="Match teams">
          <section class="m2-card-team m2-card-team-blue">
            <div class="m2-card-team-title"><span>Blue Team</span><strong>${m.blueTeam.length}</strong></div>
            ${rosterHtml(m.blueTeam, "blue-team")}
          </section>
          <section class="m2-card-team m2-card-team-red">
            <div class="m2-card-team-title"><span>Red Team</span><strong>${m.redTeam.length}</strong></div>
            ${rosterHtml(m.redTeam, "red-team")}
          </section>
        </div>
      </article>
    `;
  }

  function selectedDetailMatch(m) {
    const detail = state.detailsById.get(m.id);
    if (!detail || detail.error) return m;
    return {
      ...m,
      ...detail,
      id: String(detail.id || detail.match_id || m.id),
      map_name: String(detail.map_name || detail.map || m.map_name),
      blueTeam: Array.isArray(detail.blueTeam) ? detail.blueTeam : m.blueTeam,
      redTeam: Array.isArray(detail.redTeam) ? detail.redTeam : m.redTeam,
      score_blue: detail.score_blue == null ? m.score_blue : Number(detail.score_blue),
      score_red: detail.score_red == null ? m.score_red : Number(detail.score_red),
      winner: String(detail.winner || m.winner || "").toUpperCase(),
      status: String(detail.status || m.status || "").toLowerCase(),
      hampalyzer_url: detail.hampalyzer_url || m.hampalyzer_url,
      tfcstats_url: detail.tfcstats_url || m.tfcstats_url
    };
  }

  function viewerScoreHtml(m) {
    const hasBlue = m.score_blue != null && Number.isFinite(Number(m.score_blue));
    const hasRed = m.score_red != null && Number.isFinite(Number(m.score_red));
    const hasScore = hasBlue && hasRed;
    const blue = hasBlue ? m.score_blue : "-";
    const red = hasRed ? m.score_red : "-";
    return `
      <div class="m2-viewer-score ${hasScore ? "" : "is-pending"}">
        <div class="blue"><span>Blue</span><strong>${escapeHtml(blue)}</strong></div>
        <i>${hasScore ? "-" : "vs"}</i>
        <div class="red"><span>Red</span><strong>${escapeHtml(red)}</strong></div>
      </div>
    `;
  }

  function compactScoreText(m) {
    const blue = m.score_blue == null ? "-" : m.score_blue;
    const red = m.score_red == null ? "-" : m.score_red;
    return `${blue} - ${red}`;
  }

  function syncMobileDrawerState(viewer) {
    const open = isMobileDock() && state.mobileDrawerOpen && !!state.expandedMatchId;
    const collapsed = open && state.mobileDrawerCollapsed;
    viewer.classList.toggle("m2-dock-open", open);
    viewer.classList.toggle("m2-dock-collapsed", collapsed);
    document.body.classList.toggle("m2-mobile-dock-open", open);
    document.body.classList.toggle("m2-mobile-dock-collapsed", collapsed);
  }

  function capTeamClass(team) {
    const normalized = String(team || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (normalized === "1" || normalized === "blu" || normalized.includes("team1") || normalized.includes("blue")) return "blue";
    if (normalized === "2" || normalized.includes("team2") || normalized.includes("red")) return "red";
    return "neutral";
  }

  function capTeamLabel(team) {
    const teamClass = capTeamClass(team);
    if (teamClass === "blue") return "Blue";
    if (teamClass === "red") return "Red";
    return String(team || "Team");
  }

  function renderViewerCapTimeline(capTimeline) {
    if (!Array.isArray(capTimeline) || !capTimeline.length) return "";
    const maxSeconds = 15 * 60;
    const events = [...capTimeline]
      .map(event => ({
		  team: event.team,
		  cap_num: event.cap_num ?? event.capNumber ?? event.cap,
		  time_seconds: Number(event.time_seconds ?? event.timeSeconds ?? 0),
		  time_text: event.time_text || event.timeText || "",
		  score_after: event.score_after || event.scoreAfter || "",
		  capper_name: event.capper_name || event.capperName || "",
		  capper_steam_id: event.capper_steam_id || event.capperSteamId || ""
		}))
      .sort((a, b) => Number(a.time_seconds || 0) - Number(b.time_seconds || 0));
    const laneGapPercent = 5.2;
    const laneCount = 4;
    const laneLastLeft = Array(laneCount).fill(-Infinity);
    const eventsWithLanes = events.map(event => {
      const seconds = Number(event.time_seconds || 0);
      const left = Math.max(3, Math.min(97, (seconds / maxSeconds) * 100));
      let lane = laneLastLeft.findIndex(lastLeft => left - lastLeft >= laneGapPercent);
      if (lane < 0) lane = laneLastLeft.indexOf(Math.min(...laneLastLeft));
      laneLastLeft[lane] = left;
      return { ...event, left, lane };
    });

    return `
      <section class="m2-viewer-section m2-viewer-cap-section">
        <div class="m2-viewer-section-head">
          <span>Flag Pace</span>
          <strong>Capture Timeline</strong>
        </div>
        <div class="m2-viewer-cap-track">
          ${eventsWithLanes.map(event => {
            const left = event.left;
            const teamClass = capTeamClass(event.team);
            const label = capTeamLabel(event.team);
            const capNum = event.cap_num || "";
            const capper = event.capper_name || "";
            const title = `${label} Capture #${capNum}${capper ? ` - ${capper}` : ""}`;
            const icon = teamClass === "red"
              ? "assets/images/icons/webp/red-flag.webp"
              : "assets/images/icons/webp/blue-flag.webp";
            return `
              <span
                class="m2-viewer-cap-marker ${teamClass}"
                style="left:${left}%;--cap-lane:${event.lane};--cap-shift:${(event.lane - 1.5) * 3}px"
                title="${escapeAttr(title)}"
                aria-label="${escapeAttr([title,event.time_text].filter(Boolean).join(" - "))}"
              >
                <img src="${escapeAttr(icon)}" alt="" loading="lazy" aria-hidden="true">
                <span class="m2-viewer-cap-badge">${escapeHtml(capNum)}</span>
              </span>
            `;
          }).join("")}
        </div>
        <div class="m2-viewer-cap-axis"><span>0:00</span><span>5:00</span><span>10:00</span><span>15:00</span></div>
        <div class="m2-viewer-cap-list">
		  ${events.map(event => `
			<div class="m2-viewer-cap-event ${capTeamClass(event.team)}">
			  <span></span>
			  <div class="m2-viewer-cap-main">
				<div class="m2-viewer-cap-row">
				  <b>${escapeHtml(capTeamLabel(event.team))} Cap ${escapeHtml(event.cap_num || "")}</b>
				  <em>${escapeHtml(event.time_text || "")}</em>
				</div>
				${event.capper_name ? `<strong>${escapeHtml(event.capper_name)}</strong>` : ""}
			  </div>
			</div>
		  `).join("")}
		</div>
      </section>
    `;
  }

  function renderViewerTeams(m) {
    return `
      <section class="m2-viewer-section">
        <div class="m2-viewer-rosters">
          <div class="m2-viewer-roster blue">
            <div class="m2-viewer-section-head"><span>Blue</span><strong>${m.blueTeam.length} Players</strong></div>
            ${rosterHtml(m.blueTeam, "blue-team")}
          </div>
          <div class="m2-viewer-roster red">
            <div class="m2-viewer-section-head"><span>Red</span><strong>${m.redTeam.length} Players</strong></div>
            ${rosterHtml(m.redTeam, "red-team")}
          </div>
        </div>
      </section>
    `;
  }

  function hydrateViewerMap(mapName) {
    const img = $("m2-viewer-map-image");
    if (!img) return;
    if (typeof window.setMapImageFromName === "function") {
      window.setMapImageFromName(img, mapName, {
        containerSelector: ".m2-viewer-map-wrap",
        fallbackSrc: "assets/images/maps/NoMap.webp"
      });
      return;
    }
    img.src = "assets/images/maps/NoMap.webp";
  }

  function renderSelectedViewer() {
    const viewer = $("matches2-viewer");
    if (!viewer) return;

    const baseMatch = selectedMatch();
    if (!baseMatch) {
      viewer.innerHTML = `<div class="m2-viewer-empty"><span>No matches found</span><p>Adjust filters to select a match.</p></div>`;
      syncMobileDrawerState(viewer);
      return;
    }

    const detail = state.detailsById.get(baseMatch.id);
    const m = selectedDetailMatch(baseMatch);
    const loading = state.detailLoadingIds.has(baseMatch.id);
    const reports = reportCount(m);
    const capTimeline = Array.isArray(detail?.capTimeline) ? detail.capTimeline :
      Array.isArray(detail?.cap_timeline) ? detail.cap_timeline :
      Array.isArray(detail?.cap_events) ? detail.cap_events :
      [];

    viewer.innerHTML = `
      <div class="m2-viewer-card">
        <div class="m2-viewer-mobile-bar">
          <button class="m2-viewer-mobile-toggle" type="button" data-m2-viewer-toggle aria-expanded="${state.mobileDrawerCollapsed ? "false" : "true"}">
            <span>
              <b>${escapeHtml(m.map_name)}</b>
              <small>${escapeHtml(m.id)}</small>
            </span>
            <strong>${escapeHtml(compactScoreText(m))}</strong>
          </button>
          <button class="m2-viewer-mobile-close" type="button" data-m2-viewer-close aria-label="Close selected match viewer">x</button>
        </div>

        <div class="m2-viewer-map-wrap">
          <img id="m2-viewer-map-image" class="m2-viewer-map-image" src="assets/images/maps/NoMap.webp" alt="${escapeAttr(m.map_name)} map preview">
          <div class="m2-viewer-map-overlay"></div>
          <div class="m2-viewer-map-label">${escapeHtml(m.map_name)}</div>
          ${viewerScoreHtml(m)}
        </div>

        <div class="m2-viewer-body">
          <div class="m2-viewer-top">
            <div>
              <p class="m2-viewer-kicker">${loading ? "Loading detail" : "Selected Match"}</p>
              <h3>${escapeHtml(m.id)}</h3>
              <small>${fmtDate(m.created_at)} · ${escapeHtml(m.map_name)}</small>
            </div>
            ${winnerBadge(m)}
          </div>

          ${renderViewerTeams(m)}
          ${renderViewerCapTimeline(capTimeline)}

          <div class="m2-viewer-actions">
            ${reports ? matchButtons(m) : ""}
            <a class="m2-report-btn m2-report-full" href="match.html?id=${encodeURIComponent(m.id)}">Full Match Page</a>
          </div>
        </div>
      </div>
    `;

    syncMobileDrawerState(viewer);
    hydrateViewerMap(m.map_name);
  }

  async function loadSelectedMatchDetail() {
    const m = selectedMatch();
    if (!m || state.detailsById.has(m.id) || state.detailLoadingIds.has(m.id)) return;

    state.detailLoadingIds.add(m.id);
    renderSelectedViewer();

    try {
      const data = await getJSON(`/api/match/${encodeURIComponent(m.id)}`);
      const detail = data?.match || null;
      state.detailsById.set(m.id, detail || { error: true });
    } catch (err) {
      console.error("[matches2] selected match detail failed", err);
      state.detailsById.set(m.id, { error: true });
    } finally {
      state.detailLoadingIds.delete(m.id);
      if (state.expandedMatchId === m.id) renderSelectedViewer();
    }
  }

  function renderRows() {
    const body = $("matches2-body");
    if (!body) return;

    const pageRows = currentPageRows();

    if (!pageRows.length) {
      body.innerHTML = `<div class="matches2-empty">No matches found for those filters.</div>`;
      return;
    }

    body.innerHTML = pageRows.map(m => {
      const cardClasses = [
        "matches2-match-card",
        winnerClass(m.winner),
        m.status === "pending" ? "row-pending" : "",
        state.expandedMatchId === m.id ? "m2-card-selected" : ""
      ].filter(Boolean).join(" ");

      const reports = reportCount(m);
      const reportIcon = reports ? `<span class="m2-mini-report">${reports} ${reports === 1 ? "report" : "reports"}</span>` : "";

      const matchId =
      `<a href="match.html?id=${encodeURIComponent(m.id)}" class="match-id-link">${escapeHtml(m.id)}</a>`;

      return matchCardHtml(m, cardClasses, matchId, reportIcon);
    }).join("");
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);

    const prev = $("m2-prev-page");
    const next = $("m2-next-page");
    const nums = $("m2-page-numbers");
    const range = $("m2-range-label");
    const visible = $("matches2-visible-count");

    if (prev) prev.disabled = state.currentPage <= 1;
    if (next) next.disabled = state.currentPage >= totalPages;

    const start = state.filtered.length ? ((state.currentPage - 1) * state.pageSize) + 1 : 0;
    const end = Math.min(state.currentPage * state.pageSize, state.filtered.length);
    if (range) range.textContent = `${start}-${end} of ${state.filtered.length} · Page ${state.currentPage} of ${totalPages}`;
    if (visible) visible.textContent = String(state.filtered.length);

    if (!nums) return;

    const pages = [];
    const push = (p) => { if (!pages.includes(p) && p >= 1 && p <= totalPages) pages.push(p); };

    push(1);
    push(2);
    for (let p = state.currentPage - 1; p <= state.currentPage + 1; p++) push(p);
    push(totalPages - 1);
    push(totalPages);
    pages.sort((a, b) => a - b);

    let last = 0;
    nums.innerHTML = pages.map(p => {
      const gap = p - last > 1 ? `<span class="matches2-page-dots">...</span>` : "";
      last = p;
      return `${gap}<button type="button" class="matches2-page-number ${p === state.currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
    }).join("");

    nums.querySelectorAll("button[data-page]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.currentPage = Number(btn.dataset.page) || 1;
        render();
        scrollToTable();
      });
    });
  }

  function render() {
    ensureSelectedMatch();
    renderRows();
    renderPagination();
    renderSelectedViewer();
    loadSelectedMatchDetail();
  }

  function scrollToTable() {
    const panel = $("matches2-list");
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function populateMapFilter(maps) {
    const select = $("m2-map-filter");
    if (!select) return;
    const unique = Array.from(new Set(maps.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    select.innerHTML = `<option value="all">All Maps</option>` + unique.map(map =>
      `<option value="${escapeAttr(map)}">${escapeHtml(map)}</option>`
    ).join("");
  }

  function fitTopMapKpi() {
    const el = $("m2-top-map");
    if (!el) return;
    el.style.fontSize = "";
    const base = Number.parseFloat(getComputedStyle(el).fontSize) || 33;
    const min = 18;
    let size = base;
    while (el.scrollWidth > el.clientWidth && size > min) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }

  async function loadKpis() {
    const [summary, outcomes, maps] = await Promise.all([
      getJSON("/api/stats/summary"),
      getJSON("/api/stats/matchOutcomes"),
      getJSON("/api/mapaverages")
    ]);

    const s = summary.data || {};
    const o = outcomes.data || {};
    const mapRows = maps.data || [];
    const topMap = mapRows[0];

    if ($("m2-total-matches")) $("m2-total-matches").textContent = s.totalMatches ?? state.all.length ?? "—";
    if ($("m2-close-games")) $("m2-close-games").textContent = (Number(o.ties || 0) + Number(o.under15 || 0)) || "—";
    if ($("m2-ties")) $("m2-ties").textContent = o.ties ?? "—";
    if ($("m2-tie-pct")) {
      const pct = o.total ? ((Number(o.ties || 0) / Number(o.total)) * 100).toFixed(1) : "—";
      $("m2-tie-pct").textContent = pct === "—" ? "—" : `${pct}% of matches`;
    }
    if ($("m2-top-map")) {
      $("m2-top-map").textContent = topMap?.map || "—";
      fitTopMapKpi();
    }
    if ($("m2-top-map-games")) $("m2-top-map-games").textContent = topMap ? `${topMap.games} games` : "—";
  }

  function wireEvents() {
    const debounced = (() => {
      let t;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => applyFilters(true), 120);
      };
    })();

    $("m2-search")?.addEventListener("input", debounced);
    $("m2-map-filter")?.addEventListener("change", () => applyFilters(true));
    $("m2-winner-filter")?.addEventListener("change", () => applyFilters(true));
    $("m2-outcome-filter")?.addEventListener("change", () => applyFilters(true));
    $("m2-sort-filter")?.addEventListener("change", () => applyFilters(true));

    $("m2-page-size")?.addEventListener("change", (e) => {
      state.pageSize = Number(e.target.value) || PAGE_SIZE_DEFAULT;
      state.currentPage = 1;
      render();
    });

    $("m2-clear-filters")?.addEventListener("click", () => {
      if ($("m2-search")) $("m2-search").value = "";
      if ($("m2-map-filter")) $("m2-map-filter").value = "all";
      if ($("m2-winner-filter")) $("m2-winner-filter").value = "all";
      if ($("m2-outcome-filter")) $("m2-outcome-filter").value = "all";
      if ($("m2-sort-filter")) $("m2-sort-filter").value = "newest";
      state.expandedMatchId = null;
      applyFilters(true);
    });

    window.addEventListener("resize", fitTopMapKpi);
    window.addEventListener("resize", () => {
      const viewer = $("matches2-viewer");
      if (viewer) syncMobileDrawerState(viewer);
    });

    $("m2-prev-page")?.addEventListener("click", () => {
      if (state.currentPage <= 1) return;
      state.currentPage--;
      state.expandedMatchId = null;
      render();
      scrollToTable();
    });

    $("m2-next-page")?.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
      if (state.currentPage >= totalPages) return;
      state.currentPage++;
      state.expandedMatchId = null;
      render();
      scrollToTable();
    });

    $("matches2-body")?.addEventListener("click", (e) => {
      if (e.target.closest("a, button, select, input")) return;
      const card = e.target.closest(".matches2-match-card[data-match-id]");
      if (!card) return;
      const id = card.dataset.matchId;
      state.expandedMatchId = state.expandedMatchId === id ? null : id;
      if (isMobileDock()) {
        state.mobileDrawerOpen = true;
        state.mobileDrawerCollapsed = false;
      }
      if (!state.expandedMatchId) {
        state.mobileDrawerOpen = false;
      }
      render();
    });

    $("matches2-viewer")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-m2-viewer-close]")) {
        state.mobileDrawerOpen = false;
        state.mobileDrawerCollapsed = false;
        renderSelectedViewer();
        return;
      }

      if (e.target.closest("[data-m2-viewer-toggle]")) {
        state.mobileDrawerCollapsed = !state.mobileDrawerCollapsed;
        renderSelectedViewer();
      }
    });
  }

  async function init() {
    if (!$("matches2-body")) return;

    wireEvents();

    const matches = await getJSON(`/api/matches?limit=${ALL_MATCH_LIMIT}&offset=0&includePending=1`);
    state.all = (matches.data || []).map(normalizeMatch);
    state.loadedAt = new Date();

    populateMapFilter(state.all.map(m => m.map_name));
    await loadKpis();

    const updated = $("matches2-updated");
    if (updated) updated.textContent = `Last updated ${state.loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    applyFilters(true);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
