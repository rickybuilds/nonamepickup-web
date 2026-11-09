"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const state = { messages: [] };
  const search = document.getElementById("muted-search");
  const channel = document.getElementById("muted-channel");
  const board = document.getElementById("muted-board");
  const empty = document.getElementById("muted-empty");
  const count = document.getElementById("muted-count");
  const status = document.getElementById("muted-status");
  const error = document.getElementById("muted-error");
  const number = new Intl.NumberFormat("en-US");

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function messageDate(message) {
    const date = message.timestamp_ms == null
      ? new Date(message.timestamp || "")
      : new Date(message.timestamp_ms);
    if (Number.isNaN(date.getTime())) {
      return { label: message.timestamp || "Unknown time", datetime: "" };
    }
    return {
      label: date.toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
      }),
      datetime: date.toISOString()
    };
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const selectedChannel = channel.value;
    const filtered = state.messages.filter(message => {
      const haystack = [message.username, message.channel_name, message.content]
        .join(" ").toLocaleLowerCase();
      return (!query || haystack.includes(query)) &&
        (!selectedChannel || message.channel_id === selectedChannel);
    });

    count.textContent = `${number.format(filtered.length)} ${filtered.length === 1 ? "message" : "messages"}`;
    board.innerHTML = filtered.map(message => {
      const date = messageDate(message);
      return `
        <article class="muted-message">
          <div class="muted-message-row">
            <time${date.datetime ? ` datetime="${escapeHtml(date.datetime)}"` : ""}>${escapeHtml(date.label)}</time>
            <strong class="muted-username">${escapeHtml(message.username)}</strong>
            <span class="muted-channel"># ${escapeHtml(message.channel_name)}</span>
            <p class="muted-message-content">${escapeHtml(message.content || "(empty message)")}</p>
          </div>
        </article>
      `;
    }).join("");
    empty.hidden = filtered.length > 0;
  }

  async function loadMessages() {
    try {
      const response = await fetch("/api/muted", { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error("muted_data_unavailable");

      state.messages = Array.isArray(payload.messages) ? payload.messages : [];
      const channels = [...new Map(state.messages.map(message => [
        message.channel_id || message.channel_name,
        { id: message.channel_id, name: message.channel_name }
      ])).values()].sort((a, b) => a.name.localeCompare(b.name));
      channel.innerHTML = '<option value="">All channels</option>' + channels.map(item =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
      ).join("");

      const generated = new Date(payload.generated_at || Date.now());
      status.textContent = `Updated ${generated.toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      })}`;
      render();
    } catch {
      status.textContent = "Archive unavailable";
      error.textContent = "Could not load mutedlogs.json. Check that the API can reach the bot data directory, then refresh this page.";
      error.hidden = false;
      board.innerHTML = "";
      count.textContent = "0 messages";
    }
  }

  search.addEventListener("input", render);
  channel.addEventListener("change", render);
  loadMessages();
});
