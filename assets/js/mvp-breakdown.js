"use strict";

const mvpbForm = document.getElementById("mvpb-form");
const mvpbInput = document.getElementById("mvpb-match-id");
const mvpbResults = document.getElementById("mvpb-results");
const mvpbSubmit = mvpbForm?.querySelector("button[type='submit']");

const MVPB_COMPONENTS = {
  combat: {
    label: "Combat",
    description: "Kills ×22 · Enemy damage ×12 · KDR ×10",
    fields: ["kills", "enemy_damage", "kdr"]
  },
  objective: {
    label: "Objective",
    description: "Flag touches ×14 · Initial touches ×10 · Captures ×6 · Flag time ×3",
    fields: ["flag_touches", "initial_touches", "flag_captures", "flag_time_seconds"]
  },
  impact: {
    label: "Impact",
    description: "Conced kills ×10 · Sentry kills ×8 · Flag-carrier kills ×8",
    fields: ["conced_kills", "sentry_kills", "flag_carrier_kills"]
  },
  penalty: {
    label: "Penalty / Discipline",
    description: "Team kills ×−10 · Suicides ×−5 · Deaths ×−4 · Team damage ×−3",
    fields: ["team_kills", "suicides", "deaths", "team_damage"]
  }
};

const MVPB_FIELD_LABELS = {
  kills: "Kills",
  enemy_damage: "Enemy damage",
  kdr: "KDR",
  flag_touches: "Touches",
  initial_touches: "Initial touches",
  flag_captures: "Captures",
  flag_time_seconds: "Flag time",
  conced_kills: "Conced kills",
  sentry_kills: "Sentry kills",
  flag_carrier_kills: "Carrier kills",
  team_kills: "Team kills",
  suicides: "Suicides",
  deaths: "Deaths",
  team_damage: "Team damage"
};

const MVPB_FALLBACK_WEIGHTS = {
  combat: { kills: 22, enemy_damage: 12, kdr: 10 },
  objective: { flag_touches: 14, initial_touches: 10, flag_captures: 6, flag_time_seconds: 3 },
  impact: { conced_kills: 10, sentry_kills: 8, flag_carrier_kills: 8 },
  penalty: { team_kills: -10, suicides: -5, deaths: -4, team_damage: -3 }
};

function mvpbEscape(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function mvpbNumber(value, places = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places });
}

function mvpbRaw(field, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (field === "kdr") return mvpbNumber(number, 3);
  if (field === "flag_time_seconds") return `${mvpbNumber(number, 0)}s`;
  return mvpbNumber(number, Number.isInteger(number) ? 0 : 2);
}

function mvpbSigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (Math.abs(number) < 0.005) return "0.00";
  return `${number > 0 ? "+" : "−"}${mvpbNumber(Math.abs(number), 2)}`;
}

function mvpbTone(value) {
  const number = Number(value);
  if (number > 0.004) return "mvpb-pos";
  if (number < -0.004) return "mvpb-neg";
  return "mvpb-zero";
}

function mvpbFallbackBreakdowns(players, formula) {
  const weights = formula?.components || MVPB_FALLBACK_WEIGHTS;
  const fields = Object.values(weights).flatMap(component => Object.keys(component));
  const distributions = {};

  for (const field of fields) {
    const values = players.map(player => Number(player.raw?.[field] || 0));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    distributions[field] = { mean, stddev: Math.sqrt(variance) };
  }

  for (const player of players) {
    const components = {};
    for (const [component, componentWeights] of Object.entries(weights)) {
      const fieldRows = {};
      let score = 0;
      for (const [field, weight] of Object.entries(componentWeights)) {
        const raw = Number(player.raw?.[field] || 0);
        const { mean, stddev } = distributions[field];
        const zScore = Math.max(-3, Math.min(3, stddev ? (raw - mean) / stddev : 0));
        const contribution = Number(weight) * zScore;
        score += contribution;
        fieldRows[field] = { raw, mean, stddev, z_score: zScore, weight, contribution };
      }
      components[component] = { score, fields: fieldRows };
    }
    player.score_breakdown = {
      base_score: Number(formula?.base_score ?? 50),
      components,
      final_score: Number(player.final_score)
    };
  }
}

function mvpbExpression(player) {
  const base = Number(player.score_breakdown?.base_score ?? 50);
  return ["combat", "objective", "impact", "penalty"].reduce(
    (text, component) => `${text} ${mvpbSigned(player.components?.[component])}`,
    mvpbNumber(base, 0)
  );
}

function mvpbSummary(players) {
  const rows = players.map(player => `
    <tr class="${Number(player.rank) === 1 ? "mvp-winner" : ""}">
      <td><span class="mvpb-rank">${mvpbEscape(player.rank)}</span><span class="mvpb-player">${mvpbEscape(player.display_name || player.player_key || "Unknown")}</span></td>
      <td class="${mvpbTone(player.components?.combat)}">${mvpbSigned(player.components?.combat)}</td>
      <td class="${mvpbTone(player.components?.objective)}">${mvpbSigned(player.components?.objective)}</td>
      <td class="${mvpbTone(player.components?.impact)}">${mvpbSigned(player.components?.impact)}</td>
      <td class="${mvpbTone(player.components?.penalty)}">${mvpbSigned(player.components?.penalty)}</td>
      <td class="mvpb-expression">${mvpbEscape(mvpbExpression(player))}</td>
      <td class="mvpb-final">${mvpbNumber(player.final_score, 2)}</td>
    </tr>
  `).join("");

  return `
    <section class="mvpb-card">
      <div class="mvpb-card-head"><h2>Overall Breakdown</h2><span>Base + four weighted components</span></div>
      <div class="mvpb-table-scroll">
        <table class="mvpb-table">
          <thead><tr><th>Rank / Player</th><th>Combat</th><th>Objective</th><th>Impact</th><th>Penalty</th><th>Calculation</th><th>Final</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function mvpbComponentTable(players, key, config) {
  const headers = config.fields.map(field => `<th>${mvpbEscape(MVPB_FIELD_LABELS[field] || field)}</th>`).join("");
  const rows = players.map(player => {
    const breakdown = player.score_breakdown?.components?.[key];
    const cells = config.fields.map(field => {
      const detail = breakdown?.fields?.[field] || {};
      const title = `Mean ${mvpbNumber(detail.mean, 4)} · SD ${mvpbNumber(detail.stddev, 4)} · z ${mvpbNumber(detail.z_score, 4)} · weight ${mvpbNumber(detail.weight, 0)}`;
      return `<td class="mvpb-stat" title="${mvpbEscape(title)}"><strong>${mvpbRaw(field, detail.raw)}</strong><span class="${mvpbTone(detail.contribution)}">${mvpbSigned(detail.contribution)}</span></td>`;
    }).join("");
    return `
      <tr class="${Number(player.rank) === 1 ? "mvp-winner" : ""}">
        <td><span class="mvpb-rank">${mvpbEscape(player.rank)}</span><span class="mvpb-player">${mvpbEscape(player.display_name || player.player_key || "Unknown")}</span></td>
        ${cells}
        <td class="mvpb-component-total ${mvpbTone(breakdown?.score)}">${mvpbSigned(breakdown?.score)}</td>
      </tr>
    `;
  }).join("");

  return `
    <section class="mvpb-card mvpb-component-card">
      <div class="mvpb-card-head"><h2>${mvpbEscape(config.label)}</h2><span>${mvpbEscape(config.description)}</span></div>
      <div class="mvpb-table-scroll">
        <table class="mvpb-table mvpb-component-table">
          <thead><tr><th>Rank / Player</th>${headers}<th>${mvpbEscape(config.label)} total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function mvpbRender(match, requestedId) {
  const mvp = match.nn_mvp;
  if (!mvp?.available || !Array.isArray(mvp.players) || !mvp.players.length) {
    throw new Error(mvp?.reason || "MVP breakdown is unavailable for this match.");
  }

  const players = mvp.players.map(player => ({ ...player }));
  if (players.some(player => !player.score_breakdown)) {
    mvpbFallbackBreakdowns(players, mvp.formula);
  }

  const matchId = String(match.id || match.match_id || requestedId);
  const winner = players[0];
  const baseScore = Number(mvp.formula?.base_score ?? winner.score_breakdown?.base_score ?? 50);
  const zClamp = Number(mvp.formula?.z_clamp ?? 3);
  document.title = `${matchId} MVP Breakdown - NoName TFC`;

  mvpbResults.innerHTML = `
    <section class="mvpb-matchbar">
      <div><h2>${mvpbEscape(matchId)} · ${mvpbEscape(match.map_name || match.map || "Unknown map")}</h2><p>Winner: ${mvpbEscape(winner.display_name || "Unknown")} · ${mvpbNumber(winner.final_score, 2)} raw points · Formula ${mvpbEscape(mvp.formula_version || "unknown")}</p></div>
      <a href="match.html?id=${encodeURIComponent(matchId)}">Open Match</a>
    </section>
    <section class="mvpb-formula">
      <div class="mvpb-formula-badge">+${mvpbNumber(baseScore, 0)}</div>
      <div><strong>Score = ${mvpbNumber(baseScore, 0)} + Combat + Objective + Impact + Penalty</strong><p>Every raw statistic is converted to a z-score against all ${players.length} players using population standard deviation, clamped to ±${mvpbNumber(zClamp, 0)}, and multiplied by its field weight. Hover any contribution to see its match mean, standard deviation, z-score, and weight.</p></div>
    </section>
    ${mvpbSummary(players)}
    <div class="mvpb-component-grid">
      ${Object.entries(MVPB_COMPONENTS).map(([key, config]) => mvpbComponentTable(players, key, config)).join("")}
    </div>
    <p class="mvpb-footnote">Raw statistics are shown above each weighted contribution. Category and final totals are calculated with full-precision values before rounding, so adding the visible two-decimal contributions can occasionally differ by 0.01.</p>
  `;
}

async function mvpbLoad(matchId) {
  const id = String(matchId || "").trim();
  if (!id) {
    mvpbInput?.focus();
    return;
  }

  mvpbInput.value = id;
  if (mvpbSubmit) mvpbSubmit.disabled = true;
  mvpbResults.innerHTML = `<div class="mvpb-loading"><div class="mvpb-spinner" aria-hidden="true"></div><strong>Calculating ${mvpbEscape(id)}…</strong></div>`;

  try {
    const response = await fetch(`api/match/${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error === "match_not_found" ? "Match not found." : (data.error || "Could not load match."));
    mvpbRender(data.match || data, id);
  } catch (error) {
    mvpbResults.innerHTML = `<div class="mvpb-error"><strong>Could not build this breakdown.</strong><span>${mvpbEscape(error?.message || "Please check the match ID and try again.")}</span></div>`;
  } finally {
    if (mvpbSubmit) mvpbSubmit.disabled = false;
  }
}

mvpbForm?.addEventListener("submit", event => {
  event.preventDefault();
  const id = String(mvpbInput?.value || "").trim();
  if (!id) return mvpbInput?.focus();
  const url = new URL(location.href);
  url.searchParams.set("id", id);
  history.pushState({}, "", url);
  mvpbLoad(id);
});

window.addEventListener("popstate", () => {
  const id = new URLSearchParams(location.search).get("id") || "";
  if (id) mvpbLoad(id);
});

const mvpbInitialId = new URLSearchParams(location.search).get("id");
if (mvpbInitialId) mvpbLoad(mvpbInitialId);
