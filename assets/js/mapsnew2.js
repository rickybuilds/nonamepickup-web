// =============================================
// NoName TFC Pickups — Map Intel V2
// Path: /assets/js/mapsnew2.js
// =============================================

(() => {
  let scoreChart = null;
  let outcomeChart = null;
  let allPlayers = [];
  let allMatches = [];
  let currentSort = "games";

  const $ = id => document.getElementById(id);
  const fetchJSON = window.nnHelpers?.fetchJSON;
  const escapeHtml = window.nnHelpers?.escapeHtml;
  const escapeAttr = window.nnHelpers?.escapeAttr;
  const supporterBadge = window.nnHelpers?.supporterBadge;
  const fmtDate = window.nnHelpers.formatDate;

  function pct(part, total, digits = 1) {
    return total ? `${((part / total) * 100).toFixed(digits)}%` : "0.0%";
  }

function playerLink(p,cls=""){
  const rawId=p.id||p.player_id||"";
  const href=escapeAttr(`player.html?id=${encodeURIComponent(rawId)}`);
  const name=escapeHtml(p.name||p.player||p.display_name||p.id||"Unknown");
  const supporter=supporterBadge
    ? supporterBadge(rawId)
    : "";

  return `<a class="${escapeAttr(cls)}" href="${href}">${name}${supporter}</a>`;
}

  function teamList(arr, cls) {
    if (!Array.isArray(arr) || !arr.length) return "—";
    return arr.map(p => playerLink(p, cls)).join(" • ");
  }

  function winnerTextClass(winner) {
    const w = String(winner || "").toUpperCase();
    if (w === "BLUE") return "winner-blue-text";
    if (w === "RED") return "winner-red-text";
    if (w === "TIE") return "winner-tie-text";
    return "";
  }

  const winnerRowClass = window.nnHelpers.winnerRowClass;

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function getCompletedMatches() {
    return allMatches.filter(m => String(m.status || "completed").toLowerCase() !== "in_progress");
  }

  function calcStats() {
    const completed = getCompletedMatches().filter(m => m.score_blue != null && m.score_red != null);
    const total = completed.length;
    const blueWins = completed.filter(m => String(m.winner || "").toUpperCase() === "BLUE").length;
    const redWins = completed.filter(m => String(m.winner || "").toUpperCase() === "RED").length;
    const ties = completed.filter(m => String(m.winner || "").toUpperCase() === "TIE").length;

    const avgBlue = total ? completed.reduce((s, m) => s + Number(m.score_blue || 0), 0) / total : 0;
    const avgRed = total ? completed.reduce((s, m) => s + Number(m.score_red || 0), 0) / total : 0;
    const avgMargin = total ? completed.reduce((s, m) => s + Math.abs(Number(m.score_blue || 0) - Number(m.score_red || 0)), 0) / total : 0;
    const closeGames = completed.filter(m => Math.abs(Number(m.score_blue || 0) - Number(m.score_red || 0)) < 15).length;

    return { completed, total, blueWins, redWins, ties, avgBlue, avgRed, avgMargin, closeGames };
  }

  function renderKpis(mapName) {
    const s = calcStats();

    setText("kpi-total-games", s.total.toLocaleString());
    setText("kpi-total-sub", `${allMatches.length} loaded`);
    setText("kpi-avg-score", s.total ? `${s.avgBlue.toFixed(1)} - ${s.avgRed.toFixed(1)}` : "—");
    setText("kpi-blue-win", pct(s.blueWins, s.total));
    setText("kpi-blue-wins", `${s.blueWins.toLocaleString()} wins`);
    setText("kpi-red-win", pct(s.redWins, s.total));
    setText("kpi-red-wins", `${s.redWins.toLocaleString()} wins`);
    setText("kpi-tie-win", pct(s.ties, s.total));
    setText("kpi-ties", `${s.ties.toLocaleString()} ties`);
    setText("kpi-margin", s.total ? s.avgMargin.toFixed(1) : "—");
    setText("kpi-margin-sub", s.avgMargin < 15 ? "Close Game" : s.avgMargin < 25 ? "Competitive" : "Blowout Risk");

    setText("donut-total", s.total.toLocaleString());
    setText("legend-blue", `${pct(s.blueWins, s.total)}  ${s.blueWins}`);
    setText("legend-red", `${pct(s.redWins, s.total)}  ${s.redWins}`);
    setText("legend-tie", `${pct(s.ties, s.total)}  ${s.ties}`);

    const tagPopularity = $("tag-popularity");
    const tagBalance = $("tag-balance");
    const tagStyle = $("tag-style");

    if (tagPopularity) {
      tagPopularity.textContent = s.total >= 100 ? "Most Played" : s.total >= 40 ? "Active Map" : "Low Sample";
      tagPopularity.className = `tag ${s.total >= 100 ? "tag-blue" : s.total >= 40 ? "tag-purple" : "tag-gray"}`;
    }

    if (tagBalance) {
      const spread = Math.abs(s.blueWins - s.redWins);
      tagBalance.textContent = s.total && spread / s.total < .12 ? "Balanced" : s.blueWins > s.redWins ? "Blue Lean" : s.redWins > s.blueWins ? "Red Lean" : "Balanced";
      tagBalance.className = `tag ${s.total && spread / s.total < .12 ? "tag-purple" : s.blueWins > s.redWins ? "tag-blue" : "tag-red"}`;
    }

    if (tagStyle) {
      tagStyle.textContent = s.avgMargin < 15 ? "Close Games" : s.avgMargin < 25 ? "Mid Margin" : "Blowout Heavy";
      tagStyle.className = `tag ${s.avgMargin < 15 ? "tag-gold" : s.avgMargin < 25 ? "tag-gray" : "tag-red"}`;
    }
  }

  function renderPlayers() {
    const body = $("map-v2-players-body");
    if (!body) return;

    const rows = [...allPlayers].sort((a, b) => {
      if (currentSort === "winrate") {
        const aw = Number(a.winRate || 0);
        const bw = Number(b.winRate || 0);
        return bw - aw || Number(b.gp || 0) - Number(a.gp || 0);
      }
      if (currentSort === "wins") {
        return Number(b.w || 0) - Number(a.w || 0) || Number(b.gp || 0) - Number(a.gp || 0);
      }
      return Number(b.gp || 0) - Number(a.gp || 0) || Number(b.w || 0) - Number(a.w || 0);
    }).slice(0, 8);

    body.innerHTML = rows.map((p, i) => `
      <tr>
        <td class="row-rank">${i + 1}</td>
        <td>${playerLink({ id: p.id, name: p.player }, i % 2 ? "player-red" : "player-blue")}</td>
        <td>${p.gp ?? 0}</td>
        <td>${p.w ?? 0}</td>
        <td class="${Number(p.winRate || 0) >= 50 ? "winner-blue-text" : "winner-red-text"}">${p.winRate ?? "0.0"}%</td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="empty-row">No player data</td></tr>`;
  }

  function renderMatches() {
    const body = $("map-v2-matches-body");
    if (!body) return;

    const rows = allMatches;
    body.innerHTML = rows.map(m => {
      const winner = String(m.winner || "").toUpperCase();
      const matchId = escapeHtml(m.id || "—");
      const matchCell = m.hampalyzer_url
        ? `<a class="match-link" href="${escapeAttr(m.hampalyzer_url)}" target="_blank" rel="noopener noreferrer">${matchId}</a>`
        : `<span class="match-link">${matchId}</span>`;

      return `
        <tr class="${winnerRowClass(winner)}">
          <td>${fmtDate(m.created_at)}</td>
          <td class="score-cell">${m.score_blue ?? "?"} - ${m.score_red ?? "?"}</td>
          <td class="${winnerTextClass(winner)}">${winner || "—"}</td>
          <td>${teamList(m.blueTeam, "player-blue")}</td>
          <td>${teamList(m.redTeam, "player-red")}</td>
          <td>${matchCell}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6" class="empty-row">No matches found</td></tr>`;
  }

  function renderRivalries() {
    const rivalryBody = $("map-v2-rivalries-body");
    const duoBody = $("map-v2-duos-body");
    if (!rivalryBody || !duoBody) return;

    const rivalryMap = new Map();
    const duoMap = new Map();

    allMatches.forEach(m => {
      const blue = m.blueTeam || [];
      const red = m.redTeam || [];
      const winner = String(m.winner || "").toUpperCase();

      blue.forEach(b => red.forEach(r => {
        const pair = [
          { id: String(b.id), name: b.name },
          { id: String(r.id), name: r.name }
        ].sort((a, z) => a.name.localeCompare(z.name));
        const key = `${pair[0].id}|${pair[1].id}`;
        const item = rivalryMap.get(key) || { a: pair[0], b: pair[1], count: 0 };
        item.count++;
        rivalryMap.set(key, item);
      }));

      const winningTeam = winner === "BLUE" ? blue : winner === "RED" ? red : [];
      for (let i = 0; i < winningTeam.length; i++) {
        for (let j = i + 1; j < winningTeam.length; j++) {
          const pair = [
            { id: String(winningTeam[i].id), name: winningTeam[i].name },
            { id: String(winningTeam[j].id), name: winningTeam[j].name }
          ].sort((a, z) => a.name.localeCompare(z.name));
          const key = `${pair[0].id}|${pair[1].id}`;
          const item = duoMap.get(key) || { a: pair[0], b: pair[1], wins: 0 };
          item.wins++;
          duoMap.set(key, item);
        }
      }
    });

    const rivalries = [...rivalryMap.values()].sort((a, b) => b.count - a.count).slice(0, 6);
    const duos = [...duoMap.values()].sort((a, b) => b.wins - a.wins).slice(0, 6);

    rivalryBody.innerHTML = rivalries.map(x => `
      <tr>
        <td>${playerLink(x.a, "player-blue")} <span class="team-vs">vs</span> ${playerLink(x.b, "player-red")}</td>
        <td>${x.count}</td>
      </tr>
    `).join("") || `<tr><td colspan="2" class="empty-row">No rivalries yet</td></tr>`;

    duoBody.innerHTML = duos.map(x => `
      <tr>
        <td>${playerLink(x.a, "player-blue")} <span class="team-vs">+</span> ${playerLink(x.b, "player-red")}</td>
        <td>${x.wins}</td>
      </tr>
    `).join("") || `<tr><td colspan="2" class="empty-row">No winning duos yet</td></tr>`;
  }

  function renderCharts() {
    if (typeof Chart === "undefined") return;

    const scoreCanvas = $("map-v2-score-chart");
    const outcomeCanvas = $("map-v2-outcome-chart");
    const rows = [...allMatches]
      .filter(m => m.score_blue != null && m.score_red != null)
      .reverse();

    if (scoreCanvas) {
      if (scoreChart) scoreChart.destroy();
      scoreChart = new Chart(scoreCanvas.getContext("2d"), {
        type: "line",
        data: {
          labels: rows.map((_, i) => i + 1),
          datasets: [
            {
              label: "Team 1 Score",
              data: rows.map(m => Number(m.score_blue || 0)),
              borderColor: "#3b82f6",
              backgroundColor: "rgba(59,130,246,.12)",
              borderWidth: 3,
              tension: .35,
              pointRadius: 3,
              pointHoverRadius: 6
            },
            {
              label: "Team 2 Score",
              data: rows.map(m => Number(m.score_red || 0)),
              borderColor: "#ef4444",
              backgroundColor: "rgba(239,68,68,.12)",
              borderWidth: 3,
              tension: .35,
              pointRadius: 3,
              pointHoverRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: "#cbd5e1", boxWidth: 14, font: { weight: "bold" } }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "Match (Oldest → Newest)", color: "#94a3b8" },
              grid: { color: "rgba(148,163,184,.08)" },
              ticks: { color: "#94a3b8" }
            },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(148,163,184,.08)" },
              ticks: { color: "#94a3b8" }
            }
          }
        }
      });
    }

    if (outcomeCanvas) {
      const s = calcStats();
      if (outcomeChart) outcomeChart.destroy();
      outcomeChart = new Chart(outcomeCanvas.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: ["Team 1 Wins", "Team 2 Wins", "Ties"],
          datasets: [{
            data: [s.blueWins, s.redWins, s.ties],
            backgroundColor: ["#2563eb", "#dc2626", "#94a3b8"],
            borderColor: "rgba(8,13,26,.92)",
            borderWidth: 4,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "64%",
          plugins: { legend: { display: false } }
        }
      });
    }
  }


  function formatShortDate(ts) {
    if (!ts) return "—";
    return new Date(Number(ts) * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function renderHeroIntel() {
  const most = [...allPlayers].sort((a,b)=>Number(b.gp||0)-Number(a.gp||0))[0];

  const mostPlayedEl=document.getElementById("map-v2-most-played-by");
  if(mostPlayedEl){
    mostPlayedEl.innerHTML=
      escapeHtml(most?.player||"—")+
      (supporterBadge&&most?.id
        ? supporterBadge(most.id)
        : "");
  }

  setText("map-v2-most-played-games", most ? `${most.gp||0} matches` : "— matches");

    const completed = allMatches.filter(m => m.status !== "in_progress" && m.created_at);
    const oldest = completed.length
      ? completed.reduce((min, m) => Number(m.created_at) < Number(min.created_at) ? m : min, completed[0])
      : null;

    setText("map-v2-first-played", oldest ? formatShortDate(oldest.created_at) : "—");
    setText("map-v2-total-players", allPlayers.length || "—");
  }

  function renderAll() {
    setText("score-trend-label", "All Matches");
    setText("recent-label", `${allMatches.length} Loaded`);
    renderKpis();
    renderHeroIntel();
    renderPlayers();
    renderMatches();
    renderRivalries();
    renderCharts();
  }

  function setupTabs() {
    document.querySelectorAll(".map-v2-tabs button").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".map-v2-tabs button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentSort = btn.dataset.sort || "games";
        renderPlayers();
      });
    });
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const mapName = params.get("map");

    if (!$("map-v2-name")) return;

    if (!mapName) {
      setText("map-v2-name", "No Map Selected");
      setText("map-v2-subtitle", "Choose a map from Map Intel, Matches, or a player profile.");
      $("map-v2-image")?.closest(".map-v2-thumb-wrap")?.classList.add("no-image");
      return;
    }

    setText("map-v2-name", mapName);
    setText("recent-title", `Recent Matches on ${mapName}`);
    window.setMapImageFromName($("map-v2-image"), mapName, {
      containerSelector: ".map-v2-thumb-wrap"
    });
    setupTabs();

    const [playersRes, matchesRes] = await Promise.all([
      fetchJSON(`/api/map/${encodeURIComponent(mapName)}/players`),
      fetchJSON(`/api/map/${encodeURIComponent(mapName)}/matches`)
    ]);

    allPlayers = playersRes.data || [];
    allMatches = matchesRes.data || [];

    renderAll();

  }

  document.addEventListener("DOMContentLoaded", init);
})();
