(function () {
  "use strict";

  const nn = window.nnHelpers || {};
  const $ = id => document.getElementById(id);
  const supporterBadge = nn.supporterBadge || window.supporterBadge || (() => "");
  const loadSupporters = nn.loadSupporters || window.loadSupporters;
  const escapeHtml = nn.escapeHtml || (value => String(value ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m])));
  const escapeAttr = nn.escapeAttr || escapeHtml;
  const number = new Intl.NumberFormat("en-US");
  const progressionColors = [
    "#38bdf8",
    "#fbbf24",
    "#34d399",
    "#f472b6",
    "#a78bfa",
    "#fb7185",
    "#22d3ee",
    "#c4b5fd",
    "#f97316",
    "#84cc16"
  ];
  const classNames = {
    0: "Civilian",
    1: "Scout",
    2: "Sniper",
    3: "Soldier",
    4: "Demoman",
    5: "Medic",
    6: "Heavy",
    7: "Pyro",
    8: "Spy",
    9: "Engineer",
    10: "Civilian",
    11: "Civilian"
  };

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value ?? "-";
  }

  function setHtml(id, value) {
    const el = $(id);
    if (el) el.innerHTML = value || "";
  }

  function fitSpeedrunPlayerName() {
    const el = $("sr-player-title");
    const text = el?.querySelector(".speedrun-player-name-text");
    if (!el || !text) return;

    const max = window.innerWidth <= 800 ? 34 : 64;
    const min = window.innerWidth <= 800 ? 16 : 18;
    let size = max;
    text.style.fontSize = `${size}px`;

    while (el.scrollWidth > el.clientWidth && size > min) {
      size -= 1;
      text.style.fontSize = `${size}px`;
    }
  }

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function compact(value) {
    return number.format(Number(value || 0));
  }

  function time(row, key = "time") {
    const display = row?.timeDisplay || row?.bestTimeDisplay || row?.worldRecordDisplay;
    if (display) return display;
    const ms = row?.[`${key}Ms`] ?? row?.timeMs ?? row?.bestTimeMs ?? row?.worldRecordTimeMs;
    const n = Number(ms);
    if (!Number.isFinite(n)) return "-";
    const minutes = Math.floor(n / 60000);
    const seconds = Math.floor((n % 60000) / 1000);
    const millis = Math.floor(n % 1000);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }

  function timestampValue(row, camelKey, snakeKey) {
    return row?.[camelKey] ?? row?.[snakeKey];
  }

  function achievedTimestamp(row) {
    return row?.achievedAt ?? row?.achieved_at ?? row?.pbCreatedAt ?? row?.pb_created_at ?? row?.updatedAt ?? row?.updated_at;
  }

  function rankText(row) {
    const rank = Number(row?.recordRank ?? row?.record_rank ?? row?.rank);
    return Number.isFinite(rank) && rank > 0 ? `#${rank}` : "-";
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const datePart = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    const timePart = date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit"
    });
    return `${datePart} ${timePart}`;
  }

  function formatImprovement(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return "First record";
    return `${time({ timeMs: value })} faster`;
  }

  async function api(path) {
    const res = await fetch(path, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(json?.error || `HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return json;
  }

  function showError(message) {
    const el = $("speedrun-error");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
  }

  function mapUrl(map) {
    return `speedrun-map.html?map=${encodeURIComponent(map || "")}`;
  }

  function hasReplay(row) {
    return Boolean(row?.hasReplay || row?.has_replay);
  }

  function replayUrl(row) {
    const runId = row?.runId ?? row?.run_id;
    if (runId != null && String(runId).trim() !== "") {
      return `speedrun-replay.html?runId=${encodeURIComponent(runId)}`;
    }
    const map = row?.map || params().get("map") || "";
    const classId = row?.classId ?? row?.class_id ?? "";
    const steamId = row?.steamId || row?.steamid || "";
    return `speedrun-replay.html?map=${encodeURIComponent(map)}&classId=${encodeURIComponent(classId)}&steamid=${encodeURIComponent(steamId)}`;
  }

  function replayLink(row, label = "View Replay") {
    if (!hasReplay(row)) return "";
    return `<a class="speedrun-replay-link" href="${escapeAttr(replayUrl(row))}">${escapeHtml(label)}</a>`;
  }

  function mapPreviewUrl(map) {
    return `https://tfcmaps.net/images/maps/source/${encodeURIComponent(map || "")}.jpg`;
  }

 function playerUrl(discordId) {
    return `speedrun-player.html?id=${encodeURIComponent(discordId || "")}`;
  }

  function runnerLink(row) {
    const steamId = row?.steamId || row?.steamid;
    const discordId = row?.discordId || row?.discord_id;
    const name = row?.playerName || row?.player_name || steamId || "Unknown";
    const badge = discordId ? supporterBadge(discordId) : "";

    return discordId
      ? `<a href="${escapeAttr(playerUrl(discordId))}">${escapeHtml(name)}${badge}</a>`
      : `${escapeHtml(name)}${badge}`;
  }

  function classText(row) {
    const existing = String(row?.className || row?.class_name || "").trim();
    if (existing && existing !== "-") return existing;
    const classId = row?.classId ?? row?.class_id;
    if (classId == null || classId === "") return "-";
    return classNames[Number(classId)] || `Class ${classId}`;
  }

  function classValue(row) {
    return String(row?.classId ?? row?.class_id ?? classText(row) ?? "");
  }

  function steamIdsText(player) {
    const ids = (player?.steamIds || player?.steam_ids || [])
      .map(id => String(id || "").trim())
      .filter(Boolean);
    return ids.length ? `Steam IDs: ${ids.join(", ")}` : "Steam ID unavailable";
  }

  function playerInitial(name) {
    return String(name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  function speedrunAvatarMarkup(name, avatarUrl) {
    const fallback = `<span class="nn-avatar-fallback">${escapeHtml(playerInitial(name))}</span>`;
    const image = avatarUrl
      ? `<img src="${escapeAttr(avatarUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
      : "";
    return fallback + image;
  }

  async function loadSteamProfile(discordId) {
    if (!discordId) return null;
    try {
      const data = await api(`/api/steam/profile/${encodeURIComponent(discordId)}`);
      return data?.ok === false ? null : (data?.data || data);
    } catch {
      return null;
    }
  }

  function yesNo(value) {
    return value ? "Yes" : "No";
  }

  function setupStatusLabel(status) {
    return {
      configured: "Configured",
      missing_start: "Missing Start",
      missing_finish: "Missing Finish",
      not_logged: "Not Logged"
    }[status] || "Not Logged";
  }

  function serverChips(row) {
    const servers = row?.servers || row?.server_keys || [];
    return (servers.length ? servers : [row?.serverKey || row?.server_key || "-"])
      .map(server => `<span class="speedrun-server-chip">${escapeHtml(server)}</span>`)
      .join("");
  }

  function mapPreviewLink(map) {
    const name = map || "-";
    return `<a class="speedrun-map-preview-link" href="${escapeAttr(mapUrl(name))}" data-map-preview="${escapeAttr(name)}">${escapeHtml(name)}</a>`;
  }

  function setupMapPreview() {
    if (document.body?.dataset?.mapPreviewReady === "1") return;
    if (document.body) document.body.dataset.mapPreviewReady = "1";

    const preview = document.createElement("div");
    preview.className = "speedrun-map-preview";
    preview.hidden = true;
    preview.innerHTML = `<img alt="" loading="lazy">`;
    document.body.appendChild(preview);
    const img = preview.querySelector("img");
    let activeLink = null;

    const move = event => {
      const padding = 18;
      const width = preview.offsetWidth || 280;
      const height = preview.offsetHeight || 170;
      let left = event.clientX + padding;
      let top = event.clientY + padding;
      if (left + width > window.innerWidth - 12) left = event.clientX - width - padding;
      if (top + height > window.innerHeight - 12) top = event.clientY - height - padding;
      preview.style.left = `${Math.max(12, left)}px`;
      preview.style.top = `${Math.max(12, top)}px`;
    };

    const show = (link, event) => {
      const map = link?.dataset?.mapPreview;
      if (!map) return;
      activeLink = link;
      img.onerror = () => {
        if (activeLink === link) preview.hidden = true;
      };
      img.src = mapPreviewUrl(map);
      preview.hidden = false;
      if (event) move(event);
    };

    const hide = link => {
      if (link && activeLink !== link) return;
      activeLink = null;
      preview.hidden = true;
    };

    document.addEventListener("mousemove", event => {
      if (activeLink) move(event);
    });
    document.addEventListener("mouseover", event => {
      const link = event.target.closest?.("[data-map-preview]");
      if (link) show(link, event);
    });
    document.addEventListener("mouseout", event => {
      const link = event.target.closest?.("[data-map-preview]");
      if (link && !link.contains(event.relatedTarget)) hide(link);
    });
    document.addEventListener("focusin", event => {
      const link = event.target.closest?.("[data-map-preview]");
      if (!link) return;
      const rect = link.getBoundingClientRect();
      show(link, { clientX: rect.right, clientY: rect.top });
    });
    document.addEventListener("focusout", event => {
      const link = event.target.closest?.("[data-map-preview]");
      if (link) hide(link);
    });
  }

  function empty(message) {
    return `<div class="speedrun-empty">${escapeHtml(message)}</div>`;
  }

  function listRow({ title, titleHtml, subtitle, subtitleHtml, value, href }) {
    const safeTitle = titleHtml || (href
      ? `<a href="${escapeAttr(href)}">${escapeHtml(title)}</a>`
      : escapeHtml(title));
    return `
      <article class="speedrun-list-row analytics-card">
        <div>
          <strong>${safeTitle}</strong>
          <small>${subtitleHtml || escapeHtml(subtitle || "")}</small>
        </div>
        <div class="speedrun-list-value">${escapeHtml(value || "-")}</div>
      </article>
    `;
  }

  function renderRuns(targetId, rows, emptyText) {
    setHtml(targetId, (rows || []).map(row => listRow({
      title: row.map || "Unknown map",
      subtitleHtml: `${runnerLink(row)} &middot; ${escapeHtml(classText(row))} &middot; ${escapeHtml(formatDateTime(timestampValue(row, "createdAt", "created_at")))}${hasReplay(row) ? ` &middot; ${replayLink(row)}` : ""}`,
      value: time(row),
      href: mapUrl(row.map)
    })).join("") || empty(emptyText));
  }

  function renderRecords(targetId, rows, emptyText) {
    setHtml(targetId, (rows || []).map(row => listRow({
      title: row.map || "Unknown map",
      subtitleHtml: `${runnerLink(row)} &middot; ${escapeHtml(classText(row))} &middot; ${escapeHtml(formatDateTime(achievedTimestamp(row)))}${hasReplay(row) ? ` &middot; ${replayLink(row)}` : ""}`,
      value: time(row, "bestTime"),
      href: mapUrl(row.map)
    })).join("") || empty(emptyText));
  }

  function msValue(value) {
    const ms = Number(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function formatMs(value) {
    const ms = msValue(value);
    return ms == null ? "-" : time({ timeMs: ms });
  }

  function formatGap(value) {
    const ms = msValue(value);
    if (ms == null) return "-";
    if (ms <= 0) return "WR";
    return `+${formatMs(ms)}`;
  }

  function formatImprovementValue(value) {
    const ms = msValue(value);
    if (ms == null || ms <= 0) return "-";
    return `-${formatMs(ms)}`;
  }

  function dateOnly(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function rankBadge(row) {
    const rank = Number(row?.recordRank ?? row?.record_rank ?? row?.rank);
    if (!Number.isFinite(rank) || rank <= 0) return `<span class="speedrun-rank-pill">-</span>`;
    const tier = rank === 1 ? " wr" : rank <= 3 ? " podium" : "";
    const label = rank === 1 ? `#1 <b>WR</b>` : `#${rank}`;
    return `<span class="speedrun-rank-pill${tier}">${label}</span>`;
  }

  function miniStat(label, value, detail = "") {
    return `
      <article>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(detail)}</small>
      </article>
    `;
  }

  function classKey(row) {
    return String(row?.classId ?? row?.class_id ?? "");
  }

  function mapCategory(row, mapLookup) {
    return mapLookup.get(row?.map || "")?.category || "other";
  }

  function countByDay(rows) {
    const counts = new Map();
    for (const row of rows) {
      const key = dateOnly(achievedTimestamp(row));
      if (key === "-") continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  }

  function renderPlayerDashboard(data) {
    const pbs = Array.isArray(data.personalBests) ? data.personalBests : [];
    const maps = Array.isArray(data.maps) ? data.maps : [];
    const mapLookup = new Map(maps.map(row => [row.map, row]));
    const classFilter = $("sr-player-class-filter");
    const categoryFilter = $("sr-player-category-filter");
    const rankFilter = $("sr-player-rank-filter");

    const classes = [...new Map(pbs.map(row => [classKey(row), classText(row)]).filter(([key]) => key !== "")).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]));
    if (classFilter) {
      classFilter.innerHTML = `<option value="">All Classes</option>${classes.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join("")}`;
    }

    const categories = [...new Set(pbs.map(row => mapCategory(row, mapLookup)).filter(Boolean))].sort();
    if (categoryFilter) {
      categoryFilter.innerHTML = `<option value="">All Categories</option>${categories.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join("")}`;
    }

    const filteredRows = () => pbs.filter(row => {
      const rank = Number(row.recordRank ?? row.rank);
      if (classFilter?.value && classKey(row) !== classFilter.value) return false;
      if (categoryFilter?.value && mapCategory(row, mapLookup) !== categoryFilter.value) return false;
      if (rankFilter?.value === "wr" && rank !== 1) return false;
      if (rankFilter?.value === "not-wr" && rank === 1) return false;
      if (rankFilter?.value === "top3" && (!Number.isFinite(rank) || rank > 3)) return false;
      if (rankFilter?.value === "top10" && (!Number.isFinite(rank) || rank > 10)) return false;
      return true;
    });

    const renderPbTable = () => {
      const rows = filteredRows();
      setHtml("sr-player-pbs", rows.map(row => `
        <tr>
          <td data-label="Map"><a href="${escapeAttr(mapUrl(row.map))}">${escapeHtml(row.map || "-")}</a><small>${escapeHtml(mapCategory(row, mapLookup))}</small></td>
          <td data-label="Class">${escapeHtml(classText(row))}</td>
          <td data-label="PB Time" class="speedrun-time">${escapeHtml(time(row, "bestTime"))}${replayLink(row)}</td>
          <td data-label="Rank">${rankBadge(row)}</td>
          <td data-label="Total"><span class="speedrun-total-runners">/ ${escapeHtml(row.totalRunners ?? row.total_runners ?? "-")}</span></td>
          <td data-label="WR Gap" class="${Number(row.wrGapMs ?? row.wr_gap_ms) <= 0 ? "speedrun-wr-gap is-wr" : "speedrun-wr-gap"}">${escapeHtml(formatGap(row.wrGapMs ?? row.wr_gap_ms))}</td>
          <td data-label="Improvement" class="speedrun-improvement">${escapeHtml(formatImprovementValue(row.improvementMs ?? row.improvement_ms))}</td>
          <td data-label="Set">${escapeHtml(formatDateTime(achievedTimestamp(row)))}</td>
        </tr>
      `).join("") || `<tr><td colspan="8">${empty("No personal bests match these filters.")}</td></tr>`);
    };

    [classFilter, categoryFilter, rankFilter].forEach(control => {
      if (control) control.addEventListener("change", renderPbTable);
    });
    renderPbTable();

    const totalPbMs = pbs.reduce((sum, row) => sum + (msValue(row.bestTimeMs) || 0), 0);
    const averagePbMs = pbs.length ? Math.round(totalPbMs / pbs.length) : null;
    const improvements = pbs.map(row => msValue(row.improvementMs ?? row.improvement_ms)).filter(value => value != null && value > 0);
    const bestImprovement = improvements.length ? Math.max(...improvements) : null;
    const dates = pbs.map(row => achievedTimestamp(row)).filter(Boolean).map(value => new Date(value)).filter(date => !Number.isNaN(date.getTime()));
    const firstPb = dates.length ? new Date(Math.min(...dates.map(date => date.getTime()))) : null;
    const latestPb = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : null;
    setHtml("sr-player-statistics", [
      miniStat("Total PB Time", formatMs(totalPbMs), "Across all PBs"),
      miniStat("Average PB", formatMs(averagePbMs), "Per map/class"),
      miniStat("Best Improvement", formatImprovementValue(bestImprovement), "From prior run"),
      miniStat("First PB", dateOnly(firstPb), "Earliest set"),
      miniStat("Latest PB", dateOnly(latestPb), "Most recent")
    ].join(""));

    const classCounts = classes.map(([value, label]) => ({
      value,
      label,
      count: pbs.filter(row => classKey(row) === value).length
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const maxClassCount = Math.max(1, ...classCounts.map(row => row.count));
    setHtml("sr-player-class-breakdown", classCounts.map(row => `
      <article>
        <div><strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(row.count)} PBs</span></div>
        <i style="--bar:${Math.max(8, Math.round((row.count / maxClassCount) * 100))}%"></i>
      </article>
    `).join("") || empty("No class data yet."));

    const completedMaps = new Set(pbs.map(row => row.map).filter(Boolean));
    const availableMaps = maps.filter(row => row?.map && row.enabled !== false).map(row => row.map);
    const incompleteMaps = availableMaps.filter(map => !completedMaps.has(map)).sort((a, b) => a.localeCompare(b));
    const totalMaps = Number(data.summary?.enabledMaps || data.summary?.totalMaps || maps.length || completedMaps.size);
    const playedMaps = Number(data.summary?.mapsPlayed || completedMaps.size);
    const inProgress = Math.max(0, playedMaps - completedMaps.size);
    const notStarted = Math.max(0, totalMaps - completedMaps.size - inProgress);
    const completionPercent = totalMaps ? Math.min(100, Math.max(0, (completedMaps.size / totalMaps) * 100)) : 0;
    const completionLabel = `${completionPercent.toFixed(1).replace(/\.0$/, "")}% complete`;
    setHtml("sr-player-map-progress", `
      <div class="speedrun-progress-summary">
        <div><strong>${escapeHtml(completedMaps.size)} / ${escapeHtml(totalMaps || completedMaps.size)}</strong><span>maps completed</span></div>
      </div>
      
      <div class="speedrun-progress-bar" aria-label="${escapeAttr(completionLabel)}">
        <i style="--progress:${completionPercent}%"></i>
        <strong>${escapeHtml(completionLabel)}</strong>
      </div>
    `);
    const downloadIncomplete = $("sr-player-download-incomplete");
    if (downloadIncomplete) {
      downloadIncomplete.disabled = !incompleteMaps.length;
      downloadIncomplete.textContent = `Download Unplayed Map List (${incompleteMaps.length || notStarted})`;
      downloadIncomplete.addEventListener("click", () => {
        const playerName = data.player?.playerName || data.player?.player_name || "runner";
        const lines = incompleteMaps.length ? incompleteMaps : ["No incomplete map names were available from the API response."];
        const body = [
          `Incomplete speedrun maps for ${playerName}`,
          `Completed: ${completedMaps.size} / ${totalMaps || completedMaps.size}`,
          "",
          ...lines
        ].join("\n");
        const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${String(playerName).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "runner"}-incomplete-speedrun-maps.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      });
    }

    const fastest = [...pbs].sort((a, b) => Number(a.bestTimeMs || Infinity) - Number(b.bestTimeMs || Infinity))[0];
    const longest = [...pbs].sort((a, b) => Number(b.bestTimeMs || -1) - Number(a.bestTimeMs || -1))[0];
    const biggestImprovementRow = [...pbs].sort((a, b) => Number(b.improvementMs || b.improvement_ms || -1) - Number(a.improvementMs || a.improvement_ms || -1))[0];
    const bestDay = countByDay(pbs);
    setHtml("sr-player-career-bests", [
      miniStat("Fastest Time", fastest ? time(fastest, "bestTime") : "-", fastest ? `${fastest.map} (${classText(fastest)})` : ""),
      miniStat("Longest Time", longest ? time(longest, "bestTime") : "-", longest ? `${longest.map} (${classText(longest)})` : ""),
      miniStat("Biggest Improvement", biggestImprovementRow ? formatImprovementValue(biggestImprovementRow.improvementMs ?? biggestImprovementRow.improvement_ms) : "-", biggestImprovementRow ? `${biggestImprovementRow.map} (${classText(biggestImprovementRow)})` : ""),
      miniStat("Most PBs In One Day", bestDay ? String(bestDay[1]) : "-", bestDay ? bestDay[0] : "")
    ].join(""));
  }

  function progressionPointTime(point) {
    return time({ timeMs: point?.time_ms });
  }

  function normalizeProgressionClasses(data) {
    return (data?.classes || [])
      .map((classRow, index) => ({
        classId: classRow.class_id,
        className: classText({ class_id: classRow.class_id, class_name: classRow.class_name }),
        color: progressionColors[index % progressionColors.length],
        points: (classRow.points || [])
          .map(point => ({
            ...point,
            x: new Date(point.created_at).getTime(),
            y: Number(point.time_ms)
          }))
          .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      }))
      .filter(classRow => classRow.points.length);
  }

  function drawProgressionChart(canvas, tooltip, classes, activeIds) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width || canvas.clientWidth || 720));
    const height = Math.max(260, Math.floor(rect.height || canvas.clientHeight || 360));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const activeClasses = classes.filter(classRow => activeIds.has(String(classRow.classId)));
    const points = activeClasses.flatMap(classRow => classRow.points.map(point => ({ ...point, classRow })));
    const pad = { top: 22, right: 18, bottom: 48, left: 72 };
    const plotWidth = Math.max(1, width - pad.left - pad.right);
    const plotHeight = Math.max(1, height - pad.top - pad.bottom);

    ctx.fillStyle = "rgba(3, 8, 20, .36)";
    ctx.fillRect(0, 0, width, height);

    if (!points.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "800 13px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Toggle a class to view progression.", width / 2, height / 2);
      canvas.__progressionPoints = [];
      return;
    }

    let minX = Math.min(...points.map(point => point.x));
    let maxX = Math.max(...points.map(point => point.x));
    let minY = Math.min(...points.map(point => point.y));
    let maxY = Math.max(...points.map(point => point.y));
    if (minX === maxX) {
      minX -= 86400000;
      maxX += 86400000;
    }
    if (minY === maxY) {
      minY = Math.max(0, minY - 1000);
      maxY += 1000;
    }
    const yPadding = Math.max(250, (maxY - minY) * 0.08);
    minY = Math.max(0, minY - yPadding);
    maxY += yPadding;

    const xFor = value => pad.left + ((value - minX) / (maxX - minX)) * plotWidth;
    const yFor = value => pad.top + (1 - ((value - minY) / (maxY - minY))) * plotHeight;

    ctx.strokeStyle = "rgba(148, 163, 184, .16)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#64748b";
    ctx.font = "800 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const value = minY + ((maxY - minY) * i / 4);
      const y = yFor(value);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(time({ timeMs: value }), pad.left - 10, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 3; i += 1) {
      const value = minX + ((maxX - minX) * i / 3);
      const x = xFor(value);
      ctx.strokeStyle = "rgba(148, 163, 184, .08)";
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, height - pad.bottom);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.fillText(new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }), x, height - pad.bottom + 14);
    }

    const hitPoints = [];
    for (const classRow of activeClasses) {
      const linePoints = classRow.points.map(point => ({
        ...point,
        sx: xFor(point.x),
        sy: yFor(point.y),
        classRow
      }));

      ctx.strokeStyle = classRow.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      linePoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.sx, point.sy);
        else ctx.lineTo(point.sx, point.sy);
      });
      ctx.stroke();

      for (const point of linePoints) {
        ctx.fillStyle = "#020617";
        ctx.strokeStyle = classRow.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.sx, point.sy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        hitPoints.push(point);
      }
    }
    canvas.__progressionPoints = hitPoints;

    const handleMove = event => {
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const nearest = (canvas.__progressionPoints || [])
        .map(point => ({ point, distance: Math.hypot(point.sx - x, point.sy - y) }))
        .sort((a, b) => a.distance - b.distance)[0];

      if (!tooltip || !nearest || nearest.distance > 18) {
        if (tooltip) tooltip.hidden = true;
        return;
      }

      const point = nearest.point;
      tooltip.innerHTML = `
        <strong style="color:${escapeAttr(point.classRow.color)}">${escapeHtml(point.classRow.className)}</strong>
        <span>${escapeHtml(point.player_name || point.steamid || "Unknown")}</span>
        <span>${escapeHtml(progressionPointTime(point))}</span>
        <span>${escapeHtml(formatDateTime(point.created_at))}</span>
        <span>${escapeHtml(formatImprovement(point.improvement_ms))}</span>
      `;
      tooltip.hidden = false;
      const left = Math.min(width - 190, Math.max(8, point.sx + 12));
      const top = Math.min(height - 112, Math.max(8, point.sy - 12));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    if (canvas.__progressionMove) canvas.removeEventListener("mousemove", canvas.__progressionMove);
    if (canvas.__progressionLeave) canvas.removeEventListener("mouseleave", canvas.__progressionLeave);
    canvas.__progressionMove = handleMove;
    canvas.__progressionLeave = () => {
      if (tooltip) tooltip.hidden = true;
    };
    canvas.addEventListener("mousemove", canvas.__progressionMove);
    canvas.addEventListener("mouseleave", canvas.__progressionLeave);
  }

  function renderProgression(data) {
    const status = $("sr-progression-status");
    const content = $("sr-progression-content");
    const toggles = $("sr-progression-toggles");
    const canvas = $("sr-progression-chart");
    const tooltip = $("sr-progression-tooltip");
    if (!status || !content || !toggles || !canvas) return;

    const classes = normalizeProgressionClasses(data);
    if (!classes.length) {
      status.hidden = false;
      status.textContent = "No world record progression data yet.";
      content.hidden = true;
      setHtml("sr-map-progression", empty("No world record progression yet."));
      return;
    }

    status.hidden = true;
    content.hidden = false;
    const fastestClass = classes
      .map(classRow => ({
        classRow,
        bestTime: Math.min(...classRow.points.map(point => Number(point.time_ms)))
      }))
      .filter(row => Number.isFinite(row.bestTime))
      .sort((a, b) => a.bestTime - b.bestTime)[0]?.classRow;
    const defaultClassRows = classes.slice(0, Math.min(4, classes.length));
    if (fastestClass && !defaultClassRows.some(classRow => String(classRow.classId) === String(fastestClass.classId))) {
      if (defaultClassRows.length >= 4) defaultClassRows[defaultClassRows.length - 1] = fastestClass;
      else defaultClassRows.push(fastestClass);
    }
    const defaultVisible = new Set(defaultClassRows.map(classRow => String(classRow.classId)));
    const activeIds = new Set(defaultVisible);

    const redraw = () => drawProgressionChart(canvas, tooltip, classes, activeIds);
    toggles.innerHTML = classes.map(classRow => `
      <label class="speedrun-class-toggle">
        <input type="checkbox" value="${escapeAttr(classRow.classId)}" ${activeIds.has(String(classRow.classId)) ? "checked" : ""}>
        <span style="--class-color:${escapeAttr(classRow.color)}"></span>
        ${escapeHtml(classRow.className)}
      </label>
    `).join("");

    toggles.querySelectorAll("input").forEach(input => {
      input.addEventListener("change", () => {
        if (input.checked) activeIds.add(String(input.value));
        else activeIds.delete(String(input.value));
        redraw();
      });
    });

    const flattened = classes.flatMap(classRow => classRow.points.map(point => ({ ...point, classRow })))
      .sort((a, b) => b.x - a.x);
    setHtml("sr-map-progression", flattened.map(point => listRow({
      title: point.player_name || "Unknown",
      subtitle: `${point.classRow.className} · ${formatDateTime(point.created_at)} · ${formatImprovement(point.improvement_ms)}`,
      value: progressionPointTime(point)
    })).join("") || empty("No world record progression yet."));

    redraw();
    if (window.__speedrunProgressionResize) {
      window.removeEventListener("resize", window.__speedrunProgressionResize);
    }
    window.__speedrunProgressionResize = () => redraw();
    window.addEventListener("resize", window.__speedrunProgressionResize);
  }

  function renderMaps(rows) {
    setHtml("sr-map-grid", (rows || []).map(row => `
      <article class="speedrun-map-card matches2-panel">
        <div>
          <h3><a href="${escapeAttr(mapUrl(row.map))}">${escapeHtml(row.displayName || row.map)}</a></h3>
          <div class="speedrun-map-meta">
            <span class="speedrun-chip hot">${escapeHtml(row.category || "other")}</span>
            <span class="speedrun-chip">D${escapeHtml(row.difficulty ?? "-")}</span>
            <span class="speedrun-chip">${row.enabled ? "Enabled" : "Disabled"}</span>
          </div>
        </div>
        <div class="speedrun-card-stats">
          <div><span>Runs</span><strong>${compact(row.totalRuns)}</strong></div>
          <div><span>Runners</span><strong>${compact(row.totalRunners)}</strong></div>
          <div><span>Records</span><strong>${compact(row.totalRecords)}</strong></div>
        </div>
        <div class="speedrun-record-line">
        <span>${
          row.worldRecordDiscordId
            ? `<a href="${escapeAttr(playerUrl(row.worldRecordDiscordId))}">
                ${escapeHtml(row.worldRecordPlayer || row.worldRecordSteamId)}${supporterBadge(row.worldRecordDiscordId)}
              </a>`
            : escapeHtml(row.worldRecordPlayer || "No record")
        }</span>
          <strong>${time(row, "worldRecordTime")}</strong>
        </div>
      </article>
    `).join("") || empty("No speedrun maps found."));
  }

  async function loadHome() {
    try {
      const [summary, maps] = await Promise.all([
        api("/api/speedruns/summary"),
        api("/api/speedruns/maps?limit=24&sort=name&with_records=1")
      ]);

      setText("sr-maps", compact(summary.maps));
      setText("sr-enabled", compact(summary.enabledMaps));
      setText("sr-runs", compact(summary.runs));
      setText("sr-runners", compact(summary.runners));
      setText("sr-records", compact(summary.records));
      setText("speedrun-status", "Records loaded from the NoName timer.");
      renderMaps(maps);
      renderRuns("sr-recent-runs", summary.recentRuns, "No recent runs yet.");

      setHtml("sr-top-runners", (summary.topRunners || []).map(row => listRow({
        title: row.playerName || row.discordId || "Unknown",
        titleHtml: runnerLink(row),
        subtitle: `${compact(row.totalRuns)} total runs`,
        value: `${compact(row.currentRecords)} records`,
        href: playerUrl(row.discordId)
      })).join("") || empty("No runners yet."));

      setHtml("sr-popular-maps", (summary.popularMaps || []).map(row => listRow({
        title: row.displayName || row.map,
        subtitle: `${compact(row.totalRunners)} runners · ${row.category || "other"}`,
        value: `${compact(row.totalRuns)} runs`,
        href: mapUrl(row.map)
      })).join("") || empty("No map activity yet."));

      const search = $("sr-map-search");
      const sort = $("sr-map-sort");
      let timer = null;
      const reloadMaps = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            const query = new URLSearchParams({
              limit: "24",
              sort: sort?.value || "name",
              with_records: "1"
            });
            if (search?.value.trim()) query.set("q", search.value.trim());
            renderMaps(await api(`/api/speedruns/maps?${query.toString()}`));
          } catch {
            showError("Speedrun maps could not be loaded right now.");
          }
        }, 180);
      };
      search?.addEventListener("input", reloadMaps);
      sort?.addEventListener("change", reloadMaps);
    } catch (error) {
      console.error("[speedruns]", error);
      setText("speedrun-status", "Speedruns unavailable");
      showError(error.status === 503 ? "Speedrun database unavailable" : "Speedrun data could not be loaded right now.");
    }
  }

  async function loadMap() {
    const mapName = params().get("map") || "";
    if (!mapName) {
      showError("Missing map.");
      setText("sr-map-title", "Map not found");
      return;
    }

    try {
      const data = await api(`/api/speedruns/maps/${encodeURIComponent(mapName)}`);
      document.title = `NoName TFC | ${data.displayName || data.map} Speedrun`;
      setText("sr-map-title", data.displayName || data.map);
      setText("sr-map-subtitle", `${data.map} · ${data.category || "other"} · ${data.enabled ? "enabled" : "disabled"}`);
      setText("sr-map-wr", time(data.summary, "worldRecordTime"));
      setText("sr-map-runs", compact(data.summary?.totalRuns));
      setText("sr-map-runners", compact(data.summary?.totalRunners));
      setText("sr-map-records", compact(data.summary?.totalRecords));
      setText("sr-map-difficulty", data.difficulty == null ? "-" : `D${data.difficulty}`);

      const classFilter = $("sr-map-class-filter");
      const classOptions = [...new Map((data.leaderboard || []).map(row => [
        classValue(row),
        classText(row)
      ])).entries()]
        .filter(([value]) => value)
        .sort((a, b) => a[1].localeCompare(b[1]));

      if (classFilter) {
        classFilter.innerHTML = `<option value="">All Classes</option>${classOptions.map(([value, label]) =>
          `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`
        ).join("")}`;
      }

      const renderLeaderboard = () => {
        const selectedClass = classFilter?.value || "";
        const rows = selectedClass
          ? (data.leaderboard || []).filter(row => classValue(row) === selectedClass)
          : (data.leaderboard || []);

        setHtml("sr-map-leaderboard", rows.map((row, index) => `
          <tr>
          <td>#${compact(index + 1)}</td>
          <td>${runnerLink(row)}</td>
          <td>${escapeHtml(classText(row))}</td>
          <td class="speedrun-time">${escapeHtml(time(row, "bestTime"))}${replayLink(row)}</td>
          <td>${escapeHtml(formatDateTime(achievedTimestamp(row)))}</td>
        </tr>
        `).join("") || `<tr><td colspan="5">${empty(selectedClass ? "No records for this class yet." : "No records yet.")}</td></tr>`);
      };

      classFilter?.addEventListener("change", renderLeaderboard);
      renderLeaderboard();

      renderRuns("sr-map-recent", data.recentRuns, "No recent runs for this map.");
      try {
        renderProgression(await api(`/api/speedruns/maps/${encodeURIComponent(mapName)}/progression`));
      } catch (progressionError) {
        console.error("[speedrun-map-progression]", progressionError);
        const status = $("sr-progression-status");
        const content = $("sr-progression-content");
        if (status) {
          status.hidden = false;
          status.textContent = "Could not load WR progression.";
        }
        if (content) content.hidden = true;
        setHtml("sr-map-progression", empty("Could not load WR progression."));
      }
    } catch (error) {
      console.error("[speedrun-map]", error);
      setText("sr-map-title", "Map unavailable");
      showError(error.status === 503 ? "Speedrun database unavailable" : "This speedrun map could not be loaded.");
    }
  }

  async function loadPlayer() {
    const discordId = params().get("id") || "";
    if (!discordId) {
      showError("Missing runner ID.");
      setText("sr-player-title", "Runner not found");
      return;
    }

    try {
      const [data, steamProfile] = await Promise.all([
        api(`/api/speedruns/players/${encodeURIComponent(discordId)}`),
        loadSteamProfile(discordId)
      ]);
      const playerName = steamProfile?.personaname || data.player?.playerName || discordId;
      document.title = `NoName TFC | ${playerName} Speedruns`;
      setHtml(
        "sr-player-title",
        `<span class="speedrun-player-name-text">${escapeHtml(playerName)}</span>${supporterBadge(data.player?.discordId || discordId)}`
      );
      requestAnimationFrame(fitSpeedrunPlayerName);
      setHtml(
        "sr-player-mark",
        speedrunAvatarMarkup(
          playerName,
          steamProfile?.avatarfull || steamProfile?.avatarmedium || steamProfile?.avatar || ""
        )
      );

      setText(
        "sr-player-subtitle",
        steamProfile?.steam_id ? `SteamID: ${steamProfile.steam_id}` : steamIdsText(data.player)
      );
      setHtml(
        "sr-player-profile-links",
        `<a class="speedrun-profile-link" href="${escapeAttr(`player.html?id=${encodeURIComponent(data.player?.discordId || discordId)}`)}">Player Profile</a>`
      );
      setText("sr-player-runs", compact(data.summary?.totalRuns));
      setText("sr-player-maps", compact(data.summary?.mapsCompleted ?? data.summary?.mapsPlayed));
      setText("sr-player-map-total", data.summary?.enabledMaps || data.summary?.totalMaps ? `of ${compact(data.summary.enabledMaps || data.summary.totalMaps)} maps` : "PB maps");
      setText("sr-player-records", compact(data.summary?.currentRecords));
      setText("sr-player-world-records", compact(data.summary?.worldRecords ?? (data.worldRecords || []).length));
      setText("sr-player-best-rank", data.summary?.bestRecordRank ? `#${data.summary.bestRecordRank}` : "-");
      setText("sr-player-global-rank", data.summary?.globalRank ? `#${data.summary.globalRank}` : "-");
      setText("sr-player-global-total", data.summary?.globalRunnerCount ? `of ${compact(data.summary.globalRunnerCount)} runners` : "Speedrun runners");

      renderRecords("sr-player-record-list", data.worldRecords, "No current records.");
      renderRuns("sr-player-recent", data.recentActivity, "No runs recorded.");
      renderPlayerDashboard(data);
    } catch (error) {
      console.error("[speedrun-player]", error);
      setText("sr-player-title", "Runner unavailable");
      showError(error.status === 503 ? "Speedrun database unavailable" : "This runner could not be loaded.");
    }
  }

  async function loadMapCatalog() {
    try {
      const serverMaps = await api("/api/speedruns/server-maps");
      const search = $("sr-catalog-search");
      const filter = $("sr-catalog-filter");
      const head = $("sr-catalog-head");
      const body = $("sr-catalog-body");

      setText("sr-catalog-server", compact(serverMaps.length));
      setText("sr-catalog-configured", compact(serverMaps.filter(row => row.setup_status === "configured").length));
      setText("sr-catalog-not-logged", compact(serverMaps.filter(row => row.setup_status === "not_logged").length));
      setText("sr-catalog-needs-setup", compact(serverMaps.filter(row => row.setup_status !== "configured").length));
      setText("sr-catalog-records", compact(serverMaps.reduce((sum, row) => sum + Number(row.totalRecords || 0), 0)));
      setText("speedrun-status", "Server map inventory loaded.");

      const header = `
        <tr>
          <th>Name</th><th>Servers</th><th>Status</th><th>Runs</th><th>Runners</th><th>Records</th><th>Difficulty</th><th>Enabled</th><th>Last Seen</th>
        </tr>
      `;

      const renderRows = rows => rows.map(row => `
        <tr>
          <td>${mapPreviewLink(row.map)}</td>
          <td><span class="speedrun-server-chip-row">${serverChips(row)}</span></td>
          <td><span class="speedrun-status-badge status-${escapeAttr(row.setup_status || "not_logged")}">${escapeHtml(setupStatusLabel(row.setup_status))}</span></td>
          <td>${compact(row.totalRuns)}</td>
          <td>${compact(row.totalRunners)}</td>
          <td>${compact(row.totalRecords)}</td>
          <td>${row.difficulty == null ? "-" : `D${escapeHtml(row.difficulty)}`}</td>
          <td>${row.enabled == null ? "-" : yesNo(row.enabled)}</td>
          <td>${escapeHtml(formatDateTime(timestampValue(row, "lastSeen", "last_seen")))}</td>
        </tr>
      `).join("");

      const render = () => {
        const q = String(search?.value || "").trim().toLowerCase();
        const mode = filter?.value || "server";
        let rows = serverMaps;

        if (mode === "needs_setup") {
          rows = rows.filter(row => row.setup_status !== "configured");
        } else if (mode === "records") {
          rows = rows.filter(row => Number(row.totalRecords || 0) > 0);
        } else if (mode === "logged") {
          rows = rows.filter(row => row.setup_status !== "not_logged");
        } else if (mode !== "server") {
          rows = rows.filter(row => row.setup_status === mode);
        }

        rows = rows.filter(row => `${(row.servers || row.server_keys || []).join(" ")} ${row.map || ""}`.toLowerCase().includes(q));
        if (head) head.innerHTML = header;
        if (body) {
          body.innerHTML = renderRows(rows) || `<tr><td colspan="9">${empty("No maps found.")}</td></tr>`;
        }
      };

      search?.addEventListener("input", render);
      filter?.addEventListener("change", render);
      setupMapPreview();
      render();
    } catch (error) {
      console.error("[speedrun-maps]", error);
      showError(error.status === 503 ? "Speedrun database unavailable" : "Speedrun map catalogue could not be loaded.");
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (loadSupporters) await loadSupporters();
    const view = document.body?.dataset?.speedrunsView;
    if (view === "home") loadHome();
    else if (view === "map") loadMap();
    else if (view === "player") loadPlayer();
    else if (view === "maps") loadMapCatalog();
  });
  window.addEventListener("resize", fitSpeedrunPlayerName);
})();
