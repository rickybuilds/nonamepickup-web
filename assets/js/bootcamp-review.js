(function () {
  "use strict";
  const form = document.getElementById("br-login"), status = document.getElementById("br-status");
  const queue = document.getElementById("br-queue"), template = document.getElementById("br-card-template");
  let authorization = "";
  const classes = ["Any", "Scout", "Sniper", "Soldier", "Demoman", "Medic", "HWGuy", "Pyro", "Spy", "Engineer"];
  const say = (text, error = false) => { status.textContent = text; status.className = error ? "br-error" : ""; };

  async function api(path, options = {}) {
    const response = await fetch(`/api/bootcamp${path}`, { ...options, cache: "no-store",
      headers: { authorization, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(response.status === 401 ? "Login rejected. Check your reviewer credentials." :
        response.status === 503 ? "Review service is unavailable or not configured." : data.error || `Request failed (${response.status})`);
    }
    return response.status === 204 ? null : response.json();
  }

  function draw(canvas, frames, current) {
    const ctx = canvas.getContext("2d"), width = canvas.width, height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (!frames.length) return;
    const xs = frames.map(f => f.x), ys = frames.map(f => f.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 32, scale = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY));
    const point = frame => [pad + (frame.x - minX) * scale, height - pad - (frame.y - minY) * scale];
    ctx.strokeStyle = "#71839f"; ctx.lineWidth = 3; ctx.beginPath();
    frames.forEach((frame, index) => { const [x, y] = point(frame); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    const [x, y] = point(frames[current]); ctx.fillStyle = "#8ce0c6"; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#dce5f4"; ctx.font = "14px system-ui"; ctx.fillText("Start", pad, height - 10); ctx.fillText("Finish", width - 82, height - 10);
  }

  async function renderQueue() {
    say("Loading pending reviews…");
    const data = await api("/admin/reviews");
    queue.replaceChildren();
    if (!data.reviews.length) { const empty = document.createElement("p"); empty.className = "br-empty"; empty.textContent = "No complete flagged runs are waiting for review."; queue.append(empty); }
    for (const review of data.reviews) await addReview(review);
    say(`${data.reviews.length} pending review${data.reviews.length === 1 ? "" : "s"}.`);
  }

  async function addReview(review) {
    const card = template.content.firstElementChild.cloneNode(true), meta = card.querySelector(".br-meta");
    const title = document.createElement("strong"); title.textContent = `${review.playerName} · ${review.map} · ${review.routeName}`; meta.append(title);
    for (const value of [classes[review.classId] || `Class ${review.classId}`, `${(review.timeMs / 1000).toFixed(3)}s`,
      `Tier ${review.tier}`, review.steamId, `Config v${review.configVersion}`]) {
      const item = document.createElement("span"); item.textContent = value; meta.append(item);
    }
    card.dataset.runId = String(review.runId); queue.append(card);
    try {
      const replay = await api(`/admin/reviews/${review.runId}/replay`);
      const canvas = card.querySelector("canvas"), seek = card.querySelector('[data-action="seek"]'), time = card.querySelector('[data-action="time"]');
      seek.max = String(replay.frames.length - 1);
      let playing = false, last = 0, accumulator = 0;
      const render = () => { const index = Number(seek.value); draw(canvas, replay.frames, index); time.value = `${replay.frames[index].t.toFixed(2)} / ${replay.frames.at(-1).t.toFixed(2)} sec`; };
      seek.addEventListener("input", render); render();
      const tick = now => {
        if (!playing) return;
        if (!last) last = now;
        accumulator += now - last; last = now;
        const step = Math.max(5, Number(replay.frameInterval) * 1000);
        while (accumulator >= step && Number(seek.value) < Number(seek.max)) { seek.value = String(Number(seek.value) + 1); accumulator -= step; }
        render();
        if (Number(seek.value) >= Number(seek.max)) { playing = false; card.querySelector('[data-action="play"]').textContent = "Play"; }
        else requestAnimationFrame(tick);
      };
      card.querySelector('[data-action="play"]').addEventListener("click", event => {
        playing = !playing; event.currentTarget.textContent = playing ? "Pause" : "Play";
        if (playing) { if (Number(seek.value) >= Number(seek.max)) seek.value = "0"; last = 0; requestAnimationFrame(tick); }
      });
    } catch (error) {
      const note = document.createElement("p"); note.className = "br-error"; note.textContent = `Replay unavailable: ${error.message}`; card.querySelector(".br-replay").replaceChildren(note);
    }
    for (const verdict of ["approve", "reject"]) card.querySelector(`[data-action="${verdict}"]`).addEventListener("click", async event => {
      event.currentTarget.disabled = true;
      try {
        await api(`/admin/reviews/${review.runId}`, { method: "POST", body: JSON.stringify({ verdict }) });
        card.remove(); say(`Run ${review.runId} ${verdict === "approve" ? "approved and published" : "rejected"}.`);
        if (!queue.querySelector(".br-card")) { const empty = document.createElement("p"); empty.className = "br-empty"; empty.textContent = "No complete flagged runs are waiting for review."; queue.append(empty); }
      } catch (error) { say(error.message, true); event.currentTarget.disabled = false; }
    });
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const values = new FormData(form), user = String(values.get("username") || ""), password = String(values.get("password") || "");
    authorization = `Basic ${btoa(unescape(encodeURIComponent(`${user}:${password}`)))}`;
    form.elements.password.value = "";
    try { await renderQueue(); } catch (error) { queue.replaceChildren(); say(error.message, true); authorization = ""; }
  });
}());
