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

  function timestampValue(row, camelKey, snakeKey) {
    return row?.[camelKey] ?? row?.[snakeKey];
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
    return row?.className || row?.class_name || (row?.classId || row?.class_id ? `Class ${row.classId || row.class_id}` : "-");
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
      subtitleHtml: `${runnerLink(row)} &middot; ${escapeHtml(classText(row))} &middot; ${escapeHtml(formatDateTime(timestampValue(row, "createdAt", "created_at")))}`,
      value: time(row),
      href: mapUrl(row.map)
    })).join("") || empty(emptyText));
  }

  function renderRecords(targetId, rows, emptyText) {
    setHtml(targetId, (rows || []).map(row => listRow({
      title: row.map || "Unknown map",
      subtitleHtml: `${runnerLink(row)} &middot; ${escapeHtml(classText(row))} &middot; ${escapeHtml(formatDateTime(timestampValue(row, "updatedAt", "updated_at")))}`,
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
            <td class="speedrun-time">${escapeHtml(time(row, "bestTime"))}</td>
            <td>${escapeHtml(formatDateTime(timestampValue(row, "updatedAt", "updated_at")))}</td>
          </tr>
        `).join("") || `<tr><td colspan="5">${empty(selectedClass ? "No records for this class yet." : "No records yet.")}</td></tr>`);
      };

      classFilter?.addEventListener("change", renderLeaderboard);
      renderLeaderboard();

      renderRuns("sr-map-recent", data.recentRuns, "No recent runs for this map.");
      setHtml("sr-map-progression", (data.worldRecordProgression || []).map(row => listRow({
        title: row.playerName || "Unknown",
        titleHtml: runnerLink(row),
        subtitle: `${classText(row)} · ${formatDateTime(timestampValue(row, "createdAt", "created_at"))}`,
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
        steamIdsText(data.player)
      );
      setText("sr-player-runs", compact(data.summary?.totalRuns));
      setText("sr-player-maps", compact(data.summary?.mapsPlayed));
      setText("sr-player-records", compact(data.summary?.currentRecords));

      setHtml("sr-player-pbs", (data.personalBests || []).map(row => `
        <tr>
          <td><a href="${escapeAttr(mapUrl(row.map))}">${escapeHtml(row.map || "-")}</a></td>
          <td>${escapeHtml(classText(row))}</td>
          <td class="speedrun-time">${escapeHtml(time(row, "bestTime"))}</td>
          <td>${escapeHtml(formatDateTime(timestampValue(row, "updatedAt", "updated_at")))}</td>
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
})();
