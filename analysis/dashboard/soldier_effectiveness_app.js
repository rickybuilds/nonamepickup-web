const state = {
  activeMode: "equal_time",
  data: window.SOLDIER_EFFECTIVENESS_DATA || { modes: {}, schemaNotes: [] }
};

const color = {
  pre: "#2563eb",
  post: "#c43c35",
  ink: "#18202a",
  muted: "#66717f",
  grid: "#edf0f3",
  green: "#16825d",
  red: "#c43c35",
  gold: "#b7791f"
};

const cardMetrics = [
  ["team_damage_per_round", "Friendly Damage / Round", true],
  ["damage_per_round", "Damage / Round", false],
  ["kd", "K/D", false],
  ["kills_per_round", "Kills / Round", false],
  ["deaths_per_round", "Deaths / Round", true]
];

function activeData() {
  return state.data.modes[state.activeMode] || state.data.modes[state.data.defaultMode] || {
    label: "No Data",
    meta: {},
    overall: [],
    maps: [],
    paired_players_min5: [],
    paired_players_min10: []
  };
}

function byMetric(rows, metric) {
  return rows.find(row => row.metric === metric) || { pre: 0, post: 0, pct_change: 0 };
}

function num(value) {
  return Number(value || 0);
}

function format(value, decimals = 1) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "n/a";
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: Math.abs(Number(value) - Math.round(Number(value))) < 0.001 ? 0 : decimals
  });
}

function compact(value) {
  const n = num(value);
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return format(n, 1);
}

function pct(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "n/a";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function changeClass(value, lowerIsGood = true) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "neutral";
  const n = Number(value);
  if (Math.abs(n) < 0.1) return "neutral";
  return lowerIsGood ? (n < 0 ? "good" : "bad") : (n > 0 ? "good" : "bad");
}

function deltaPill(value, lowerIsGood = true) {
  const cls = changeClass(value, lowerIsGood);
  return `<span class="delta-pill ${cls}">${pct(value)}</span>`;
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(240, Math.floor(Number(canvas.getAttribute("height") || 280) * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: canvas.width / ratio, height: canvas.height / ratio };
}

function drawGroupedBars(canvas, groups) {
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { top: 18, right: 18, bottom: 54, left: 58 };
  const max = Math.max(...groups.flatMap(group => [group.pre, group.post]), 1);
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const groupWidth = chartWidth / groups.length;
  const barWidth = Math.min(34, groupWidth * 0.26);

  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px Inter, system-ui, sans-serif";

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + chartHeight * (i / 4);
    ctx.strokeStyle = color.grid;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = color.muted;
    ctx.textAlign = "right";
    ctx.fillText(compact(max * (1 - i / 4)), pad.left - 8, y + 4);
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

  ctx.textAlign = "left";
  ctx.fillStyle = color.pre;
  ctx.fillRect(width - 150, 18, 11, 11);
  ctx.fillStyle = color.ink;
  ctx.fillText("PRE", width - 134, 28);
  ctx.fillStyle = color.post;
  ctx.fillRect(width - 88, 18, 11, 11);
  ctx.fillStyle = color.ink;
  ctx.fillText("POST", width - 72, 28);
}

function drawHorizontalDeltas(canvas, rows) {
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { top: 18, right: 70, bottom: 18, left: 116 };
  const max = Math.max(...rows.map(row => Math.abs(num(row.team_damage_per_round_pct_change))), 1);
  const rowGap = (height - pad.top - pad.bottom) / Math.max(rows.length, 1);
  const barHeight = Math.max(10, Math.min(22, rowGap * 0.56));
  const zeroX = width - pad.right;
  const barMax = width - pad.left - pad.right;

  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  rows.forEach((row, index) => {
    const value = num(row.team_damage_per_round_pct_change);
    const y = pad.top + index * rowGap + rowGap / 2;
    const barWidth = Math.abs(value) / max * barMax;
    ctx.fillStyle = color.ink;
    ctx.textAlign = "right";
    ctx.fillText(String(row.player_name).slice(0, 16), pad.left - 10, y);
    ctx.fillStyle = value < 0 ? color.green : color.red;
    ctx.fillRect(zeroX - barWidth, y - barHeight / 2, barWidth, barHeight);
    ctx.fillStyle = color.muted;
    ctx.textAlign = "left";
    ctx.fillText(pct(value), zeroX + 8, y);
  });
}

function renderModeChrome() {
  const data = activeData();
  const meta = data.meta || {};
  document.querySelectorAll(".mode-tabs button").forEach(button => {
    button.classList.toggle("active", button.dataset.mode === state.activeMode);
  });
  document.querySelector("#modeWindow").textContent = `${data.label}: PRE ${meta.pre_match_count || 0} matches, POST ${meta.post_match_count || 0} matches`;
  document.querySelector("#modeNote").textContent = `${data.label}: PRE ${meta.pre_first_match_time || "n/a"} through ${meta.pre_last_match_time || "n/a"}. POST ${meta.post_first_match_time || "n/a"} through ${meta.post_last_match_time || "n/a"}.`;
  document.querySelector("#schemaNotes").textContent = state.data.schemaNotes?.length
    ? `Schema limitations: ${state.data.schemaNotes.join("; ")}.`
    : "No schema limitations found for requested effectiveness metrics.";
}

function renderCards() {
  const data = activeData();
  document.querySelector("#effectivenessCards").innerHTML = cardMetrics.map(([metric, label, lowerIsGood]) => {
    const row = byMetric(data.overall, metric);
    const cls = changeClass(row.pct_change, lowerIsGood);
    return `
      <article class="metric-card">
        <div class="label">${label}</div>
        <div class="value">${format(row.post, metric === "kd" ? 2 : 1)}</div>
        <div class="sub">
          <span>PRE ${format(row.pre, metric === "kd" ? 2 : 1)}</span>
          <span class="change ${cls}">${pct(row.pct_change)}</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderCharts() {
  const data = activeData();
  const groups = [
    ["team_damage_per_round", "FD/R"],
    ["damage_per_round", "Dmg/R"],
    ["kd", "K/D"],
    ["kills_per_round", "K/R"],
    ["deaths_per_round", "Dths/R"]
  ].map(([metric, label]) => {
    const row = byMetric(data.overall, metric);
    return { label, pre: row.pre, post: row.post };
  });
  drawGroupedBars(document.querySelector("#effectivenessChart"), groups);
  const paired = pairedRows().slice(0, 10);
  drawHorizontalDeltas(document.querySelector("#pairedChart"), paired);
  document.querySelector("#effectivenessCallout").textContent = `FD/R ${pct(byMetric(data.overall, "team_damage_per_round").pct_change)}`;
  document.querySelector("#pairedCallout").textContent = `${paired.length} shown`;
}

function pairedRows() {
  const data = activeData();
  const minRounds = Number(document.querySelector("#minRounds")?.value || 5);
  const query = document.querySelector("#playerSearch")?.value.trim().toLowerCase() || "";
  const rows = minRounds === 10 ? data.paired_players_min10 : data.paired_players_min5;
  return [...(rows || [])]
    .filter(row => String(row.player_name).toLowerCase().includes(query))
    .sort((a, b) => num(a.team_damage_per_round_pct_change) - num(b.team_damage_per_round_pct_change));
}

function renderTable(target, rows, columns) {
  document.querySelector(target).innerHTML = rows.map(row => `
    <tr>
      ${columns.map(column => `<td>${column.format ? column.format(row[column.key], row) : row[column.key]}</td>`).join("")}
    </tr>
  `).join("");
}

function renderTables() {
  const data = activeData();
  const mapQuery = document.querySelector("#mapSearch").value.trim().toLowerCase();
  const maps = [...data.maps]
    .filter(row => String(row.map_name).toLowerCase().includes(mapQuery))
    .sort((a, b) => num(a.team_damage_per_round_pct_change) - num(b.team_damage_per_round_pct_change));

  renderTable("#pairedTable", pairedRows(), [
    { key: "player_name" },
    { key: "pre_soldier_rounds", format: value => format(value, 0) },
    { key: "post_soldier_rounds", format: value => format(value, 0) },
    { key: "pre_team_damage_per_round", format: value => format(value, 1) },
    { key: "post_team_damage_per_round", format: value => format(value, 1) },
    { key: "team_damage_per_round_pct_change", format: value => deltaPill(value, true) },
    { key: "pre_damage_per_round", format: value => format(value, 1) },
    { key: "post_damage_per_round", format: value => format(value, 1) },
    { key: "damage_per_round_pct_change", format: value => deltaPill(value, false) },
    { key: "pre_kd", format: value => format(value, 2) },
    { key: "post_kd", format: value => format(value, 2) },
    { key: "kd_pct_change", format: value => deltaPill(value, false) },
    {
      key: "post_kills_per_round",
      format: (value, row) => `${format(row.pre_kills_per_round, 1)} / ${format(value, 1)}`
    },
    {
      key: "post_deaths_per_round",
      format: (value, row) => `${format(row.pre_deaths_per_round, 1)} / ${format(value, 1)}`
    }
  ]);

  renderTable("#mapTable", maps, [
    { key: "map_name" },
    { key: "pre_soldier_rounds", format: value => format(value, 0) },
    { key: "post_soldier_rounds", format: value => format(value, 0) },
    {
      key: "post_damage_per_round",
      format: (value, row) => `${format(row.pre_damage_per_round, 1)} / ${format(value, 1)}`
    },
    {
      key: "post_team_damage_per_round",
      format: (value, row) => `${format(row.pre_team_damage_per_round, 1)} / ${format(value, 1)}`
    },
    {
      key: "post_kills_per_round",
      format: (value, row) => `${format(row.pre_kills_per_round, 1)} / ${format(value, 1)}`
    },
    {
      key: "post_deaths_per_round",
      format: (value, row) => `${format(row.pre_deaths_per_round, 1)} / ${format(value, 1)}`
    },
    {
      key: "post_kd",
      format: (value, row) => `${format(row.pre_kd, 2)} / ${format(value, 2)}`
    },
    {
      key: "post_friendly_damage_pct",
      format: (value, row) => `${format(row.pre_friendly_damage_pct, 1)}% / ${format(value, 1)}%`
    }
  ]);
}

function renderAll() {
  renderModeChrome();
  renderCards();
  renderCharts();
  renderTables();
}

function init() {
  state.activeMode = state.data.defaultMode || "equal_time";
  document.querySelectorAll(".mode-tabs button").forEach(button => {
    button.addEventListener("click", () => {
      state.activeMode = button.dataset.mode;
      renderAll();
    });
  });
  document.querySelector("#minRounds").addEventListener("change", renderAll);
  document.querySelector("#playerSearch").addEventListener("input", renderAll);
  document.querySelector("#mapSearch").addEventListener("input", renderTables);
  window.addEventListener("resize", () => window.requestAnimationFrame(renderCharts));
  renderAll();
}

init();
