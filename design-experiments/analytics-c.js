(() => {
  const api = window.NNAnalyticsExperiments;
  let data;
  let metrics = [];
  let currentQuestion = null;
  let currentMetric = null;
  let currentScope = "all";
  const $ = id => document.getElementById(id);
  const questions = [{ id:"performance", label:"Who is performing best?", groups:["performance","combat","objective"] }, { id:"records", label:"Who owns the records?", groups:["players","matches","rounds"] }, { id:"maps", label:"Which maps shape the archive?", groups:["maps","objective"] }, { id:"roles", label:"What roles create impact?", groups:["roles","objective"] }];
  function metricPool() { return metrics.filter(metric => !currentQuestion || currentQuestion.groups.includes(metric.group)); }
  function renderQuestions() { $("question-grid").innerHTML = questions.map(question => `<button type="button" data-question="${question.id}" aria-pressed="${currentQuestion?.id === question.id}">${api.escapeHtml(question.label)}</button>`).join(""); }
  function renderMetricSelect() { const pool = metricPool(); $("metric-select").disabled = !pool.length; $("metric-select").innerHTML = pool.map(metric => `<option value="${api.escapeAttr(metric.id)}">${api.escapeHtml(metric.label)}</option>`).join("") || `<option>No matching records</option>`; if (pool.length) { currentMetric = pool.find(metric => metric.id === currentMetric?.id) || pool[0]; $("metric-select").value = currentMetric.id; renderAnswer(); } }
  function renderAllMetrics() { $("all-metrics").innerHTML = metrics.map(metric => `<button type="button" data-metric="${api.escapeAttr(metric.id)}">${api.escapeHtml(metric.label)}<small style="display:block;color:var(--nn-dim);margin-top:3px">${api.escapeHtml(metric.group)}</small></button>`).join(""); }
  function renderAnswer() {
    if (!currentMetric) return;
    const rows = currentMetric.rows || [];
    const scopedRows = currentScope === "all" ? rows : currentScope === "map" && rows.some(row => row.map) ? rows : [];
    $("answer-kicker").textContent = currentMetric.group;
    $("answer-title").textContent = currentMetric.label;
    $("answer-count").textContent = `${scopedRows.length} returned`;
    $("lens-title").textContent = currentQuestion?.label || "Choose a question first";
    $("method-note").textContent = currentScope === "recent" ? `${currentMetric.note}. Recent-period player records are not exposed by this endpoint, so this scope remains unavailable rather than inferred.` : `${currentMetric.note}. Select another lens or open the full record family below.`;
    $("answer-state").hidden = scopedRows.length > 0;
    if (!scopedRows.length) { $("answer-state").setAttribute("role", "status"); $("answer-state").innerHTML = currentScope === "recent" ? "<strong>Recent scope unavailable</strong><span>This endpoint does not expose recent-period rows for the selected metric.</span>" : "<strong>No record</strong><span>The archive returned no qualifying values for this question.</span>"; $("answer-results").hidden = true; return; }
    $("answer-results").hidden = false;
    $("answer-results").innerHTML = `<div class="answer-list">${scopedRows.map((row,index) => `<div class="answer-row"><span class="answer-rank">${index+1}</span><div class="answer-player">${row.player ? api.playerLink(row) : api.mapLink(row)}<small>${api.escapeHtml(api.rowDetail(row,currentMetric))}</small><small class="answer-row-links">${api.sourceLinks(row) || "No linked source"}</small></div><span class="answer-value">${api.format.value(row.value,currentMetric.type)}</span></div>`).join("")}</div>`;
  }
  function chooseQuestion(id) { currentQuestion = questions.find(question => question.id === id) || questions[0]; renderQuestions(); renderMetricSelect(); }
  $("question-grid").addEventListener("click", event => { const button = event.target.closest("[data-question]"); if (button) chooseQuestion(button.dataset.question); });
  $("metric-select").addEventListener("change", event => { currentMetric = metrics.find(metric => metric.id === event.target.value); renderAnswer(); });
  $("all-metrics").addEventListener("click", event => { const button = event.target.closest("[data-metric]"); if (!button) return; currentMetric = metrics.find(metric => metric.id === button.dataset.metric); currentQuestion = questions.find(question => question.groups.includes(currentMetric.group)) || null; renderQuestions(); renderMetricSelect(); $("metric-select").value = currentMetric.id; renderAnswer(); });
  document.querySelectorAll("[data-scope]").forEach(button => button.addEventListener("click", () => { currentScope = button.dataset.scope; document.querySelectorAll("[data-scope]").forEach(item => { const active = item === button; item.classList.toggle("is-active",active); item.setAttribute("aria-pressed",String(active)); }); renderAnswer(); }));
  api.loadAnalytics().then(result => { if (result.error) { $("answer-state").setAttribute("role", "alert"); $("answer-state").innerHTML = `<strong>Analytics unavailable</strong><span>${api.escapeHtml(result.error)} Use ?api=https://nonamepickup.servehalflife.com when reviewing with the public API.</span>`; return; } data = result.data; metrics = api.metricCatalog(data); renderQuestions(); renderAllMetrics(); chooseQuestion("performance"); });
})();
