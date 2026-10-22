(() => {
  const api = window.NNAnalyticsExperiments;
  let data;
  let metrics = [];
  let current;
  const $ = id => document.getElementById(id);
  const value = (row, metric) => api.format.value(row?.value, metric?.type);
  function populateSelect() {
    const groups = new Map();
    metrics.forEach(metric => { if (!groups.has(metric.group)) groups.set(metric.group, []); groups.get(metric.group).push(metric); });
    $("metric-select").innerHTML = [...groups.entries()].map(([group, entries]) => `<optgroup label="${api.escapeAttr(group)}">${entries.map(metric => `<option value="${api.escapeAttr(metric.id)}">${api.escapeHtml(metric.label)}</option>`).join("")}</optgroup>`).join("");
    $("deep-records").innerHTML = `<div class="deep-grid">${metrics.map(metric => `<button type="button" data-metric="${api.escapeAttr(metric.id)}">${api.escapeHtml(metric.label)}</button>`).join("")}</div>`;
  }
  function renderCoverage() {
    const summary = data.summary || {};
    $("coverage-signal").innerHTML = [["Matches",summary.matches],["Players",summary.players],["Rounds",summary.rounds],["Kills",summary.total_kills]].map(([label, number]) => `<div class="signal-cell"><span>${label}</span><strong>${api.format.count(number)}</strong></div>`).join("");
    const activity = (data.activity || []).slice(-8);
    const max = Math.max(1, ...activity.map(row => row.matches == null || row.matches === "" ? 0 : Number(row.matches)));
    $("activity-signal").innerHTML = activity.map(row => { const matches = row.matches == null || row.matches === "" ? null : Number(row.matches); const height = matches == null ? 8 : Math.max(8, matches / max * 100); return `<div class="activity-bar${matches == null ? " is-unavailable" : ""}" style="height:${height}%" title="${matches == null ? "Activity unavailable" : `${api.format.count(matches)} matches`}"><span>${api.escapeHtml(String(row.month).slice(5))}</span></div>`; }).join("") || `<span class="nn-note">No activity data.</span>`;
  }
  function renderContext(metric) {
    const topMap = data.maps?.details?.[0] || data.maps?.most_played?.[0];
    const leader = metric.rows?.[0];
    const summary = data.summary || {};
    $("archive-context").innerHTML = [["Archive", `${api.format.count(summary.matches)} matches`],["Top map", topMap?.map || "Unavailable"],["Metric rows", `${metric.rows.length} returned`]].map(([label, value]) => `<div class="context-row"><span>${label}</span><strong>${api.escapeHtml(value)}</strong></div>`).join("");
    const related = [api.sourceLinks(leader), leader?.map ? api.mapLink(leader) : "", leader?.match_id ? api.matchLink(leader) : ""].filter(Boolean);
    $("related-evidence").innerHTML = related.length ? `<div class="related-list">${related.map(item => `<span>${item}</span>`).join("")}</div>` : `<span class="nn-note">No linked evidence on this record.</span>`;
    $("method-copy").textContent = `${metric.note}. Values are returned by the NoName analytics endpoint; missing or non-qualified records remain unavailable rather than being inferred.`;
  }
  function renderMetric(id) {
    current = metrics.find(metric => metric.id === id) || metrics[0];
    if (!current) return;
    const rows = current.rows || [];
    $("metric-select").value = current.id;
    $("focus-group").textContent = current.group.toUpperCase();
    $("focus-note").textContent = current.note;
    if (!rows.length) { $("focus-state").hidden = false; $("focus-state").innerHTML = "<strong>No record</strong><span>The API returned no qualifying rows for this metric.</span>"; $("focal-card").hidden = true; $("ladder").innerHTML = ""; return; }
    $("focus-state").hidden = true;
    $("focal-card").hidden = false;
    const leader = rows[0]; const runner = rows[1]; const hasLeaderValue = leader.value != null && leader.value !== ""; const hasRunnerValue = runner?.value != null && runner.value !== ""; const gap = runner && hasLeaderValue && hasRunnerValue ? Math.max(0, Number(leader.value) - Number(runner.value)) : null; const max = hasLeaderValue ? Math.max(1, Number(leader.value)) : 1;
    $("leader-name").innerHTML = leader.player ? api.playerLink(leader) : api.mapLink(leader);
    $("leader-context").textContent = api.rowDetail(leader, current);
    $("leader-value").textContent = value(leader, current);
    $("gap-bar").style.width = `${Math.max(14, Math.min(100, Number(leader.value || 0) / max * 100))}%`;
    $("gap-copy").textContent = runner ? (gap == null ? `Gap unavailable · ${runner.player || runner.map || "the next record"} returned` : `${api.format.value(gap, current.type)} ahead of ${runner.player || runner.map || "the next record"}`) : "No runner-up record returned.";
    $("ladder-count").textContent = `${rows.length} rows · ${current.note}`;
    $("ladder").innerHTML = rows.map((row, index) => `<div class="ladder-row"><span class="ladder-rank">${index + 1}</span><div class="ladder-player">${row.player ? api.playerLink(row) : api.mapLink(row)}<small>${api.escapeHtml(api.rowDetail(row, current))}</small><small class="ladder-links">${api.sourceLinks(row) || "No linked source"}</small></div><span class="ladder-value">${value(row, current)}</span><span class="ladder-sample">${row.matches != null ? `${api.format.number.format(Number(row.matches))} games` : "record"}</span></div>`).join("");
    renderContext(current);
  }
  $("metric-select").addEventListener("change", event => renderMetric(event.target.value));
  $("deep-details").addEventListener("click", event => { const button = event.target.closest("[data-metric]"); if (button) { renderMetric(button.dataset.metric); $("deep-details").open = false; } });
  $("open-details").addEventListener("click", () => { const details = $("deep-details"); details.open = !details.open; $("open-details").setAttribute("aria-expanded", String(details.open)); });
  api.loadAnalytics().then(result => { if (result.error) { $("focus-state").className = "nn-state nn-state-error"; $("focus-state").setAttribute("role", "alert"); $("focus-state").innerHTML = `<strong>Analytics unavailable</strong><span>${api.escapeHtml(result.error)} Use ?api=https://nonamepickup.servehalflife.com when reviewing with the public API.</span>`; $("command-status").innerHTML = `<span class="status-light"></span><span>ARCHIVE UNAVAILABLE</span>`; return; } data = result.data; metrics = api.metricCatalog(data); populateSelect(); renderCoverage(); $("command-status").innerHTML = `<span class="status-light is-ready"></span><span>ARCHIVE READY · LIMIT 10</span>`; renderMetric(metrics[0]?.id); });
})();
