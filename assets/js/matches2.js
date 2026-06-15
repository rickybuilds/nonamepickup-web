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
    expandedMatchId: null
  };

  const $ = (id) => document.getElementById(id);

  async function getJSON(url) {
    if (typeof window.fetchJSON === "function") return window.fetchJSON(url);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`[matches2] failed: ${url}`, err);
      return { ok: false, data: [] };
    }
  }

  function esc(value) {
    if (typeof window.nnHelpers?.escapeHtml === "function") {
      return window.nnHelpers.escapeHtml(value);
    }
    return String(value ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

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

  function rosterHtml(players,teamClass){
  if(!Array.isArray(players)||!players.length)return "—";
  return `<div class="team-list ${teamClass}">${players.map(p=>{
  const id=p.id||p.player_id||p.discord_id||"";
  const name=p.name||p.display_name||p.player||id||"unknown";
  const supporter=window.supporterBadge&&window.supporterBadge(id)?`<span class="supporter-badge supporter-inline" title="Server Supporter">💎</span>`:"";
  return `<a href="player.html?id=${encodeURIComponent(id)}">${esc(name)}${supporter}</a>`;
  }).join(" <span class=\"score-dash\">•</span> ")}</div>`;
  }

  function scoreHtml(m) {
    const b = m.score_blue == null ? "?" : m.score_blue;
    const r = m.score_red == null ? "?" : m.score_red;
    return `
      <span class="score-wrap">
        <span class="score-pill score-blue">${esc(b)}</span>
        <span class="score-dash">-</span>
        <span class="score-pill score-red">${esc(r)}</span>
      </span>
    `;
  }

  function winnerBadge(m) {
    const w = String(m.winner || "").toUpperCase();
    if (m.status === "pending" || !w) return `<span class="winner-badge badge-pending">PENDING</span>`;
    if (w === "BLUE") return `<span class="winner-badge badge-blue">BLUE</span>`;
    if (w === "RED") return `<span class="winner-badge badge-red">RED</span>`;
    if (w === "TIE") return `<span class="winner-badge badge-tie">TIE</span>`;
    return `<span class="winner-badge badge-pending">${esc(w)}</span>`;
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
		const id = p.id || p.player_id || p.discord_id || "";
		const name = p.name || p.display_name || p.player || id || "unknown";
		const hidden = isEloHidden(p);
		const before = hidden ? "Hidden" : (p.before ?? "—");
		const after = hidden ? "" : ` → ${esc(p.after ?? "—")}`;
		const delta = p.delta ?? 0;

		return `
		  <div class="m2-elo-player">
			<a class="m2-elo-name" href="player.html?id=${encodeURIComponent(id)}">${esc(name)}${window.supporterBadge&&window.supporterBadge(id)?`<span class="supporter-badge supporter-inline" title="Server Supporter">💎</span>`:""}</a>
			<span class="m2-elo-before-after">${esc(before)}${after}</span>
			<span class="m2-elo-delta ${hidden ? "m2-delta-zero" : deltaClass(delta)}">${hidden ? "Hidden" : fmtDelta(delta)}</span>
		  </div>
		`;
	  }).join("");
	}

  function matchButtons(m) {
    const buttons = [];

    if (m.hampalyzer_url) {
      buttons.push(`
        <a class="m2-report-btn m2-report-hamp" href="${esc(m.hampalyzer_url)}" target="_blank" rel="noopener noreferrer">
          Open Hampalyzer ↗
        </a>
      `);
    }

    if (m.tfcstats_url) {
      buttons.push(`
        <a class="m2-report-btn m2-report-tfc" href="${esc(m.tfcstats_url)}" target="_blank" rel="noopener noreferrer">
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
  
  function expandedRowHtml(m) {
    return `
      <tr class="matches2-expanded-row">
        <td colspan="7">
          <div class="m2-expanded-card">
            <div class="m2-expanded-top">
              <div>
                <p class="m2-expanded-kicker">MATCH REPORT</p>
                <h3>${esc(m.map_name)} <span>${scoreHtml(m)}</span></h3>
                <small>${esc(m.id)} · ${fmtDate(m.created_at)} · ${esc(m.status)}</small>
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
        </td>
      </tr>
    `;
  }

  function renderRows() {
    const body = $("matches2-body");
    if (!body) return;

    const start = (state.currentPage - 1) * state.pageSize;
    const pageRows = state.filtered.slice(start, start + state.pageSize);

    if (!pageRows.length) {
      body.innerHTML = `<tr><td colspan="7" class="matches2-empty">No matches found for those filters.</td></tr>`;
      return;
    }

    body.innerHTML = pageRows.map(m => {
      const rowClasses = [
        "matches2-main-row",
        winnerClass(m.winner),
        m.status === "pending" ? "row-pending" : "",
        state.expandedMatchId === m.id ? "m2-row-expanded" : ""
      ].filter(Boolean).join(" ");

      const reportIcon = m.tfcstats_url ? `<span class="m2-mini-report">2 reports</span>` :
        m.hampalyzer_url ? `<span class="m2-mini-report">report</span>` : "";

      const matchId =
      `<a href="match.html?id=${encodeURIComponent(m.id)}" class="match-id-link">${esc(m.id)}</a>`;

      const mainRow = `
        <tr class="${rowClasses}" data-match-id="${esc(m.id)}" title="Click row to expand match details">
          <td>
            <span class="m2-expand-caret">${state.expandedMatchId === m.id ? "▾" : "▸"}</span>
            ${matchId}
            ${reportIcon}
          </td>
          <td class="whitespace-nowrap">${fmtDate(m.created_at)}</td>
          <td><a class="map-link" href="map.html?map=${encodeURIComponent(m.map_name || "")}">${esc(m.map_name)}</a></td>
          <td>${rosterHtml(m.blueTeam, "blue-team")}</td>
          <td>${rosterHtml(m.redTeam, "red-team")}</td>
          <td class="text-center">${scoreHtml(m)}</td>
          <td class="text-center">${winnerBadge(m)}</td>
        </tr>
      `;

      return mainRow + (state.expandedMatchId === m.id ? expandedRowHtml(m) : "");
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
    renderRows();
    renderPagination();
  }

  function scrollToTable() {
    const panel = $("matches2-table");
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function populateMapFilter(maps) {
    const select = $("m2-map-filter");
    if (!select) return;
    const unique = Array.from(new Set(maps.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    select.innerHTML = `<option value="all">All Maps</option>` + unique.map(map =>
      `<option value="${esc(map)}">${esc(map)}</option>`
    ).join("");
  }

  function calcAverageScore(rows) {
    const scored = rows.filter(m => Number.isFinite(m.score_blue) && Number.isFinite(m.score_red));
    if (!scored.length) return "—";
    const blue = Math.round(scored.reduce((sum, m) => sum + Number(m.score_blue), 0) / scored.length);
    const red = Math.round(scored.reduce((sum, m) => sum + Number(m.score_red), 0) / scored.length);
    return `${blue} - ${red}`;
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
    if ($("m2-top-map")) $("m2-top-map").textContent = topMap?.map || "—";
    if ($("m2-top-map-games")) $("m2-top-map-games").textContent = topMap ? `${topMap.games} games` : "—";
    if ($("m2-avg-score")) $("m2-avg-score").textContent = calcAverageScore(state.all);
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
      const row = e.target.closest("tr.matches2-main-row[data-match-id]");
      if (!row) return;
      const id = row.dataset.matchId;
      state.expandedMatchId = state.expandedMatchId === id ? null : id;
      render();
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
