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

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value ?? "-";
  }

  function setHtml(id, value) {
    const el = $(id);
    if (el) el.innerHTML = value || "";
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

  function shortDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function fullDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
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
    return row?.className || row?.class_name || (row?.classId || row?.class_id ? `Class ${row.classId || row.class_id}` : "-");
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
      subtitleHtml: `${runnerLink(row)} &middot; ${escapeHtml(classText(row))} &middot; ${escapeHtml(fullDate(row.createdAt))}`,
      value: time(row),
      href: mapUrl(row.map)
    })).join("") || empty(emptyText));
  }

  function renderRecords(targetId, rows, emptyText) {
    setHtml(targetId, (rows || []).map(row => listRow({
      title: row.map || "Unknown map",
      subtitleHtml: `${runnerLink(row)} &middot; ${escapeHtml(classText(row))} &middot; ${escapeHtml(shortDate(row.updatedAt))}`,
      value: time(row, "bestTime"),
      href: mapUrl(row.map)
    })).join("") || empty(emptyText));
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
          <div><span>Last</span><strong>${shortDate(row.lastRunAt)}</strong></div>
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
        api("/api/speedruns/maps?limit=24&sort=name")
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
        titleHtml: null,
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
              sort: sort?.value || "name"
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

      setHtml("sr-map-leaderboard", (data.leaderboard || []).map(row => `
        <tr>
          <td>#${compact(row.rank)}</td>
          <td>${runnerLink(row)}</td>
          <td>${escapeHtml(classText(row))}</td>
          <td class="speedrun-time">${escapeHtml(time(row, "bestTime"))}</td>
          <td>${escapeHtml(shortDate(row.updatedAt))}</td>
        </tr>
      `).join("") || `<tr><td colspan="5">${empty("No records yet.")}</td></tr>`);

      renderRuns("sr-map-recent", data.recentRuns, "No recent runs for this map.");
      setHtml("sr-map-progression", (data.worldRecordProgression || []).map(row => listRow({
        title: row.playerName || "Unknown",
        titleHtml: runnerLink(row),
        subtitle: `${classText(row)} · ${fullDate(row.createdAt)}`,
        value: time(row),
        href: playerUrl(row.discordId)
      })).join("") || empty("No world record progression yet."));
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
      const data = await api(`/api/speedruns/players/${encodeURIComponent(discordId)}`);
      const playerName = data.player?.playerName || discordId;
      document.title = `NoName TFC | ${playerName} Speedruns`;
      setHtml(
        "sr-player-title",
        `${escapeHtml(playerName)}${supporterBadge(data.player?.discordId || discordId)}`
      );

      setText(
        "sr-player-subtitle",
        data.player?.discordId || discordId
      );
      setText("sr-player-runs", compact(data.summary?.totalRuns));
      setText("sr-player-maps", compact(data.summary?.mapsPlayed));
      setText("sr-player-records", compact(data.summary?.currentRecords));

      setHtml("sr-player-pbs", (data.personalBests || []).map(row => `
        <tr>
          <td><a href="${escapeAttr(mapUrl(row.map))}">${escapeHtml(row.map || "-")}</a></td>
          <td>${escapeHtml(classText(row))}</td>
          <td class="speedrun-time">${escapeHtml(time(row, "bestTime"))}</td>
          <td>${escapeHtml(shortDate(row.updatedAt))}</td>
        </tr>
      `).join("") || `<tr><td colspan="4">${empty("No personal bests yet.")}</td></tr>`);

      renderRecords("sr-player-record-list", data.worldRecords, "No current records.");
      renderRuns("sr-player-recent", data.recentActivity, "No recent activity.");
    } catch (error) {
      console.error("[speedrun-player]", error);
      setText("sr-player-title", "Runner unavailable");
      showError(error.status === 503 ? "Speedrun database unavailable" : "This runner could not be loaded.");
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (loadSupporters) await loadSupporters();
    const view = document.body?.dataset?.speedrunsView;
    if (view === "home") loadHome();
    else if (view === "map") loadMap();
    else if (view === "player") loadPlayer();
  });
})();
