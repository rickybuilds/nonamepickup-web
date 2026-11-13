(() => {
  "use strict";
  function mount(root, options = {}) {
  const lifecycle = new AbortController();
  let destroyed = false, animationFrame = 0;
  const $ = id => root.querySelector(`[id="${id}"]`);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  const params = new URLSearchParams(location.search);
  $("match").value = options.matchId || params.get("match") || "HDPVET";
  $("round").value = String(options.round || params.get("round")) === "2" ? "2" : "1";
  const classNames = ["Unknown", "Scout", "Sniper", "Soldier", "Demoman", "Medic", "Heavy", "Pyro", "Spy", "Engineer", "Civilian"];
  const maxHealth = [100, 75, 90, 100, 90, 90, 100, 100, 90, 80, 50];
  const icons = new Map();
  const flagIcons = new Map();
  const flagTeams = new Map();
  for (const [id, color] of [[1, "blue"], [2, "red"]]) {
    const image = new Image(); image.src = `/assets/images/icons/webp/${color}flag.webp`;
    image.onload = () => { dirty = true; }; flagIcons.set(id, image);
  }
  function flagTeam(flag) {
    return flagTeams.get(flag.id) ?? null;
  }
  function resolveFlagTeams() {
    flagTeams.clear();
    const flags = data.flags || [], evidence = new Map();
    for (const flag of flags) {
      const explicit = flag.team === 1 || flag.team === 2 ? flag.team : /blue/i.test(flag.name) ? 1 : /red/i.test(flag.name) ? 2 : null;
      if (explicit) flagTeams.set(flag.id, explicit);
      // Objective IDs identify entities, not teams. In a two-flag CTF round,
      // an enemy carrying a flag supplies ownership evidence for that flag.
      const owners = new Set(); evidence.set(flag.id, owners);
      if (explicit || flags.length !== 2) continue;
      for (let i = 0; i < flag.frames.length; i += 6) {
        if (flag.frames[i + 4] !== 1 || flag.frames[i + 5] <= 0) continue;
        const player = byId.get(flag.frames[i + 5]), frame = player && frameAt(player, flag.frames[i]);
        if (frame?.[5] === 1 && (frame[9] === 1 || frame[9] === 2)) owners.add(3 - frame[9]);
      }
      if (owners.size === 1) flagTeams.set(flag.id, owners.values().next().value);
    }
    if (flags.length === 2 && flagTeams.size === 1) {
      const unknown = flags.find(flag => !flagTeams.has(flag.id));
      // Only pair a genuinely unobserved flag; conflicting evidence stays unknown.
      if (evidence.get(unknown.id).size === 0) flagTeams.set(unknown.id, 3 - flagTeams.values().next().value);
    }
  }
  function flagLabel(flag) {
    const team = flagTeam(flag);
    return team ? (team === 1 ? "Blue flag" : "Red flag") : `${flag.name} (color unknown)`;
  }
  for (let id = 1; id <= 9; id++) {
    const image = new Image(); image.src = `/assets/images/classes/${classNames[id]}old_tfc.png`;
    image.onload = () => { dirty = true; }; icons.set(id, image);
  }
  let data = null, background = null, project = null, selected = "", time = 0, playing = false, dirty = true;
  let lastTick = performance.now(), lastUI = 0, loadVersion = 0, eventsSignature = "";
  const viewport = $("viewport");
  const mapSpace = $("map-space");
  let viewScale = 1, drag = null;
  function sizeSurface() {
    const width = Math.min(viewport.clientWidth, mapSpace.clientWidth);
    const height = Math.min(viewport.clientHeight, mapSpace.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = width + "px"; canvas.style.height = height + "px";
    const backingWidth = Math.max(1, Math.round(width * dpr)), backingHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
  }
  function setZoom(next, clientX, clientY) {
    if (!data || $("viewer").hidden) return;
    const rect = viewport.getBoundingClientRect(), before = mapSpace.getBoundingClientRect();
    const anchorX = clientX ?? rect.left + viewport.clientWidth / 2;
    const anchorY = clientY ?? rect.top + viewport.clientHeight / 2;
    const fractionX = (anchorX - before.left) / before.width;
    const fractionY = (anchorY - before.top) / before.height;
    viewScale = Math.max(1, Math.min(8, next));
    const fitWidth = Math.min(viewport.clientWidth, viewport.clientHeight * background.width / background.height);
    mapSpace.style.width = fitWidth * viewScale + "px";
    mapSpace.style.height = fitWidth * viewScale * background.height / background.width + "px";
    sizeSurface();
    const after = mapSpace.getBoundingClientRect();
    viewport.scrollLeft += after.left + fractionX * after.width - anchorX;
    viewport.scrollTop += after.top + fractionY * after.height - anchorY;
    $("zoom-level").textContent = Math.round(viewScale * 100) + "%";
    dirty = true;
  }
  function fitViewport(reset = false) {
    if (!data || $("viewer").hidden) return;
    viewport.style.height = Math.min(viewport.clientWidth * background.height / background.width, innerHeight * .72) + "px";
    setZoom(reset ? 1 : viewScale);
    if (reset) { viewport.scrollLeft = 0; viewport.scrollTop = 0; }
  }
  viewport.addEventListener("wheel", event => {
    if (!data || event.ctrlKey) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    setZoom(viewScale * Math.exp(-delta * .0015), event.clientX, event.clientY);
  }, { passive: false });
  viewport.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || event.button !== 0 || viewScale <= 1) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId); viewport.classList.add("is-dragging"); event.preventDefault(); viewport.focus({ preventScroll: true });
  });
  viewport.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x); viewport.scrollTop = drag.top - (event.clientY - drag.y);
  });
  viewport.addEventListener("scroll", () => { dirty = true; }, { passive: true });
  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null; viewport.classList.remove("is-dragging");
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) viewport.addEventListener(type, endDrag);
  viewport.addEventListener("keydown", event => {
    if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "0") fitViewport(true); else setZoom(viewScale * (event.key === "-" ? 1 / 1.35 : 1.35));
    }
  });
  const byId = new Map(), rosterStates = new Map();
  const clock = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"); };
  const playerName = id => byId.get(id)?.name || "World";
  function say(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
  async function json(url, signal) {
    const response = await fetch(url, { signal, cache: "no-cache" });
    if (!response.ok) {
      let code = ""; try { code = (await response.json()).error; } catch {}
      if (code === "tactical_not_prepared") throw new Error("This round has not been prepared yet. The recording is still being processed. Try reloading this round shortly.");
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
  function flagAt(flag) {
    const frames = flag.frames;
    let low = 0, high = frames.length / 6;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (frames[middle * 6] <= time) low = middle + 1; else high = middle; }
    if (!low) return null;
    const index = (low - 1) * 6;
    if (time - frames[index] > Math.max(2000, data.sampleIntervalMs * 4) || frames[index + 4] < 0) return null;
    const state = frames[index + 4], carrier = frames[index + 5];
    if (carrier > 0) {
      const player = byId.get(carrier), frame = player && frameAt(player, time);
      return frame?.[5] === 1 ? { x: frame[1], y: frame[2], state, carrier } : null;
    }
    // State 1 without a carrier can be a hidden objective, not a flag at base.
    if (state === 1) return null;
    let x = frames[index + 1], y = frames[index + 2];
    const next = index + 6;
    if (next < frames.length && frames[next + 4] === state && frames[next + 5] === 0 &&
        frames[next] > frames[index] && frames[next] - frames[index] <= 2000) {
      const fraction = (time - frames[index]) / (frames[next] - frames[index]);
      x += (frames[next + 1] - x) * fraction; y += (frames[next + 2] - y) * fraction;
    }
    return { x, y, state, carrier: 0 };
  }
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
    $("flag-status").textContent = data.flags?.length ? data.flags.map(flag => {
      const frame = flagAt(flag);
      return flagLabel(flag) + ": " + (!frame ? "not visible in this sample" : frame.carrier ? "carried by " + playerName(frame.carrier) : frame.state === 2 ? "dropped" : "at base");
    }).join(" · ") : "No identified flag tracks in this recording.";
    const life = currentLife(), player = byId.get(Number(selected));
    $("trail-info").textContent = selected ? "Trail: selected player’s life so far; retained after death until the next life. Play or scrub forward to reveal it."
      : "Trails: everyone’s last 5 seconds. Select a player for their full life path.";
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
    sizeSurface();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = mapSpace.clientWidth / background.width, dpr = window.devicePixelRatio || 1;
    const sceneRect = mapSpace.getBoundingClientRect(), surfaceRect = canvas.getBoundingClientRect();
    // Draw only the visible map at native screen resolution. Enlarging the
    // scrollable scene must never enlarge an already-rasterized text overlay.
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale,
      dpr * (sceneRect.left - surfaceRect.left), dpr * (sceneRect.top - surfaceRect.top));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(background, 0, 0);
    const unit = 1 / scale, size = 25 * unit;
    const focused = byId.get(Number(selected));
    if ($("trail").checked) for (const player of focused ? [focused] : data.players) {
      const life = (focused && currentLife()) || player.lives.findLast(item => time >= item.startMs);
      if (life && (focused || time - life.endMs <= 5000)) {
        const start = focused ? life.startMs : Math.max(life.startMs, time - 5000);
        const frame = frameAt(player, Math.min(time, life.endMs));
        ctx.beginPath(); ctx.strokeStyle = focused ? "#f9d076" : frame?.[9] === 1 ? "#60a5ff" : "#ff7886";
        ctx.lineWidth = (focused ? 3 : 2) * unit;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        let previous = null;
        for (let index = 0; index < player.frames.length; index += data.stride) {
          const frames = player.frames, t = frames[index];
          if (t < start || t > Math.min(time, life.endMs) || frames[index + 5] !== 1) continue;
          const point = project(frames[index + 1], frames[index + 2]);
          if (!previous || t - previous.time > 2000 || Math.hypot(point[0] - previous.x, point[1] - previous.y) > background.width / 4) ctx.moveTo(...point);
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
    if ($("flags").checked) for (const flag of data.flags || []) {
      const frame = flagAt(flag);
      if (!frame) continue;
      const point = project(frame.x, frame.y);
      const x = point[0] + (frame.carrier ? size * .7 : 0), y = point[1] - (frame.carrier ? size * .4 : 0);
      const height = 24 * unit, width = 16 * unit;
      const team = flagTeam(flag), icon = flagIcons.get(team || 1), radius = 16 * unit;
      const flagColor = team === 1 ? "#60a5ff" : team === 2 ? "#ff7886" : "#b8c6d4";
      ctx.globalAlpha = 1;
      if (icon?.complete && icon.naturalWidth) {
        // The supplied art has a background; crop it into a flag badge so the
        // square image does not obscure the overview around the marker.
        ctx.save(); ctx.beginPath(); ctx.arc(x, y - radius, radius, 0, Math.PI * 2); ctx.clip();
        if (!team) ctx.filter = "grayscale(1)";
        ctx.drawImage(icon, x - radius, y - radius * 2, radius * 2, radius * 2); ctx.restore();
        ctx.strokeStyle = flagColor; ctx.lineWidth = 2 * unit;
        ctx.beginPath(); ctx.arc(x, y - radius, radius, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.lineWidth = 2 * unit; ctx.strokeStyle = "#fff3ce";
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - height); ctx.stroke();
        ctx.fillStyle = flagColor;
        ctx.beginPath(); ctx.moveTo(x, y - height); ctx.lineTo(x + width, y - height + 6 * unit); ctx.lineTo(x, y - height + 12 * unit); ctx.closePath(); ctx.fill();
      }
      if (!frame.carrier) {
        ctx.textAlign = "center"; ctx.font = `600 ${11 * unit}px Inter, sans-serif`; ctx.lineWidth = 3 * unit; ctx.fillStyle = "#fff3ce"; ctx.strokeStyle = "#10151c";
        const label = flagLabel(flag) + (frame.state === 2 ? " · dropped" : " · base");
        ctx.strokeText(label, x, y + 13 * unit); ctx.fillText(label, x, y + 13 * unit);
      }
    }
  }
  let controller;
  async function load(event) {
    event?.preventDefault();
    const match = $("match").value.trim(), round = Number($("round").value);
    if (!/^[a-z0-9_-]{1,64}$/i.test(match)) return say("Enter a valid match ID.", true);
    controller?.abort(); controller = new AbortController(); const version = ++loadVersion;
    pause(); $("viewer").hidden = true; $("load").disabled = true; say("Loading round playback…");
    try {
      const next = await json(`/api/pickup-replays/viewer/${encodeURIComponent(match)}/${round}/tactical`, controller.signal);
      if (next.version !== 2 || next.stride !== 10 || !Array.isArray(next.players) || !next.players.length) throw new Error("Playback is unavailable for this recording. Try reloading the round later.");
      const view = await overview(next.map, controller.signal);
      if (destroyed || version !== loadVersion) return;
      data = next; background = view.background; project = view.project;
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
      resolveFlagTeams();
      $("map-name").textContent = data.map; $("round-meta").textContent = `${data.players.length} players · ${clock(data.durationMs)} recorded · Round ${round}`;
      if ($("map-link")) $("map-link").href = "map.html?map=" + encodeURIComponent(data.map);
      $("timeline").max = String(data.durationMs); mapSpace.style.width = "100%"; mapSpace.style.height = "1px";
      $("viewer").hidden = false;
      fitViewport(true);
      if (options.updateUrl !== false) {
        const url = new URL(location.href); url.searchParams.set("match", match); url.searchParams.set("round", String(round)); history.replaceState(null, "", url);
      }
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
  $("reset-view").onclick = () => fitViewport(true);
  $("effects").onchange = $("trail").onchange = $("flags").onchange = () => { dirty = true; };
  window.addEventListener("resize", () => { fitViewport(); dirty = true; }, { signal: lifecycle.signal });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); }, { signal: lifecycle.signal });
  const resizeObserver = new ResizeObserver(() => { fitViewport(); dirty = true; });
  resizeObserver.observe(root === document ? document.body : root);
  function tick(now) {
    if (destroyed) return;
    const elapsed = Math.min(250, now - lastTick); lastTick = now;
    if (playing && data) {
      time = Math.min(currentLife()?.endMs ?? data.durationMs, time + elapsed * Number($("speed").value));
      if (time >= (currentLife()?.endMs ?? data.durationMs)) pause();
      dirty = true;
    }
    if (dirty) { draw(); dirty = false; if (now - lastUI >= 200 || !playing) { updateUI(); lastUI = now; } }
    animationFrame = requestAnimationFrame(tick);
  }
  animationFrame = requestAnimationFrame(tick); void load();
  return { destroy() {
    destroyed = true; loadVersion++; playing = false;
    controller?.abort(); lifecycle.abort(); resizeObserver.disconnect();
    cancelAnimationFrame(animationFrame); data = null; background = null;
    byId.clear(); rosterStates.clear();
  }};
  }
  window.nnRoundPlayback = { mount, markup: () => `
<div class="map-vision-player"><form id="load-form" class="playback-reload"><input id="match" type="hidden"><input id="round" type="hidden"><span id="round-meta"></span><button id="load" type="submit">Reload round</button></form>
    <p id="status" role="status">Loading round playback…</p>
    <section id="viewer" hidden aria-label="Tactical round playback">
      <div class="playback-layout">
        <div class="stage">
          <div class="stage-tools"><strong id="map-name"></strong><button id="reset-view" type="button">Reset view</button><span id="zoom-level">100%</span><label><input id="effects" type="checkbox" checked> Conc endpoints</label><label><input id="trail" type="checkbox" checked> Life trail</label></div>
          <label><input id="flags" type="checkbox" checked> Show flags</label>
          <p id="flag-status" class="note" aria-label="Recorded flag states" title="Colors use recorded flag metadata or carrier evidence in two-flag CTF rounds. Unknown colors stay neutral."></p>
          <p class="map-hint">Scroll to zoom · drag to move · keyboard + / − to zoom, 0 to reset</p>
          <div id="viewport" tabindex="0" aria-label="Map. Scroll to zoom, drag to move. Keyboard plus and minus zoom; zero resets; arrows pan."><div id="map-space"><canvas id="map" role="img" aria-label="Recorded player positions, health, movement trails, and flags"></canvas></div></div>
          <div class="transport"><button id="back" aria-label="Back five seconds">−5s</button><button id="play" aria-label="Play round">Play</button><button id="forward" aria-label="Forward five seconds">+5s</button><output id="clock">0:00 / 0:00</output><label>Speed<select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label></div>
          <input id="timeline" aria-label="Round playback position" type="range" min="0" max="1" step="50" value="0">
          <p id="trail-info" class="note">Trails: everyone’s last 5 seconds. Select a player for their full life path.</p>
          <div class="legend"><span><i class="blue"></i>In-game blue</span><span><i class="red"></i>In-game red</span><span>× Death</span><span><i class="conc"></i>Conc endpoint effect</span></div>
        </div>
        <aside>
          <section><h2>Follow a player</h2><div id="roster" class="roster"></div></section>
          <section><h2>Spawn → death</h2><label class="life-label">Recorded life<select id="life"><option value="">Full round</option></select></label><p id="life-detail">Choose a player to inspect their lives.</p><div class="life-nav"><button id="previous-life">Previous life</button><button id="next-life">Next life</button></div></section>
          <section><h2>Recent events</h2><div id="events" aria-label="Recent kill and death events"></div></section>
        </aside>
      </div>
      <details class="playback-notes"><summary>About recorded data</summary><p class="note">Movement and health are sampled. Colors follow in-game teams. Conc rings show recorded projectile endpoints, not confirmed detonations. Life starts are first observed alive samples.</p></details>
    </section>
</div>
` };
  if (document.querySelector("#load-form")) mount(document);
})();
