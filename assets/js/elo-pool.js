"use strict";

(() => {
  const content = document.getElementById("elo-pool-content");
  const status = document.getElementById("elo-pool-status");
  const refresh = document.getElementById("elo-pool-refresh");
  if (!content || !status || !refresh) return;
  const number = value => Number(value).toLocaleString("en-US");
  const signed = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value))}`;
  const tone = value => value > 0 ? "elo-pool-positive" : value < 0 ? "elo-pool-negative" : "elo-pool-neutral";
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const date = value => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const timestamp = value => new Date(value * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
  let loading = false;
  let currentPage = 0;
  let pagination = null;

  function renderRecords(records) {
    if (!records) return "";
    const labels = [["net_gain", "Biggest net gain"], ["net_loss", "Biggest net loss"],
      ["awarded", "Most awarded"], ["deducted", "Most deducted"]];
    return `<section class="elo-pool-records" aria-labelledby="elo-pool-records-heading">
      <h3 id="elo-pool-records-heading">All-time daily records</h3>
      <p>Recorded match history · Eastern time</p>
      <dl>${labels.map(([key, label]) => {
        const record = records[key];
        const value = record ? (key === "deducted" ? -record.value : record.value) : 0;
        const fullDate = record ? new Date(`${record.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
        return `<div><dt>${label}</dt><dd>${record ? `<strong class="${tone(value)}">${signed(value)} Elo</strong><small><time datetime="${escape(record.date)}">${escape(fullDate)}</time> · ${number(record.matches)} matches${record.partial ? " · in progress" : ""}${record.tied_days > 1 ? ` · ${number(record.tied_days)} days tied (earliest shown)` : ""}</small>` : "<small>No qualifying day recorded.</small>"}</dd></div>`;
      }).join("")}</dl>
    </section>`;
  }

  function render(data) {
    const { days, totals, quality } = data;
    const openDays = new Set([...content.querySelectorAll("details[open]")].map(element => element.dataset.date));
    const movement = totals.net > 0 ? "added to" : totals.net < 0 ? "removed from" : "net change in";
    pagination = data.pagination;
    currentPage = pagination.page;
    const rangeDate = value => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    document.getElementById("elo-pool-range").textContent = `${rangeDate(pagination.start_date)} – ${rangeDate(pagination.end_date)} · Eastern time`;
    content.innerHTML = `<div class="elo-pool-summary">
      <div><span>14-day net change</span><strong class="${tone(totals.net)}">${signed(totals.net)} Elo</strong></div>
      <p>${number(Math.abs(totals.net))} Elo ${movement} the pool · ${number(totals.matches)} matches</p>
      <dl class="elo-pool-totals"><div><dt>Awarded</dt><dd class="elo-pool-positive">+${number(totals.gained)}</dd></div><div><dt>Deducted</dt><dd class="elo-pool-negative">${totals.lost ? "−" : ""}${number(totals.lost)}</dd></div></dl>
    </div>
    <div class="elo-pool-list-label"><span>Day · select for details</span><span>Matches / Net Elo</span></div>
    <div class="elo-pool-list">${days.slice().reverse().map(day => `<details class="elo-pool-day" data-date="${escape(day.date)}" ${openDays.has(day.date) ? "open" : ""}>
      <summary><div><time datetime="${escape(day.date)}">${date(day.date)}</time>${day.partial ? "<small>Today · in progress</small>" : ""}</div><span>${number(day.matches)} games</span><strong class="${tone(day.net)}">${signed(day.net)}</strong></summary>
      <div class="elo-pool-day-body"><p><span>Awarded</span><b class="elo-pool-positive">+${number(day.gained)} Elo</b></p><p><span>Deducted</span><b class="elo-pool-negative">${day.lost ? "−" : ""}${number(day.lost)} Elo</b></p><p>${day.matches ? `${number(day.players_up)} players up · ${number(day.players_down)} down · ${number(day.players_even)} even` : "No recorded match changes on this day."}</p></div>
    </details>`).join("")}</div>
    <nav class="elo-pool-pagination" aria-label="Elo pool date windows">
      <button type="button" data-pool-page="older" ${pagination.has_older ? "" : "disabled"}>Older 14 days</button>
      <button type="button" data-pool-page="newer" ${pagination.has_newer ? "" : "disabled"}>Newer 14 days</button>
    </nav>
    ${currentPage ? '<p class="elo-pool-updated">Historical window · automatic refresh paused</p>' : ""}
    ${!totals.matches ? '<p class="elo-pool-warning">No recorded match changes in this 14-day window.</p>' : ""}
    ${quality.inconsistent_rows ? `<p class="elo-pool-warning">${number(quality.inconsistent_rows)} records have differing delta metadata. Totals use ending minus starting Elo.</p>` : ""}
    ${quality.fallback_rows ? `<p class="elo-pool-warning">${number(quality.fallback_rows)} records lack starting or ending Elo; their recorded delta is used.</p>` : ""}
    ${quality.unmeasured_rows ? `<p class="elo-pool-warning">${number(quality.unmeasured_rows)} records cannot be measured and are excluded from Elo totals.</p>` : ""}
    <p class="elo-pool-updated">Updated ${escape(timestamp(data.generated_at))}${data.latest_change_at ? `<br>Latest recorded change: ${escape(timestamp(data.latest_change_at))}` : "<br>No recorded match history available."}</p>
    ${renderRecords(data.records)}`;
    content.hidden = false;
    status.hidden = true;
  }

  async function load(manual = false, requestedPage = currentPage) {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    refresh.textContent = "Updating…";
    content.querySelectorAll("[data-pool-page]").forEach(button => { button.disabled = true; });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`api/elo-pool?page=${requestedPage}${manual ? "&refresh=1" : ""}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !Array.isArray(payload.data?.days)) throw new Error("unavailable");
      render(payload.data);
    } catch {
      status.hidden = false;
      status.className = "elo-pool-status error";
      status.textContent = content.hidden ? "Daily Elo changes could not be loaded. Select Refresh to try again." : "Refresh failed. Showing the last loaded figures; select Refresh to retry.";
    } finally {
      clearTimeout(timeout);
      loading = false;
      refresh.disabled = false;
      refresh.textContent = "Refresh";
      content.querySelectorAll("[data-pool-page]").forEach(button => {
        button.disabled = !pagination?.[button.dataset.poolPage === "older" ? "has_older" : "has_newer"];
      });
    }
  }
  refresh.addEventListener("click", () => load(true));
  content.addEventListener("click", event => {
    const button = event.target.closest("button[data-pool-page]");
    if (!button || button.disabled) return;
    load(false, currentPage + (button.dataset.poolPage === "older" ? 1 : -1));
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && currentPage === 0) load(); });
  setInterval(() => { if (!document.hidden && currentPage === 0) load(); }, 60000);
  load();
})();
