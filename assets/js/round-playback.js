(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  const params = new URLSearchParams(location.search);
  $("match").value = params.get("match") || "HDPVET";
  $("round").value = params.get("round") === "2" ? "2" : "1";
  const classNames = ["Unknown", "Scout", "Sniper", "Soldier", "Demoman", "Medic", "Heavy", "Pyro", "Spy", "Engineer", "Civilian"];
  const maxHealth = [100, 75, 90, 100, 90, 90, 100, 100, 90, 80, 50];
  const icons = new Map();
  for (let id = 1; id <= 9; id++) {
    const image = new Image(); image.src = `/assets/images/classes/${classNames[id]}old_tfc.png`;
    image.onload = () => { dirty = true; }; icons.set(id, image);
  }
  let data = null, background = null, project = null, selected = "", time = 0, playing = false, dirty = true;
  let lastTick = performance.now(), lastUI = 0, loadVersion = 0, eventsSignature = "";
  const byId = new Map(), rosterStates = new Map();
  const clock = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"); };
  const playerName = id => byId.get(id)?.name || "World";
  function say(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
  async function json(url, signal) {
    const response = await fetch(url, { signal, cache: "no-cache" });
    if (!response.ok) {
      let code = ""; try { code = (await response.json()).error; } catch {}
      if (code === "tactical_not_prepared") throw new Error("This round has not been prepared yet. Prepare this match on the server, then select Load round again.");
      throw new Error(`Could not load round data (${response.status}). Check the match and round, then try again.`);
    }
    return response.json();
  }
  function imageFrom(url) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("Map overview image could not be loaded.")); image.src = url; }); }
  async function overview(map, signal) {
    const manifest = await json("/assets/tfc/overviews/manifest.json", signal);
    const file = manifest[map.toLowerCase()];
    if (!file) throw new Error("This map does not have an overview yet.");
    const root = "/assets/tfc/overviews/" + encodeURIComponent(file);
    const response = await fetch(root + ".txt", { signal });
    if (!response.ok) throw new Error("Map overview coordinates are unavailable.");
    const metadata = await response.text(), image = await imageFrom(root + ".bmp");
    const zoom = /^\s*zoom\s+([-+\d.]+)/im.exec(metadata), origin = /^\s*origin\s+([-+\d.]+)\s+([-+\d.]+)/im.exec(metadata), rotated = /^\s*rotated\s+([01])/im.exec(metadata);
    if (!zoom || !origin || !rotated || !(Number(zoom[1]) > 0)) throw new Error("Invalid overview coordinates.");
    const oriented = ["shutdown2_lg2", "alchimy_lg", "openfire_lowgrens", "blutopia_tfp", "fry_baked_lg", "snow_gutter", "demolish2_b4r", "demolish2_b6", "schtop", "siege", "waterwar_lg", "voltage_lg", "mortality_lg", "viridian", "siden_lg", "foundry_b3", "mm_chateau_b1", "mm_chateau_b2", "mm_chateau_b3", "mm_chateau_b4", "2mesa3_lg", "ostargh", "2trof_b4", "turbo_b10", "congestus_lg"].includes(map.toLowerCase());
    const crop = oriented && image.naturalWidth === 1920 && image.naturalHeight === 1080 ? 240 : 0;
    const bg = document.createElement("canvas"); bg.width = image.naturalWidth - crop * 2; bg.height = image.naturalHeight;
    const context = bg.getContext("2d");
    if (!oriented) { context.translate(0, bg.height); context.scale(1, -1); context.drawImage(image, 0, 0); }
    else context.drawImage(image, crop, 0, bg.width, bg.height, 0, 0, bg.width, bg.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const pixels = context.getImageData(0, 0, bg.width, bg.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
      if ((r === 0 && g === 255 && b === 0) || (g > 80 && r < 50 && b < 80 && g > r * 1.5 && g > b * 1.2) ||
          (map.toLowerCase() === "shutdown2_lg2" && g > 45 && r < 100 && b < 80 && g > r * 1.25 && g > b * 1.5)) {
        pixels.data[i] = 16; pixels.data[i + 1] = 21; pixels.data[i + 2] = 28;
      }
    }
    context.putImageData(pixels, 0, 0);
    const scale = bg.width * Number(zoom[1]) / 8192, ox = Number(origin[1]), oy = Number(origin[2]);
    return { background: bg, project: (x, y) => Number(rotated[1])
      ? [bg.width / 2 + (x - ox) * scale, bg.height / 2 - (y - oy) * scale]
      : [bg.width / 2 - (y - oy) * scale, bg.height / 2 - (x - ox) * scale] };
  }
  function frameAt(player, at) {
    const frames = player.frames, stride = data.stride;
    let low = 0, high = frames.length / stride;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (frames[middle * stride] <= at) low = middle + 1; else high = middle; }
    if (!low) return null;
    const index = (low - 1) * stride;
    if (at - frames[index] > Math.max(2000, data.sampleIntervalMs * 4)) return null;
    const frame = frames.slice(index, index + stride), next = index + stride;
    if (next < frames.length && frame[5] === 1 && frames[next + 5] === 1 &&
        frames[next] - frame[0] <= Math.max(2000, data.sampleIntervalMs * 4) &&
        Math.hypot(frames[next + 1] - frame[1], frames[next + 2] - frame[2]) < 1200) {
      const fraction = (at - frame[0]) / (frames[next] - frame[0]);
      if (Number.isFinite(fraction)) for (const field of [1, 2, 3]) frame[field] += (frames[next + field] - frame[field]) * fraction;
    }
    return frame;
  }
  function currentLife() { const player = byId.get(Number(selected)); return $("life").value === "" ? null : player?.lives[Number($("life").value)]; }
  function pause() { playing = false; $("play").textContent = "Play"; $("play").setAttribute("aria-label", "Play round"); }
  function seek(next) {
    if (!data) return;
    time = Math.min(data.durationMs, Math.max(0, next)); dirty = true; updateUI();
  }
  function selectPlayer(id) {
    selected = String(id); $("life").replaceChildren(new Option("Full round", ""));
    const player = byId.get(Number(selected));
    for (const [index, life] of (player?.lives || []).entries()) {
      $("life").append(new Option(`Life ${life.number} · ${clock(life.endMs - life.startMs)} · ${life.kills} kills`, String(index)));
    }
    $("life").disabled = !player?.lives.length;
    rosterStates.forEach((state, key) => state.button.setAttribute("aria-pressed", String(key === Number(selected))));
    dirty = true; eventsSignature = ""; updateUI();
  }
  function lifeChange() { pause(); const life = currentLife(); if (life) seek(life.startMs); else { dirty = true; updateUI(); } }
  function stepLife(direction) {
    const lives = byId.get(Number(selected))?.lives || [];
    const index = $("life").value === "" ? (direction > 0 ? -1 : lives.length) : Number($("life").value);
    const next = Math.min(lives.length - 1, Math.max(0, index + direction));
    if (!lives.length) return;
    $("life").value = String(next); lifeChange();
  }
  function weaponLabel(value) {
    const raw = String(value || "").trim();
    if (!raw || /^(unknown|\d+|weapon-0)$/i.test(raw)) return "";
    const names = { "weapon-1": "Grenade", "weapon-2": "Nail grenade", "weapon-3": "MIRV", "weapon-4": "EMP", "weapon-5": "Super Nailgun", "weapon-6": "Nails", "weapon-7": "Crowbar", "weapon-8": "Spanner", "weapon-9": "Medkit", "weapon-10": "Single Shotgun", "weapon-11": "Super Shotgun", "weapon-12": "Rocket Launcher", "weapon-13": "Assault Cannon", "weapon-14": "Railgun", "weapon-15": "Sentry Gun", "weapon-16": "Dispenser", "weapon-18": "Grenade Launcher", "weapon-19": "Pipebomb", "weapon-20": "Detpack", "weapon-29": "Infection" };
    return names[raw] || raw.replace(/^(tf_|weapon_)+/, "").replace(/_/g, " ");
  }
  function updateUI() {
    if (!data) return;
    $("timeline").value = String(time); $("timeline").setAttribute("aria-valuetext", clock(time));
    $("clock").textContent = clock(time) + " / " + clock(data.durationMs);
    const life = currentLife(), player = byId.get(Number(selected));
    $("life-detail").textContent = life ? `${clock(life.startMs)}–${clock(life.endMs)} · ${clock(life.endMs - life.startMs)} alive · ${life.kills} kills · ${life.endReason}`
      : player ? `${player.lives.length} recorded lives. Select one to follow its full path.` : "All recorded players. Select a player to inspect their lives.";
    $("previous-life").disabled = !player?.lives.length || $("life").value === "0";
    $("next-life").disabled = !player?.lives.length || Number($("life").value) === player.lives.length - 1;
    for (const [id, state] of rosterStates) {
      const frame = frameAt(byId.get(id), time);
      state.label.textContent = !frame ? "No sample" : frame[5] === 1 ? `${Math.max(0, frame[6])} HP` : "Dead";
    }
    const recent = data.events.filter(event => event.time <= time && event.type === "death" &&
      (!selected || event.attacker === Number(selected) || event.victim === Number(selected))).slice(-6).reverse();
    const signature = selected + ":" + recent.map(event => event.time + ":" + event.victim).join("|");
    if (signature !== eventsSignature) {
      eventsSignature = signature; $("events").replaceChildren();
      if (!recent.length) $("events").textContent = "No deaths yet in this view.";
      for (const event of recent) {
        const button = document.createElement("button"); button.className = "event";
        const timestamp = document.createElement("time"); timestamp.textContent = clock(event.time);
        const text = document.createElement("span");
        text.textContent = event.attacker === event.victim ? playerName(event.victim) + " died (suicide)" : event.attacker ? playerName(event.attacker) + " → " + playerName(event.victim) + (event.teamKill ? " (team kill)" : "") : playerName(event.victim) + " died";
        const weapon = document.createElement("small"); weapon.textContent = weaponLabel(event.weapon); weapon.style.display = "block";
        button.append(timestamp, text, weapon); button.onclick = () => { pause(); $("life").value = ""; seek(event.time); };
        $("events").append(button);
      }
    }
  }
  function draw() {
    if (!data || !background || !project) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(background, 0, 0);
    const unit = canvas.width / Math.max(1, canvas.clientWidth), size = 25 * unit;
    const focused = byId.get(Number(selected));
    if (focused && $("trail").checked) {
      const life = currentLife() || focused.lives.find(item => time >= item.startMs && time <= item.endMs);
      if (life) {
        ctx.beginPath(); ctx.strokeStyle = "#f9d076"; ctx.lineWidth = 2 * unit;
        let previous = null;
        for (let index = 0; index < focused.frames.length; index += data.stride) {
          const frames = focused.frames, t = frames[index];
          if (t < life.startMs || t > Math.min(time, life.endMs) || frames[index + 5] !== 1) continue;
          const point = project(frames[index + 1], frames[index + 2]);
          if (!previous || t - previous.time > 2000 || Math.hypot(point[0] - previous.x, point[1] - previous.y) > canvas.width / 4) ctx.moveTo(...point);
          else ctx.lineTo(...point);
          previous = { time: t, x: point[0], y: point[1] };
        }
        ctx.stroke();
      }
    }
    for (const event of data.events) {
      const age = time - event.time;
      if (age < 0 || age > 1800) continue;
      if (event.type === "conc-endpoint" && $("effects").checked) {
        const [x, y] = project(event.x, event.y);
        ctx.globalAlpha = Math.max(0, 1 - age / 1800); ctx.strokeStyle = "#7fe5a7"; ctx.lineWidth = 2 * unit;
        ctx.beginPath(); ctx.arc(x, y, (8 + age / 35) * unit, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (event.type === "death") {
        const victim = byId.get(event.victim), frame = victim && frameAt(victim, event.time - 1);
        if (!frame) continue;
        const [x, y] = project(frame[1], frame[2]), r = 6 * unit;
        ctx.strokeStyle = selected && event.attacker === Number(selected) ? "#f9d076" : "#ff8a94";
        ctx.lineWidth = 3 * unit; ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
      }
    }
    const sorted = [...data.players].sort((a, b) => Number(a.id === Number(selected)) - Number(b.id === Number(selected)));
    for (const player of sorted) {
      const frame = frameAt(player, time);
      if (!frame || frame[5] !== 1) continue;
      const [x, y] = project(frame[1], frame[2]), color = frame[9] === 1 ? "#60a5ff" : frame[9] === 2 ? "#ff7886" : "#d9e87a";
      ctx.globalAlpha = selected && player.id !== Number(selected) ? 0.45 : 1;
      ctx.fillStyle = "#0a1422"; ctx.strokeStyle = color; ctx.lineWidth = (player.id === Number(selected) ? 3 : 1.5) * unit;
      ctx.beginPath(); ctx.arc(x, y, size * .6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const icon = icons.get(frame[8]);
      if (icon?.complete && icon.naturalWidth) ctx.drawImage(icon, x - size / 2, y - size / 2, size, size);
      else { ctx.fillStyle = color; ctx.font = `bold ${11 * unit}px Inter, sans-serif`; ctx.textAlign = "center"; ctx.fillText((classNames[frame[8]] || "?").slice(0, 2), x, y + 4 * unit); }
      const facing = project(frame[1] + Math.cos(frame[4] * Math.PI / 180) * 50, frame[2] + Math.sin(frame[4] * Math.PI / 180) * 50);
      const angle = Math.atan2(facing[1] - y, facing[0] - x), r = size * .85;
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r); ctx.lineTo(x + Math.cos(angle + .4) * size * .6, y + Math.sin(angle + .4) * size * .6); ctx.lineTo(x + Math.cos(angle - .4) * size * .6, y + Math.sin(angle - .4) * size * .6); ctx.closePath(); ctx.fill();
      const barWidth = 30 * unit, barY = y - size * .9;
      ctx.fillStyle = "#18222e"; ctx.fillRect(x - barWidth / 2, barY, barWidth, 4 * unit);
      const hp = Math.max(0, frame[6]), ratio = Math.min(1, hp / (maxHealth[frame[8]] || 100));
      ctx.fillStyle = ratio > .5 ? "#7fe5a7" : ratio > .25 ? "#f8cf75" : "#ff7886"; ctx.fillRect(x - barWidth / 2, barY, barWidth * ratio, 4 * unit);
      ctx.textAlign = "center"; ctx.font = `600 ${11 * unit}px Inter, sans-serif`; ctx.lineWidth = 3 * unit; ctx.strokeStyle = "#060c15"; ctx.fillStyle = "#fff";
      const label = player.name.length > 22 ? player.name.slice(0, 21) + "…" : player.name;
      ctx.strokeText(label, x, y + size * .95); ctx.fillText(label, x, y + size * .95);
      if (player.id === Number(selected)) { ctx.font = `${10 * unit}px Inter, sans-serif`; ctx.strokeText(`${hp} HP · ${Math.max(0, frame[7])} armor`, x, y + size * 1.5); ctx.fillText(`${hp} HP · ${Math.max(0, frame[7])} armor`, x, y + size * 1.5); }
      ctx.globalAlpha = 1;
    }
  }
  let controller;
  async function load(event) {
    event?.preventDefault();
    const match = $("match").value.trim(), round = Number($("round").value);
    if (!/^[a-z0-9_-]{1,64}$/i.test(match)) return say("Enter a valid match ID.", true);
    controller?.abort(); controller = new AbortController(); const version = ++loadVersion;
    pause(); $("viewer").hidden = true; $("load").disabled = true; say("Loading compact round playback…");
    try {
      const next = await json(`/api/pickup-replays/viewer/${encodeURIComponent(match)}/${round}/tactical`, controller.signal);
      if (next.version !== 1 || next.stride !== 10 || !Array.isArray(next.players) || !next.players.length) throw new Error("Prepared playback is empty or incompatible. Prepare the round again.");
      const view = await overview(next.map, controller.signal);
      if (version !== loadVersion) return;
      data = next; background = view.background; project = view.project; canvas.width = background.width; canvas.height = background.height;
      byId.clear(); rosterStates.clear(); $("roster").replaceChildren();
      const all = document.createElement("button"); all.textContent = "Everyone"; all.onclick = () => selectPlayer(""); $("roster").append(all);
      for (const player of data.players) {
        byId.set(player.id, player);
        const button = document.createElement("button"); button.type = "button"; button.setAttribute("aria-pressed", "false");
        const firstAlive = player.frames.findIndex((value, index) => index % data.stride === 5 && value === 1);
        const classId = firstAlive >= 0 ? player.frames[firstAlive + 3] : 0;
        const icon = icons.get(classId); if (icon) { const image = document.createElement("img"); image.src = icon.src; image.alt = classNames[classId]; button.append(image); }
        const name = document.createElement("span"); name.textContent = player.name;
        const label = document.createElement("span"); label.className = "player-state";
        button.append(name, label); button.onclick = () => selectPlayer(player.id); $("roster").append(button); rosterStates.set(player.id, { button, label });
      }
      $("map-name").textContent = data.map; $("round-meta").textContent = `${data.players.length} players · ${clock(data.durationMs)} recorded · Round ${round}`;
      $("map-link").href = "map.html?map=" + encodeURIComponent(data.map);
      $("timeline").max = String(data.durationMs); $("zoom").value = "1"; canvas.style.width = "100%";
      $("viewer").hidden = false;
      const url = new URL(location.href); url.searchParams.set("match", match); url.searchParams.set("round", String(round)); history.replaceState(null, "", url);
      time = 0; selectPlayer(""); seek(0);
      say(`Ready · ${match}, round ${round}. Select a player, choose a life, and press Play.`);
    } catch (error) { if (version === loadVersion && error.name !== "AbortError") say(error.message, true); }
    finally { if (version === loadVersion) $("load").disabled = false; }
  }
  $("load-form").addEventListener("submit", load);
  $("play").onclick = () => { if (!data) return; if (playing) return pause(); const life = currentLife(); if (time >= (life?.endMs ?? data.durationMs) || (life && time < life.startMs)) seek(life?.startMs || 0); playing = true; lastTick = performance.now(); $("play").textContent = "Pause"; $("play").setAttribute("aria-label", "Pause round"); };
  $("back").onclick = () => seek(time - 5000); $("forward").onclick = () => seek(time + 5000);
  $("timeline").oninput = () => { pause(); seek(Number($("timeline").value)); };
  $("life").onchange = lifeChange; $("previous-life").onclick = () => stepLife(-1); $("next-life").onclick = () => stepLife(1);
  $("zoom").onchange = () => { canvas.style.width = Number($("zoom").value) * 100 + "%"; dirty = true; };
  $("effects").onchange = $("trail").onchange = () => { dirty = true; };
  window.addEventListener("resize", () => { dirty = true; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  function tick(now) {
    const elapsed = Math.min(250, now - lastTick); lastTick = now;
    if (playing && data) {
      time = Math.min(currentLife()?.endMs ?? data.durationMs, time + elapsed * Number($("speed").value));
      if (time >= (currentLife()?.endMs ?? data.durationMs)) pause();
      dirty = true;
    }
    if (dirty) { draw(); dirty = false; if (now - lastUI >= 200 || !playing) { updateUI(); lastUI = now; } }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick); void load();
})();
