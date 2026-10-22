(() => {
  const api = window.NNAnalyticsExperiments;
  let data;
  let metrics = [];
  let current = null;
  const selected = [];
  const $ = id => document.getElementById(id);
  function setState(title, detail, kind = "info") {
    const target = $("result-state");
    target.className = `nn-state nn-state-${kind}`;
    target.setAttribute("role", kind === "error" ? "alert" : "status");
    target.innerHTML = `<strong>${api.escapeHtml(title)}</strong><span>${api.escapeHtml(detail)}</span>`;
    target.hidden = false;
  }
  function coverage() {
    const summary = data.summary || {};
    $("coverage").innerHTML = [["Matches", summary.matches], ["Players", summary.players], ["Rounds", summary.rounds], ["Kills", summary.total_kills]].map(([label, value]) => `<div class="coverage-cell"><span>${label}</span><strong>${api.format.count(value)}</strong></div>`).join("");
    $("qualification-note").textContent = `Performance rankings use the live qualification rules: ${api.format.count(data.qualification?.minimum_games)} games minimum where noted.`;
  }
  function renderMetricNav(filter = "") {
    const needle = filter.trim().toLowerCase();
    const groups = new Map();
    metrics.filter(metric => !needle || `${metric.group} ${metric.label}`.toLowerCase().includes(needle)).forEach(metric => { if (!groups.has(metric.group)) groups.set(metric.group, []); groups.get(metric.group).push(metric); });
    $("metric-nav").innerHTML = [...groups.entries()].map(([group, entries]) => `<div class="metric-group"><div class="nn-note" style="padding:8px 9px;text-transform:uppercase;letter-spacing:.08em">${api.escapeHtml(group)}</div>${entries.map(metric => `<button type="button" data-metric="${api.escapeAttr(metric.id)}" aria-pressed="${current?.id === metric.id}">${api.escapeHtml(metric.label)}<small>${api.escapeHtml(metric.note)}</small></button>`).join("")}</div>`).join("") || api.state("No metrics match", "Try a broader metric search.");
  }
  function renderOverview() {
    $("result-group").textContent = "Overview";
    $("result-title").textContent = "Coverage before comparison";
    $("result-note").textContent = "Choose a metric from the rail to move from archive context into ranked evidence.";
    $("ranking-wrap").hidden = true;
    $("result-state").hidden = true;
    const activity = (data.activity || []).slice(-6);
    const spotlight = [...(data.per_game?.kills || []), ...(data.combat?.kills || [])].slice(0, 5);
    $("overview-panel").hidden = false;
    $("overview-panel").innerHTML = `<div class="overview-block"><h3>Recent activity</h3><div class="overview-list">${activity.map(row => `<div><span>${api.escapeHtml(row.month)}</span><strong>${api.format.count(row.matches)} matches</strong></div>`).join("") || `<p class="nn-note">No activity data available.</p>`}</div></div><div class="overview-block"><h3>Performance spotlight</h3><div class="overview-list">${spotlight.map(row => `<div><span>${api.playerLink(row)}</span><strong>${api.format.value(row.value, "decimal")}</strong></div>`).join("") || `<p class="nn-note">No leaders available.</p>`}</div></div>`;
  }
  function renderRanking(filter = "") {
    const rows = current?.rows || [];
    const needle = filter.trim().toLowerCase();
    const filtered = rows.filter(row => JSON.stringify(row).toLowerCase().includes(needle));
    $("result-group").textContent = current.group;
    $("result-title").textContent = current.label;
    $("result-note").textContent = `${current.note} · ${filtered.length} of ${rows.length} returned rows`;
    $("overview-panel").hidden = true;
    $("result-state").hidden = filtered.length > 0;
    $("ranking-wrap").hidden = filtered.length === 0;
    if (!filtered.length) { setState(rows.length ? "No matching records" : "No record", rows.length ? "Try a different player, map, or context filter." : "The API returned no qualifying rows for this metric."); return; }
    $("ranking-body").innerHTML = filtered.map((row, index) => `<tr tabindex="0" data-row-index="${rows.indexOf(row)}"><td class="rank">${index + 1}</td><td class="player-cell">${row.map && !row.player ? api.mapLink(row) : api.playerLink(row)}<small>${api.escapeHtml(api.rowDetail(row, current))}</small></td><td class="value">${api.format.value(row.value, current.type)}</td><td class="evidence">${api.sourceLinks(row) || api.escapeHtml(row.secondary != null ? `${api.format.number.format(Number(row.secondary))} total` : current.note)}</td></tr>`).join("");
  }
  function renderComparison() {
    $("selection-count").textContent = `${selected.length} selected`;
    $("comparison-body").innerHTML = selected.length ? selected.map(item => `<div class="comparison-item"><strong>${item.player || item.map || "Record"}</strong><span class="nn-number">${api.format.value(item.value, item.type)}</span><small class="nn-note">${api.escapeHtml(item.detail)}</small>${item.links ? `<div style="margin-top:8px">${item.links}</div>` : ""}</div>`).join("") : `<p class="nn-note">Select a row to pin a player or record here while you continue exploring.</p>`;
  }
  function selectMetric(id) { current = metrics.find(metric => metric.id === id) || null; renderMetricNav($("metric-filter").value); if (current) renderRanking($("row-filter").value); else renderOverview(); }
  $("metric-nav").addEventListener("click", event => { const button = event.target.closest("[data-metric]"); if (button) selectMetric(button.dataset.metric); });
  $("metric-filter").addEventListener("input", event => renderMetricNav(event.target.value));
  $("row-filter").addEventListener("input", event => current && renderRanking(event.target.value));
  $("reset-selection").addEventListener("click", () => { selected.length = 0; renderComparison(); document.querySelectorAll(".ranking-table tr.is-selected").forEach(row => row.classList.remove("is-selected")); });
  function pinRow(row) { if (!row || !current) return; const source = current.rows[Number(row.dataset.rowIndex)]; selected.unshift({ ...source, type: current.type, player: source.player || source.map, detail: api.rowDetail(source, current), links: api.sourceLinks(source) }); if (selected.length > 3) selected.pop(); row.classList.add("is-selected"); renderComparison(); }
  $("ranking-body").addEventListener("click", event => pinRow(event.target.closest("tr[data-row-index]")));
  $("ranking-body").addEventListener("keydown", event => { const row = event.target.closest("tr[data-row-index]"); if (!row || !["Enter", " "].includes(event.key)) return; event.preventDefault(); pinRow(row); });
  api.loadAnalytics().then(result => { if (result.error) { $("coverage").innerHTML = api.state("Preview unavailable", result.error, "error"); setState("Analytics unavailable", `${result.error} Use ?api=https://nonamepickup.servehalflife.com when reviewing with the public API.` , "error"); return; } data = result.data; metrics = api.metricCatalog(data); coverage(); renderMetricNav(); renderOverview(); });
})();
