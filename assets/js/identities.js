"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const number = new Intl.NumberFormat("en-US");
  const state = {
    players: [],
    sharedIps: {},
    query: ""
  };

  const body = document.getElementById("identities-body");
  const filter = document.getElementById("identities-filter");
  const identityModal = document.getElementById("identity-modal");
  const ipModal = document.getElementById("ip-modal");

  function text(value, fallback = "—") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function formatDate(value) {
    if (value == null || value === "") return "—";
    const numeric = Number(value);
    const date = Number.isFinite(numeric)
      ? new Date(Math.abs(numeric) < 100000000000 ? numeric * 1000 : numeric)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return text(value);

    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function searchableValue(player) {
    return [
      player.current_name,
      player.steam_id,
      player.discord_id,
      player.current_ip
    ].map(value => String(value ?? "").toLowerCase()).join("\n");
  }

  function ipButton(ip, steamIdCount) {
    const value = text(ip);
    if (value === "—" || Number(steamIdCount || 0) < 2) {
      return `<span class="identities-mono">${escapeHtml(value)}</span>`;
    }

    return `
      <button
        class="identities-ip-link"
        type="button"
        data-ip="${escapeAttr(value)}"
        title="Show ${number.format(steamIdCount)} SteamIDs that used this IP"
      >${escapeHtml(value)}</button>
    `;
  }

  function renderRows() {
    const query = state.query.trim().toLowerCase();
    const visible = state.players.filter(player =>
      !query || searchableValue(player).includes(query)
    );

    body.innerHTML = visible.map(player => {
      const steamId = text(player.steam_id);
      const discordId = text(player.discord_id, "Not linked");
      const unlinked = player.discord_id == null || String(player.discord_id).trim() === "";
      return `
        <tr
          class="${unlinked ? "identity-unlinked" : ""}"
          data-steam-id="${escapeAttr(steamId)}"
          tabindex="0"
          aria-label="Open player details for ${escapeAttr(text(player.current_name, steamId))}"
        >
          <td data-label="Player"><strong>${escapeHtml(text(player.current_name, "Unknown player"))}</strong></td>
          <td data-label="SteamID"><span class="identities-mono">${escapeHtml(steamId)}</span></td>
          <td data-label="Discord ID"><span class="${unlinked ? "identities-unlinked-label" : "identities-mono"}">${escapeHtml(discordId)}</span></td>
          <td data-label="Current IP">${ipButton(player.current_ip, state.sharedIps[player.current_ip])}</td>
          <td data-label="Last Server Seen In">${escapeHtml(text(player.current_server))}</td>
          <td data-label="Connections">${number.format(Number(player.connection_count || 0))}</td>
          <td data-label="First Seen"><time>${escapeHtml(formatDate(player.first_seen))}</time></td>
          <td data-label="Last Seen"><time>${escapeHtml(formatDate(player.last_seen))}</time></td>
          <td data-label="Alias Count">${number.format(Number(player.alias_count || 0))}</td>
          <td data-label="IP Count">${number.format(Number(player.ip_count || 0))}</td>
        </tr>
      `;
    }).join("");

    document.getElementById("identities-empty").hidden = visible.length > 0;
    document.getElementById("identities-visible-count").textContent =
      `${number.format(visible.length)} of ${number.format(state.players.length)} players`;
  }

  function historyTable(columns, rows, emptyMessage) {
    if (!rows.length) return `<p class="identities-history-empty">${escapeHtml(emptyMessage)}</p>`;
    return `
      <div class="identities-history-table-wrap">
        <table class="identities-history-table">
          <thead><tr>${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                ${columns.map(column => `
                  <td data-label="${escapeAttr(column.label)}">${column.render(row)}</td>
                `).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function loadingModal(modal, content, title) {
    content.innerHTML = `<p class="identities-modal-loading">Loading ${escapeHtml(title)}...</p>`;
    if (!modal.open) modal.showModal();
  }

  async function openIdentity(steamId) {
    if (!steamId || steamId === "—") return;
    const content = document.getElementById("identity-modal-content");
    loadingModal(identityModal, content, "player history");

    const payload = await fetchJSON(`/api/player-identities/${encodeURIComponent(steamId)}`);
    if (!payload.ok || !payload.player) {
      content.innerHTML = `<p class="identities-modal-error">Player details could not be loaded.</p>`;
      return;
    }

    const player = payload.player;
    const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
    const ips = Array.isArray(payload.ips) ? payload.ips : [];
    document.getElementById("identity-modal-title").textContent =
      text(player.current_name, player.steam_id);

    const details = [
      ["Player Name", text(player.current_name, "Unknown player")],
      ["SteamID", text(player.steam_id)],
      ["Discord ID", text(player.discord_id, "Not linked")],
      ["Current IP", text(player.current_ip)],
      ["Last Server Seen In", text(player.current_server)],
      ["Connections", number.format(Number(player.connection_count || 0))],
      ["First Seen", formatDate(player.first_seen)],
      ["Last Seen", formatDate(player.last_seen)]
    ];

    content.innerHTML = `
      <section class="identities-detail-grid" aria-label="Player information">
        ${details.map(([label, value]) => `
          <article>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </article>
        `).join("")}
      </section>

      <section class="identities-history-section">
        <div class="identities-history-heading">
          <div><p>NAME RECORDS</p><h3>Aliases</h3></div>
          <span>${number.format(aliases.length)} records</span>
        </div>
        ${historyTable([
          { label: "Alias", render: row => `<strong>${escapeHtml(text(row.alias))}</strong>` },
          { label: "Times Seen", render: row => number.format(Number(row.times_seen || 0)) },
          { label: "First Seen", render: row => escapeHtml(formatDate(row.first_seen)) },
          { label: "Last Seen", render: row => escapeHtml(formatDate(row.last_seen)) }
        ], aliases, "No alias history recorded.")}
      </section>

      <section class="identities-history-section">
        <div class="identities-history-heading">
          <div><p>NETWORK RECORDS</p><h3>IP History</h3></div>
          <span>${number.format(ips.length)} records</span>
        </div>
        ${historyTable([
          { label: "IP", render: row => ipButton(row.ip, row.steam_id_count) },
          { label: "Times Seen", render: row => number.format(Number(row.times_seen || 0)) },
          { label: "First Seen", render: row => escapeHtml(formatDate(row.first_seen)) },
          { label: "Last Seen", render: row => escapeHtml(formatDate(row.last_seen)) }
        ], ips, "No IP history recorded.")}
      </section>
    `;
  }

  async function openIp(ip) {
    if (!ip || ip === "—") return;
    const content = document.getElementById("ip-modal-content");
    document.getElementById("ip-modal-title").textContent = ip;
    loadingModal(ipModal, content, "shared IP history");

    const payload = await fetchJSON(`/api/player-identities/ip/${encodeURIComponent(ip)}`);
    const players = Array.isArray(payload.data) ? payload.data : [];
    if (!payload.ok) {
      content.innerHTML = `<p class="identities-modal-error">Shared IP history could not be loaded.</p>`;
      return;
    }

    content.innerHTML = `
      <p class="identities-ip-summary">
        <strong>${number.format(players.length)}</strong>
        ${players.length === 1 ? "SteamID has" : "SteamIDs have"} connected from this address.
      </p>
      ${historyTable([
        {
          label: "Player",
          render: row => `<button class="identities-player-link" type="button" data-steam-id="${escapeAttr(row.steam_id)}">${escapeHtml(text(row.current_name, "Unknown player"))}</button>`
        },
        { label: "SteamID", render: row => `<span class="identities-mono">${escapeHtml(text(row.steam_id))}</span>` },
        { label: "Discord ID", render: row => escapeHtml(text(row.discord_id, "Not linked")) },
        { label: "Times Seen", render: row => number.format(Number(row.times_seen || 0)) },
        { label: "First Seen", render: row => escapeHtml(formatDate(row.first_seen)) },
        { label: "Last Seen", render: row => escapeHtml(formatDate(row.last_seen)) }
      ], players, "No players were found for this IP.")}
    `;
  }

  async function loadIdentities() {
    const payload = await fetchJSON("/api/player-identities");
    const error = document.getElementById("identities-error");
    if (!payload.ok || !Array.isArray(payload.data)) {
      error.hidden = false;
      error.textContent = "The player tracker could not be loaded right now.";
      document.getElementById("identities-status").textContent = "Player records unavailable";
      body.innerHTML = `<tr><td colspan="10" class="identities-empty">Unable to load identities.</td></tr>`;
      return;
    }

    state.players = payload.data;
    state.sharedIps = payload.shared_ips || {};
    const unlinked = state.players.filter(player =>
      player.discord_id == null || String(player.discord_id).trim() === ""
    ).length;
    const connections = state.players.reduce(
      (total, player) => total + Number(player.connection_count || 0),
      0
    );

    document.getElementById("identities-total").textContent = number.format(state.players.length);
    document.getElementById("identities-unlinked").textContent = number.format(unlinked);
    document.getElementById("identities-connections").textContent = number.format(connections);
    document.getElementById("identities-status").textContent =
      `${number.format(state.players.length)} player records loaded`;
    renderRows();
  }

  filter.addEventListener("input", () => {
    state.query = filter.value;
    renderRows();
  });

  body.addEventListener("click", event => {
    const ipTarget = event.target.closest("[data-ip]");
    if (ipTarget) {
      event.stopPropagation();
      void openIp(ipTarget.dataset.ip);
      return;
    }

    const row = event.target.closest("[data-steam-id]");
    if (row) void openIdentity(row.dataset.steamId);
  });

  body.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest("[data-ip]")) return;
    const row = event.target.closest("[data-steam-id]");
    if (!row) return;
    event.preventDefault();
    void openIdentity(row.dataset.steamId);
  });

  identityModal.addEventListener("click", event => {
    const ipTarget = event.target.closest("[data-ip]");
    if (ipTarget) void openIp(ipTarget.dataset.ip);
  });

  ipModal.addEventListener("click", event => {
    const playerTarget = event.target.closest("[data-steam-id]");
    if (!playerTarget) return;
    ipModal.close();
    void openIdentity(playerTarget.dataset.steamId);
  });

  document.querySelectorAll("[data-close-modal]").forEach(button => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  [identityModal, ipModal].forEach(modal => {
    modal.addEventListener("click", event => {
      if (event.target === modal) modal.close();
    });
  });

  void loadIdentities();
});
