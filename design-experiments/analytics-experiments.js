(() => {
  "use strict";

  const number = new Intl.NumberFormat("en-US");
  const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const formatDuration = value => {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>\"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const escapeAttr = escapeHtml;
  const formatValue = (value, type) => {
    if (value == null || value === "") return "—";
    const numeric = Number(value);
    if (type === "decimal") return decimal.format(numeric);
    if (type === "percent") return `${decimal.format(numeric)}%`;
    if (type === "time") return formatDuration(numeric);
    return number.format(numeric);
  };
  const queryApi = new URLSearchParams(location.search).get("api");
  const apiBase = queryApi || "";

  async function loadAnalytics() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${apiBase}/api/analytics?limit=10`, { signal: controller.signal, credentials: "same-origin" });
      if (!response.ok) throw new Error(`Analytics request returned ${response.status}`);
      const payload = await response.json();
      if (!payload.ok || !payload.data) throw new Error(payload.error || "The analytics response was incomplete.");
      return { data: payload.data, error: null };
    } catch (error) {
      return { data: null, error: error.name === "AbortError" ? "The analytics request timed out." : "Analytics data is unavailable from this preview origin." };
    } finally {
      clearTimeout(timeout);
    }
  }

  const playerLink = row => {
    const name = escapeHtml(row?.player || "Unknown player");
    return row?.id ? `<a href="../player.html?id=${encodeURIComponent(row.id)}">${name}</a>` : `<span title="No linked player identity">${name}</span>`;
  };
  const mapLink = row => row?.map ? `<a href="../map.html?map=${encodeURIComponent(row.map)}">${escapeHtml(row.map)}</a>` : "—";
  const matchLink = row => row?.match_id ? `<a href="../match.html?id=${encodeURIComponent(row.match_id)}">Match ${escapeHtml(row.match_id)}</a>` : "";
  const sourceLinks = row => [matchLink(row), row?.hampalyzer_url ? `<a href="${escapeAttr(row.hampalyzer_url)}" target="_blank" rel="noopener noreferrer">Hampalyzer</a>` : "", row?.tfcstats_url ? `<a href="${escapeAttr(row.tfcstats_url)}" target="_blank" rel="noopener noreferrer">TFCStats</a>` : ""].filter(Boolean).join(" · ");
  const state = (title, detail, kind = "info") => `<div class="nn-state nn-state-${kind}" role="${kind === "error" ? "alert" : "status"}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;

  const metricGroups = {
    combat: [["games", "Most Games Played", "games"], ["kills", "Career Kills", "kills"], ["enemy_damage", "Enemy Damage", "damage"], ["kdr", "Career K/D", "decimal", "Qualified"], ["round_kills", "Highest Round Kills", "kills", "Round"], ["round_damage", "Highest Round Damage", "damage", "Round"]],
    objective: [["caps", "Flag Captures", "caps"], ["touches", "Flag Touches", "touches"], ["initial_touches", "Initial Touches", "touches"], ["flag_time", "Flag Time", "time"], ["conversion", "Cap Conversion", "percent"]],
    roles: [["soldier_damage", "Soldier Damage", "damage"], ["soldier_kills", "Soldier Kills", "kills"], ["hwguy_damage", "HWGuy Damage", "damage"], ["hwguy_kills", "HWGuy Kills", "kills"], ["defense", "Defensive Impact", "damage"], ["offense", "Offensive Impact", "damage"]],
    rounds: [["kills", "Most Kills In A Round", "kills", "Round"], ["damage", "Most Damage In A Round", "damage", "Round"], ["caps", "Most Caps In A Round", "caps", "Round"], ["touches", "Most Touches In A Round", "touches", "Round"], ["flag_time", "Most Flag Time In A Round", "time", "Round"], ["conc_jumps", "Most Conc Jumps In A Round", "jumps", "Round"]],
    matches: [["kills", "Most Kills In A Match", "kills", "Match"], ["enemy_damage", "Most Damage In A Match", "damage", "Match"], ["caps", "Most Caps In A Match", "caps", "Match"], ["touches", "Most Touches In A Match", "touches", "Match"], ["flag_time", "Most Flag Time In A Match", "time", "Match"], ["kdr", "Best K/D In A Match", "decimal", "Qualified"]],
    players: [["mvps", "Match MVPs", "MVP games"], ["win_streaks", "Highest Win Streak", "wins"], ["loss_streaks", "Highest Loss Streak", "losses"], ["chaos", "Wall of Shame", "records"]]
  };

  function metricCatalog(data) {
    const entries = [];
    for (const [group, configs] of Object.entries(metricGroups)) {
      const source = group === "objective" ? data.flags : group === "players" ? data : data[group];
      for (const [key, label, type, note] of configs) {
        const raw = key === "mvps" ? data.mvps : key === "win_streaks" ? data.streaks?.wins : key === "loss_streaks" ? data.streaks?.losses : key === "chaos" ? data.chaos?.suicides : source?.[key];
        entries.push({ id: `${group}:${key}`, group, key, label, type, note: note || "All-time completed matches", rows: Array.isArray(raw) ? raw : [] });
      }
    }
    for (const [key, label, type] of [["kills", "Kills / Game", "decimal"], ["damage", "Damage / Game", "damage"], ["kdr", "K/D Ratio", "decimal"], ["captures", "Captures / Game", "decimal"], ["kills_per_round", "Kills / Round", "decimal"]]) {
      entries.push({ id: `performance:${key}`, group: "performance", key, label, type, note: "Qualified performance ranking", rows: data.per_game?.[key] || [] });
    }
    if (data.weapons) for (const key of Object.keys(data.weapons)) entries.push({ id: `weapons:${key}`, group: "weapons", key, label: key, type: "kills", note: "Weapon kill totals", rows: data.weapons[key] || [] });
    const mapData = data.maps || {};
    for (const [key, label, type, note] of [["most_played", "Most Played Maps", "games", "Completed-match map archive"], ["total_kills", "Map Total Kills", "kills", "Recorded kills by map"], ["average_team_score", "Average Team Score", "decimal", "Qualified map score sample"], ["leaders", "Map Player Leaders", "kills", "Player kills by map"], ["details", "Map Archive", "games", "Completed-match map archive"]]) {
      const rows = key === "details" ? (mapData.details || []).map(row => ({ ...row, value: row.matches, secondary: row.total_kills })) : mapData[key] || [];
      entries.push({ id: `maps:${key}`, group: "maps", key, label, type, note, rows });
    }
    return entries;
  }

  function rowDetail(row, metric) {
    const bits = [];
    if (metric.note) bits.push(metric.note);
    if (row.matches != null) bits.push(`${number.format(row.matches)} matches`);
    if (row.map) bits.push(row.map);
    if (row.round_num) bits.push(`Round ${number.format(row.round_num)}`);
    return bits.join(" · ");
  }

  window.NNAnalyticsExperiments = { loadAnalytics, metricCatalog, metricGroups, rowDetail, playerLink, mapLink, matchLink, sourceLinks, state, escapeHtml, escapeAttr, format: { number, decimal, duration: formatDuration, count: value => value == null || value === "" ? "—" : number.format(Number(value)), value: formatValue } };
})();
