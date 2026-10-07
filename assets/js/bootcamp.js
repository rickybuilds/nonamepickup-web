(function () {
  "use strict";

  // Noname TFC Bootcamp pages. One script, one view per page
  // (body[data-bootcamp-view]): home, map, route, drill, player, review.

  const nn = window.nnHelpers || {};
  const $ = id => document.getElementById(id);
  const escapeHtml = nn.escapeHtml || (value => String(value ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m])));
  const escapeAttr = nn.escapeAttr || escapeHtml;
  const number = new Intl.NumberFormat("en-US");
  const TIERS = ["none", "bronze", "silver", "gold", "platinum"];
  const TIER_LABELS = ["—", "Bronze", "Silver", "Gold", "Platinum"];
  const ROUTE_TYPES = {
    conc: "Conc",
    bhop: "Bhop",
    rj: "Rocket jump",
    pj: "Pipe jump",
    flagrun: "Flag run",
    escape: "Escape",
    walk: "Walk",
    rotation: "Rotation"
  };
  const POINT_LABELS = { crit: "Crit", spot: "Spots", trap: "Traps", callout: "Callouts", tour: "Tour stops", spam: "Spam" };

  /* ---------------------------------------------------------------------- */

  function query(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json?.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value == null || value === "" ? "-" : String(value);
  }

  function setHtml(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }

  function empty(text) {
    return `<div class="speedrun-empty">${escapeHtml(text)}</div>`;
  }

  function showError(message) {
    const el = $("bc-error");
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
    setText("bc-status", "");
  }

  function fmtNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? number.format(n) : "-";
  }

  function fmtTime(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return "-";
    const total = value / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return minutes ? `${minutes}:${seconds.toFixed(3).padStart(6, "0")}` : seconds.toFixed(3);
  }

  function fmtDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function tierBadge(tier) {
    const t = Math.max(0, Math.min(4, Number(tier) || 0));
    if (!t) return `<span class="bootcamp-tier none">—</span>`;
    return `<span class="bootcamp-tier ${TIERS[t]}">${TIER_LABELS[t]}</span>`;
  }

  function playerHref(steamid) {
    return `bootcamp-player.html?id=${encodeURIComponent(steamid || "")}`;
  }

  function playerLink(row) {
    const name = row.playerName || row.steamid || "Unknown";
    return row.steamid ? `<a href="${escapeAttr(playerHref(row.steamid))}">${escapeHtml(name)}</a>` : escapeHtml(name);
  }

  function mapHref(map) {
    return `bootcamp-map.html?map=${encodeURIComponent(map || "")}`;
  }

  function routeHref(id) {
    return `bootcamp-route.html?id=${encodeURIComponent(id)}`;
  }

  function drillHref(id) {
    return `bootcamp-drill.html?id=${encodeURIComponent(id)}`;
  }

  function runReplayHref(runId, compareRunId) {
    let href = `speedrun-replay.html?bootcampRunId=${encodeURIComponent(runId)}`;
    if (compareRunId && Number(compareRunId) !== Number(runId)) href += `&compareBootcampRunId=${encodeURIComponent(compareRunId)}`;
    return href;
  }

  function replayLink(runId, label = "Watch", compareRunId = null) {
    if (!runId) return `<span class="bootcamp-muted">—</span>`;
    return `<a class="bootcamp-replay" href="${escapeAttr(runReplayHref(runId, compareRunId))}">${escapeHtml(label)}</a>`;
  }

  function row(title, subtitle, value, action = "") {
    return `
      <article class="speedrun-list-row${action ? " has-action" : ""}">
        <div><strong>${title}</strong><small>${subtitle}</small></div>
        <div class="speedrun-list-value">${value}</div>
        ${action}
      </article>`;
  }

  function list(rows, emptyText) {
    return rows.length ? `<div class="speedrun-list">${rows.join("")}</div>` : empty(emptyText);
  }

  function table(headers, rows, emptyText) {
    if (!rows.length) return empty(emptyText);
    return `
      <div class="speedrun-table-wrap">
        <table class="speedrun-table bootcamp-table">
          <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Home                                                                   */
  /* ---------------------------------------------------------------------- */

  async function renderHome() {
    wireLookup();
    renderHowItWorks();
    const data = await fetchJson("/api/bootcamp/summary");
    setText("bc-k-maps", `${fmtNumber(data.rotationMaps)} / ${fmtNumber(data.maps)}`);
    setText("bc-k-routes", fmtNumber(data.routes));
    setText("bc-k-runs", fmtNumber(data.runs));
    setText("bc-k-runners", fmtNumber(data.runners));
    setText("bc-k-licensed", fmtNumber((data.licenses?.licensed || 0) + (data.licenses?.platinum || 0)));
    setText("bc-status", `${fmtNumber(data.licenses?.permit || 0)} learner's permits · ${fmtNumber(data.drillSets)} drill sets · ${fmtNumber(data.lessons)} lessons finished`);

    if (data.challenge) {
      const c = data.challenge;
      const el = $("bc-challenge");
      const href = c.targetType === "route" ? routeHref(c.targetId) : drillHref(c.targetId);
      el.innerHTML = `
        <span class="bootcamp-challenge-kicker">WEEKLY CHALLENGE</span>
        <strong><a href="${escapeAttr(href)}">${escapeHtml(c.title)}</a></strong>
        <span>${escapeHtml(c.targetName || "")} · ${escapeHtml(c.map || "")} · ends ${escapeHtml(fmtDate(c.endsAt))}</span>`;
      el.hidden = false;
    }

    setHtml("bc-maps", list((data.mapList || []).map(m => row(
      `<a href="${escapeAttr(mapHref(m.map))}">${escapeHtml(m.map)}</a>${m.inRotation ? ` <span class="bootcamp-chip">Rotation #${m.rotationOrder + 1}</span>` : ""}`,
      `${fmtNumber(m.routes)} routes · ${fmtNumber(m.points)} marked spots`,
      `${fmtNumber(m.runs)} runs`
    )), "No training maps are set up yet."));

    setHtml("bc-records", list((data.recentRecords || []).map(r => row(
      `${playerLink(r)}`,
      `<a href="${escapeAttr(routeHref(r.routeId))}">${escapeHtml(r.routeName)}</a> · ${escapeHtml(r.map)} · ${escapeHtml(fmtDate(r.createdAt))}`,
      escapeHtml(r.timeDisplay || fmtTime(r.timeMs)),
      r.runId ? replayLink(r.runId) : ""
    )), "No route records yet."));

    setHtml("bc-tierups", list((data.recentTierUps || []).map(t => row(
      playerLink(t),
      `<a href="${escapeAttr(t.targetType === "route" ? routeHref(t.targetId) : drillHref(t.targetId))}">${escapeHtml(t.targetName)}</a> · ${escapeHtml(t.map)} · ${escapeHtml(fmtDate(t.createdAt))}`,
      tierBadge(t.tier)
    )), "No gold or platinum tiers yet."));

    setHtml("bc-licenses", list((data.recentLicenses || []).map(l => row(
      playerLink(l),
      escapeHtml(fmtDate(l.createdAt)),
      `<span class="bootcamp-level ${escapeAttr(l.level)}">${escapeHtml(l.levelLabel)}</span>`
    )), "No licenses granted yet."));
  }

  function wireLookup() {
    const form = $("bc-lookup");
    if (!form) return;
    form.addEventListener("submit", event => {
      event.preventDefault();
      const id = String($("bc-lookup-id")?.value || "").trim();
      if (id) window.location.href = playerHref(id);
    });
  }

  function renderHowItWorks() {
    const steps = [
      ["Learner's permit", "Finish the map tour quiz at bronze on any training map. Permit holders can join learning pugs."],
      ["TFC license", "On the first three rotation maps: the tour quiz at bronze, the live-target trainer at silver, and every drill for one defensive class (engineer, soldier, HWGuy or demoman) at silver."],
      ["Offense endorsement", "Two conc or bhop routes and one flag run at silver on every rotation map."],
      ["Class badges", "Gold in all of one class's routes and drills on the rotation maps."],
      ["Platinum license", "One class's full set at platinum on every rotation map. Platinum holders can co-sign other players' licenses."]
    ];
    setHtml("bc-how", `<ol class="bootcamp-steps">${steps.map(([title, text]) => `<li><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></li>`).join("")}</ol>
      <p class="bootcamp-note">Licenses and endorsements never expire: a new rotation map is needed for new endorsements but never takes away what you've earned. Join the Bootcamp server and type <code>/bootcamp</code> to start.</p>`);
  }

  /* ---------------------------------------------------------------------- */
  /* Map                                                                    */
  /* ---------------------------------------------------------------------- */

  async function renderMap() {
    const map = query("map");
    if (!map) throw new Error("No map given.");
    const data = await fetchJson(`/api/bootcamp/maps/${encodeURIComponent(map)}`);
    document.title = `NoName TFC | ${data.map} Bootcamp`;
    setText("bc-title", data.map);
    setHtml("bc-status", `<a href="bootcamp.html">Bootcamp</a>`);
    setText("bc-k-rotation", data.inRotation ? `#${data.rotationOrder + 1}` : "No");
    setText("bc-k-routes", fmtNumber(data.routes.length));
    setText("bc-k-drills", fmtNumber(data.drills.length));
    setText("bc-k-spots", fmtNumber((data.points?.spot || 0) + (data.points?.trap || 0)));
    setText("bc-k-runs", fmtNumber(data.routes.reduce((sum, r) => sum + (r.runs || 0), 0)));
    const pointSummary = Object.entries(data.points || {}).map(([kind, n]) => `${n} ${POINT_LABELS[kind] || kind}`).join(" · ");
    setText("bc-subtitle", pointSummary || "Routes and drills on this map.");

    setHtml("bc-routes", table(
      ["Route", "Type", "Class", "Reference", "Record", "Holder", "Runs", "Replay"],
      data.routes.map(r => `
        <tr>
          <td><a href="${escapeAttr(routeHref(r.id))}">${escapeHtml(r.name)}</a>${r.callout ? `<small class="bootcamp-sub">${escapeHtml(r.callout)}</small>` : ""}</td>
          <td>${escapeHtml(ROUTE_TYPES[r.type] || r.type)}</td>
          <td>${escapeHtml(r.className)}</td>
          <td class="bootcamp-mono">${escapeHtml(r.referenceTimeDisplay || "—")}</td>
          <td class="bootcamp-mono">${r.record ? escapeHtml(r.record.timeDisplay) : "—"}</td>
          <td>${r.record ? playerLink(r.record) : "—"}</td>
          <td>${fmtNumber(r.runs)}</td>
          <td>${r.record ? replayLink(r.record.runId) : "—"}</td>
        </tr>`),
      "No routes on this map yet."
    ));

    setHtml("bc-drills", table(
      ["Drill", "Class", "Bronze", "Silver", "Gold", "Platinum", "Sets", "Best"],
      data.drills.map(d => `
        <tr>
          <td><a href="${escapeAttr(drillHref(d.id))}">${escapeHtml(d.name)}</a></td>
          <td>${escapeHtml(d.className)}</td>
          <td>${fmtNumber(d.tierScores.bronze)}</td>
          <td>${fmtNumber(d.tierScores.silver)}</td>
          <td>${fmtNumber(d.tierScores.gold)}</td>
          <td>${fmtNumber(d.tierScores.platinum)}</td>
          <td>${fmtNumber(d.sets)}</td>
          <td>${d.bestScore == null ? "—" : fmtNumber(Math.round(d.bestScore))}</td>
        </tr>`),
      "No drills on this map yet."
    ));
  }

  /* ---------------------------------------------------------------------- */
  /* Route                                                                  */
  /* ---------------------------------------------------------------------- */

  async function renderRoute() {
    const id = query("id");
    if (!/^\d+$/.test(id)) throw new Error("No route given.");
    const data = await fetchJson(`/api/bootcamp/routes/${encodeURIComponent(id)}`);
    const route = data.route;
    document.title = `NoName TFC | ${route.name} (${route.map})`;
    setText("bc-kicker", `TRAINING ROUTE · ${(ROUTE_TYPES[route.type] || route.type).toUpperCase()}`);
    setText("bc-title", route.name);
    const endLabel = { zone: "finishes in a zone", entity: "finishes on a button", flag: "finishes at the flag" }[route.endKind] || "";
    setText("bc-subtitle", [route.callout, route.targetCrit ? `to ${route.targetCrit}` : "", endLabel].filter(Boolean).join(" · "));
    setHtml("bc-status", `<a href="bootcamp.html">Bootcamp</a> / <a href="${escapeAttr(mapHref(route.map))}">${escapeHtml(route.map)}</a>${data.legacyRuns ? ` · ${fmtNumber(data.legacyRuns)} runs from older versions of this route are not ranked` : ""}`);

    const record = data.leaderboard[0] || null;
    setText("bc-k-record", record ? record.timeDisplay : "-");
    setText("bc-k-reference", route.referenceTimeDisplay || "-");
    setText("bc-k-runs", fmtNumber(data.leaderboard.length));
    setText("bc-k-checkpoints", fmtNumber(route.checkpoints));
    setText("bc-k-class", route.className);

    // Tier cutoffs from the reference time.
    if (route.referenceTimeMs) {
      const cut = pct => fmtTime(route.referenceTimeMs * pct / 100);
      const p = route.tierPercents;
      setHtml("bc-tiers", `<div class="bootcamp-tier-cutoffs">
        <div>${tierBadge(4)}<strong>${cut(p.platinum)}</strong><small>${p.platinum}% of reference</small></div>
        <div>${tierBadge(3)}<strong>${cut(p.gold)}</strong><small>${p.gold}%</small></div>
        <div>${tierBadge(2)}<strong>${cut(p.silver)}</strong><small>${p.silver}%</small></div>
        <div>${tierBadge(1)}<strong>${cut(p.bronze)}</strong><small>${p.bronze}%</small></div>
      </div>${route.referenceRunId ? `<p class="bootcamp-note">${replayLink(route.referenceRunId, "Watch the reference run")}</p>` : ""}`);
    } else {
      setHtml("bc-tiers", empty("This route has no reference run yet, so runs aren't tiered."));
    }

    const recordRunId = record?.hasReplay ? record.runId : null;
    setHtml("bc-leaderboard", table(
      ["Rank", "Player", "Class", "Time", "Tier", "Replay", "Vs record", "Set"],
      data.leaderboard.map(r => `
        <tr>
          <td>${r.rank}</td>
          <td>${playerLink(r)}${r.pendingReview ? ` <span class="bootcamp-chip warn" title="Waiting for an admin to check the replay">review</span>` : ""}</td>
          <td>${escapeHtml(r.className)}</td>
          <td class="bootcamp-mono">${escapeHtml(r.timeDisplay)}</td>
          <td>${tierBadge(r.tier)}</td>
          <td>${r.hasReplay ? replayLink(r.runId) : "—"}</td>
          <td>${r.hasReplay && recordRunId && r.runId !== recordRunId ? replayLink(r.runId, "Compare", recordRunId) : "—"}</td>
          <td>${escapeHtml(fmtDate(r.createdAt))}</td>
        </tr>`),
      "No ranked runs yet."
    ));

    setHtml("bc-recent", list(data.recentRuns.map(r => row(
      playerLink(r),
      `${escapeHtml(r.className)} · ${r.mode}${r.valid ? "" : ` · invalid${r.invalidReason ? ` (${escapeHtml(r.invalidReason)})` : ""}`} · ${escapeHtml(fmtDate(r.createdAt))}`,
      `${escapeHtml(r.timeDisplay)} ${tierBadge(r.tier)}`,
      r.hasReplay ? replayLink(r.runId) : ""
    )), "No runs yet."));
  }

  /* ---------------------------------------------------------------------- */
  /* Drill                                                                  */
  /* ---------------------------------------------------------------------- */

  function detailSummary(details) {
    if (!details || typeof details !== "object") return "";
    return Object.entries(details)
      .filter(([, v]) => v == null || ["number", "string", "boolean"].includes(typeof v))
      .slice(0, 5)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "number" ? Math.round(v * 100) / 100 : v}`)
      .join(" · ");
  }

  async function renderDrill() {
    const id = query("id");
    if (!/^\d+$/.test(id)) throw new Error("No drill given.");
    const data = await fetchJson(`/api/bootcamp/drills/${encodeURIComponent(id)}`);
    const drill = data.drill;
    document.title = `NoName TFC | ${drill.name} (${drill.map})`;
    setText("bc-title", drill.name);
    setText("bc-subtitle", `Scored out of 100. Best set per player.`);
    setHtml("bc-status", `<a href="bootcamp.html">Bootcamp</a> / <a href="${escapeAttr(mapHref(drill.map))}">${escapeHtml(drill.map)}</a>`);
    setText("bc-k-best", data.leaderboard[0] ? fmtNumber(Math.round(data.leaderboard[0].score)) : "-");
    setText("bc-k-players", fmtNumber(data.leaderboard.length));
    setText("bc-k-class", drill.className);
    setText("bc-k-kind", (drill.kind || "").replace(/_/g, " "));
    setText("bc-k-map", drill.map);

    const s = drill.tierScores;
    setHtml("bc-tiers", `<div class="bootcamp-tier-cutoffs">
      <div>${tierBadge(4)}<strong>${fmtNumber(s.platinum)}</strong><small>points</small></div>
      <div>${tierBadge(3)}<strong>${fmtNumber(s.gold)}</strong><small>points</small></div>
      <div>${tierBadge(2)}<strong>${fmtNumber(s.silver)}</strong><small>points</small></div>
      <div>${tierBadge(1)}<strong>${fmtNumber(s.bronze)}</strong><small>points</small></div>
    </div>`);

    setHtml("bc-leaderboard", table(
      ["Rank", "Player", "Class", "Score", "Tier", "Details", "Replay", "Set"],
      data.leaderboard.map(r => `
        <tr>
          <td>${r.rank}</td>
          <td>${playerLink(r)}</td>
          <td>${escapeHtml(r.className)}</td>
          <td class="bootcamp-mono">${fmtNumber(Math.round(r.score))}</td>
          <td>${tierBadge(r.tier)}</td>
          <td><small class="bootcamp-sub">${escapeHtml(detailSummary(r.details))}</small></td>
          <td>${r.ghostId ? `<a class="bootcamp-replay" href="speedrun-replay.html?bootcampGhostId=${encodeURIComponent(r.ghostId)}">Watch</a>` : "—"}</td>
          <td>${escapeHtml(fmtDate(r.createdAt))}</td>
        </tr>`),
      "No sets yet."
    ));
  }

  /* ---------------------------------------------------------------------- */
  /* Player license card                                                    */
  /* ---------------------------------------------------------------------- */

  function endorsementLabel(text) {
    if (text === "offense") return "Offense";
    const m = /^class:(\w+)$/.exec(text);
    if (!m) return text;
    return { hwguy: "HWGuy" }[m[1]] || m[1].charAt(0).toUpperCase() + m[1].slice(1);
  }

  async function renderPlayer() {
    const id = query("id");
    if (!id) throw new Error("No player given.");
    let data;
    try {
      data = await fetchJson(`/api/bootcamp/players/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error.status === 404) throw new Error("No Bootcamp progress found for that player yet.");
      throw error;
    }
    const license = data.license;
    document.title = `NoName TFC | ${data.player.playerName} — TFC license`;
    setText("bc-title", data.player.playerName);
    setText("bc-subtitle", data.player.steamIds.join(" · "));
    setHtml("bc-status", `<a href="bootcamp.html">Bootcamp</a>${data.player.discordId ? ` · <a href="player.html?id=${encodeURIComponent(data.player.discordId)}">Pickup profile</a>` : ""}`);

    const counts = [0, 0, 0, 0, 0];
    for (const t of data.tiers) counts[t.tier] += 1;
    setText("bc-k-license", license.levelLabel);
    setText("bc-k-platinum", fmtNumber(counts[4]));
    setText("bc-k-gold", fmtNumber(counts[3]));
    setText("bc-k-silver", fmtNumber(counts[2]));
    setText("bc-k-bronze", fmtNumber(counts[1]));

    const card = $("bc-card");
    card.className = `bootcamp-license-card level-${license.level}`;
    card.innerHTML = `
      <div class="bootcamp-license-head">
        <span>NONAME TFC</span>
        <strong>${escapeHtml(license.levelLabel)}</strong>
      </div>
      <div class="bootcamp-license-body">
        <div><span>Holder</span><strong>${escapeHtml(data.player.playerName)}</strong></div>
        <div><span>Granted</span><strong>${escapeHtml(fmtDate(license.grantedAt) || "—")}</strong></div>
        <div><span>Co-signed by</span><strong>${escapeHtml(license.cosignedBy || "—")}</strong></div>
        <div class="bootcamp-license-endorse"><span>Endorsements</span>
          <div>${license.endorsements.length ? license.endorsements.map(e => `<span class="bootcamp-chip">${escapeHtml(endorsementLabel(e))}</span>`).join("") : `<em class="bootcamp-muted">None yet</em>`}</div>
        </div>
      </div>`;
    card.hidden = false;

    // Tier grid grouped by map.
    const byMap = new Map();
    for (const t of data.tiers) {
      if (!byMap.has(t.map)) byMap.set(t.map, []);
      byMap.get(t.map).push(t);
    }
    const groups = [...byMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    setHtml("bc-grid", groups.length ? groups.map(([map, rows]) => `
      <div class="bootcamp-grid-map">
        <h3><a href="${escapeAttr(mapHref(map))}">${escapeHtml(map || "Unknown map")}</a></h3>
        <div class="bootcamp-grid">
          ${rows.sort((a, b) => b.tier - a.tier || a.targetName.localeCompare(b.targetName)).map(t => `
            <a class="bootcamp-grid-cell tier-${TIERS[t.tier]}" href="${escapeAttr(t.targetType === "route" ? routeHref(t.targetId) : drillHref(t.targetId))}">
              <strong>${escapeHtml(t.targetName)}</strong>
              <small>${escapeHtml(t.targetType === "route" ? "Route" : "Drill")} · ${escapeHtml(t.className)}</small>
              ${tierBadge(t.tier)}
            </a>`).join("")}
        </div>
      </div>`).join("") : empty("No tiers earned yet."));

    setHtml("bc-pbs", list(data.personalBests.map(pb => row(
      `<a href="${escapeAttr(routeHref(pb.routeId))}">${escapeHtml(pb.routeName)}</a>`,
      escapeHtml(pb.map),
      `${escapeHtml(pb.timeDisplay)} ${tierBadge(pb.tier)}`,
      pb.hasReplay && pb.runId ? replayLink(pb.runId) : ""
    )), "No ranked route runs yet."));

    setHtml("bc-lessons", list(data.lessons.map(l => row(
      escapeHtml(l.lesson.replace(/_/g, " ")),
      escapeHtml(fmtDate(l.completedAt)),
      escapeHtml(l.completionMs ? l.completionDisplay : "Done")
    )), "No lessons finished yet."));
  }

  /* ---------------------------------------------------------------------- */
  /* Review queue                                                           */
  /* ---------------------------------------------------------------------- */

  async function renderReview() {
    const data = await fetchJson("/api/bootcamp/review");
    const runs = data.runs || [];
    const isRecord = r => r.previousBestMs == null || r.timeMs < r.previousBestMs;
    setText("bc-k-pending", fmtNumber(runs.length));
    setText("bc-k-records", fmtNumber(runs.filter(isRecord).length));
    setText("bc-k-platinum", fmtNumber(runs.filter(r => r.tier === 4).length));
    setText("bc-k-noreplay", fmtNumber(runs.filter(r => !r.hasReplay).length));
    setText("bc-k-oldest", runs.length ? fmtDate(runs[runs.length - 1].createdAt) : "-");
    setHtml("bc-status", `<a href="bootcamp.html">Bootcamp</a>`);

    setHtml("bc-review", table(
      ["Run", "Player", "Route", "Class", "Time", "Previous best", "Gain", "Tier", "fps_max", "Replay", "Clear in game"],
      runs.map(r => {
        const gain = r.previousBestMs ? fmtTime(r.previousBestMs - r.timeMs) : "first";
        return `
          <tr>
            <td class="bootcamp-mono">${r.runId}</td>
            <td>${playerLink(r)}</td>
            <td><a href="${escapeAttr(routeHref(r.routeId))}">${escapeHtml(r.routeName)}</a><small class="bootcamp-sub">${escapeHtml(r.map)}</small></td>
            <td>${escapeHtml(r.className)}</td>
            <td class="bootcamp-mono">${escapeHtml(r.timeDisplay)}</td>
            <td class="bootcamp-mono">${escapeHtml(r.previousBestDisplay || "—")}</td>
            <td class="bootcamp-mono">${escapeHtml(gain)}</td>
            <td>${tierBadge(r.tier)}</td>
            <td>${r.fpsMax ? fmtNumber(r.fpsMax) : "—"}</td>
            <td>${r.hasReplay ? replayLink(r.runId) : "—"}</td>
            <td><code>/tt_review ${r.runId} ok</code></td>
          </tr>`;
      }),
      "Nothing waiting for review."
    ));
  }

  /* ---------------------------------------------------------------------- */

  const VIEWS = {
    home: renderHome,
    map: renderMap,
    route: renderRoute,
    drill: renderDrill,
    player: renderPlayer,
    review: renderReview
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const view = document.body.dataset.bootcampView;
    const render = VIEWS[view];
    if (!render) return;
    try {
      if (view !== "home") setText("bc-status", "");
      await render();
      if (view === "home" && !$("bc-status").textContent) setText("bc-status", "");
    } catch (error) {
      console.error("[bootcamp]", error);
      showError(error?.message === "Bootcamp data unavailable"
        ? "Bootcamp data isn't available right now."
        : error?.message || "Something went wrong loading Bootcamp data.");
      for (const el of document.querySelectorAll(".bootcamp-block .speedrun-empty")) {
        if (el.textContent === "Loading...") el.textContent = "Not available.";
      }
    }
  });
})();
