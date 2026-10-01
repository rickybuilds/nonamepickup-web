"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const number = new Intl.NumberFormat("en-US");
  const state = { events: [] };

  function playerUrl(id) {
    return `player.html?id=${encodeURIComponent(String(id || ""))}`;
  }

  function displayDate(event) {
    const date = event.timestamp_ms
      ? new Date(event.timestamp_ms)
      : new Date(event.timestamp);
    if (Number.isNaN(date.getTime())) return event.timestamp || "Unknown time";

    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function renderChart(players) {
    const target = document.getElementById("kicked-chart");
    const chartRows = players.slice(0, 12);
    const maxKicks = Math.max(1, chartRows[0]?.kicks || 0);

    target.innerHTML = chartRows.map(player => {
      const width = Math.max(4, Math.round((player.kicks / maxKicks) * 100));
      return `
        <a class="kicked-bar-row" href="${escapeAttr(playerUrl(player.id))}" aria-label="${escapeAttr(`${player.name}: ${player.kicks} kicks`)}">
          <span class="kicked-bar-rank">#${number.format(player.rank)}</span>
          <span class="kicked-bar-name">${escapeHtml(player.name)}</span>
          <span class="kicked-bar-track" aria-hidden="true">
            <span class="kicked-bar" style="--bar-width:${width}%"></span>
          </span>
          <strong class="kicked-bar-value">${number.format(player.kicks)}×</strong>
        </a>
      `;
    }).join("") || `<p class="kicked-empty">No kick data yet.</p>`;
  }

  function renderRanking(players) {
    document.getElementById("kicked-ranking-count").textContent =
      `${number.format(players.length)} ${players.length === 1 ? "player" : "players"}`;
    document.getElementById("kicked-ranking").innerHTML = players.map(player => `
      <li>
        <span class="kicked-ranking-rank">#${number.format(player.rank)}</span>
        <div class="kicked-ranking-player">
          <a href="${escapeAttr(playerUrl(player.id))}">${escapeHtml(player.name)}</a>
          <small>${player.last_kicked_at ? `Last: ${escapeHtml(player.last_kicked_at)}` : "No date recorded"}</small>
        </div>
        <strong class="kicked-ranking-count">${number.format(player.kicks)}×</strong>
      </li>
    `).join("");
  }

  function renderHistory() {
    const query = document.getElementById("kicked-filter").value.trim().toLowerCase();
    const filtered = state.events.filter(event =>
      !query ||
      event.players.some(player =>
        String(player.name || "").toLowerCase().includes(query) ||
        String(player.id || "").toLowerCase().includes(query)
      )
    );

    const target = document.getElementById("kicked-history");
    const empty = document.getElementById("kicked-history-empty");
    target.innerHTML = filtered.map(event => `
      <article class="kicked-event">
        <div class="kicked-event-top">
          <time datetime="${event.timestamp_ms ? new Date(event.timestamp_ms).toISOString() : ""}">${escapeHtml(displayDate(event))}</time>
          <span class="kicked-reason">${escapeHtml(String(event.reason || "unknown").replaceAll("_", " "))}</span>
        </div>
        <div class="kicked-event-players">
          ${event.players.map(player => `
            <a href="${escapeAttr(playerUrl(player.id))}">${escapeHtml(player.name)}</a>
          `).join("")}
        </div>
      </article>
    `).join("");
    empty.hidden = filtered.length > 0;
  }

  function renderCoverageRange(events) {
    const earliest = events.reduce((oldest, event) => {
      const value = Number(event.timestamp_ms) || Date.parse(event.timestamp || "");
      if (!Number.isFinite(value)) return oldest;
      return oldest == null || value < oldest ? value : oldest;
    }, null);

    document.getElementById("kicked-chart-range").textContent = earliest == null
      ? "Since records began"
      : `Since ${new Date(earliest).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric"
        })}`;
  }

  async function loadKicked() {
    const error = document.getElementById("kicked-error");
    const payload = await fetchJSON("/api/kicked");

    if (!payload.ok) {
      error.hidden = false;
      error.textContent = "The kicked.json data could not be loaded right now.";
      document.getElementById("kicked-updated").textContent = "Kick history unavailable";
      return;
    }

    const summary = payload.summary || {};
    const leaderboard = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
    state.events = Array.isArray(payload.events) ? payload.events : [];
    renderCoverageRange(state.events);

    document.getElementById("kicked-total").textContent = number.format(summary.missed_votes || 0);
    document.getElementById("kicked-events").textContent = number.format(summary.kick_events || 0);
    document.getElementById("kicked-players").textContent = number.format(summary.unique_players || 0);

    const worst = leaderboard[0];
    document.getElementById("kicked-worst").textContent = worst?.name || "Nobody yet";
    document.getElementById("kicked-worst-note").textContent =
      worst ? `${number.format(worst.kicks)} missed ${worst.kicks === 1 ? "vote" : "votes"}` : "clean record";

    const generatedAt = new Date(payload.generated_at || Date.now());
    document.getElementById("kicked-updated").textContent =
      `Updated ${generatedAt.toLocaleString()}`;

    renderChart(leaderboard);
    renderRanking(leaderboard);
    renderHistory();
  }

  document.getElementById("kicked-filter").addEventListener("input", renderHistory);
  loadKicked();
});
