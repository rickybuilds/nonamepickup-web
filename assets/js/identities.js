"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const number = new Intl.NumberFormat("en-US");
  const state = { query: "", filter: "all", page: 1, limit: 10, total: 0, players: [], summary: null, requestId: 0 };
  const body = document.getElementById("identities-body");
  const filterInput = document.getElementById("identities-filter");
  const pagination = document.getElementById("identities-pagination");
  const drawer = document.getElementById("identity-drawer");
  const ipModal = document.getElementById("ip-modal");

  function value(input, fallback = "—") {
    const result = String(input ?? "").trim();
    return result || fallback;
  }

  function timestamp(input) {
    if (input == null || input === "") return null;
    const numeric = Number(input);
    const date = Number.isFinite(numeric) ? new Date(Math.abs(numeric) < 100000000000 ? numeric * 1000 : numeric) : new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(input) {
    const date = timestamp(input);
    if (!date) return value(input);
    return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function relativeDate(input) {
    const date = timestamp(input);
    if (!date) return value(input);
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 172800) return "Yesterday";
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function initials(name) { return value(name, "?").charAt(0).toUpperCase(); }
  function isUnlinked(player) { return !player.discord_id || !String(player.discord_id).trim(); }
  function escape(valueToEscape) { return escapeHtml(String(valueToEscape ?? "")); }
  function avatarImageMarkup(player) {
    const imageUrl = player.avatarfull || player.avatarmedium || player.avatar || "";
    return `<span class="tracker-avatar-fallback">${escape(initials(player.current_name || player.discord_name))}</span>${imageUrl ? `<img src="${escapeAttr(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}`;
  }

  function identityMarkup(player) {
    const steam = value(player.steam_id);
    const discordName = value(player.discord_name, "Not linked");
    const discordId = value(player.discord_id, "Not linked");
    return `<div class="tracker-identity"><span class="tracker-id-line"><span class="tracker-steam-mark">◉</span>${escape(steam)}</span><span class="tracker-id-line ${isUnlinked(player) ? "is-unlinked" : ""}"><span class="tracker-discord-mark">●</span>${escape(discordName)}${isUnlinked(player) ? "" : ` <small>· ${escape(discordId)}</small>`}</span></div>`;
  }

  function renderRows() {
    if (!state.players.length) {
      body.innerHTML = `<tr><td colspan="7" class="identities-empty">No identities match that search.</td></tr>`;
      document.getElementById("identities-empty").hidden = true;
      return;
    }
    body.innerHTML = state.players.map(player => `
      <tr class="tracker-player-row" data-steam-id="${escapeAttr(value(player.steam_id))}" tabindex="0" aria-label="Open player details for ${escapeAttr(value(player.current_name, player.steam_id))}">
        <td data-label="Player"><div class="tracker-player"><span class="tracker-avatar">${avatarImageMarkup(player)}</span><span><strong>${escape(value(player.current_name, "Unknown player"))}</strong><small>${escape(value(player.discord_name, "No linked Discord name"))}</small></span></div></td>
        <td data-label="Identity">${identityMarkup(player)}</td>
        <td data-label="Last server"><span class="tracker-server">${escape(value(player.current_server))}</span></td>
        <td data-label="Connections"><strong class="tracker-connection-count">${number.format(Number(player.connection_count || 0))}</strong><span class="tracker-sparkline" aria-hidden="true">▂▃▂▅▆▅▇</span></td>
        <td data-label="Last seen"><time title="${escapeAttr(formatDate(player.last_seen))}">${escape(relativeDate(player.last_seen))}</time><small>${escape(formatDate(player.last_seen))}</small></td>
        <td data-label="History"><span class="tracker-history-count">${number.format(Number(player.alias_count || 0))} aliases</span><span class="tracker-history-count">${number.format(Number(player.ip_count || 0))} IPs</span></td>
        <td class="tracker-row-action" aria-hidden="true">›</td>
      </tr>
    `).join("");
    document.getElementById("identities-empty").hidden = true;
  }

  function renderPagination() {
    const pages = Math.max(1, Math.ceil(state.total / state.limit));
    if (pages <= 1) { pagination.innerHTML = ""; return; }
    const buttons = [];
    buttons.push(`<button type="button" class="tracker-page-button" data-page="${Math.max(1, state.page - 1)}" ${state.page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`);
    const visible = new Set([1, pages, state.page - 1, state.page, state.page + 1].filter(page => page > 0 && page <= pages));
    let last = 0;
    [...visible].sort((a, b) => a - b).forEach(page => {
      if (last && page - last > 1) buttons.push(`<span class="tracker-page-ellipsis">…</span>`);
      buttons.push(`<button type="button" class="tracker-page-button ${page === state.page ? "is-active" : ""}" data-page="${page}" aria-current="${page === state.page ? "page" : "false"}">${page}</button>`);
      last = page;
    });
    buttons.push(`<button type="button" class="tracker-page-button" data-page="${Math.min(pages, state.page + 1)}" ${state.page === pages ? "disabled" : ""} aria-label="Next page">›</button>`);
    pagination.innerHTML = `<span class="tracker-pagination-label">Showing ${Math.min((state.page - 1) * state.limit + 1, state.total)} to ${Math.min(state.page * state.limit, state.total)} of ${number.format(state.total)} players</span><div>${buttons.join("")}</div>`;
  }

  function setSummary(summary, paginationData) {
    if (summary) {
      state.summary = summary;
      document.getElementById("identities-total").textContent = number.format(Number(summary.known_players || 0));
      document.getElementById("identities-connections").textContent = number.format(Number(summary.total_connections || 0));
      document.getElementById("identities-unlinked").textContent = number.format(Number(summary.unlinked_players || 0));
      document.getElementById("identities-updated").textContent = relativeDate(summary.last_updated);
      Object.entries(summary.filters || {}).forEach(([key, count]) => { const node = document.querySelector(`[data-count="${key}"]`); if (node) node.textContent = number.format(Number(count || 0)); });
    }
    if (paginationData) state.total = Number(paginationData.total || 0);
  }

  async function loadPlayers() {
    const requestId = ++state.requestId;
    body.innerHTML = `<tr><td colspan="7" class="identities-empty">Loading player identities...</td></tr>`;
    const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit), filter: state.filter });
    if (state.query.trim()) params.set("q", state.query.trim());
    const payload = await fetchJSON(`/api/player-identities?${params}`);
    if (requestId !== state.requestId) return;
    const error = document.getElementById("identities-error");
    if (!payload.ok || !Array.isArray(payload.data)) {
      error.hidden = false;
      error.textContent = "The player tracker could not be loaded right now.";
      body.innerHTML = `<tr><td colspan="7" class="identities-empty">Unable to load identities.</td></tr>`;
      return;
    }
    error.hidden = true;
    state.players = payload.data;
    setSummary(payload.summary, payload.pagination);
    document.getElementById("identities-status").textContent = `${number.format(state.total)} player records indexed`;
    document.getElementById("identities-visible-count").textContent = state.total ? `${number.format(state.total)} matching players` : "No matching players";
    renderRows();
    renderPagination();
  }

  function historyTable(columns, rows, emptyMessage) {
    if (!rows.length) return `<p class="identities-history-empty">${escape(emptyMessage)}</p>`;
    return `<div class="identities-history-table-wrap"><table class="identities-history-table"><thead><tr>${columns.map(column => `<th>${escape(column.label)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => `<td data-label="${escapeAttr(column.label)}">${column.render(row)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function ipButton(ip, steamIdCount) {
    const cleanIp = value(ip);
    if (cleanIp === "—" || Number(steamIdCount || 0) < 2) return `<span class="identities-mono">${escape(cleanIp)}</span>`;
    return `<button class="identities-ip-link" type="button" data-ip="${escapeAttr(cleanIp)}" title="Show ${number.format(Number(steamIdCount))} SteamIDs observed on this IP">${escape(cleanIp)}</button>`;
  }

  function showDrawer() { drawer.hidden = false; drawer.setAttribute("aria-hidden", "false"); requestAnimationFrame(() => drawer.classList.add("is-open")); document.body.classList.add("drawer-open"); }
  function closeDrawer() { drawer.classList.remove("is-open"); drawer.setAttribute("aria-hidden", "true"); document.body.classList.remove("drawer-open"); setTimeout(() => { if (drawer.getAttribute("aria-hidden") === "true") drawer.hidden = true; }, 220); }

  async function openIdentity(steamId) {
    if (!steamId) return;
    const content = document.getElementById("identity-drawer-content");
    content.innerHTML = `<p class="identities-modal-loading">Loading player history...</p>`;
    showDrawer();
    const payload = await fetchJSON(`/api/player-identities/${encodeURIComponent(steamId)}`);
    if (!payload.ok || !payload.player) { content.innerHTML = `<p class="identities-modal-error">Player details could not be loaded.</p>`; return; }
    const player = payload.player;
    const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
    const ips = Array.isArray(payload.ips) ? payload.ips : [];
    document.getElementById("identity-drawer-title").textContent = value(player.current_name, player.steam_id);
    document.getElementById("identity-drawer-avatar").innerHTML = avatarImageMarkup(player);
    document.getElementById("identity-drawer-discord").textContent = value(player.discord_name, "No linked Discord name");
    const profileLink = player.discord_id ? `<a class="tracker-profile-link" href="player.html?id=${encodeURIComponent(player.discord_id)}">View full player profile ↗</a>` : "";
    content.innerHTML = `
      <section class="drawer-identity-block"><div class="drawer-id-row"><span>SteamID</span><strong class="identities-mono">${escape(value(player.steam_id))}</strong></div><div class="drawer-id-row"><span>Discord ID</span><strong class="identities-mono">${escape(value(player.discord_id, "Not linked"))}</strong></div></section>
      <section class="drawer-stat-grid"><article><span>Connections</span><strong>${number.format(Number(player.connection_count || 0))}</strong></article><article><span>Aliases</span><strong>${number.format(aliases.length)}</strong></article><article><span>IPs</span><strong>${number.format(ips.length)}</strong></article><article title="Server history is not available in the current tracker source"><span>Servers</span><strong>—</strong></article></section>
      <section class="drawer-section"><div class="drawer-section-heading"><div><p>CURRENT / LAST CONNECTION</p><h3>${escape(value(player.current_server))}</h3></div><span class="drawer-live-dot"></span></div><div class="drawer-connection-card"><strong class="identities-mono">${escape(value(player.current_ip))}</strong><span>${escape(relativeDate(player.last_seen))}</span><time title="${escapeAttr(formatDate(player.last_seen))}">${escape(formatDate(player.last_seen))}</time></div></section>
      <section class="drawer-section"><div class="drawer-section-heading"><div><p>ALIAS HISTORY</p><h3>Aliases <small>${number.format(aliases.length)}</small></h3></div></div>${historyTable([{label:"Alias",render:row => `<strong>${escape(value(row.alias))}</strong>${value(row.alias) === value(player.current_name) ? `<em class="drawer-current-badge">CURRENT</em>` : ""}`},{label:"Seen",render:row => number.format(Number(row.times_seen || 0))},{label:"Last seen",render:row => escape(relativeDate(row.last_seen))}], aliases, "No alias history recorded.")}</section>
      <section class="drawer-section"><div class="drawer-section-heading"><div><p>IP HISTORY</p><h3>Known IPs <small>${number.format(ips.length)}</small></h3></div></div>${historyTable([{label:"IP",render:row => ipButton(row.ip, row.steam_id_count)},{label:"Connections",render:row => number.format(Number(row.times_seen || 0))},{label:"Last seen",render:row => escape(relativeDate(row.last_seen))}], ips, "No IP history recorded.")}</section>
      <section class="drawer-section drawer-timeline"><div class="drawer-section-heading"><div><p>CONNECTION TIMELINE</p><h3>Recent activity</h3></div></div><div class="drawer-timeline-item"><span></span><div><strong>${escape(value(player.current_server))}</strong><small>${escape(value(player.current_ip))}</small></div><time title="${escapeAttr(formatDate(player.last_seen))}">${escape(formatDate(player.last_seen))}</time></div><p class="drawer-note">Detailed connection events are not available in the current tracker data source.</p></section>
      ${profileLink ? `<div class="drawer-profile-action">${profileLink}</div>` : ""}
    `;
  }

  async function openIp(ip) {
    if (!ip || ip === "—") return;
    document.getElementById("ip-modal-title").textContent = ip;
    document.getElementById("ip-modal-content").innerHTML = `<p class="identities-modal-loading">Loading shared IP history...</p>`;
    if (!ipModal.open) ipModal.showModal();
    const payload = await fetchJSON(`/api/player-identities/ip/${encodeURIComponent(ip)}`);
    const players = Array.isArray(payload.data) ? payload.data : [];
    document.getElementById("ip-modal-content").innerHTML = payload.ok ? `<p class="identities-ip-summary"><strong>${number.format(players.length)}</strong> players have connected from this IP. This is a factual connection overlap, not an identity inference.</p>${historyTable([{label:"Player",render:row => `<button class="identities-player-link" type="button" data-steam-id="${escapeAttr(row.steam_id)}">${escape(value(row.current_name, "Unknown player"))}</button>`},{label:"Connections",render:row => number.format(Number(row.times_seen || 0))},{label:"Last seen",render:row => escape(relativeDate(row.last_seen))}], players, "No players were found for this IP.")}` : `<p class="identities-modal-error">Shared IP history could not be loaded.</p>`;
  }

  let searchTimer;
  filterInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = filterInput.value; state.page = 1; void loadPlayers(); }, 220); });
  document.querySelectorAll(".tracker-filter").forEach(button => button.addEventListener("click", () => { document.querySelectorAll(".tracker-filter").forEach(item => item.classList.remove("is-active")); button.classList.add("is-active"); state.filter = button.dataset.filter; state.page = 1; void loadPlayers(); }));
  pagination.addEventListener("click", event => { const button = event.target.closest("[data-page]"); if (!button || button.disabled) return; state.page = Number(button.dataset.page); void loadPlayers(); });
  body.addEventListener("click", event => { const ip = event.target.closest("[data-ip]"); if (ip) { event.stopPropagation(); void openIp(ip.dataset.ip); return; } const row = event.target.closest("[data-steam-id]"); if (row) void openIdentity(row.dataset.steamId); });
  body.addEventListener("keydown", event => { if (!["Enter", " "].includes(event.key) || event.target.closest("[data-ip]")) return; const row = event.target.closest("[data-steam-id]"); if (!row) return; event.preventDefault(); void openIdentity(row.dataset.steamId); });
  document.getElementById("identity-drawer-content").addEventListener("click", event => { const ip = event.target.closest("[data-ip]"); if (ip) void openIp(ip.dataset.ip); });
  ipModal.addEventListener("click", event => { const player = event.target.closest("[data-steam-id]"); if (!player) return; ipModal.close(); void openIdentity(player.dataset.steamId); });
  document.querySelectorAll("[data-close-drawer]").forEach(button => button.addEventListener("click", closeDrawer));
  document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  ipModal.addEventListener("click", event => { if (event.target === ipModal) ipModal.close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { if (drawer.getAttribute("aria-hidden") === "false") closeDrawer(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); filterInput.focus(); } });
  void loadPlayers();
});
