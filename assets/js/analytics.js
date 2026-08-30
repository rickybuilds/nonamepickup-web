"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const number = new Intl.NumberFormat("en-US");
  const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const helpers = window.nnHelpers || {};
  const escapeHtml = helpers.escapeHtml;
  const escapeAttr = helpers.escapeAttr;
  const fetchJSON = helpers.fetchJSON;
  const supporterBadge = helpers.supporterBadge;
  const loadSupporters = helpers.loadSupporters;
  const weaponName = helpers.weaponName || (value => value);
  const formatDuration = helpers.formatSeconds || window.formatSeconds || (value => `${number.format(value)}s`);

  const sections = {
    combat: [
      ["games", "Most Games Played", "games"],
      ["kills", "Career Kills", "kills"],
      ["enemy_damage", "Enemy Damage", "damage"],
      ["kdr", "Career K/D", "decimal", null, "qualified"],
      ["round_kills", "Highest Round Kills", "kills", null, "round"],
      ["round_damage", "Highest Round Damage", "damage", null, "round"]
    ],
    flags: [
      ["caps", "Flag Captures", "caps"],
      ["touches", "Flag Touches", "touches"],
      ["initial_touches", "Initial Touches", "touches"],
      ["flag_time", "Flag Time", "time"],
      ["conversion", "Cap Conversion", "percent", "Caps per initial touch; minimum 10 touches"]
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
      ["medic_caps", "Medic Flag Captures", "caps"],
      ["medic_touches", "Medic Flag Touches", "touches"],
      ["scout_caps", "Scout Flag Captures", "caps"],
      ["scout_touches", "Scout Flag Touches", "touches"],
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
      ["caps", "Most Caps In A Round", "caps", null, "round"],
      ["touches", "Most Touches In A Round", "touches", null, "round"],
      ["initial_touches", "Most Initial Touches In A Round", "touches", null, "round"],
      ["flag_time", "Most Flag Time In A Round", "time", null, "round"],
      ["conc_jumps", "Most Conc Jumps In A Round", "jumps", null, "round"],
      ["suicides", "Most Suicides In A Round", "suicides", null, "round"],
      ["team_kills", "Most Team Kills In A Round", "team kills", null, "round"],
      ["team_damage", "Most Team Damage In A Round", "damage", null, "round"]
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
      ["kdr", "Best K/D In A Match", "decimal", "Minimum 10 kills", "match"]
    ],
    chaos: [
      ["suicides", "Most Suicides", "suicides"],
      ["team_kills", "Most Team Kills", "team kills"],
      ["team_damage", "Most Team Damage", "damage"],
      ["deaths", "Most Deaths", "deaths"],
      ["worst_kdr", "Worst Career K/D", "decimal", "Minimum 25 kill/death sample"],
      ["team_kills_per_match", "Most Team Kills Per Match", "decimal", "Minimum 10 matches"],
      ["suicides_per_match", "Most Suicides Per Match", "decimal", "Minimum 10 matches"]
    ]
  };

  function formatValue(value, type) {
    const numeric = Number(value || 0);
    if (type === "decimal") return decimal.format(numeric);
    if (type === "percent") return `${decimal.format(numeric)}%`;
    if (type === "time") return formatDuration(numeric);
    return number.format(numeric);
  }

  function playerName(row) {
    const name = escapeHtml(row?.player || "Unknown");
    const badge = row?.id && supporterBadge ? supporterBadge(row.id) : "";
    return row?.id
      ? `<a href="${escapeAttr(`player.html?id=${encodeURIComponent(row.id)}`)}">${name}${badge}</a>`
      : `<span title="No linked Discord profile">${name}</span>`;
  }

  function mapName(row) {
    const name = String(row?.map || "Unknown");
    return `<a href="${escapeAttr(`map.html?map=${encodeURIComponent(name)}`)}">${escapeHtml(name)}</a>`;
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
    if (row.match_id) links.push(`<a class="analytics-link-pill noname" href="${escapeAttr(`match.html?id=${encodeURIComponent(row.match_id)}`)}">NoName</a>`);
    const hampalyzer = safeExternalUrl(row.hampalyzer_url);
    const tfcstats = safeExternalUrl(row.tfcstats_url);
    if (hampalyzer) links.push(`<a class="analytics-link-pill hampalyzer" href="${escapeAttr(hampalyzer)}" target="_blank" rel="noopener noreferrer">Hampalyzer</a>`);
    if (tfcstats) links.push(`<a class="analytics-link-pill tfcstats" href="${escapeAttr(tfcstats)}" target="_blank" rel="noopener noreferrer">TFCStats</a>`);
    return links.length ? `<span class="analytics-record-links">${links.join("")}</span>` : "";
  }

  function rowContext(row, type, recordType) {
    const details = [];
    if (recordType === "round") {
      if (row.map) details.push(escapeHtml(row.map));
      if (row.round_num) details.push(`Round ${number.format(row.round_num)}`);
    } else if (recordType === "match") {
      if (row.map) details.push(escapeHtml(row.map));
    } else if (recordType === "mvp-rate") {
      details.push(`${number.format(row.secondary || 0)} MVPs / ${number.format(row.matches || 0)} games`);
    } else if (row.secondary != null) {
      details.push(`${number.format(row.secondary)} total`);
    } else if (row.matches != null && type !== "games") {
      details.push(`${number.format(row.matches)} matches`);
    }
    const unit = type === "decimal" || type === "percent" || type === "time" ? "" : ` ${escapeHtml(type)}`;
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
        <div class="analytics-card-head"><h3>${escapeHtml(title)}</h3>${note ? `<span>${escapeHtml(note)}</span>` : ""}</div>
        <ol>${list || `<li class="analytics-empty">No data yet</li>`}</ol>
      </article>
    `;
  }

  function renderSection(id, data, config, qualificationNote) {
    const target = document.getElementById(id);
    if (!target) return;
    target.innerHTML = config.map(([key, title, type, note, recordType]) =>
      renderCard(title, data?.[key], type, recordType === "qualified" ? qualificationNote : note, recordType)
    ).join("");
  }

  function fillActivityMonths(rows) {
    const values = new Map((rows || []).map(row => [row.month, Number(row.matches || 0)]));
    const output = [];
    const now = new Date();
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      output.push({
        key,
        label: date.toLocaleDateString("en-US", { month: "short" }),
        fullLabel: date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        value: values.get(key) || 0
      });
    }
    return output;
  }

  function renderActivity(rows) {
    const target = document.getElementById("analytics-activity");
    if (!target) return;
    const points = fillActivityMonths(rows);
    const max = Math.max(1, ...points.map(point => point.value));
    const left = 42;
    const right = 710;
    const top = 18;
    const bottom = 164;
    const width = right - left;
    const step = width / Math.max(1, points.length - 1);
    const coordinates = points.map((point, index) => ({ ...point, x: left + (index * step), y: bottom - ((point.value / max) * (bottom - top)) }));
    const polyline = coordinates.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const area = `${left},${bottom} ${polyline} ${right},${bottom}`;
    target.innerHTML = `
      <svg viewBox="0 0 750 205" role="img" aria-labelledby="analytics-activity-title analytics-activity-desc">
        <title id="analytics-activity-title">Completed matches over the last 12 months</title>
        <desc id="analytics-activity-desc">${escapeHtml(points.map(point => `${point.fullLabel}: ${point.value}`).join(", "))}</desc>
        <line class="analytics-chart-grid" x1="${left}" y1="${top}" x2="${right}" y2="${top}"></line>
        <line class="analytics-chart-grid" x1="${left}" y1="${(top + bottom) / 2}" x2="${right}" y2="${(top + bottom) / 2}"></line>
        <line class="analytics-chart-grid" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"></line>
        <polygon class="analytics-chart-area" points="${area}"></polygon>
        <polyline class="analytics-chart-line" points="${polyline}"></polyline>
        ${coordinates.map(point => `<circle class="analytics-chart-point" cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(`${point.fullLabel}: ${point.value} matches`)}</title></circle>`).join("")}
        ${coordinates.map(point => `<text class="analytics-chart-label" x="${point.x}" y="194" text-anchor="middle">${escapeHtml(point.label)}</text>`).join("")}
        <text class="analytics-chart-value" x="8" y="${top + 4}">${number.format(max)}</text>
        <text class="analytics-chart-value" x="25" y="${bottom + 4}">0</text>
      </svg>
    `;
  }

  function renderSpotlight(data, qualificationNote) {
    const target = document.getElementById("analytics-spotlight");
    if (!target) return;
    const rows = [
      ["Kills / Game", data.per_game?.kills?.[0], "decimal"],
      ["Damage / Game", data.per_game?.damage?.[0], "damage"],
      ["K/D Ratio", data.per_game?.kdr?.[0], "decimal"],
      ["Win Rate", data.per_game?.win_rate?.[0], "percent"],
      ["MVP Efficiency", data.per_game?.mvp_efficiency?.[0], "percent"]
    ].filter(([, row]) => row);
    target.innerHTML = rows.map(([label, row, type]) => `
      <div class="analytics-spotlight-row"><span>${escapeHtml(label)}</span><div>${playerName(row)}</div><strong>${formatValue(row.value, type)}</strong></div>
    `).join("") || `<p class="analytics-empty">No qualified rankings yet.</p>`;
    document.getElementById("analytics-spotlight-note").textContent = qualificationNote;
  }

  function renderComparison(label, careerRow, careerType, performanceLabel, performanceRow, performanceType) {
    const side = (sideLabel, row, type, sideClass) => `
      <div class="analytics-comparison-side ${sideClass}"><span>${escapeHtml(sideLabel)}</span><div class="analytics-comparison-player">${row ? playerName(row) : "—"}</div><strong>${row ? formatValue(row.value, type) : "—"}</strong></div>
    `;
    return `<article class="analytics-comparison-card card">${side(label, careerRow, careerType, "career")}<span class="analytics-versus" aria-hidden="true">VS</span>${side(performanceLabel, performanceRow, performanceType, "performance")}</article>`;
  }

  function renderComparisons(data) {
    document.getElementById("analytics-comparisons").innerHTML = [
      renderComparison("Career Kills", data.combat?.kills?.[0], "kills", "Kills / Game", data.per_game?.kills?.[0], "decimal"),
      renderComparison("Career Damage", data.combat?.enemy_damage?.[0], "damage", "Damage / Game", data.per_game?.damage?.[0], "damage"),
      renderComparison("Match MVPs", data.mvps?.[0], "MVP games", "MVP Efficiency", data.mvp_rate?.[0], "percent"),
      renderComparison("Most Games", data.combat?.games?.[0], "games", "Win Rate", data.per_game?.win_rate?.[0], "percent")
    ].join("");
  }

  function renderOverviewTeaser(title, eyebrow, entries) {
    const rows = entries.filter(([, row]) => row);
    return `
      <article class="card analytics-teaser-card">
        <div class="analytics-card-head"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(eyebrow)}</span></div>
        <div class="analytics-teaser-list">
          ${rows.map(([label, row, type]) => `
            <div class="analytics-teaser-row">
              <span>${escapeHtml(label)}</span>
              <div>${playerName(row)}</div>
              <strong>${formatValue(row.value, type)}</strong>
            </div>
          `).join("") || `<p class="analytics-empty">No records yet.</p>`}
        </div>
      </article>`;
  }

  function renderOverviewTeasers(data) {
    const target = document.getElementById("analytics-overview-teasers");
    if (!target) return;
    target.innerHTML = [
      renderOverviewTeaser("Top Per-Game Performers", "Qualified efficiency leaders", [
        ["Kills / Game", data.per_game?.kills?.[0], "decimal"],
        ["Damage / Game", data.per_game?.damage?.[0], "damage"],
        ["K/D", data.per_game?.kdr?.[0], "decimal"],
        ["Win Rate", data.per_game?.win_rate?.[0], "percent"],
        ["MVP Efficiency", data.per_game?.mvp_efficiency?.[0], "percent"]
      ]),
      renderOverviewTeaser("All-Time Leaders", "Career record owners", [
        ["Career Kills", data.combat?.kills?.[0], "kills"],
        ["Career Damage", data.combat?.enemy_damage?.[0], "damage"],
        ["Games Played", data.combat?.games?.[0], "games"],
        ["Match MVPs", data.mvps?.[0], "MVP games"],
        ["Captures", data.flags?.caps?.[0], "caps"]
      ]),
      renderOverviewTeaser("Record Holders", "Standout match and round marks", [
        ["Match Kills", data.matches?.kills?.[0], "kills"],
        ["Match Damage", data.matches?.enemy_damage?.[0], "damage"],
        ["Round Kills", data.rounds?.kills?.[0], "kills"],
        ["Round Damage", data.rounds?.damage?.[0], "damage"],
        ["Match Captures", data.matches?.caps?.[0], "caps"]
      ])
    ].join("");
  }

  function finishAnalyticsLoading(message) {
    document.getElementById("analytics-updated-text").textContent = message;
    document.getElementById("analytics-updated").classList.remove("is-loading");
    document.getElementById("analytics-load-progress").hidden = true;
  }

  function renderPerGame(data, qualificationNote) {
    const config = [
      ["kills", "Kills / Game", "decimal"], ["deaths", "Deaths / Game", "decimal"], ["damage", "Damage / Game", "damage"],
      ["captures", "Captures / Game", "decimal"], ["kills_per_round", "Kills / Round", "decimal"], ["damage_per_round", "Damage / Round", "damage"],
      ["kdr", "K/D Ratio", "decimal"], ["win_rate", "Win Rate", "percent"], ["mvp_efficiency", "MVP Efficiency", "percent", "mvp-rate"]
    ];
    document.getElementById("analytics-per-game").innerHTML = config.map(([key, title, type, recordType]) => renderCard(title, data.per_game?.[key], type, qualificationNote, recordType)).join("");
    document.getElementById("analytics-per-game-note").textContent = qualificationNote;
  }

  function renderWeapons(data) {
    const totals = data.weapons?.totals || [];
    document.getElementById("analytics-weapon-totals").innerHTML = `
      <article class="analytics-card analytics-weapon-total-card">
        <div class="analytics-card-head"><h3>Most Kills By Weapon</h3><span>Recorded weapon kill totals</span></div>
        <ol>${totals.map((row, index) => `
          <li class="${index === 0 ? "is-leader" : ""}"><span class="analytics-rank">${index + 1}</span><div class="analytics-player analytics-weapon-name"><i class="weapon-icon ${escapeAttr(row.weapon)}" aria-hidden="true"></i><span>${escapeHtml(weaponName(row.weapon))}</span></div><strong>${number.format(row.value)} kills<small>${number.format(row.matches)} matches with recorded kills</small></strong></li>
        `).join("") || `<li class="analytics-empty">No weapon data yet</li>`}</ol>
      </article>`;
    const leadersByWeapon = new Map();
    (data.weapons?.leaders || []).forEach(row => {
      const list = leadersByWeapon.get(row.weapon) || [];
      list.push(row);
      leadersByWeapon.set(row.weapon, list);
    });
    document.getElementById("analytics-weapon-leaders").innerHTML = totals.slice(0, 6).map(row => renderCard(`${weaponName(row.weapon)} Kill Leaders`, leadersByWeapon.get(row.weapon), "kills", "Career weapon kills")).join("");
  }

  function renderMapCard(title, rows, type, note) {
    return `<article class="analytics-card"><div class="analytics-card-head"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(note)}</span></div><ol>${(rows || []).map((row, index) => `
      <li class="${index === 0 ? "is-leader" : ""}"><span class="analytics-rank">${index + 1}</span><div class="analytics-player">${mapName(row)}</div><strong>${formatValue(row.value, type)}${type === "games" ? " games" : type === "kills" ? " kills" : ""}<small>${number.format(row.matches || 0)} completed matches</small></strong></li>
    `).join("") || `<li class="analytics-empty">No map data yet</li>`}</ol></article>`;
  }

  function renderMaps(data, minimumMapGames) {
    document.getElementById("analytics-maps").innerHTML = [
      renderMapCard("Most Played Maps", data.maps?.most_played, "games", "Completed matches"),
      renderMapCard("Most Recorded Kills", data.maps?.total_kills, "kills", "Player kills across completed matches"),
      renderMapCard("Highest Average Team Score", data.maps?.average_team_score, "decimal", `Combined score divided by two; minimum ${minimumMapGames} games`)
    ].join("");
  }

  function setupTabs() {
    const tabs = [...document.querySelectorAll("[data-analytics-tab]")];
    const panels = [...document.querySelectorAll("[data-analytics-panel]")];
    const names = new Set(tabs.map(tab => tab.dataset.analyticsTab));
    function activate(name, focus = false) {
      const selected = names.has(name) ? name : "overview";
      tabs.forEach(tab => {
        const active = tab.dataset.analyticsTab === selected;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        if (active && focus) tab.focus();
      });
      panels.forEach(panel => { panel.hidden = panel.dataset.analyticsPanel !== selected; });
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${selected}`);
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activate(tab.dataset.analyticsTab));
      tab.addEventListener("keydown", event => {
        let nextIndex = null;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        if (nextIndex == null) return;
        event.preventDefault();
        activate(tabs[nextIndex].dataset.analyticsTab, true);
      });
    });
    activate(window.location.hash.slice(1));
  }

  async function loadAnalytics() {
    const error = document.getElementById("analytics-error");
    try {
      const payload = await fetchJSON("/api/analytics?limit=5");
      if (!payload.ok || !payload.data) throw new Error(payload.error || "Invalid response");
      const data = payload.data;
      const minimumGames = Number(data.qualification?.minimum_games || 0);
      const minimumMapGames = Number(data.qualification?.minimum_map_games || 0);
      const qualificationNote = `Minimum ${number.format(minimumGames)} games`;
      document.getElementById("analytics-match-count").textContent = number.format(data.summary?.matches || 0);
      document.getElementById("analytics-player-count").textContent = number.format(data.summary?.players || 0);
      document.getElementById("analytics-round-count").textContent = number.format(data.summary?.rounds || 0);
      document.getElementById("analytics-kill-count").textContent = number.format(data.summary?.total_kills || 0);
      finishAnalyticsLoading(`Updated ${new Date(Number(data.generated_at || 0) * 1000).toLocaleString()}`);
      renderActivity(data.activity);
      renderSpotlight(data, qualificationNote);
      renderComparisons(data);
      renderOverviewTeasers(data);
      renderPerGame(data, qualificationNote);
      renderWeapons(data);
      renderMaps(data, minimumMapGames);
      document.getElementById("analytics-mvps").innerHTML = renderCard("Match MVPs", data.mvps, "MVP games", "Total matches where player earned MVP", false, true);
      document.getElementById("analytics-mvp-rate").innerHTML = renderCard("MVP Efficiency", data.mvp_rate, "percent", qualificationNote, "mvp-rate", true);
      renderSection("analytics-combat", data.combat, sections.combat, qualificationNote);
      renderSection("analytics-flags", data.flags, sections.flags, qualificationNote);
      renderSection("analytics-roles", data.roles, sections.roles, qualificationNote);
      renderSection("analytics-rounds", data.rounds, sections.rounds, qualificationNote);
      renderSection("analytics-matches", data.matches, sections.matches, qualificationNote);
      renderSection("analytics-chaos", data.chaos, sections.chaos, qualificationNote);
    } catch (loadError) {
      console.error("Analytics load failed", loadError);
      error.hidden = false;
      error.textContent = "The analytics data could not be loaded right now.";
      finishAnalyticsLoading("Analytics unavailable");
    }
  }

  setupTabs();
  if (loadSupporters) await loadSupporters();
  loadAnalytics();
});
