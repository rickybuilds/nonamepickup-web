"use strict";

(() => {
  const form = document.getElementById("coolest-dude-tag-form");
  if (!form) return;

  const input = document.getElementById("coolest-dude-tag-input");
  const count = document.getElementById("coolest-dude-tag-count");
  const status = document.getElementById("coolest-dude-tag-status");
  const list = document.getElementById("coolest-dude-tags-list");
  const button = form.querySelector("button[type='submit']");
  const maxLength = input.maxLength || 120;
  let tags = [];

  function updateCount() {
    count.textContent = `${input.value.length} / ${maxLength}`;
  }

  function setStatus(message, kind = "") {
    status.textContent = message;
    status.className = `coolest-dude-tag-status${kind ? ` ${kind}` : ""}`;
  }

  function formatDate(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return "Just now";
    return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function renderTags() {
    list.replaceChildren();

    if (!tags.length) {
      const empty = document.createElement("p");
      empty.className = "coolest-dude-tags-empty";
      empty.textContent = "No tags yet — be the first.";
      list.appendChild(empty);
      return;
    }

    tags.forEach(tag => {
      const article = document.createElement("article");
      article.className = "coolest-dude-tag";

      const message = document.createElement("p");
      message.textContent = tag.message || "";

      const time = document.createElement("time");
      time.dateTime = new Date(Number(tag.created_at)).toISOString();
      time.textContent = formatDate(tag.created_at);

      article.append(message, time);
      list.appendChild(article);
    });
  }

  async function loadTags() {
    try {
      const response = await fetch("/api/coolest-dude/tags?limit=100", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error("load_failed");
      tags = Array.isArray(payload.data) ? payload.data : [];
      renderTags();
    } catch {
      list.replaceChildren();
      const error = document.createElement("p");
      error.className = "coolest-dude-tags-empty";
      error.textContent = "Tags are unavailable right now.";
      list.appendChild(error);
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) {
      setStatus("Write a tag first.", "is-error");
      return;
    }

    button.disabled = true;
    setStatus("Checking your tag...", "is-busy");

    try {
      const response = await fetch("/api/coolest-dude/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 422 && payload.error === "tag_not_allowed") {
        setStatus("That tag was blocked. Keep it kind and positive.", "is-error");
        return;
      }
      if (response.status === 429) {
        setStatus("Please wait about 30 minutes before posting another tag.", "is-error");
        return;
      }
      if (!response.ok || !payload.ok || !payload.data) throw new Error("post_failed");

      tags = [payload.data, ...tags].slice(0, 100);
      input.value = "";
      updateCount();
      renderTags();
      setStatus("Tag posted — thanks for keeping it positive.", "is-success");
    } catch {
      setStatus("Could not post that tag right now. Please try again.", "is-error");
    } finally {
      button.disabled = false;
    }
  });

  input.addEventListener("input", updateCount);
  updateCount();
  renderTags();
  loadTags();
})();
