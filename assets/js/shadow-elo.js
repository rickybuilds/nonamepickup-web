"use strict";

const selState = {
  limit: 100,
  matchPage: 1,
  replay: null,
  scenario: "actual",
  request: null,
  requestId: 0
};

const selStatus = document.getElementById("sel-status");
const selContent = document.getElementById("sel-content");
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

function selWhole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number)) : "—";
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
  const players = (snapshot.players || snapshot.v1_changes || []).map(change => {
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
      actual_delta: Number(change.actual_delta ?? change.delta ?? 0),
      nn_score: Number(details.nn_score),
      rank: Number(details.rank)
    };
  });

  const fallback = selIsFallback(payload) || Boolean(snapshot.fallback);

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

function selFormatDate(timestamp) {
  if (!timestamp) return "Date unavailable";
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function selMatchTeamTable(game, team) {
  const players = game.players.filter(player => player.team === team).sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return `<div class="sel-match-team ${team.toLowerCase()}">
    <h3>${team === "BLUE" ? "Blue team" : "Red team"}</h3>
    <table class="sel-match-table">
      <thead><tr><th>Player</th><th>Starting Elo</th><th>NN score</th><th>Rank</th><th>Actual</th></tr></thead>
      <tbody>${players.map(player => `
        <tr>
          <td><span class="sel-player-name">${selEscape(player.name)}</span></td>
          <td>${selWhole(player.before)}</td>
          <td>${Number.isFinite(player.nn_score) ? selNumber(player.nn_score, 2) : "—"}</td>
          <td>${Number.isFinite(player.rank) ? `#${player.rank}` : "—"}</td>
          <td class="${selTone(player.actual_delta)}">${selSigned(player.actual_delta, 1)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  </div>`;
}

function selRenderMatches(replay) {
  const matches = replay.games.slice().reverse();
  const pageCount = Math.max(1, Math.ceil(matches.length / 20));
  selState.matchPage = Math.min(selState.matchPage, pageCount);
  const pageStart = (selState.matchPage - 1) * 20;
  const visibleMatches = matches.slice(pageStart, pageStart + 20);
  document.getElementById("sel-matches").innerHTML = visibleMatches.map((game, pageIndex) => `
    <details class="sel-match">
      <summary>
        <span class="sel-match-number">#${matches.length - pageStart - pageIndex}</span>
        <span class="sel-match-title"><strong>${selEscape(game.match_id)} · ${selEscape(game.map_name || "Unknown map")}</strong><span>${selEscape(game.winner || "Unknown")} result</span></span>
        <span class="sel-match-date">${selEscape(selFormatDate(game.created_at))}</span>
        <span class="sel-team-pool blue">Blue ${selSigned(game.pools.BLUE, 0)}</span>
        <span class="sel-team-pool red">Red ${selSigned(game.pools.RED, 0)}</span>
        <span class="sel-fallback ${game.fallback ? "" : "none"}" title="${selEscape((game.fallback_reasons || []).join(", "))}">${game.fallback ? "Equal fallback" : "Weighted"}</span>
        <span class="sel-chevron">⌄</span>
      </summary>
      <div class="sel-match-body">
        ${game.fallback ? `<p class="sel-fallback-reason"><strong>Equal-share fallback:</strong> ${selEscape((game.fallback_reasons || []).join(", ").replaceAll("_", " "))}</p>` : ""}
        <div class="sel-match-teams">${selMatchTeamTable(game, "BLUE")}${selMatchTeamTable(game, "RED")}</div>
      </div>
    </details>
  `).join("") + `<nav class="sel-pagination" aria-label="Replay ledger pages">
    <button type="button" data-match-page="prev" ${selState.matchPage === 1 ? "disabled" : ""}>Previous</button>
    <span>Page ${selState.matchPage} of ${pageCount}</span>
    <button type="button" data-match-page="next" ${selState.matchPage === pageCount ? "disabled" : ""}>Next</button>
  </nav>`;
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
  selStatus.hidden = true;
  selContent.hidden = false;
  selState.matchPage = 1;
  selRenderMatches(replay);
  selRenderValidation(replay);
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
  selContent.hidden = true;
  selStatus.className = "sel-status";
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
  }
}

document.getElementById("sel-matches")?.addEventListener("click", event => {
  const button = event.target.closest("button[data-match-page]");
  if (!button || button.disabled || !selState.replay) return;
  const pageCount = Math.max(1, Math.ceil(selState.replay.games.length / 20));
  selState.matchPage = Math.max(1, Math.min(pageCount, selState.matchPage + (button.dataset.matchPage === "next" ? 1 : -1)));
  selRenderMatches(selState.replay);
});

selLoad();
