const csvFiles = {
  overall: "../output/overall.csv",
  maps: "../output/maps.csv",
  players: "../output/players.csv",
  objectives: "../output/objectives.csv"
};

const metricLabels = {
  matches: "Matches",
  rounds: "Rounds",
  soldier_player_rounds: "Soldier Rounds",
  soldier_damage: "Soldier Damage",
  soldier_team_damage: "Team Damage",
  team_damage_per_soldier_round: "TD / Soldier Round",
  team_damage_per_soldier_match: "TD / Soldier Match",
  damage_per_soldier_round: "Damage / Soldier Round",
  damage_per_team_damage: "Damage per TD",
  team_damage_pct_soldier_damage: "Friendly Damage %",
  soldier_damage_per_match: "Damage / Match",
  flag_touches_allowed_per_match: "Touches Allowed / Match",
  captures_allowed_per_match: "Caps Allowed / Match"
};

const color = {
  pre: "#2563eb",
  post: "#c43c35",
  ink: "#18202a",
  muted: "#66717f",
  line: "#d9dee5",
  grid: "#edf0f3",
  green: "#16825d",
  gold: "#b7791f",
  cyan: "#0891b2"
};

const state = {
  defaultMode: "equal_time",
  activeMode: "equal_time",
  modes: {}
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records
    .filter(record => record.some(cell => cell !== ""))
    .map(record => Object.fromEntries(headers.map((header, index) => [header, coerce(record[index])])));
}

function coerce(value) {
  if (value == null || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

async function loadData() {
  if (window.SOLDIER_NG_DATA) {
    if (window.SOLDIER_NG_DATA.modes) {
      Object.assign(state, window.SOLDIER_NG_DATA);
      state.activeMode = state.defaultMode || "equal_time";
    } else {
      state.modes = {
        equal_time: {
          label: "Equal Time",
          meta: {},
          ...window.SOLDIER_NG_DATA
        }
      };
      state.activeMode = "equal_time";
    }
    return;
  }

  const entries = await Promise.all(
    Object.entries(csvFiles).map(async ([key, file]) => {
      const response = await fetch(file);
      if (!response.ok) throw new Error(`Failed to load ${file}`);
      return [key, parseCsv(await response.text())];
    })
  );

  state.modes = normalizeModeRows(Object.fromEntries(entries));
  state.activeMode = state.defaultMode;
}

function normalizeModeRows(datasets) {
  const modes = {};
  for (const [datasetName, rows] of Object.entries(datasets)) {
    for (const row of rows) {
      const modeId = row.comparison_mode || "equal_time";
      const label = row.comparison_label || (modeId === "equal_match_count" ? "Equal Match Count" : "Equal Time");
      modes[modeId] ||= { label, meta: {}, overall: [], maps: [], players: [], objectives: [] };
      const clean = { ...row };
      delete clean.comparison_mode;
      delete clean.comparison_label;
      modes[modeId][datasetName].push(clean);
    }
  }
  return modes;
}

function activeData() {
  return state.modes[state.activeMode] || state.modes[state.defaultMode] || {
    label: "No Data",
    meta: {},
    overall: [],
    maps: [],
    players: [],
    objectives: []
  };
}

function byMetric(rows, metric) {
  return rows.find(row => row.metric === metric) || { pre: 0, post: 0, pct_change: 0 };
}

function compactNumber(value, decimals = 1) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(decimals)}M`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(decimals)}K`;
  if (Math.abs(number % 1) > 0.001) return number.toFixed(decimals);
  return number.toLocaleString();
}

function number(value, decimals = 0) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  });
}

function pct(value) {
  if (value === "" || value == null || Number.isNaN(Number(value))) return "n/a";
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

function changeClass(value, lowerIsGood = true) {
  if (value === "" || value == null || Number.isNaN(Number(value))) return "neutral";
  const numeric = Number(value);
  if (Math.abs(numeric) < 0.1) return "neutral";
  return lowerIsGood ? (numeric < 0 ? "good" : "bad") : (numeric > 0 ? "good" : "bad");
}

function renderCards() {
  const data = activeData();
  const cards = [
    ["soldier_team_damage", "Team Damage", true],
    ["team_damage_per_soldier_round", "TD / Soldier Round", true],
    ["soldier_damage", "Soldier Damage", false],
    ["damage_per_team_damage", "Damage per TD", false],
    ["captures_allowed_per_match", "Caps Allowed / Match", true]
  ];
  const container = document.querySelector("#summaryCards");
  container.innerHTML = cards.map(([metric, label, lowerIsGood]) => {
    const source = metric.includes("captures") ? data.objectives : data.overall;
    const row = byMetric(source, metric);
    const cls = changeClass(row.pct_change, lowerIsGood);
    return `
      <article class="metric-card">
        <div class="label">${label}</div>
        <div class="value">${compactNumber(row.post)}</div>
        <div class="sub">
          <span>PRE ${compactNumber(row.pre)}</span>
          <span class="change ${cls}">${pct(row.pct_change)}</span>
        </div>
      </article>
    `;
  }).join("");
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(220, Math.floor(Number(canvas.getAttribute("height") || 260) * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: canvas.width / ratio, height: canvas.height / ratio };
}

function drawGroupedBars(canvas, groups, options = {}) {
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { top: 16, right: 18, bottom: 54, left: 58 };
  const max = Math.max(...groups.flatMap(group => [group.pre, group.post]), 1);
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const groupWidth = chartWidth / groups.length;
  const barWidth = Math.min(34, groupWidth * 0.26);

  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + chartHeight * (i / 4);
    ctx.strokeStyle = color.grid;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = color.muted;
    ctx.textAlign = "right";
    ctx.fillText(compactNumber(max * (1 - i / 4)), pad.left - 8, y + 4);
  }

  groups.forEach((group, index) => {
    const x = pad.left + index * groupWidth + groupWidth / 2;
    const preHeight = chartHeight * (group.pre / max);
    const postHeight = chartHeight * (group.post / max);
    ctx.fillStyle = color.pre;
    ctx.fillRect(x - barWidth - 3, pad.top + chartHeight - preHeight, barWidth, preHeight);
    ctx.fillStyle = color.post;
    ctx.fillRect(x + 3, pad.top + chartHeight - postHeight, barWidth, postHeight);
    ctx.fillStyle = color.ink;
    ctx.textAlign = "center";
    ctx.fillText(group.label, x, height - 24);
  });

  drawLegend(ctx, width - 150, 16);
  if (options.footer) {
    ctx.fillStyle = color.muted;
    ctx.textAlign = "left";
    ctx.fillText(options.footer, pad.left, height - 8);
  }
}

function drawHorizontalBars(canvas, rows) {
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { top: 18, right: 72, bottom: 18, left: 112 };
  const max = Math.max(...rows.map(row => Math.abs(row.delta)), 1);
  const rowGap = (height - pad.top - pad.bottom) / rows.length;
  const barHeight = Math.max(10, Math.min(22, rowGap * 0.56));
  const zeroX = width - pad.right;
  const barMax = width - pad.left - pad.right;

  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  rows.forEach((row, index) => {
    const y = pad.top + index * rowGap + rowGap / 2;
    const barWidth = Math.abs(row.delta) / max * barMax;
    ctx.fillStyle = color.ink;
    ctx.textAlign = "right";
    ctx.fillText(row.map_name, pad.left - 10, y);
    ctx.fillStyle = row.delta < 0 ? color.green : color.red;
    ctx.fillRect(zeroX - barWidth, y - barHeight / 2, barWidth, barHeight);
    ctx.fillStyle = color.muted;
    ctx.textAlign = "left";
    ctx.fillText(compactNumber(row.delta), zeroX + 8, y);
  });
}

function drawLegend(ctx, x, y) {
  ctx.textAlign = "left";
  ctx.fillStyle = color.pre;
  ctx.fillRect(x, y, 11, 11);
  ctx.fillStyle = color.ink;
  ctx.fillText("PRE", x + 16, y + 10);
  ctx.fillStyle = color.post;
  ctx.fillRect(x + 62, y, 11, 11);
  ctx.fillStyle = color.ink;
  ctx.fillText("POST", x + 78, y + 10);
}

function renderCharts() {
  const data = activeData();
  const damageGroups = [
    ["soldier_team_damage", "Team dmg", data.overall],
    ["soldier_damage", "Enemy dmg", data.overall],
    ["team_damage_per_soldier_round", "TD / rnd", data.overall],
    ["damage_per_soldier_round", "Dmg / rnd", data.overall]
  ].map(([metric, label, source]) => {
    const row = byMetric(source, metric);
    return { label, pre: row.pre, post: row.post };
  });
  drawGroupedBars(document.querySelector("#damageChart"), damageGroups);

  const efficiencyGroups = [
    ["damage_per_team_damage", "Dmg / TD", data.overall],
    ["team_damage_pct_soldier_damage", "FD %", data.overall],
    ["soldier_damage_per_match", "Dmg / match", data.overall],
    ["team_damage_per_soldier_match", "TD / match", data.overall]
  ].map(([metric, label, source]) => {
    const row = byMetric(source, metric);
    return { label, pre: row.pre, post: row.post };
  });
  drawGroupedBars(document.querySelector("#efficiencyChart"), efficiencyGroups);

  const objectiveGroups = [
    ["flag_touches_allowed_per_match", "Touches", data.objectives],
    ["captures_allowed_per_match", "Caps", data.objectives]
  ].map(([metric, label, source]) => {
    const row = byMetric(source, metric);
    return { label, pre: row.pre, post: row.post };
  });
  drawGroupedBars(document.querySelector("#objectiveChart"), objectiveGroups);

  const mapDrops = data.maps
    .map(row => ({
      map_name: row.map_name,
      delta: Number(row.post_soldier_team_damage || 0) - Number(row.pre_soldier_team_damage || 0)
    }))
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 10);
  drawHorizontalBars(document.querySelector("#mapDropChart"), mapDrops);

  document.querySelector("#damageCallout").textContent = pct(byMetric(data.overall, "soldier_team_damage").pct_change);
  document.querySelector("#efficiencyCallout").textContent = `${number(byMetric(data.overall, "team_damage_pct_soldier_damage").post, 1)}% POST FD`;
  document.querySelector("#objectiveCallout").textContent = pct(byMetric(data.objectives, "captures_allowed_per_match").pct_change);
}

function renderTable(target, rows, columns) {
  document.querySelector(target).innerHTML = rows.map(row => `
    <tr>
      ${columns.map(column => {
        const value = column.format ? column.format(row[column.key], row) : row[column.key];
        return `<td>${value}</td>`;
      }).join("")}
    </tr>
  `).join("");
}

function deltaPill(value, lowerIsGood = true) {
  const cls = changeClass(value, lowerIsGood);
  return `<span class="delta-pill ${cls}">${pct(value)}</span>`;
}

function renderTables() {
  const data = activeData();
  const mapQuery = document.querySelector("#mapSearch").value.trim().toLowerCase();
  const playerQuery = document.querySelector("#playerSearch").value.trim().toLowerCase();

  const maps = data.maps
    .filter(row => String(row.map_name).toLowerCase().includes(mapQuery))
    .sort((a, b) => {
      const ad = Number(a.post_soldier_team_damage || 0) - Number(a.pre_soldier_team_damage || 0);
      const bd = Number(b.post_soldier_team_damage || 0) - Number(b.pre_soldier_team_damage || 0);
      return ad - bd;
    });

  const players = data.players
    .filter(row => String(row.player_name).toLowerCase().includes(playerQuery))
    .sort((a, b) => {
      const at = Number(a.pre_team_damage || 0) + Number(a.post_team_damage || 0);
      const bt = Number(b.pre_team_damage || 0) + Number(b.post_team_damage || 0);
      return bt - at;
    });

  renderTable("#mapTable", maps, [
    { key: "map_name" },
    { key: "pre_soldier_team_damage", format: value => number(value) },
    { key: "post_soldier_team_damage", format: value => number(value) },
    { key: "soldier_team_damage_pct_change", format: value => deltaPill(value, true) },
    { key: "pre_soldier_damage", format: value => number(value) },
    { key: "post_soldier_damage", format: value => number(value) },
    {
      key: "post_damage_per_soldier_round",
      format: (value, row) => `${number(row.pre_damage_per_soldier_round, 1)} / ${number(value, 1)}`
    },
    { key: "post_team_damage_per_match", format: value => number(value, 1) }
  ]);

  renderTable("#playerTable", players, [
    { key: "player_name" },
    { key: "pre_team_damage", format: value => number(value) },
    { key: "post_team_damage", format: value => number(value) },
    { key: "team_damage_pct_change", format: value => deltaPill(value, true) },
    { key: "pre_rounds", format: value => number(value) },
    { key: "post_rounds", format: value => number(value) },
    {
      key: "post_team_damage_per_round",
      format: (value, row) => `${number(row.pre_team_damage_per_round, 1)} / ${number(value, 1)}`
    },
    {
      key: "post_team_damage_pct_soldier_damage",
      format: (value, row) => `${number(row.pre_team_damage_pct_soldier_damage, 1)}% / ${number(value, 1)}%`
    }
  ]);
}

function renderModeChrome() {
  const data = activeData();
  const meta = data.meta || {};
  document.querySelectorAll(".mode-tabs button").forEach(button => {
    button.classList.toggle("active", button.dataset.mode === state.activeMode);
  });
  document.querySelector("#modeWindow").textContent = `${data.label}: PRE ${meta.pre_match_count || 0} matches, POST ${meta.post_match_count || 0} matches`;
  const preRange = meta.pre_first_match_time && meta.pre_last_match_time
    ? `${meta.pre_first_match_time} through ${meta.pre_last_match_time}`
    : "No PRE matches";
  const postRange = meta.post_first_match_time && meta.post_last_match_time
    ? `${meta.post_first_match_time} through ${meta.post_last_match_time}`
    : "No POST matches";
  document.querySelector("#modeNote").textContent = `${data.label}: PRE ${preRange}. POST ${postRange}. Metrics below are Soldier-only.`;
}

function renderAll() {
  renderModeChrome();
  renderCards();
  renderCharts();
  renderTables();
}

async function init() {
  await loadData();
  renderAll();
  document.querySelectorAll(".mode-tabs button").forEach(button => {
    button.addEventListener("click", () => {
      state.activeMode = button.dataset.mode;
      renderAll();
    });
  });
  document.querySelector("#mapSearch").addEventListener("input", renderTables);
  document.querySelector("#playerSearch").addEventListener("input", renderTables);
  window.addEventListener("resize", () => {
    window.requestAnimationFrame(renderCharts);
  });
}

init().catch(error => {
  document.body.innerHTML = `<main><section class="table-section"><h2>Dashboard failed to load</h2><p>${error.message}</p></section></main>`;
});
