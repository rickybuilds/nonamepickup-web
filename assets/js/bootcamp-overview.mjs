export function projectWorldPoint(point, map) {
  const matrix = map?.transform;
  const values = [point?.x, point?.y, map?.width, map?.height, ...(Array.isArray(matrix) ? matrix : [])].map(Number);
  if (values.length !== 10 || values.some(value => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) return null;
  const [x, y, , , a, b, c, d, e, f] = values;
  return { x: a * x + b * y + c, y: d * x + e * y + f };
}

export function fitOverviewView(imageWidth, imageHeight, viewportWidth, viewportHeight) {
  const values = [imageWidth, imageHeight, viewportWidth, viewportHeight].map(Number);
  if (values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  const [width, height, viewWidth, viewHeight] = values;
  const scale = Math.min(viewWidth / width, viewHeight / height);
  return {
    scale,
    offsetX: (viewWidth - width * scale) / 2,
    offsetY: (viewHeight - height * scale) / 2
  };
}

export function projectToCanvas(point, view) {
  if (![point?.x, point?.y, view?.scale, view?.offsetX, view?.offsetY].every(value => Number.isFinite(Number(value))) || Number(view.scale) <= 0) return null;
  return {
    x: Number(point.x) * Number(view.scale) + Number(view.offsetX),
    y: Number(point.y) * Number(view.scale) + Number(view.offsetY)
  };
}

export function speedSeries(frames) {
  if (!Array.isArray(frames)) return [];
  const result = [];
  for (let index = 1; index < frames.length && result.length < 3600; index += 1) {
    const a = frames[index - 1], b = frames[index];
    const values = [a?.t, a?.x, a?.y, a?.z, b?.t, b?.x, b?.y, b?.z].map(Number);
    if (values.some(value => !Number.isFinite(value))) continue;
    const [at, ax, ay, az, bt, bx, by, bz] = values;
    const dt = bt - at;
    if (dt <= 0) continue;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    result.push({ t: (at + bt) / 2, speed: Math.hypot(dx, dy, dz) / dt });
  }
  return result;
}

export function timelineTimeAtPoint(clientX, rect, duration) {
  const values = [clientX, rect?.left, rect?.width, duration].map(Number);
  if (values.some(value => !Number.isFinite(value)) || values[2] <= 0 || values[3] < 0) return null;
  const [x, left, width, total] = values;
  const plotWidth = Math.max(1, width - 44);
  const fraction = Math.min(1, Math.max(0, (x - left - 34) / plotWidth));
  return fraction * total;
}

const REPLAY_EVENT_TITLES = new Map([
  [1, "Jump"], [2, "Conc primed"], [3, "Conc thrown"], [4, "Conc exploded"],
  [5, "Weapon fired"], [6, "Pipe detonated"], [7, "Flag touched"], [9, "Finish"], [10, "Weapon changed"]
]);

export function eventTitle(event) {
  const code = Number(event?.code);
  if (!Number.isSafeInteger(code)) return "Replay event";
  if (code === 8) {
    const checkpoint = Number(event?.a);
    return Number.isFinite(checkpoint) ? `Checkpoint ${Math.max(1, Math.trunc(checkpoint) + 1)}` : "Checkpoint";
  }
  return REPLAY_EVENT_TITLES.get(code) || `Event ${code}`;
}

function finiteFrames(frames) {
  return Array.isArray(frames) ? frames.filter(frame => [frame?.t, frame?.x, frame?.y, frame?.z].every(value => Number.isFinite(Number(value)))) : [];
}

function fitBounds(points, width, height) {
  if (!points.length) return null;
  const xs = points.map(point => Number(point.x)), ys = points.map(point => Number(point.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY), pad = 24;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  return { minX, maxY, scale, offsetX: (width - spanX * scale) / 2, offsetY: (height - spanY * scale) / 2 };
}

function fallbackPoint(point, bounds) {
  if (!bounds) return null;
  return { x: bounds.offsetX + (Number(point.x) - bounds.minX) * bounds.scale,
    y: bounds.offsetY + (bounds.maxY - Number(point.y)) * bounds.scale };
}

export class BootcampReplayOverview {
  constructor({ mapCanvas, speedCanvas, status, onSeek }) {
    this.mapCanvas = mapCanvas;
    this.speedCanvas = speedCanvas;
    this.status = status;
    this.onSeek = onSeek;
    this.manifest = null;
    this.mapName = "";
    this.image = null;
    this.imageReady = false;
    this.imageUrl = "";
    this.eventKey = "";
    this.lastSnapshot = null;
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.render(this.lastSnapshot)) : null;
    for (const canvas of [mapCanvas, speedCanvas]) this.resizeObserver?.observe(canvas);
    speedCanvas?.addEventListener("click", event => {
      if (!this.lastSnapshot || typeof this.onSeek !== "function") return;
      const rect = speedCanvas.getBoundingClientRect();
      const time = timelineTimeAtPoint(event.clientX, rect, this.lastSnapshot.duration);
      if (time != null) this.onSeek(time);
    });
    speedCanvas?.addEventListener("keydown", event => {
      if (!this.lastSnapshot || typeof this.onSeek !== "function") return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        this.onSeek(this.lastSnapshot.time + (event.key === "ArrowRight" ? 0.1 : -0.1));
      }
    });
    this.loadManifest();
  }

  async loadManifest() {
    try {
      const response = await fetch("/assets/data/bootcamp-overviews.json", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Overview metadata unavailable (${response.status})`);
      this.manifest = await response.json();
      if (this.lastSnapshot) this.render(this.lastSnapshot);
    } catch (error) {
      if (this.status) this.status.textContent = `Map overview metadata unavailable: ${error.message}`;
    }
  }

  setMap(mapName) {
    const normalized = String(mapName || "").toLowerCase();
    const config = this.manifest?.maps?.[normalized];
    if (this.mapName === normalized && this.imageUrl === String(config?.image || "")) return;
    this.mapName = normalized;
    this.image = null;
    this.imageReady = false;
    if (!config?.image) {
      this.imageUrl = "";
      if (this.status) this.status.textContent = `No map overview is configured for ${this.mapName || "this replay"}; showing the route on a coordinate grid.`;
      return;
    }
    this.imageUrl = config.image;
    const image = new Image();
    image.onload = () => { this.image = image; this.imageReady = true; this.render(this.lastSnapshot); };
    image.onerror = () => { if (this.status) this.status.textContent = `Overview image for ${this.mapName} could not be loaded; showing the route on a coordinate grid.`; };
    image.src = this.imageUrl;
  }

  render(snapshot) {
    if (!snapshot?.replay || !this.mapCanvas || !this.speedCanvas) return;
    this.lastSnapshot = snapshot;
    this.setMap(snapshot.replay.map);
    this.drawMap(snapshot);
    this.drawTimeline(snapshot);
  }

  canvasContext(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  drawMap(snapshot) {
    const { ctx, width, height } = this.canvasContext(this.mapCanvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b1118";
    ctx.fillRect(0, 0, width, height);
    const config = this.manifest?.maps?.[this.mapName];
    const hasImage = this.imageReady && this.image;
    const imageWidth = hasImage ? this.image.naturalWidth : width;
    const imageHeight = hasImage ? this.image.naturalHeight : height;
    const view = fitOverviewView(imageWidth, imageHeight, width, height);
    if (hasImage && view) ctx.drawImage(this.image, view.offsetX, view.offsetY, imageWidth * view.scale, imageHeight * view.scale);
    if (!hasImage) {
      ctx.strokeStyle = "rgba(137,160,182,.12)";
      ctx.lineWidth = 1;
      for (let x = 24; x < width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = 24; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    }
    const primary = finiteFrames(snapshot.replay.frames);
    const secondary = finiteFrames(snapshot.comparison?.frames);
    const all = [...primary, ...secondary];
    const fallback = !hasImage ? fitBounds(all, width, height) : null;
    const point = frame => {
      if (!frame) return null;
      if (hasImage && config && view) {
        const projected = projectWorldPoint(frame, config);
        return projected && projectToCanvas(projected, view);
      }
      return fallbackPoint(frame, fallback);
    };
    const drawPath = (frames, color, current) => {
      if (!frames.length) return;
      ctx.beginPath();
      let started = false;
      for (const frame of frames) {
        const p = point(frame);
        if (!p) continue;
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const marker = point(current);
      if (marker) {
        ctx.beginPath(); ctx.arc(marker.x, marker.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#f4f7fb"; ctx.stroke();
      }
    };
    drawPath(primary, "#53c5ff", snapshot.primaryFrame);
    if (snapshot.comparison) drawPath(secondary, "#ff76bb", snapshot.comparisonFrame);
    if (this.status && hasImage) {
      const message = `Showing ${this.mapName} overview. ${snapshot.comparison ? "Both compatible runs are overlaid." : "Add a compatible run to compare paths."}`;
      if (this.status.textContent !== message) this.status.textContent = message;
    }
  }

  drawTimeline(snapshot) {
    const { ctx, width, height } = this.canvasContext(this.speedCanvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#101922"; ctx.fillRect(0, 0, width, height);
    const left = 34, right = width - 10, top = 8, bottom = height - 19;
    const plotWidth = Math.max(1, right - left), plotHeight = Math.max(1, bottom - top);
    const duration = Math.max(0.001, Number(snapshot.duration) || 0.001);
    const runs = [{ replay: snapshot.replay, color: "#53c5ff" }];
    if (snapshot.comparison) runs.push({ replay: snapshot.comparison, color: "#ff76bb" });
    const starts = [Number(snapshot.timelineStart) || 0, Number(snapshot.comparisonStart) || 0];
    const seriesByRun = runs.map((run, index) => speedSeries(run.replay.frames)
      .map(point => ({ ...point, t: point.t - starts[index], color: run.color }))
      .filter(point => point.t >= 0 && point.t <= duration));
    const series = seriesByRun.flat();
    const maxSpeed = Math.max(1, ...series.map(point => point.speed));
    ctx.strokeStyle = "rgba(150,174,195,.15)"; ctx.fillStyle = "#91a2b3"; ctx.font = "10px Inter, sans-serif";
    for (let index = 0; index <= 4; index += 1) {
      const y = top + plotHeight * index / 4;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      if (index === 0) ctx.fillText(`${Math.round(maxSpeed)} HU/s`, 3, y + 3);
    }
    for (const [index, run] of runs.entries()) {
      const points = seriesByRun[index];
      if (points.length < 2) continue;
      ctx.beginPath();
      points.forEach((item, index) => {
        const x = left + Math.min(1, item.t / duration) * plotWidth;
        const y = bottom - Math.min(1, item.speed / maxSpeed) * plotHeight;
        index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = run.color; ctx.lineWidth = 1.6; ctx.stroke();
    }
    const drawEvents = (replay, origin) => {
      for (const event of replay.events || []) {
        const elapsed = Number(event.t) - origin;
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > duration) continue;
        const x = left + elapsed / duration * plotWidth;
        ctx.fillStyle = event.code === 8 ? "#ffc66d" : "#d7e2ec";
        ctx.fillRect(x - 1, top, 2, 7);
        ctx.fillStyle = "#a9b9c8";
        ctx.fillRect(x - 1, bottom + 8, 2, 4);
      }
    };
    drawEvents(snapshot.replay, starts[0]);
    if (snapshot.comparison) drawEvents(snapshot.comparison, starts[1]);
    const currentX = left + Math.min(1, Math.max(0, snapshot.time / duration)) * plotWidth;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(currentX, top); ctx.lineTo(currentX, bottom + 8); ctx.stroke();
    ctx.fillStyle = "#91a2b3"; ctx.fillText("0:00", left, height - 4); ctx.textAlign = "right"; ctx.fillText(`${duration.toFixed(2)}s`, right, height - 4); ctx.textAlign = "left";
    this.renderEventList(snapshot, starts);
  }

  renderEventList(snapshot, starts) {
    const list = document.getElementById("bootcamp-replay-events");
    if (!list) return;
    const key = [snapshot.replay.runId, snapshot.comparison?.runId, snapshot.replay.events?.length, snapshot.comparison?.events?.length].join(":");
    if (key === this.eventKey) return;
    this.eventKey = key;
    list.replaceChildren();
    const entries = [
      ...(snapshot.replay.events || []).map(event => ({ event, origin: starts[0], color: "primary" })),
      ...(snapshot.comparison?.events || []).map(event => ({ event, origin: starts[1], color: "comparison" }))
    ].filter(row => Number.isFinite(Number(row.event?.t))).sort((a, b) => Number(a.event.t) - Number(b.event.t)).slice(0, 40);
    const fragment = document.createDocumentFragment();
    for (const { event, origin, color } of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `bootcamp-overview-event ${color}`;
      button.textContent = `${eventTitle(event)} · ${(Number(event.t) - origin).toFixed(2)}s`;
      button.addEventListener("click", () => this.onSeek?.(Number(event.t) - origin));
      fragment.appendChild(button);
    }
    if (entries.length) list.appendChild(fragment);
    else {
      const empty = document.createElement("span");
      empty.className = "bootcamp-overview-events-empty";
      empty.textContent = "No recorded route events.";
      list.appendChild(empty);
    }
  }
}
