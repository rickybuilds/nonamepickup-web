"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const number = new Intl.NumberFormat("en-US");
  const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const escapeHtml = window.nnHelpers?.escapeHtml;
  const escapeAttr = window.nnHelpers?.escapeAttr;
  const fetchJSON = window.nnHelpers?.fetchJSON;
  const supporterBadge = window.nnHelpers?.supporterBadge;
  const loadSupporters = window.nnHelpers?.loadSupporters;

  const sections = {
    combat: [
      ["games", "Most Games Played", "games"],
      ["kills", "Career Kills", "kills"],
      ["enemy_damage", "Enemy Damage", "damage"],
      ["kdr", "Career KDR", "decimal", "Minimum 25 games"],
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
      ["kills", "Most Kills In A Round", "kills", null, "round"],
      ["damage", "Most Damage In A Round", "damage", null, "round"],
      ["caps", "Most Caps In A Round", "caps", null, true],
      ["touches", "Most Touches In A Round", "touches", null, true],
      ["initial_touches", "Most Initial Touches In A Round", "touches", null, true],
      ["flag_time", "Most Flag Time In A Round", "time", null, true],
      ["conc_jumps", "Most Conc Jumps In A Round", "jumps", null, true],
      ["suicides", "Most Suicides In A Round", "suicides", null, true],
      ["team_kills", "Most Team Kills In A Round", "team kills", null, true],
      ["team_damage", "Most Team Damage In A Round", "damage", null, true]
    ],
    matches: [
      ["kills", "Most Kills In A Match", "kills", null, "match"],
      ["enemy_damage", "Most Damage In A Match", "damage", null, "match"],
      ["caps", "Most Caps In A Match", "caps", null, "match"],
      ["touches", "Most Touches In A Match", "touches", null, "match"],
      ["initial_touches", "Most Initial Touches In A Match", "touches", null, "match"],
      ["flag_time", "Most Flag Time In A Match", "time", null, "match"],
      ["conc_jumps", "Most Conc Jumps In A Match", "jumps", null, "match"],
      ["suicides", "Most Suicides In A Match", "suicides", null, "match"],
      ["team_kills", "Most Team Kills In A Match", "team kills", null, "match"],
      ["team_damage", "Most Team Damage In A Match", "damage", null, "match"],
      ["deaths", "Most Deaths In A Match", "deaths", null, "match"],
      ["kdr", "Best KDR In A Match", "decimal", "Minimum 10 kills", "match"]
    ],
    chaos: [
      ["suicides", "Most Suicides", "suicides"],
      ["team_kills", "Most Team Kills", "team kills"],
      ["team_damage", "Most Team Damage", "damage"],
      ["deaths", "Most Deaths", "deaths"],
      ["worst_kdr", "Worst Career KDR", "decimal", "Minimum 25 kill/death sample"],
      ["team_kills_per_match", "Most Team Kills Per Match", "team kills/match", "Minimum 10 matches"],
      ["suicides_per_match", "Most Suicides Per Match", "suicides/match", "Minimum 10 matches"]
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
    const badge = row.id && supporterBadge ? supporterBadge(row.id) : "";
    return row.id
      ? `<a href="${escapeAttr(`player.html?id=${encodeURIComponent(row.id)}`)}">${name}${badge}</a>`
      : `<span title="No linked Discord profile">${name}</span>`;
  }

  function safeExternalUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value), window.location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function recordLinks(row) {
    const links = [];
    if (row.match_id) {
      links.push(`<a class="analytics-link-pill noname" href="${escapeAttr(`match.html?id=${encodeURIComponent(row.match_id)}`)}">NoName</a>`);
    }
    const hampalyzer = safeExternalUrl(row.hampalyzer_url);
    const tfcstats = safeExternalUrl(row.tfcstats_url);
    if (hampalyzer) {
      links.push(`<a class="analytics-link-pill hampalyzer" href="${escapeAttr(hampalyzer)}" target="_blank" rel="noopener noreferrer">Hampalyzer</a>`);
    }
    if (tfcstats) {
      links.push(`<a class="analytics-link-pill tfcstats" href="${escapeAttr(tfcstats)}" target="_blank" rel="noopener noreferrer">TFCStats</a>`);
    }
    return links.length ? `<span class="analytics-record-links">${links.join("")}</span>` : "";
  }

  function rowContext(row, type, recordType) {
  const details = [];
  if (recordType === "round" || recordType === true) {
    if (row.map) details.push(escapeHtml(row.map));
    if (row.round_num) details.push(`Round ${number.format(row.round_num)}`);
  } else if (recordType === "match") {
    if (row.map) details.push(escapeHtml(row.map));
  } else if (recordType === "mvp-rate") {
    details.push(`${number.format(row.secondary || 0)} MVPs / ${number.format(row.matches || 0)} games`);
  } else if (row.secondary != null) {
    details.push(`${number.format(row.secondary)} ${type === "percent" ? "caps" : "kills"}`);
  } else if (row.matches != null && type !== "games") {
    details.push(`${number.format(row.matches)} matches`);
  }

  const unit = type === "decimal" || type === "percent" || type === "time"
    ? ""
    : ` ${escapeHtml(type)}`;
  return `${formatValue(row.value, type)}${unit}${details.length ? `<small>${details.join(" · ")}</small>` : ""}${recordLinks(row)}`;
}

  function renderCard(title, rows, type, note, recordType = false, featured = false) {
    const list = (rows || []).map((row, index) => `
      <li class="${index === 0 ? "is-leader" : ""}">
        <span class="analytics-rank">${index + 1}</span>
        <div class="analytics-player">${playerName(row)}</div>
        <strong>${rowContext(row, type, recordType)}</strong>
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
    target.innerHTML = config.map(([key, title, type, note, recordType]) =>
      renderCard(title, data?.[key], type, note, recordType)
    ).join("");
  }

  async function loadAnalytics() {
    const error = document.getElementById("analytics-error");
    try {
      const payload = await fetchJSON("/api/analytics?limit=5");
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
        renderCard("Match MVPs", data.mvps, "MVP games", "Total matches where player earned MVP", false, true);
      document.getElementById("analytics-mvp-rate").innerHTML =
        renderCard("MVP Efficiency", data.mvp_rate, "percent", "MVPs / games played; minimum 25 games", "mvp-rate", true);
      renderSection("analytics-combat", data.combat, sections.combat);
      renderSection("analytics-flags", data.flags, sections.flags);
      renderSection("analytics-roles", data.roles, sections.roles);
      renderSection("analytics-rounds", data.rounds, sections.rounds);
      renderSection("analytics-matches", data.matches, sections.matches);
      renderSection("analytics-chaos", data.chaos, sections.chaos);
    } catch (loadError) {
      console.error("Analytics load failed", loadError);
      error.hidden = false;
      error.textContent = "The analytics data could not be loaded right now.";
      document.getElementById("analytics-updated").textContent = "Analytics unavailable";
    }
  }

  if (loadSupporters) await loadSupporters();
  loadAnalytics();
});
