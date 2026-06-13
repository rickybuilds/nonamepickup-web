"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const number = new Intl.NumberFormat("en-US");
  const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

  const sections = {
    combat: [
      ["games", "Most Games Played", "games"],
      ["kills", "Career Kills", "kills"],
      ["enemy_damage", "Enemy Damage", "damage"],
      ["kdr", "Career KDR", "decimal", "Minimum 25 kills"],
      ["round_kills", "Highest Round Kills", "kills", null, true],
      ["round_damage", "Highest Round Damage", "damage", null, true]
    ],
    flags: [
      ["caps", "Flag Captures", "caps"],
      ["touches", "Flag Touches", "touches"],
      ["initial_touches", "Initial Touches", "touches"],
      ["flag_time", "Flag Time", "time"],
      ["conversion", "Cap Conversion", "percent", "Caps per initial touch; minimum 10"]
    ],
    roles: [
      ["soldier_damage", "Soldier Damage", "damage"],
      ["soldier_kills", "Soldier Kills", "kills"],
      ["hwguy_damage", "HWGuy Damage", "damage"],
      ["hwguy_kills", "HWGuy Kills", "kills"],
      ["demoman_damage", "Demoman Damage", "damage"],
      ["demoman_kills", "Demoman Kills", "kills"],
      ["engineer_kills", "Engineer Kills", "kills"],
      ["engineer_sentry_kills", "Sentry Kills", "kills"],
      ["dispenser_kills", "Dispenser Kills", "kills"],
      ["defense", "Defensive Impact", "damage", "Enemy damage; kills shown second"],
      ["offense", "Offensive Impact", "damage", "Enemy damage; kills shown second"],
      ["offensive_flag_captures", "Offensive Flag Captures", "caps"],
      ["offensive_flag_touches", "Offensive Flag Touches", "touches"],
      ["offensive_initial_touches", "Offensive Initial Touches", "touches"],
      ["offensive_flag_time", "Offensive Flag Time", "time"],
      ["offensive_damage", "Offensive Damage", "damage"]
    ],
    rounds: [
      ["kills", "Best Kill Round", "kills", null, true],
      ["damage", "Best Damage Round", "damage", null, true],
      ["caps", "Most Caps In A Round", "caps", null, true],
      ["touches", "Most Touches In A Round", "touches", null, true],
      ["conc_jumps", "Most Conc Jumps In A Round", "jumps", null, true]
    ],
    chaos: [
      ["suicides", "Most Suicides", "suicides"],
      ["team_kills", "Most Team Kills", "team kills"],
      ["team_damage", "Most Team Damage", "damage"]
    ]
  };

  function formatValue(value, type) {
    const numeric = Number(value || 0);
    if (type === "decimal") return decimal.format(numeric);
    if (type === "percent") return `${decimal.format(numeric)}%`;
    if (type === "time") return formatSeconds(numeric);
    return number.format(numeric);
  }

  function playerName(row) {
    const name = escapeHtml(row.player || "Unknown");
    return row.id
      ? `<a href="player.html?id=${encodeURIComponent(row.id)}">${name}</a>`
      : `<span title="No linked Discord profile">${name}</span>`;
  }

  function rowContext(row, type, isRound) {
    const details = [];
    if (isRound) {
      if (row.map) details.push(escapeHtml(row.map));
      if (row.round_num) details.push(`Round ${number.format(row.round_num)}`);
      if (row.match_id) {
        details.push(`<a href="match.html?id=${encodeURIComponent(row.match_id)}">match</a>`);
      }
    } else if (row.secondary != null) {
      details.push(`${number.format(row.secondary)} ${type === "percent" ? "caps" : "kills"}`);
    } else if (row.matches != null && type !== "games") {
      details.push(`${number.format(row.matches)} matches`);
    }

    const unit = type === "decimal" || type === "percent" || type === "time"
      ? ""
      : ` ${escapeHtml(type)}`;
    return `${formatValue(row.value, type)}${unit}${details.length ? `<small>${details.join(" · ")}</small>` : ""}`;
  }

  function renderCard(title, rows, type, note, isRound = false, featured = false) {
    const list = (rows || []).map((row, index) => `
      <li class="${index === 0 ? "is-leader" : ""}">
        <span class="analytics-rank">${index + 1}</span>
        <div class="analytics-player">${playerName(row)}</div>
        <strong>${rowContext(row, type, isRound)}</strong>
      </li>
    `).join("");

    return `
      <article class="analytics-card ${featured ? "analytics-card-featured" : ""}">
        <div class="analytics-card-head">
          <h3>${escapeHtml(title)}</h3>
          ${note ? `<span>${escapeHtml(note)}</span>` : ""}
        </div>
        <ol>${list || `<li class="analytics-empty">No data yet</li>`}</ol>
      </article>
    `;
  }

  function renderSection(id, data, config) {
    const target = document.getElementById(id);
    if (!target) return;
    target.innerHTML = config.map(([key, title, type, note, isRound]) =>
      renderCard(title, data?.[key], type, note, isRound)
    ).join("");
  }

  async function loadAnalytics() {
    const error = document.getElementById("analytics-error");
    try {
      const response = await fetch("/api/analytics?limit=5", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.ok || !payload.data) throw new Error(payload.error || "Invalid response");

      const data = payload.data;
      document.getElementById("analytics-match-count").textContent =
        number.format(data.summary?.matches || 0);
      document.getElementById("analytics-player-count").textContent =
        number.format(data.summary?.players || 0);
      document.getElementById("analytics-round-count").textContent =
        number.format(data.summary?.player_rounds || 0);
      document.getElementById("analytics-updated").textContent =
        `Updated ${new Date(Number(data.generated_at || 0) * 1000).toLocaleString()}`;

      document.getElementById("analytics-mvps").innerHTML =
        renderCard("Match MVPs", data.mvps, "MVP games", "COUNT(DISTINCT match_id)", false, true);
      renderSection("analytics-combat", data.combat, sections.combat);
      renderSection("analytics-flags", data.flags, sections.flags);
      renderSection("analytics-roles", data.roles, sections.roles);
      renderSection("analytics-rounds", data.rounds, sections.rounds);
      renderSection("analytics-chaos", data.chaos, sections.chaos);
    } catch (loadError) {
      console.error("Analytics load failed", loadError);
      error.hidden = false;
      error.textContent = "The analytics data could not be loaded right now.";
      document.getElementById("analytics-updated").textContent = "Analytics unavailable";
    }
  }

  loadAnalytics();
});
