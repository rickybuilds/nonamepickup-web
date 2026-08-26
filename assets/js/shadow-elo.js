"use strict";

const selState = {
  limit: 20,
  replay: null,
  scenario: "actual",
  selectedPlayer: null,
  chart: null,
  request: null,
  requestId: 0
};

const selStatus = document.getElementById("sel-status");
const selContent = document.getElementById("sel-content");
const selRefresh = document.getElementById("sel-refresh");
const selPlayerRows = document.getElementById("sel-player-rows");
const selFilter = document.getElementById("sel-player-filter");
const SEL_SCENARIOS = ["actual"];
const SEL_COLORS = ["#38bdf8", "#a78bfa", "#4ade80", "#fbbf24", "#fb7185", "#60a5fa", "#f472b6", "#22d3ee", "#fb923c", "#818cf8", "#34d399", "#e879f9"];

function selEscape(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function selNumber(value, places = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places })
    : "—";
}

function selSigned(value, places = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (Math.abs(number) < (places ? .005 : .5)) return places ? Number(0).toFixed(places) : "0";
  return `${number > 0 ? "+" : "−"}${selNumber(Math.abs(number), places)}`;
}

function selTone(value) {
  const number = Number(value);
  return number > .004 ? "sel-diff-pos" : number < -.004 ? "sel-diff-neg" : "sel-diff-zero";
}

function selObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function selPlayerId(row, fallback = "") {
  return String(row?.player_id ?? row?.playerId ?? row?.discord_id ?? row?.id ?? row?.key ?? fallback);
}

function selRows(source) {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (typeof source !== "object") return [];
  for (const key of ["players", "player_results", "player_deltas", "deltas", "allocations", "results", "rows"]) {
    if (source[key]) return selRows(source[key]);
  }
  return Object.entries(source).map(([key, value]) => {
    if (typeof value === "number") return { player_id: key, delta: value };
    return { ...(selObject(value) || {}), player_id: selPlayerId(value, key) };
  });
}

function selNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function selEnrichment(payload) {
  const candidates = [payload?.players, payload?.nn_scores, payload?.rankings, payload?.mvp?.players, payload?.performance?.players];
  const map = new Map();
  for (const candidate of candidates) {
    for (const row of selRows(candidate)) {
      const id = selPlayerId(row);
      if (!id) continue;
      const current = map.get(id) || {};
      map.set(id, {
        ...current,
        ...row,
        nn_score: row.nn_score ?? row.mvp_score ?? row.score ?? row.final_score ?? current.nn_score,
        rank: row.team_rank ?? row.rank ?? row.nn_rank ?? current.rank
      });
    }
  }
  return map;
}

function selParseIds(value) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function selPools(payload, actualRows) {
  const source = payload?.team_pools || payload?.v1_team_pools || payload?.pools || payload?.team_totals || {};
  const read = team => {
    const direct = Number(source?.[team] ?? source?.[team.toLowerCase()] ?? source?.[`${team.toLowerCase()}_pool`] ?? payload?.[`${team.toLowerCase()}_team_pool`]);
    if (Number.isFinite(direct)) return direct;
    return actualRows.filter(row => row.team === team).reduce((sum, row) => sum + Number(row.actual_delta || 0), 0);
  };
  return { BLUE: read("BLUE"), RED: read("RED") };
}

function selIsFallback(payload) {
  return Boolean(
    payload?.equal_share_fallback || payload?.used_equal_share_fallback || payload?.fallback === "equal_share" ||
    payload?.fallback_used || payload?.allocation?.fallback === "equal"
  );
}

function selNormalizeSnapshot(snapshot, index) {
  const payload = snapshot.payload || {};
  const blueIds = new Set(selParseIds(snapshot.blue_ids));
  const redIds = new Set(selParseIds(snapshot.red_ids));
  const extra = selEnrichment(payload);
  const players = (snapshot.v1_changes || []).map(change => {
    const id = selPlayerId(change);
    const details = extra.get(id) || {};
    const displayName = change.display_name || details.display_name || details.player || details.name || id;
    const team = blueIds.has(id) ? "BLUE" : redIds.has(id) ? "RED" : String(details.team || details.team_name || "").toUpperCase();
    return {
      id,
      name: displayName,
      team,
      before: selNullableNumber(change.before),
      after: selNullableNumber(change.after),
      actual_delta: Number(change.delta || 0),
      nn_score: Number(details.nn_score),
      rank: Number(details.rank)
    };
  });

  const fallback = selIsFallback(payload);

  return {
    ...snapshot,
    sequence: index + 1,
    players,
    pools: selPools(payload, players),
    fallback,
    incomplete: false
  };
}

function selBuildReplay(snapshots) {
  const games = snapshots.map(selNormalizeSnapshot).filter(game => game.players.length);
  const players = new Map();
  const labels = ["Start", ...games.map(game => game.match_id)];

  for (const game of games) {
    for (const row of game.players) {
      if (!players.has(row.id)) {
        const start = Number.isFinite(row.before) ? row.before : Number(row.after) - row.actual_delta;
        const emptyPath = Array(game.sequence).fill(null);
        players.set(row.id, {
          id: row.id, name: row.name, start, actual: start,
          games: 0, joinedAt: game.sequence,
          paths: { actual: [...emptyPath] }
        });
      }
      const player = players.get(row.id);
      player.name = row.name || player.name;
    }

    for (const player of players.values()) {
      const row = game.players.find(item => item.id === player.id);
      if (row) {
        player.games += 1;
        player.actual += row.actual_delta;
      }
      for (const scenario of SEL_SCENARIOS) {
        if (game.sequence < player.joinedAt) player.paths[scenario].push(null);
        else player.paths[scenario].push(player[scenario]);
      }
    }
  }

  for (const player of players.values()) {
    player.paths.actual[0] = player.start;
  }

  const playerList = [...players.values()].sort((a, b) => b.actual - a.actual || a.name.localeCompare(b.name));
  return { games, players: playerList, labels };
}

function selRenderKpis(replay) {
  const topPlayer = replay.players[0];
  const fallbacks = replay.summary?.fallback_matches ?? replay.games.filter(game => game.fallback).length;
  const discrepancies = replay.summary?.validation_discrepancies ?? replay.validation?.length ?? 0;
  document.getElementById("sel-kpis").innerHTML = `
    <article class="sel-kpi"><span>Actual games replayed</span><strong>${replay.games.length}</strong><small>Oldest through today</small></article>
    <article class="sel-kpi accent"><span>Players compared</span><strong>${replay.players.length}</strong><small>Real V1 starting Elo</small></article>
    <article class="sel-kpi ${fallbacks ? "warn" : "good"}"><span>Equal-share fallbacks</span><strong>${fallbacks}</strong><small>${discrepancies} V1 validation discrepancies</small></article>
    <article class="sel-kpi"><span>Top actual Elo</span><strong>${topPlayer ? selNumber(topPlayer.actual, 1) : "—"}</strong><small>${topPlayer ? selEscape(topPlayer.name) : "No replayed players"}</small></article>
  `;
}

function selRenderChart() {
  const replay = selState.replay;
  if (!replay || typeof Chart === "undefined") return;
  const canvas = document.getElementById("sel-chart");
  const player = replay.players.find(item => item.id === selState.selectedPlayer) || replay.players[0];
  if (!player) return;
  document.getElementById("sel-chart-player").textContent = player.name;
  const datasets = [
    { key: "actual", label: "Actual 20%-30%", color: "#4d8fff" }
  ].map(series => ({
    label: series.label,
    data: player.paths[series.key],
    borderColor: series.color,
    backgroundColor: "transparent",
    borderWidth: 2.5,
    pointRadius: 1.5,
    pointHoverRadius: 4,
    tension: .22,
    spanGaps: true
  }));

  if (selState.chart) selState.chart.destroy();
  selState.chart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: { labels: replay.labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: true, labels: { color: "#9baccc", boxWidth: 18, boxHeight: 2, font: { size: 10, weight: "bold" } } },
        tooltip: { backgroundColor: "#050a14", borderColor: "rgba(77,143,255,.35)", borderWidth: 1, titleColor: "#fff", bodyColor: "#b7c4df" }
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,.035)" }, ticks: { color: "#667591", maxTicksLimit: 12, font: { size: 9 } } },
        y: { grid: { color: "rgba(255,255,255,.05)" }, ticks: { color: "#7b8aa7", font: { size: 9 } }, title: { display: true, text: "ELO", color: "#667591", font: { size: 9, weight: "bold" } } }
      }
    }
  });
}

function selRenderPlayers() {
  if (!selState.replay) return;
  const query = String(selFilter?.value || "").trim().toLowerCase();
  selPlayerRows.innerHTML = selState.replay.players.filter(player => player.name.toLowerCase().includes(query)).map(player => `
    <tr data-player-id="${selEscape(player.id)}" class="${selState.selectedPlayer === player.id ? "selected" : ""}">
      <td><span class="sel-player-name">${selEscape(player.name)}</span><span class="sel-player-games">${player.games} selected games</span></td>
      <td class="sel-elo">${selNumber(player.start, 1)}</td>
      <td class="sel-elo">${selNumber(player.actual, 1)}</td>
      <td class="${selTone(player.actual - player.start)}">${selSigned(player.actual - player.start, 1)}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">No matching players.</td></tr>`;
}

function selFormatDate(timestamp) {
  if (!timestamp) return "Date unavailable";
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function selMatchRows(game) {
  return game.players.slice().sort((a, b) => a.team.localeCompare(b.team) || (a.rank || 99) - (b.rank || 99)).map(player => `
    <tr>
      <td><i class="sel-team-tag ${player.team.toLowerCase()}"></i><span class="sel-player-name">${selEscape(player.name)}</span></td>
      <td>${selNumber(player.before, 1)}</td>
      <td>${Number.isFinite(player.nn_score) ? selNumber(player.nn_score, 2) : "—"}</td>
      <td>${Number.isFinite(player.rank) ? `#${player.rank}` : "—"}</td>
      <td class="${selTone(player.actual_delta)}">${selSigned(player.actual_delta, 1)}</td>
    </tr>
  `).join("");
}

function selRenderMatches(replay) {
  document.getElementById("sel-matches").innerHTML = replay.games.slice().reverse().map((game, reverseIndex) => `
    <details class="sel-match">
      <summary>
        <span class="sel-match-number">#${replay.games.length - reverseIndex}</span>
        <span class="sel-match-title"><strong>${selEscape(game.match_id)} · ${selEscape(game.map_name || "Unknown map")}</strong><span>${selEscape(game.winner || "Unknown")} result</span></span>
        <span class="sel-match-date">${selEscape(selFormatDate(game.created_at))}</span>
        <span class="sel-team-pool blue">Blue ${selSigned(game.pools.BLUE, 0)}</span>
        <span class="sel-team-pool red">Red ${selSigned(game.pools.RED, 0)}</span>
        <span class="sel-chevron">⌄</span>
        <span class="sel-fallback ${game.fallback ? "" : "none"}" title="${selEscape((game.fallback_reasons || []).join(", "))}">${game.fallback ? "Equal fallback" : "Weighted"}</span>
      </summary>
      <div class="sel-match-body">
        ${game.fallback ? `<p class="sel-fallback-reason"><strong>Equal-share fallback:</strong> ${selEscape((game.fallback_reasons || []).join(", ").replaceAll("_", " "))}</p>` : ""}
        <div class="sel-table-scroll"><table class="sel-match-table">
        <thead><tr><th>Player</th><th>Starting Elo</th><th>NN score</th><th>Team rank</th><th>Actual 20–30%</th></tr></thead>
        <tbody>${selMatchRows(game)}</tbody>
      </table></div></div>
    </details>
  `).join("");
}

function selRenderValidation(replay) {
  const panel = document.getElementById("sel-validation");
  const rows = replay.validation || [];
  if (!rows.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `
    <div class="sel-card-head"><div><p class="sel-card-kicker">V1 VALIDATION</p><h2>${rows.length} historical discrepancies</h2></div><span class="sel-expand-hint">Shown explicitly; simulated records were not written</span></div>
    <ul class="sel-validation-list">${rows.slice(0, 100).map(row => `
      <li><strong>${selEscape(row.match_id)}</strong><b>${selEscape(row.type)}</b><span>${selEscape(row.player_id ? `${row.player_id} · ${row.detail}` : row.detail)}</span></li>
    `).join("")}</ul>
  `;
}

function selRender(replay) {
  selState.replay = replay;
  if (!replay.players.some(player => player.id === selState.selectedPlayer)) selState.selectedPlayer = replay.players[0]?.id || null;
  selStatus.hidden = true;
  selContent.hidden = false;
  selRenderKpis(replay);
  selRenderPlayers();
  selRenderMatches(replay);
  selRenderValidation(replay);
  selRenderChart();
}

async function selLoad() {
  if (selState.request) selState.request.abort();
  const controller = new AbortController();
  const requestId = ++selState.requestId;
  selState.request = controller;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30000);
  selRefresh.disabled = true;
  selRefresh.textContent = "Replaying…";
  selContent.hidden = true;
  selStatus.hidden = false;
  selStatus.className = "sel-status";
  selStatus.innerHTML = `<div class="sel-spinner" aria-hidden="true"></div><strong>Replaying ${selState.limit} games…</strong>`;
  try {
    const response = await fetch(`api/shadow-elo?limit=${selState.limit}`, {
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error === "shadow_elo_unavailable" ? "Historical simulation data is not available yet." : (payload.error || "The replay could not be loaded."));
    const replay = payload.data;
    if (!replay?.games?.length) throw new Error("No replayable historical matches were found in this window.");
    if (requestId === selState.requestId) selRender(replay);
  } catch (error) {
    if (requestId !== selState.requestId) return;
    selStatus.className = "sel-status error";
    const message = timedOut || error?.name === "AbortError"
      ? "The 100-game replay took too long. Try again, or use a smaller window while the server catches up."
      : (error?.message || "Please try again in a moment.");
    selStatus.innerHTML = `<strong>The Elo simulation is unavailable.</strong><span>${selEscape(message)}</span><button class="sel-refresh" type="button" id="sel-status-retry">Try again</button>`;
    document.getElementById("sel-status-retry")?.addEventListener("click", selLoad, { once: true });
  } finally {
    clearTimeout(timeout);
    if (requestId !== selState.requestId) return;
    selState.request = null;
    selRefresh.disabled = false;
    selRefresh.textContent = `Replay ${selState.limit} games`;
  }
}

document.getElementById("sel-window")?.addEventListener("click", event => {
  const button = event.target.closest("button[data-limit]");
  if (!button) return;
  selState.limit = Number(button.dataset.limit);
  document.querySelectorAll("#sel-window button").forEach(item => item.classList.toggle("active", item === button));
  selRefresh.textContent = `Replay ${selState.limit} games`;
  selLoad();
});

selPlayerRows?.addEventListener("click", event => {
  const row = event.target.closest("tr[data-player-id]");
  if (!row) return;
  selState.selectedPlayer = selState.selectedPlayer === row.dataset.playerId ? null : row.dataset.playerId;
  selRenderPlayers();
  selRenderChart();
});

selFilter?.addEventListener("input", selRenderPlayers);
selRefresh?.addEventListener("click", selLoad);
selLoad();
