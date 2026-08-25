import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import {
  ReplayProjectileVisuals,
  parseReplaySprite,
  replayProjectileDefinition
} from "./replay-projectile-visuals.js?v=20260805schema6sprites1";
import {
  configureReplayMapMaterial,
  isReplayMapGroundMaterial
} from "./replay-map-materials.js?v=20260821lightfixtures6";

const $ = id => document.getElementById(id);
const PAGE_QUERY = new URLSearchParams(location.search);
const LIVE_PAGE = document.body?.classList.contains("pickup-live-viewer-page") || false;
const LIVE_SERVER_ID = PAGE_QUERY.get("server") || "";
const LIVE_REAL = LIVE_PAGE && /^[A-Za-z0-9_.-]{1,64}$/.test(LIVE_SERVER_ID);
const LIVE_SIMULATION = LIVE_PAGE && !LIVE_SERVER_ID;
const LIVE_MODE = LIVE_REAL || LIVE_SIMULATION;
const REQUESTED_CLIP_START = Number(PAGE_QUERY.get("clipStart"));
const REQUESTED_CLIP_END = Number(PAGE_QUERY.get("clipEnd"));
const HAS_REQUESTED_CLIP = PAGE_QUERY.has("clipStart") && PAGE_QUERY.has("clipEnd") &&
  Number.isFinite(REQUESTED_CLIP_START) &&
  Number.isFinite(REQUESTED_CLIP_END) && REQUESTED_CLIP_END > REQUESTED_CLIP_START;
const EXPLICIT_DIRECT_EXPORT = /^(1|true|yes)$/i.test(
  PAGE_QUERY.get("clipExport") || PAGE_QUERY.get("headless") || ""
);
// The production renderer launches Chrome directly with --headless=new, not
// through WebDriver, so navigator.webdriver is false in that exact path.
const HEADLESS_CHROME = /\bHeadlessChrome\//i.test(navigator.userAgent);
const DIRECT_CLIP_EXPORT = !LIVE_MODE && HAS_REQUESTED_CLIP &&
  (EXPLICIT_DIRECT_EXPORT || navigator.webdriver === true || HEADLESS_CHROME);
const FAST_DIRECT_EXPORT = DIRECT_CLIP_EXPORT && /^(1|true|yes)$/i.test(
  PAGE_QUERY.get("clipFast") || ""
);
const DIRECT_EXPORT_FPS = Math.min(60, Math.max(1, Number(PAGE_QUERY.get("clipFps")) || 10));
const REQUESTED_EXPORT_WIDTH = Number(PAGE_QUERY.get("clipWidth"));
const REQUESTED_EXPORT_HEIGHT = Number(PAGE_QUERY.get("clipHeight"));
const DIRECT_EXPORT_WIDTH = Number.isFinite(REQUESTED_EXPORT_WIDTH) && REQUESTED_EXPORT_WIDTH > 0
  ? Math.min(1920, Math.max(320, REQUESTED_EXPORT_WIDTH)) : 0;
const DIRECT_EXPORT_HEIGHT = Number.isFinite(REQUESTED_EXPORT_HEIGHT) && REQUESTED_EXPORT_HEIGHT > 0
  ? Math.min(1080, Math.max(240, REQUESTED_EXPORT_HEIGHT)) : 0;
const RAW_FRAME_STREAM_PORT = Number(PAGE_QUERY.get("clipStreamPort"));
const RAW_FRAME_STREAM_TOKEN = PAGE_QUERY.get("clipStreamToken") || "";
const RAW_FRAME_STREAM = FAST_DIRECT_EXPORT &&
  Number.isInteger(RAW_FRAME_STREAM_PORT) && RAW_FRAME_STREAM_PORT > 0 &&
  RAW_FRAME_STREAM_PORT <= 65535 && /^[a-f0-9]{32,128}$/i.test(RAW_FRAME_STREAM_TOKEN);
const WEBM_MUXER_URL = "https://cdn.jsdelivr.net/npm/webm-muxer@5.1.4/build/webm-muxer.mjs";
const LIVE_BUFFER_SECONDS = 120;
const LIVE_TARGET_LATENCY_SECONDS = LIVE_REAL ? 1.25 : 0.35;
const CLIP_MIN_SECONDS = 1;
const CLIP_MAX_SECONDS = 60;
const TEAM = {
  1: { name: "Blue", css: "#4da3ff", color: 0x4da3ff },
  2: { name: "Red", css: "#ff5d6c", color: 0xff5d6c },
  3: { name: "Yellow", css: "#facc15", color: 0xfacc15 },
  4: { name: "Green", css: "#4ade80", color: 0x4ade80 }
};
const CLASSES = ["Civilian", "Scout", "Sniper", "Soldier", "Demoman", "Medic", "HWGuy", "Pyro", "Spy", "Engineer", "Civilian"];
const CLASS_MODELS = [
  ["civilian", "civilian"], ["scout", "scout"], ["sniper", "sniper"], ["soldier", "soldier"],
  ["demo", "demo"], ["medic", "medic"], ["hvyweapon", "hvyweapon"], ["pyro", "pyro"],
  ["spy", "spy"], ["engineer", "engineer"], ["civilian", "civilian"]
];
const CAMERA_MODES = ["pov", "chase", "overview", "free"];
const CORPSE_LIFETIME_SECONDS = 15;
const PLAYER_STANDING_VISUAL_HEIGHT = 72;
const PLAYER_CROUCH_VISUAL_HEIGHT = 40;
// One complete phase is a left + right step. TFC players cover roughly this
// distance during a natural run cycle; a shorter value makes their feet churn.
const PLAYER_STRIDE_LENGTH = 240;
const PLAYER_MOTION_RESPONSE = 12;
const PLAYER_AIR_HOLD_SECONDS = 0.18;
const CARRIED_OBJECTIVE_BACK_OFFSET = 2;
const CARRIED_OBJECTIVE_STAND_HEIGHT = -28;
const CARRIED_OBJECTIVE_CROUCH_HEIGHT = -28;
const IN_ATTACK = 1;
const AC_ROUNDS_PER_SECOND = 12;
const AC_TRACER_RANGE = 900;
const BEAM_CONTROLLER_CLASSES = new Set([
  "func_door", "func_door_rotating", "func_plat", "func_platrot", "func_train", "func_tracktrain"
]);
const LIGHT_CONTROLLER_CLASSES = new Set([
  ...BEAM_CONTROLLER_CLASSES, "func_button", "func_rot_button"
]);
const MAX_ACTIVE_MAP_LIGHTS = 24;
const LIGHT_STYLE_PATTERNS = [
  "m", "mmnmmommommnonmmonqnmmo", "abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba",
  "mmmmmaaaaammmmmaaaaaabcdefgabcdefg", "mamamamamama", "jklmnopqrstuvwxyzyxwvutsrqponmlkj",
  "nmonqnmomnmomomno", "mmmaaaabcdefgmmmmaaaammmaamm", "mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa",
  "aaaaaaaazzzzzzzz", "mmamammmmammamamaaamammma", "abcdefghijklmnopqrrqponmlkjihgfedcba",
  "mmnnmmnnnmmnn"
];
const TFC_MODEL_ASSET_VERSION = "20260810medkit1";
const freeKeys = new Set();
const loader = new GLTFLoader();
const skyLoader = new THREE.CubeTextureLoader();
const projectileVisuals = new ReplayProjectileVisuals(loader);
const modelCache = new Map();
const recordedSpriteCache = new Map();
const RECORDED_SPRITE_PATHS = new Map([
  ["sprites/flare3.spr", "/assets/sprites/flare3.spr"],
  ["sprites/glow01.spr", "/assets/sprites/glow01.spr"],
  ["sprites/lgtning.spr", "/assets/sprites/lgtning.spr"],
  ["sprites/xflare1.spr", "/assets/sprites/xflare1.spr"]
]);
let replayGlowTexture = null;

const state = {
  metadata: null,
  roster: [],
  renderModels: new Map(),
  players: [],
  playerBySession: new Map(),
  projectileDefinitions: new Map(),
  projectiles: [],
  objectiveDefinitions: new Map(),
  objectives: [],
  modelCatalog: new Map(),
  buildableDefinitions: new Map(),
  buildables: [],
  brushDefinitions: new Map(),
  brushes: [],
  entityDefinitions: new Map(),
  entities: [],
  entityById: new Map(),
  entityCensus: [],
  entityMetadata: new Map(),
  sceneMetadataRows: [],
  sceneEvents: [],
  sceneDeathsBySession: new Map(),
  events: [],
  impacts: [],
  bloodEffects: [],
  corpses: [],
  selectedSession: null,
  origin: { x: 0, y: 0, z: 0 },
  playbackTime: 0,
  duration: 0,
  clipStart: 0,
  clipEnd: 0,
  clipTitle: "",
  clipLoop: false,
  clipEditorOpen: false,
  clipEditorOffset: { x: 0, y: 0 },
  clipExport: null,
  clipPreviewActive: false,
  clipPreviewComplete: false,
  directIdleFrameRendered: false,
  sceneReady: false,
  speed: 1,
  playing: true,
  liveReady: false,
  liveEdge: 0,
  liveEnded: false,
  followLive: LIVE_MODE,
  liveBufferSeconds: LIVE_BUFFER_SECONDS,
  liveSequence: 0,
  feedSpeed: 1,
  cameraMode: "pov",
  showProjectiles: true,
  showObjectives: true,
  lastTick: performance.now(),
  lastRosterSecond: -1,
  lastEventSecond: -1,
  killFeedEvents: [],
  lastKillFeedRenderKey: "",
  analysisEvents: [],
  visibleAnalysisEvents: [],
  analysisFilter: "all",
  analysisPlayer: "all",
  selectedAnalysisEvent: null,
  selectedAnalysisEventData: null,
  activeAnalysisEvent: "",
  analysisRenderKey: "",
  freeYaw: 0,
  freePitch: -0.25
};

const canvas = $("replay-canvas");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a0f);
scene.fog = new THREE.Fog(0x070a0f, 3000, 15000);
const camera = new THREE.PerspectiveCamera(90, 1, 1, 50000);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !FAST_DIRECT_EXPORT,
  preserveDrawingBuffer: !DIRECT_CLIP_EXPORT,
  powerPreference: FAST_DIRECT_EXPORT ? "low-power" : "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1.4;
const hemisphere = new THREE.HemisphereLight(0xcfe8ff, 0x131820, 2.2);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(1000, 1800, 700);
scene.add(sun);
const world = new THREE.Group();
scene.add(world);
const playerRoot = new THREE.Group();
const corpseRoot = new THREE.Group();
const projectileRoot = new THREE.Group();
const objectiveRoot = new THREE.Group();
const buildableRoot = new THREE.Group();
const entityRoot = new THREE.Group();
const impactRoot = new THREE.Group();
const hitscanRoot = new THREE.Group();
const bloodRoot = new THREE.Group();
const mapLightRoot = new THREE.Group();
world.add(
  playerRoot, corpseRoot, projectileRoot, objectiveRoot, buildableRoot, entityRoot,
  impactRoot, hitscanRoot, bloodRoot, mapLightRoot
);
let grid = null;
let mapModel = null;
let mapBeamGroup = null;
let mapLightDefinitions = [];
let mapRotators = [];
let mapTriggeredBrushes = [];
let liveWorker = null;
let liveEventSource = null;
let liveBatchQueue = Promise.resolve();
let liveQueuedSequence = 0;
const replayTimingOrigin = performance.now();
const replayTiming = {
  mode: DIRECT_CLIP_EXPORT ? "direct" : "interactive",
  direct: DIRECT_CLIP_EXPORT,
  requestedClipSeconds: HAS_REQUESTED_CLIP ? REQUESTED_CLIP_END - REQUESTED_CLIP_START : null,
  previewPasses: 0,
  exportPasses: 0,
  events: []
};
window.__replayClipTiming = replayTiming;
window.__replayClipReady = false;
document.documentElement.dataset.replayClipMode = replayTiming.mode;
const corpseGroundRay = new THREE.Raycaster();
const corpseDown = new THREE.Vector3(0, -1, 0);
const acRaycaster = new THREE.Raycaster();
const segmentUp = new THREE.Vector3(0, 1, 0);

function queryIdentity() {
  const query = new URLSearchParams(location.search);
  const matchId = query.get("matchId") || query.get("match") || "";
  const round = query.get("round") || "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(matchId)) throw new Error("Missing or invalid matchId.");
  if (!/^\d{1,4}$/.test(round) || Number(round) < 1) throw new Error("Missing or invalid round.");
  return { matchId, round: Number(round) };
}

function setStatus(message) {
  const element = $("replay-status");
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
}

function markReplayTiming(name, details = {}) {
  const memory = performance.memory?.usedJSHeapSize;
  const event = {
    name,
    atMs: Math.round((performance.now() - replayTimingOrigin) * 100) / 100,
    ...(Number.isFinite(memory) ? { jsHeapMb: Math.round(memory / 1048576 * 100) / 100 } : {}),
    ...details
  };
  replayTiming.events.push(event);
  document.documentElement.dataset.replayClipTiming = JSON.stringify(replayTiming);
  console.info("[pickup-replay:timing]", JSON.stringify(event));
  return event;
}

function markEditorReady() {
  if (window.__replayClipReady) return;
  window.__replayClipReady = true;
  const editor = $("replay-clip-editor");
  if (editor) editor.dataset.exportReady = "true";
  markReplayTiming("editor-ready", {
    playbackTime: state.playbackTime,
    clipStart: state.clipStart,
    clipEnd: state.clipEnd
  });
  updateClipEditor();
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const millis = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${minutes}:${String(whole).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function clipQuery() {
  const query = new URLSearchParams(location.search);
  const rawStart = query.get("clipStart");
  const rawEnd = query.get("clipEnd");
  const start = rawStart == null ? null : Number(rawStart);
  const end = rawEnd == null ? null : Number(rawEnd);
  return {
    start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? end : null,
    title: query.get("clipTitle") || ""
  };
}

function setClipBounds(start, end) {
  const timelineStart = LIVE_MODE ? Math.max(0, state.liveEdge - state.liveBufferSeconds) : 0;
  const timelineEnd = LIVE_MODE ? state.liveEdge : state.duration;
  if (!(timelineEnd > timelineStart)) return;
  const timelineLength = timelineEnd - timelineStart;
  const minimum = Math.min(CLIP_MIN_SECONDS, timelineLength);
  const maximum = Math.min(CLIP_MAX_SECONDS, timelineLength);
  const requestedStart = Number(start);
  const requestedEnd = Number(end);
  let clipStart = THREE.MathUtils.clamp(
    Number.isFinite(requestedStart) ? requestedStart : 0,
    timelineStart,
    Math.max(timelineStart, timelineEnd - minimum)
  );
  let clipEnd = THREE.MathUtils.clamp(
    Number.isFinite(requestedEnd) ? requestedEnd : Math.min(timelineEnd, clipStart + maximum),
    clipStart + minimum,
    Math.min(timelineEnd, clipStart + maximum)
  );
  if (clipEnd - clipStart < minimum) {
    clipEnd = Math.min(timelineEnd, clipStart + minimum);
    clipStart = Math.max(timelineStart, clipEnd - minimum);
  }
  state.clipStart = clipStart;
  state.clipEnd = clipEnd;
}

function updateClipEditor() {
  const editor = $("replay-clip-editor");
  if (!editor || !(state.duration > 0)) return;
  editor.hidden = !state.clipEditorOpen || (DIRECT_CLIP_EXPORT && !state.sceneReady);
  editor.style.setProperty("--clip-offset-x", `${state.clipEditorOffset.x}px`);
  editor.style.setProperty("--clip-offset-y", `${state.clipEditorOffset.y}px`);
  const toggle = $("replay-clip-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(state.clipEditorOpen));
    toggle.classList.toggle("active", state.clipEditorOpen);
  }
  const timelineStart = LIVE_MODE ? Math.max(0, state.liveEdge - state.liveBufferSeconds) : 0;
  const timelineEnd = LIVE_MODE ? state.liveEdge : state.duration;
  const duration = Math.max(0.001, timelineEnd - timelineStart);
  const startPercent = Math.min(100, Math.max(0, (state.clipStart - timelineStart) / duration * 100));
  const endPercent = Math.min(100, Math.max(0, (state.clipEnd - timelineStart) / duration * 100));
  const selection = $("replay-clip-selection");
  const startHandle = $("replay-clip-start-handle");
  const endHandle = $("replay-clip-end-handle");
  if (selection) {
    selection.style.left = `${startPercent}%`;
    selection.style.right = `${100 - endPercent}%`;
  }
  if (startHandle) startHandle.style.left = `${startPercent}%`;
  if (endHandle) endHandle.style.left = `${endPercent}%`;
  $("replay-clip-duration").textContent = formatTime(state.clipEnd - state.clipStart);
  $("replay-clip-start-time").textContent = formatTime(state.clipStart);
  $("replay-clip-end-time").textContent = formatTime(state.clipEnd);
  const title = $("replay-clip-title");
  if (title && document.activeElement !== title) title.value = state.clipTitle;
  const loop = $("replay-clip-loop");
  if (loop) {
    loop.classList.toggle("active", state.clipLoop);
    loop.textContent = state.clipLoop ? "Looping" : "Loop clip";
  }
  const download = $("replay-clip-download");
  if (download) {
    download.disabled = Boolean(state.clipExport) || !state.sceneReady;
    download.textContent = state.clipExport
      ? `Recording ${formatTime(Math.max(0, state.playbackTime - state.clipStart))}`
      : "Download .webm";
  }
}

function dragClipSelection(selection) {
  if (!selection) return;
  selection.addEventListener("pointerdown", event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const track = $("replay-scrubber-track") || document.querySelector(".replay-scrubber-track");
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    const width = bounds.width || 1;
    const initialStart = state.clipStart;
    const clipLength = state.clipEnd - state.clipStart;
    const initialX = event.clientX;
    const pointerId = event.pointerId;
    selection.setPointerCapture?.(pointerId);
    const move = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      const timelineStart = LIVE_MODE ? Math.max(0, state.liveEdge - state.liveBufferSeconds) : 0;
      const timelineEnd = LIVE_MODE ? state.liveEdge : state.duration;
      const delta = (moveEvent.clientX - initialX) / width * (timelineEnd - timelineStart);
      const start = THREE.MathUtils.clamp(
        initialStart + delta,
        timelineStart,
        Math.max(timelineStart, timelineEnd - clipLength)
      );
      setClipBounds(start, start + clipLength);
      updateClipEditor();
    };
    const stop = stopEvent => {
      if (stopEvent.pointerId !== pointerId) return;
      selection.releasePointerCapture?.(pointerId);
      selection.removeEventListener("pointermove", move);
      selection.removeEventListener("pointerup", stop);
      selection.removeEventListener("pointercancel", stop);
    };
    selection.addEventListener("pointermove", move);
    selection.addEventListener("pointerup", stop);
    selection.addEventListener("pointercancel", stop);
  });
}

function setClipEditorOpen(open) {
  state.clipEditorOpen = Boolean(open);
  if (LIVE_MODE && state.clipEditorOpen) state.followLive = false;
  const editor = $("replay-clip-editor");
  if (editor) editor.hidden = !state.clipEditorOpen;
  const toggle = $("replay-clip-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(state.clipEditorOpen));
    toggle.classList.toggle("active", state.clipEditorOpen);
  }
  updateClipEditor();
}

function setClipStartAt(time) {
  const timelineStart = LIVE_MODE ? Math.max(0, state.liveEdge - state.liveBufferSeconds) : 0;
  const timelineEnd = LIVE_MODE ? state.liveEdge : state.duration;
  const start = THREE.MathUtils.clamp(Number(time) || 0, timelineStart, timelineEnd);
  const end = start + Math.min(CLIP_MAX_SECONDS, Math.max(CLIP_MIN_SECONDS, state.clipEnd - start));
  setClipBounds(start, Math.min(timelineEnd, end));
  updateClipEditor();
}

function setClipEndAt(time) {
  const timelineStart = LIVE_MODE ? Math.max(0, state.liveEdge - state.liveBufferSeconds) : 0;
  const timelineEnd = LIVE_MODE ? state.liveEdge : state.duration;
  const end = THREE.MathUtils.clamp(Number(time) || 0, timelineStart, timelineEnd);
  const start = Math.max(timelineStart, end - Math.min(CLIP_MAX_SECONDS, Math.max(CLIP_MIN_SECONDS, end - state.clipStart)));
  setClipBounds(start, end);
  updateClipEditor();
}

function resetClip() {
  const timelineStart = LIVE_MODE ? Math.max(0, state.liveEdge - state.liveBufferSeconds) : 0;
  const timelineEnd = LIVE_MODE ? state.liveEdge : state.duration;
  setClipBounds(timelineStart, Math.min(timelineEnd, timelineStart + CLIP_MAX_SECONDS));
  state.clipLoop = false;
  updateClipEditor();
}

function copyClipLink() {
  const url = new URL(location.href);
  url.searchParams.set("clipStart", state.clipStart.toFixed(3));
  url.searchParams.set("clipEnd", state.clipEnd.toFixed(3));
  if (state.clipTitle.trim()) url.searchParams.set("clipTitle", state.clipTitle.trim());
  else url.searchParams.delete("clipTitle");
  const button = $("replay-clip-copy");
  const original = button?.textContent || "Copy clip link";
  const done = () => {
    if (!button) return;
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = original; }, 1400);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url.toString()).then(done).catch(() => {
      window.prompt("Copy clip link", url.toString());
    });
  } else {
    window.prompt("Copy clip link", url.toString());
  }
}

function clipFileName() {
  const raw = state.clipTitle.trim() || `tfc-clip-${state.metadata?.matchId || "replay"}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "tfc-clip";
}

function renderClipExportFrame() {
  const exportState = state.clipExport;
  if (!exportState) return;
  const target = exportState.canvas;
  const context = exportState.context;
  const width = target.width;
  const height = target.height;
  const scale = Math.max(1, width / 1280);
  const frame = selectedFrame();
  const metadata = state.metadata || {};
  const amber = "#f2b55b";
  const pale = "#f8fafc";
  const muted = "#94a3b8";
  const margin = 16 * scale;
  const baseline = height - 17 * scale;
  const drawText = (text, x, y, size, color = pale, align = "left", weight = 800, family = "Orbitron") => {
    context.font = `${weight} ${size * scale}px ${family}, sans-serif`;
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(String(text), x, y);
  };
  const drawPlus = (x, y) => {
    context.fillStyle = amber;
    context.fillRect(x, y + 8 * scale, 18 * scale, 5 * scale);
    context.fillRect(x + 6.5 * scale, y, 5 * scale, 21 * scale);
  };
  const drawShield = (x, y) => {
    context.beginPath();
    context.moveTo(x + 10 * scale, y);
    context.lineTo(x + 20 * scale, y + 4 * scale);
    context.lineTo(x + 17 * scale, y + 18 * scale);
    context.lineTo(x + 10 * scale, y + 23 * scale);
    context.lineTo(x + 3 * scale, y + 18 * scale);
    context.lineTo(x, y + 4 * scale);
    context.closePath();
    context.strokeStyle = amber;
    context.lineWidth = 3 * scale;
    context.stroke();
  };
  const drawAmmoIcon = (x, y) => {
    context.save();
    context.strokeStyle = amber;
    context.lineWidth = 2 * scale;
    context.beginPath();
    context.roundRect(x, y, 15 * scale, 24 * scale, 6 * scale);
    context.stroke();
    context.fillStyle = amber;
    context.fillRect(x + 3 * scale, y + 15 * scale, 9 * scale, 3 * scale);
    context.fillRect(x + 3 * scale, y + 9 * scale, 9 * scale, 3 * scale);
    context.restore();
  };
  const drawGrenadeIcon = (x, y, type) => {
    context.save();
    context.strokeStyle = type > 0 ? amber : "rgba(242, 181, 91, .45)";
    context.lineWidth = 2 * scale;
    context.beginPath();
    context.ellipse(x + 8 * scale, y + 13 * scale, 7 * scale, 10 * scale, .2, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(x + 5 * scale, y + 3 * scale);
    context.lineTo(x + 5 * scale, y);
    context.lineTo(x + 11 * scale, y);
    context.lineTo(x + 11 * scale, y + 3 * scale);
    context.stroke();
    context.restore();
  };
  const drawFlag = (x, y) => {
    context.save();
    context.strokeStyle = "#facc15";
    context.fillStyle = "#facc15";
    context.lineWidth = 3 * scale;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x, y + 28 * scale);
    context.stroke();
    context.beginPath();
    context.moveTo(x + 2 * scale, y + 2 * scale);
    context.lineTo(x + 22 * scale, y + 5 * scale);
    context.lineTo(x + 2 * scale, y + 13 * scale);
    context.closePath();
    context.fill();
    context.restore();
  };
  context.clearRect(0, 0, width, height);
  context.drawImage(canvas, 0, 0, width, height);
  context.save();
  context.textBaseline = "top";
  context.shadowColor = "rgba(0, 0, 0, .9)";
  context.shadowBlur = 5 * scale;
  context.shadowOffsetY = 2 * scale;
  drawText("4V4 REPLAY", margin, margin, 10, "#dbeafe", "left", 700);
  drawText(
    `${metadata.matchId || "REPLAY"} · ROUND ${metadata.round || "—"}`,
    margin,
    margin + 16 * scale,
    15
  );

  if (!frame) {
    context.restore();
    return;
  }

  const ammo = hudAmmoDisplay(frame);
  const weapon = selectedWeaponName(frame);

  drawPlus(margin, baseline - 21 * scale);
  drawText(hudAmmoValue(frame.health), margin + 27 * scale, baseline - 4 * scale, 20, amber, "left", 800);
  drawShield(margin + 83 * scale, baseline - 22 * scale);
  drawText(hudAmmoValue(frame.armor), margin + 111 * scale, baseline - 4 * scale, 20, amber, "left", 800);

  let right = width - margin;
  const drawGrenadeSlot = (type, count) => {
    const countText = hudAmmoValue(count);
    drawText(countText, right, baseline - 4 * scale, 13, amber, "right", 800);
    right -= 25 * scale;
    drawGrenadeIcon(right - 17 * scale, baseline - 24 * scale, Number(type));
    right -= 31 * scale;
  };
  drawGrenadeSlot(frame.gren2Type, frame.gren2Count);
  drawGrenadeSlot(frame.gren1Type, frame.gren1Count);
  drawAmmoIcon(right - 15 * scale, baseline - 23 * scale);
  right -= 32 * scale;
  drawText(weapon.toUpperCase(), right, baseline - 5 * scale, 12, amber, "right", 800);
  right -= Math.max(74, context.measureText(weapon.toUpperCase()).width / scale) * scale;
  if (ammo.visible) {
    drawText(ammo.text, right, baseline - 23 * scale, 18, amber, "right", 800);
    drawText("AMMO", right, baseline - 4 * scale, 7, "rgba(242, 181, 91, .82)", "right", 700);
  }

  if (selectedFlagObjective()) {
    drawFlag(margin, height * .43);
    drawText("FLAG", margin + 28 * scale, height * .43 + 10 * scale, 9, "#facc15", "left", 800);
  }

  const recent = state.killFeedEvents
    .filter(event => event.time <= state.playbackTime + 0.001 && event.time >= state.playbackTime - 12)
    .slice(-5);
  if (recent.length) {
    drawText("COMBAT FEED", width - margin, margin + 3 * scale, 8, muted, "right", 800);
    recent.forEach((event, index) => {
      const color = event.suicide ? "#facc15" : "#fb7185";
      const y = margin + (20 + index * 19) * scale;
      context.fillStyle = color;
      context.beginPath();
      context.arc(width - 260 * scale, y + 5 * scale, 3 * scale, 0, Math.PI * 2);
      context.fill();
      drawText(`${formatTime(event.time)}  ${event.text}`, width - 250 * scale, y, 8, color, "left", 800, "Inter");
    });
  }
  context.restore();
}

function finishClipExport() {
  const exportState = state.clipExport;
  if (!exportState || exportState.stopping) return;
  exportState.stopping = true;
  if (!exportState.renderEnded) {
    exportState.renderEnded = true;
    markReplayTiming("export-render-end", {
      mode: exportState.mode,
      frames: exportState.frames || 0,
      playbackTime: state.playbackTime
    });
  }
  markReplayTiming("media-recorder-stop", { mode: exportState.mode });
  if (exportState.recorder.state !== "inactive") exportState.recorder.stop();
}

function clipExportMimeType() {
  const preferredTypes = FAST_DIRECT_EXPORT ? [
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm"
  ] : [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  return preferredTypes.find(type => MediaRecorder.isTypeSupported?.(type)) || "";
}

function createClipExportCanvas() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = DIRECT_EXPORT_WIDTH || canvas.width;
  exportCanvas.height = DIRECT_EXPORT_HEIGHT || canvas.height;
  return { exportCanvas, exportContext: exportCanvas.getContext("2d") };
}

function restoreAfterClipExport(exportState) {
  const { previous } = exportState;
  if (previous.rendererWidth && previous.rendererHeight) {
    renderer.setSize(previous.rendererWidth, previous.rendererHeight, false);
    camera.aspect = previous.cameraAspect;
    camera.updateProjectionMatrix();
  }
  state.playbackTime = previous.playbackTime;
  state.speed = previous.speed;
  state.clipLoop = previous.clipLoop;
  state.clipExport = null;
  state.directIdleFrameRendered = false;
  setPlaying(previous.playing);
  updateScene();
  updateClipEditor();
}

function downloadClipBlob(blob, mimeType, mode) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${clipFileName()}.webm`;
  document.body.appendChild(anchor);
  let probe = $("replay-clip-export-result");
  if (!probe) {
    probe = document.createElement("video");
    probe.id = "replay-clip-export-result";
    probe.hidden = true;
    probe.preload = "metadata";
    probe.setAttribute("aria-hidden", "true");
    document.body.appendChild(probe);
  }
  const reportDuration = () => {
    const duration = Number.isFinite(probe.duration) ? probe.duration : probe.currentTime;
    if (!(duration > 0)) return;
    probe.dataset.duration = String(duration);
    markReplayTiming("webm-duration", { mode, duration });
  };
  probe.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(probe.duration)) reportDuration();
    else probe.currentTime = 1e101;
  }, { once: true });
  probe.addEventListener("timeupdate", reportDuration, { once: true });
  probe.src = url;
  markReplayTiming("webm-finalized", { mode, bytes: blob.size, mimeType });
  anchor.click();
  markReplayTiming("webm-download", { mode, bytes: blob.size, fileName: anchor.download });
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadFrameStreamBlob(blob, mode) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${clipFileName()}.mjpg`;
  document.body.appendChild(anchor);
  markReplayTiming("frame-stream-finalized", { mode, bytes: blob.size, mimeType: blob.type });
  anchor.click();
  markReplayTiming("frame-stream-download", { mode, bytes: blob.size, fileName: anchor.download });
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function canvasJpegBlob(sourceCanvas) {
  return new Promise((resolve, reject) => {
    sourceCanvas.toBlob(blob => {
      if (blob?.size) resolve(blob);
      else reject(new Error("Could not encode replay frame as JPEG."));
    }, "image/jpeg", 0.93);
  });
}

function nextSocketMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = event => {
      cleanup();
      resolve(String(event.data || ""));
    };
    const onError = () => {
      cleanup();
      reject(new Error("Raw replay frame connection failed."));
    };
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("message", onMessage, { once: true });
    socket.addEventListener("error", onError, { once: true });
  });
}

async function startRawFrameExport() {
  const { exportCanvas, exportContext } = createClipExportCanvas();
  const previous = {
    playbackTime: state.playbackTime,
    playing: state.playing,
    speed: state.speed,
    clipLoop: state.clipLoop
  };
  const exportState = {
    mode: "raw-frames",
    canvas: exportCanvas,
    context: exportContext,
    previous,
    frames: 0,
    renderCpuMs: 0,
    rawBytes: 0,
    failed: false
  };
  state.clipExport = exportState;
  useExportRenderResolution(exportState);
  replayTiming.exportPasses += 1;
  state.clipLoop = false;
  if (LIVE_MODE) state.followLive = false;
  setPlaying(false);
  updateClipEditor();
  markReplayTiming("media-recorder-skipped", { reason: "native-ffmpeg-raw-frame-export" });
  markReplayTiming("export-render-start", {
    mode: exportState.mode,
    clipStart: state.clipStart,
    clipEnd: state.clipEnd,
    fps: DIRECT_EXPORT_FPS
  });

  let socket;
  try {
    markReplayTiming("raw-frame-connect-start", { port: RAW_FRAME_STREAM_PORT });
    socket = new WebSocket(
      `ws://127.0.0.1:${RAW_FRAME_STREAM_PORT}/?token=${encodeURIComponent(RAW_FRAME_STREAM_TOKEN)}`
    );
    socket.binaryType = "arraybuffer";
    const readyMessage = nextSocketMessage(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not open raw replay frame stream.")), { once: true });
    });
    if (await readyMessage !== "ready") throw new Error("Raw replay frame receiver was not ready.");
    const clipDuration = state.clipEnd - state.clipStart;
    const frameStep = 1 / DIRECT_EXPORT_FPS;
    const frameCount = Math.ceil(clipDuration * DIRECT_EXPORT_FPS);
    const startAck = nextSocketMessage(socket);
    socket.send(JSON.stringify({
      type: "start",
      width: exportCanvas.width,
      height: exportCanvas.height,
      fps: DIRECT_EXPORT_FPS,
      frames: frameCount + 1
    }));
    if (await startAck !== "start") throw new Error("Raw replay frame receiver rejected the stream.");
    markReplayTiming("raw-frame-stream-start", {
      width: exportCanvas.width,
      height: exportCanvas.height,
      fps: DIRECT_EXPORT_FPS
    });

    for (let index = 0; index <= frameCount; index += 1) {
      const offset = Math.min(clipDuration, index * frameStep);
      state.playbackTime = state.clipStart + offset;
      const renderStarted = performance.now();
      updateScene();
      renderer.render(scene, camera);
      renderClipExportFrame();
      const pixels = exportContext.getImageData(
        0, 0, exportCanvas.width, exportCanvas.height
      ).data;
      exportState.renderCpuMs += performance.now() - renderStarted;
      const frameAck = nextSocketMessage(socket);
      socket.send(pixels.buffer);
      if (await frameAck !== "frame") throw new Error("Raw replay frame receiver rejected a frame.");
      exportState.frames += 1;
      exportState.rawBytes += pixels.byteLength;
    }

    markReplayTiming("raw-frame-stream-end", {
      frames: exportState.frames,
      bytes: exportState.rawBytes
    });
    markReplayTiming("export-render-end", {
      mode: exportState.mode,
      frames: exportState.frames,
      renderCpuMs: Math.round(exportState.renderCpuMs * 100) / 100,
      playbackTime: state.playbackTime
    });
    const completion = nextSocketMessage(socket);
    socket.send(JSON.stringify({ type: "end", frames: exportState.frames }));
    if (await completion !== "complete") throw new Error("Native replay encoding did not complete.");
    markReplayTiming("raw-frame-encode-complete", { frames: exportState.frames });
    socket.close();
    restoreAfterClipExport(exportState);
  } catch (error) {
    exportState.failed = true;
    try { socket?.close(); } catch {}
    markReplayTiming("export-error", { mode: exportState.mode, message: error.message || String(error) });
    restoreAfterClipExport(exportState);
    setStatus(error.message || "Raw replay frame export failed.");
  }
}

function useExportRenderResolution(exportState) {
  if (canvas.width === exportState.canvas.width && canvas.height === exportState.canvas.height) return;
  exportState.previous.rendererWidth = canvas.width;
  exportState.previous.rendererHeight = canvas.height;
  exportState.previous.cameraAspect = camera.aspect;
  renderer.setSize(exportState.canvas.width, exportState.canvas.height, false);
  camera.aspect = exportState.canvas.width / exportState.canvas.height;
  camera.updateProjectionMatrix();
}

function prepareClipRecorder({ exportCanvas, exportContext, stream, mimeType, mode }) {
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  const previous = {
    playbackTime: state.playbackTime,
    playing: state.playing,
    speed: state.speed,
    clipLoop: state.clipLoop
  };
  state.clipExport = {
    recorder, stream, chunks, previous, stopping: false,
    canvas: exportCanvas, context: exportContext, mode,
    frames: 0, renderCpuMs: 0, recorderTransitionMs: 0, renderEnded: false, failed: false
  };
  const exportState = state.clipExport;
  recorder.addEventListener("dataavailable", event => {
    if (event.data?.size) chunks.push(event.data);
  });
  recorder.addEventListener("stop", () => {
    markReplayTiming("media-recorder-stopped", { mode, chunks: chunks.length });
    markReplayTiming("webm-finalization-start", { mode });
    const blob = new Blob(chunks, { type: mimeType });
    if (!exportState.failed) downloadClipBlob(blob, mimeType, mode);
    stream.getTracks().forEach(track => track.stop());
    restoreAfterClipExport(exportState);
  });
  recorder.addEventListener("error", event => {
    exportState.failed = true;
    markReplayTiming("export-error", { mode, message: event.error?.message || "MediaRecorder error" });
  });
  replayTiming.exportPasses += 1;
  updateClipEditor();
  return exportState;
}

function startRealtimeClipExport(mimeType) {
  if (!canvas.captureStream) {
    window.alert("This browser cannot export WebM clips. Try Chrome or Edge.");
    return;
  }
  const { exportCanvas, exportContext } = createClipExportCanvas();
  const stream = exportCanvas.captureStream(FAST_DIRECT_EXPORT ? DIRECT_EXPORT_FPS : 60);
  const exportState = prepareClipRecorder({
    exportCanvas, exportContext, stream, mimeType, mode: "realtime"
  });

  state.playbackTime = state.clipStart;
  state.speed = 1;
  state.clipLoop = false;
  if (LIVE_MODE) state.followLive = false;
  setPlaying(true);
  updateScene();
  renderClipExportFrame();
  exportState.recorder.start(250);
  markReplayTiming("media-recorder-start", { mode: exportState.mode, mimeType });
  markReplayTiming("export-render-start", {
    mode: exportState.mode,
    clipStart: state.clipStart,
    clipEnd: state.clipEnd
  });
}

function supportsDeterministicClipExport() {
  return typeof window.MediaStreamTrackGenerator === "function" &&
    typeof window.VideoFrame === "function";
}

function supportsWebCodecsClipExport() {
  return typeof window.VideoEncoder === "function" && typeof window.VideoFrame === "function";
}

async function startMjpegFrameExport() {
  const { exportCanvas, exportContext } = createClipExportCanvas();
  const previous = {
    playbackTime: state.playbackTime,
    playing: state.playing,
    speed: state.speed,
    clipLoop: state.clipLoop
  };
  const exportState = {
    mode: "mjpeg-frames",
    canvas: exportCanvas,
    context: exportContext,
    previous,
    frames: 0,
    renderCpuMs: 0,
    jpegBytes: 0,
    failed: false
  };
  state.clipExport = exportState;
  useExportRenderResolution(exportState);
  replayTiming.exportPasses += 1;
  state.clipLoop = false;
  if (LIVE_MODE) state.followLive = false;
  setPlaying(false);
  updateClipEditor();
  markReplayTiming("media-recorder-skipped", { reason: "native-ffmpeg-frame-export" });
  markReplayTiming("export-render-start", {
    mode: exportState.mode,
    clipStart: state.clipStart,
    clipEnd: state.clipEnd,
    fps: DIRECT_EXPORT_FPS
  });
  markReplayTiming("frame-stream-start", {
    width: exportCanvas.width,
    height: exportCanvas.height,
    fps: DIRECT_EXPORT_FPS,
    format: "mjpeg"
  });

  try {
    const chunks = [];
    const clipDuration = state.clipEnd - state.clipStart;
    const frameStep = 1 / DIRECT_EXPORT_FPS;
    const frameCount = Math.ceil(clipDuration * DIRECT_EXPORT_FPS);
    for (let index = 0; index <= frameCount; index += 1) {
      const offset = Math.min(clipDuration, index * frameStep);
      state.playbackTime = state.clipStart + offset;
      const renderStarted = performance.now();
      updateScene();
      renderer.render(scene, camera);
      renderClipExportFrame();
      exportState.renderCpuMs += performance.now() - renderStarted;
      const jpeg = await canvasJpegBlob(exportCanvas);
      chunks.push(jpeg);
      exportState.jpegBytes += jpeg.size;
      exportState.frames += 1;
    }
    markReplayTiming("frame-stream-end", {
      frames: exportState.frames,
      bytes: exportState.jpegBytes
    });
    markReplayTiming("export-render-end", {
      mode: exportState.mode,
      frames: exportState.frames,
      renderCpuMs: Math.round(exportState.renderCpuMs * 100) / 100,
      playbackTime: state.playbackTime
    });
    downloadFrameStreamBlob(
      new Blob(chunks, { type: "video/x-motion-jpeg" }),
      exportState.mode
    );
    restoreAfterClipExport(exportState);
  } catch (error) {
    exportState.failed = true;
    markReplayTiming("export-error", { mode: exportState.mode, message: error.message || String(error) });
    restoreAfterClipExport(exportState);
    if (supportsWebCodecsClipExport()) void startWebCodecsClipExport();
    else setStatus(error.message || "Replay frame export failed.");
  }
}

async function startWebCodecsClipExport() {
  const { exportCanvas, exportContext } = createClipExportCanvas();
  const previous = {
    playbackTime: state.playbackTime,
    playing: state.playing,
    speed: state.speed,
    clipLoop: state.clipLoop
  };
  const exportState = {
    mode: "webcodecs",
    canvas: exportCanvas,
    context: exportContext,
    previous,
    frames: 0,
    renderCpuMs: 0,
    failed: false
  };
  state.clipExport = exportState;
  replayTiming.exportPasses += 1;
  state.clipLoop = false;
  if (LIVE_MODE) state.followLive = false;
  setPlaying(false);
  updateClipEditor();
  markReplayTiming("media-recorder-skipped", { reason: "webcodecs-direct-export" });
  markReplayTiming("export-render-start", {
    mode: exportState.mode,
    clipStart: state.clipStart,
    clipEnd: state.clipEnd,
    fps: DIRECT_EXPORT_FPS
  });

  let encoder = null;
  try {
    const { Muxer, ArrayBufferTarget } = await import(WEBM_MUXER_URL);
    const width = exportCanvas.width;
    const height = exportCanvas.height;
    const encoderCodec = FAST_DIRECT_EXPORT ? "vp8" : "vp09.00.10.08";
    const muxerCodec = FAST_DIRECT_EXPORT ? "V_VP8" : "V_VP9";
    const mimeType = FAST_DIRECT_EXPORT
      ? "video/webm;codecs=vp8"
      : "video/webm;codecs=vp9";
    const encoderConfig = {
      codec: encoderCodec,
      width,
      height,
      bitrate: FAST_DIRECT_EXPORT ? 2_000_000 : 8_000_000,
      framerate: DIRECT_EXPORT_FPS,
      latencyMode: FAST_DIRECT_EXPORT ? "realtime" : "quality"
    };
    const support = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!support.supported) throw new Error("VP9 WebCodecs encoding is not supported.");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: muxerCodec, width, height, frameRate: DIRECT_EXPORT_FPS },
      firstTimestampBehavior: "offset"
    });
    let encoderError = null;
    encoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: error => { encoderError = error; }
    });
    encoder.configure(support.config || encoderConfig);
    markReplayTiming("webcodecs-start", {
      codec: encoderConfig.codec,
      width,
      height,
      fps: DIRECT_EXPORT_FPS
    });

    const clipDuration = state.clipEnd - state.clipStart;
    const frameStep = 1 / DIRECT_EXPORT_FPS;
    const frameCount = Math.ceil(clipDuration * DIRECT_EXPORT_FPS);
    for (let index = 0; index <= frameCount; index += 1) {
      const offset = Math.min(clipDuration, index * frameStep);
      const nextOffset = Math.min(clipDuration, (index + 1) * frameStep);
      state.playbackTime = state.clipStart + offset;
      const renderStarted = performance.now();
      updateScene();
      renderer.render(scene, camera);
      renderClipExportFrame();
      exportState.renderCpuMs += performance.now() - renderStarted;
      const frame = new VideoFrame(exportCanvas, {
        timestamp: Math.round(offset * 1_000_000),
        duration: Math.max(1, Math.round((nextOffset - offset) * 1_000_000))
      });
      encoder.encode(frame, { keyFrame: index % Math.max(1, DIRECT_EXPORT_FPS * 2) === 0 });
      frame.close();
      exportState.frames += 1;
      while (encoder.encodeQueueSize > 4) {
        await new Promise(resolve => window.setTimeout(resolve, 0));
        if (encoderError) throw encoderError;
      }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    encoder.close();
    encoder = null;
    muxer.finalize();
    markReplayTiming("webcodecs-end", { frames: exportState.frames });
    markReplayTiming("export-render-end", {
      mode: exportState.mode,
      frames: exportState.frames,
      renderCpuMs: Math.round(exportState.renderCpuMs * 100) / 100,
      playbackTime: state.playbackTime
    });
    markReplayTiming("webm-finalization-start", { mode: exportState.mode });
    const blob = new Blob([target.buffer], { type: mimeType });
    downloadClipBlob(blob, mimeType, exportState.mode);
    restoreAfterClipExport(exportState);
  } catch (error) {
    exportState.failed = true;
    try { encoder?.close(); } catch {}
    markReplayTiming("export-error", { mode: exportState.mode, message: error.message || String(error) });
    restoreAfterClipExport(exportState);
    const fallbackMimeType = typeof MediaRecorder === "undefined" ? "" : clipExportMimeType();
    if (fallbackMimeType && supportsDeterministicClipExport()) {
      void startDeterministicClipExport(fallbackMimeType);
    } else if (fallbackMimeType) {
      startRealtimeClipExport(fallbackMimeType);
    } else {
      setStatus(error.message || "WebM export failed.");
    }
  }
}

async function startDeterministicClipExport(mimeType) {
  const { exportCanvas, exportContext } = createClipExportCanvas();
  const generator = new MediaStreamTrackGenerator({ kind: "video" });
  const writer = generator.writable.getWriter();
  const stream = new MediaStream([generator]);
  const exportState = prepareClipRecorder({
    exportCanvas, exportContext, stream, mimeType, mode: "deterministic"
  });
  exportState.writer = writer;
  exportState.fps = DIRECT_EXPORT_FPS;
  state.clipLoop = false;
  if (LIVE_MODE) state.followLive = false;
  setPlaying(false);
  markReplayTiming("export-render-start", {
    mode: exportState.mode,
    clipStart: state.clipStart,
    clipEnd: state.clipEnd,
    fps: DIRECT_EXPORT_FPS
  });

  try {
    const clipDuration = state.clipEnd - state.clipStart;
    const frameStep = 1 / DIRECT_EXPORT_FPS;
    const lastFrame = Math.ceil(clipDuration * DIRECT_EXPORT_FPS);
    const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
    const changeRecorderState = (eventName, change) => new Promise((resolve, reject) => {
      const changeStarted = performance.now();
      const onError = event => {
        exportState.recorder.removeEventListener(eventName, onChange);
        reject(event.error || new Error(`MediaRecorder ${eventName} failed`));
      };
      const onChange = () => {
        exportState.recorder.removeEventListener("error", onError);
        resolve(performance.now() - changeStarted);
      };
      exportState.recorder.addEventListener(eventName, onChange, { once: true });
      exportState.recorder.addEventListener("error", onError, { once: true });
      change();
    });
    state.playbackTime = state.clipStart;
    let renderStarted = performance.now();
    updateScene();
    renderer.render(scene, camera);
    renderClipExportFrame();
    exportState.renderCpuMs += performance.now() - renderStarted;
    const firstFrame = new VideoFrame(exportCanvas, {
      timestamp: 0,
      duration: Math.round(frameStep * 1_000_000)
    });
    exportState.recorder.start(250);
    markReplayTiming("media-recorder-start", {
      mode: exportState.mode,
      mimeType,
      fps: DIRECT_EXPORT_FPS
    });
    await changeRecorderState("pause", () => exportState.recorder.pause());
    await writer.write(firstFrame);
    firstFrame.close();
    exportState.frames = 1;
    let previousResumeDelay = await changeRecorderState("resume", () => exportState.recorder.resume());
    exportState.recorderTransitionMs += previousResumeDelay;
    for (let index = 1; index <= lastFrame; index += 1) {
      if (state.clipExport !== exportState) return;
      const previousOffset = Math.min(clipDuration, (index - 1) * frameStep);
      const offset = Math.min(clipDuration, index * frameStep);
      const nextOffset = Math.min(clipDuration, (index + 1) * frameStep);
      const intervalMs = (offset - previousOffset) * 1000;
      const finalResumeAllowance = index === lastFrame ? previousResumeDelay : 0;
      await wait(Math.max(0, intervalMs - previousResumeDelay - finalResumeAllowance));
      await changeRecorderState("pause", () => exportState.recorder.pause());
      state.playbackTime = state.clipStart + offset;
      renderStarted = performance.now();
      updateScene();
      renderer.render(scene, camera);
      renderClipExportFrame();
      exportState.renderCpuMs += performance.now() - renderStarted;
      const frame = new VideoFrame(exportCanvas, {
        timestamp: Math.round(offset * 1_000_000),
        duration: Math.max(1, Math.round((nextOffset - offset || frameStep) * 1_000_000))
      });
      await writer.write(frame);
      frame.close();
      exportState.frames += 1;
      previousResumeDelay = await changeRecorderState("resume", () => exportState.recorder.resume());
      exportState.recorderTransitionMs += previousResumeDelay;
      if (index % 4 === 3) await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    exportState.renderEnded = true;
    markReplayTiming("export-render-end", {
      mode: exportState.mode,
      frames: exportState.frames,
      renderCpuMs: Math.round(exportState.renderCpuMs * 100) / 100,
      recorderTransitionMs: Math.round(exportState.recorderTransitionMs * 100) / 100,
      playbackTime: state.playbackTime
    });
    await writer.close();
    window.setTimeout(finishClipExport, 0);
  } catch (error) {
    exportState.failed = true;
    markReplayTiming("export-error", { mode: exportState.mode, message: error.message || String(error) });
    try { await writer.abort(error); } catch {}
    finishClipExport();
  }
}

function startClipExport() {
  if (state.clipExport || !(state.clipEnd > state.clipStart)) return;
  if (RAW_FRAME_STREAM) {
    void startRawFrameExport();
    return;
  }
  if (FAST_DIRECT_EXPORT && typeof HTMLCanvasElement.prototype.toBlob === "function") {
    void startMjpegFrameExport();
    return;
  }
  if (DIRECT_CLIP_EXPORT && supportsWebCodecsClipExport()) {
    void startWebCodecsClipExport();
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    window.alert("This browser cannot export WebM clips. Try Chrome or Edge.");
    return;
  }
  const mimeType = clipExportMimeType();
  if (!mimeType) {
    window.alert("This browser does not support WebM clip export.");
    return;
  }
  if (DIRECT_CLIP_EXPORT && supportsDeterministicClipExport()) {
    void startDeterministicClipExport(mimeType);
    return;
  }
  startRealtimeClipExport(mimeType);
}

function dragClipHandle(handle, side) {
  if (!handle) return;
  handle.addEventListener("pointerdown", event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const track = $("replay-scrubber-track") || document.querySelector(".replay-scrubber-track");
    if (!track) return;
    const pointerId = event.pointerId;
    handle.setPointerCapture?.(pointerId);
    const move = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      const bounds = track.getBoundingClientRect();
      const ratio = bounds.width ? THREE.MathUtils.clamp((moveEvent.clientX - bounds.left) / bounds.width, 0, 1) : 0;
      const timelineStart = LIVE_MODE ? Math.max(0, state.liveEdge - state.liveBufferSeconds) : 0;
      const timelineEnd = LIVE_MODE ? state.liveEdge : state.duration;
      const time = timelineStart + ratio * (timelineEnd - timelineStart);
      if (side === "start") setClipStartAt(time);
      else setClipEndAt(time);
    };
    const stop = stopEvent => {
      if (stopEvent.pointerId !== pointerId) return;
      handle.releasePointerCapture?.(pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
}

function dragClipEditor(editor) {
  const heading = editor?.querySelector(".replay-clip-editor-heading");
  if (!editor || !heading) return;
  heading.addEventListener("pointerdown", event => {
    if (event.target.closest("button, input, select, textarea")) return;
    event.preventDefault();
    heading.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = { ...state.clipEditorOffset };
    const move = moveEvent => {
      const maxX = Math.max(0, (window.innerWidth - editor.offsetWidth) / 2);
      const maxY = Math.max(0, window.innerHeight - editor.offsetHeight - 12);
      state.clipEditorOffset.x = THREE.MathUtils.clamp(initial.x + moveEvent.clientX - startX, -maxX, maxX);
      state.clipEditorOffset.y = THREE.MathUtils.clamp(initial.y + moveEvent.clientY - startY, -maxY, maxY);
      editor.style.setProperty("--clip-offset-x", `${state.clipEditorOffset.x}px`);
      editor.style.setProperty("--clip-offset-y", `${state.clipEditorOffset.y}px`);
    };
    const stop = stopEvent => {
      heading.releasePointerCapture?.(stopEvent.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  });
}

function sourcePoint(x, y, z) {
  return new THREE.Vector3(x - state.origin.x, z - state.origin.z, -(y - state.origin.y));
}

function teamInfo(number) {
  return TEAM[number] || { name: `Team ${number || "?"}`, css: "#94a3b8", color: 0x94a3b8 };
}

function className(classId) {
  return CLASSES[classId] || `Class ${classId}`;
}

function trackFrame(track, time, interpolate = true, maxTailSeconds = 0.25) {
  const data = track?.frames;
  const stride = track?.stride || 0;
  const count = stride ? Math.floor(data.length / stride) : 0;
  if (!count) return null;
  if (time < data[0] || time > data[(count - 1) * stride] + maxTailSeconds) return null;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (data[mid * stride] <= time) low = mid;
    else high = mid - 1;
  }
  const offset = low * stride;
  const nextOffset = Math.min(count - 1, low + 1) * stride;
  const span = data[nextOffset] - data[offset];
  const mix = interpolate && span > 0 ? Math.min(1, Math.max(0, (time - data[offset]) / span)) : 0;
  return { data, offset, nextOffset, mix };
}

function value(frame, index, lerp = true) {
  if (!frame) return 0;
  const a = frame.data[frame.offset + index];
  const b = frame.data[frame.nextOffset + index];
  return lerp ? THREE.MathUtils.lerp(a, b, frame.mix) : a;
}

function angle(frame, index) {
  const a = value(frame, index, false);
  const b = frame.data[frame.nextOffset + index];
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * frame.mix;
}

function playerSnapshot(track, time) {
  const frame = trackFrame(track, time);
  if (!frame) return null;
  const boundaryIndexes = track.schemaVersion >= 3
    ? [10, 11, 12, 19, 20, ...(track.schemaVersion >= 7
      ? [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47] : [])]
    : [10, 11, 12];
  if (frame.nextOffset !== frame.offset && (
    frame.data[frame.nextOffset] - frame.data[frame.offset] > 0.25 ||
    boundaryIndexes.some(index => frame.data[frame.offset + index] !== frame.data[frame.nextOffset + index])
  )) frame.mix = 0;
  const snapshot = {
    time: value(frame, 0),
    x: value(frame, 1), y: value(frame, 2), z: value(frame, 3),
    vx: value(frame, 4), vy: value(frame, 5), vz: value(frame, 6),
    pitch: angle(frame, 7), yaw: angle(frame, 8), roll: angle(frame, 9),
    alive: value(frame, 10, false) === 1,
    team: Math.round(value(frame, 11, false)),
    classId: Math.round(value(frame, 12, false)),
    weapon: Math.round(value(frame, 13, false)),
    buttons: Math.round(value(frame, 14, false)),
    health: Math.round(value(frame, 15, false)),
    armor: Math.round(value(frame, 16, false)),
    schemaVersion: track.schemaVersion || 2
  };
  if (snapshot.schemaVersion >= 3) Object.assign(snapshot, {
    ducking: value(frame, 17, false) === 1,
    oldbuttons: Math.round(value(frame, 18, false)),
    playerModelId: Math.round(value(frame, 19, false)),
    weaponModelId: Math.round(value(frame, 20, false)),
    body: Math.round(value(frame, 21, false)), skin: Math.round(value(frame, 22, false)),
    sequence: Math.round(value(frame, 23, false)), gaitsequence: Math.round(value(frame, 24, false)),
    frame: value(frame, 25), framerate: value(frame, 26), animtime: value(frame, 27),
    bodyPitch: angle(frame, 28), bodyYaw: angle(frame, 29), bodyRoll: angle(frame, 30),
    controller: [31, 32, 33, 34].map(index => value(frame, index, false)),
    blending: [35, 36].map(index => value(frame, index, false))
  });
  if (snapshot.schemaVersion >= 7) Object.assign(snapshot, {
    weaponName: track.weaponNames?.[Math.floor(frame.offset / track.stride)] || "unknown",
    clipAmmo: Math.round(value(frame, 37, false)),
    clipMax: Math.round(value(frame, 38, false)),
    ammoShells: Math.round(value(frame, 39, false)),
    ammoBullets: Math.round(value(frame, 40, false)),
    ammoCells: Math.round(value(frame, 41, false)),
    ammoRockets: Math.round(value(frame, 42, false)),
    gren1Type: Math.round(value(frame, 43, false)),
    gren1Count: Math.round(value(frame, 44, false)),
    gren2Type: Math.round(value(frame, 45, false)),
    gren2Count: Math.round(value(frame, 46, false)),
    reloadState: Math.round(value(frame, 47, false))
  });
  return snapshot;
}

function replaySchemaVersion() {
  return Number(state.metadata?.manifest?.schema_version || state.metadata?.schemaVersion || 2);
}

function sceneObjectKey(stream, streamId) {
  return `${stream}:${Number(streamId)}`;
}

function sceneMetadataAt(stream, streamId, time = state.playbackTime) {
  const updates = state.entityMetadata.get(sceneObjectKey(stream, streamId));
  if (!updates?.length || time < updates[0].time) return null;
  let low = 0;
  let high = updates.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (updates[middle].time <= time) low = middle;
    else high = middle - 1;
  }
  return updates[low];
}

function rebuildSceneIndexes() {
  const metadata = new Map();
  for (const update of state.sceneMetadataRows || []) {
    const key = sceneObjectKey(update.stream, update.streamId);
    if (!metadata.has(key)) metadata.set(key, []);
    metadata.get(key).push(update);
  }
  for (const updates of metadata.values()) {
    updates.sort((a, b) => a.time - b.time);
  }
  state.entityMetadata = metadata;

  state.sceneEvents.sort((a, b) => a.sequence - b.sequence);
  const deathsById = new Map();
  const deathsBySession = new Map();
  for (const event of state.sceneEvents) {
    if (event.event === "death") {
      const death = {
        deathId: event.objectId,
        sessionId: event.targetSession,
        startsAt: event.time,
        endsAt: Number.POSITIVE_INFINITY,
        gibDirective: event.intValue1,
        lethalDamageBits: event.intValue2,
        inflictor: event.text,
        attackerSession: event.actorSession,
        weaponNotice: "",
        deathSequence: 0,
        deathGaitSequence: 0
      };
      deathsById.set(death.deathId, death);
      if (!deathsBySession.has(death.sessionId)) deathsBySession.set(death.sessionId, []);
      deathsBySession.get(death.sessionId).push(death);
      continue;
    }
    const death = deathsById.get(event.objectId);
    if (!death) continue;
    if (event.event === "corpse_end") death.endsAt = event.time;
    else if (event.event === "death_notice") death.weaponNotice = event.text;
    else if (event.event === "death_pose") {
      death.deathSequence = event.intValue1;
      death.deathGaitSequence = event.intValue2;
    }
  }
  state.sceneDeathsBySession = deathsBySession;
}

function linkedDeathObjectActive(deathId, kinds, time) {
  for (const [key, updates] of state.entityMetadata) {
    if (!key.startsWith("entity:")) continue;
    const update = sceneMetadataAt("entity", Number(key.slice(7)), time);
    if (!update || update.deathId !== deathId || !kinds.has(update.kind)) continue;
    const track = state.entityById.get(update.streamId);
    const frame = track ? entitySnapshot(track, time) : null;
    if (frame && !(frame.effects & 128)) return true;
  }
  return false;
}

function playerDeathAt(sessionId, time = state.playbackTime) {
  const deaths = state.sceneDeathsBySession.get(Number(sessionId));
  if (!deaths?.length) return null;
  for (let index = deaths.length - 1; index >= 0; index -= 1) {
    const death = deaths[index];
    if (death.startsAt <= time && time < death.endsAt) {
      const gibbed = death.gibDirective === 1 ||
        linkedDeathObjectActive(death.deathId, new Set(["gib"]), time);
      const bodyQueued = linkedDeathObjectActive(death.deathId, new Set(["corpse_body"]), time);
      return { ...death, gibbed, bodyQueued };
    }
  }
  return null;
}

function isDucking(frame) {
  return frame.schemaVersion >= 3 ? frame.ducking : Boolean(frame.buttons & 4);
}

function assaultCannonActive(frame) {
  const modelPath = state.renderModels.get(Number(frame?.weaponModelId))?.path || "";
  const isAssaultCannon = /(?:^|\/)p_mini2?\.mdl$/i.test(modelPath);
  return Boolean(frame?.alive && isAssaultCannon && (frame.buttons & IN_ATTACK));
}

function deterministicSpread(index, salt) {
  const value = Math.sin((index + 1) * (12.9898 + salt * 17.31)) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function createAssaultCannonVisual() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const tracers = Array.from({ length: 3 }, () => {
    const tracer = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1, 6, 1, true), material);
    tracer.frustumCulled = false;
    group.add(tracer);
    return tracer;
  });
  const flash = new THREE.Mesh(
    new THREE.ConeGeometry(2.1, 6, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending })
  );
  group.add(flash);
  group.visible = false;
  return { group, tracers, flash };
}

function positionTracer(tracer, start, end) {
  const delta = end.clone().sub(start);
  const length = delta.length();
  tracer.visible = length > 0.01;
  if (!tracer.visible) return;
  tracer.position.copy(start).add(end).multiplyScalar(0.5);
  tracer.quaternion.setFromUnitVectors(segmentUp, delta.normalize());
  tracer.scale.set(1, length, 1);
}

function updateAssaultCannonVisual(track, frame, time) {
  const visual = track.acFireVisual;
  if (!visual) return;
  visual.group.visible = state.showProjectiles && assaultCannonActive(frame);
  if (!visual.group.visible) return;

  const forward = viewDirection(frame);
  const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
  const crouched = frame.schemaVersion >= 3 && isDucking(frame);
  let muzzle;
  if (track.weaponModel && track.weaponMuzzleLocal) {
    world.updateMatrixWorld(true);
    track.mesh.updateMatrixWorld(true);
    muzzle = track.weaponModel.localToWorld(track.weaponMuzzleLocal.clone());
    muzzle = world.worldToLocal(muzzle);
  } else {
    muzzle = sourcePoint(frame.x, frame.y, frame.z)
      .add(new THREE.Vector3(0, crouched ? 4 : 6, 0))
      .addScaledVector(forward, 27)
      .addScaledVector(right, 14);
  }
  const baseShot = Math.floor(time * AC_ROUNDS_PER_SECOND);

  visual.tracers.forEach((tracer, offset) => {
    const shot = baseShot - offset;
    const direction = forward.clone()
      .addScaledVector(right, deterministicSpread(shot, 1) * 0.018)
      .addScaledVector(segmentUp, deterministicSpread(shot, 2) * 0.014)
      .normalize();
    acRaycaster.set(muzzle, direction);
    acRaycaster.far = AC_TRACER_RANGE;
    const hit = mapModel ? acRaycaster.intersectObject(mapModel, true)[0] : null;
    const range = Math.max(1, Math.min(AC_TRACER_RANGE, hit?.distance || AC_TRACER_RANGE));
    const phase = ((time * AC_ROUNDS_PER_SECOND + offset / visual.tracers.length) % 1 + 1) % 1;
    // Keep one short streak connected to the barrel so continuous fire always
    // reads as originating at the cannon; the other two rounds travel downrange.
    const startDistance = offset === 0 ? 0 : Math.min(range, phase * range);
    const tracerLength = offset === 0 ? 72 : 48;
    const endDistance = Math.min(range, startDistance + tracerLength);
    positionTracer(
      tracer,
      muzzle.clone().addScaledVector(direction, startDistance),
      muzzle.clone().addScaledVector(direction, endDistance)
    );
  });
  visual.flash.position.copy(muzzle).addScaledVector(forward, 3);
  visual.flash.quaternion.setFromUnitVectors(segmentUp, forward);
  const flashPulse = 1 + (1 - ((time * AC_ROUNDS_PER_SECOND) % 1)) * 0.2;
  visual.flash.scale.setScalar(flashPulse);
}

function projectileSnapshot(track, time) {
  const frame = trackFrame(track, time);
  // Projectile telemetry uses state 1 for an entity that is still present.
  // Treat every other lifecycle state as removed so a pipe cannot remain
  // visible after its detonation event while the impact plays at its last
  // active position.
  if (!frame || value(frame, 1, false) !== 1) return null;
  return {
    state: value(frame, 1, false),
    x: value(frame, 2), y: value(frame, 3), z: value(frame, 4),
    yaw: angle(frame, 9)
  };
}

function objectiveSnapshot(track, time) {
  const frame = trackFrame(track, time);
  if (!frame || value(frame, 1, false) < 0) return null;
  return {
    state: value(frame, 1, false),
    carrierSession: Math.round(value(frame, 2, false)),
    x: value(frame, 5), y: value(frame, 6), z: value(frame, 7),
    yaw: angle(frame, 8)
  };
}

function buildableSnapshot(track, time) {
  const frame = trackFrame(track, time);
  if (!frame || value(frame, 1, false) !== 1) return null;
  if (frame.nextOffset !== frame.offset && value(frame, 6, false) !== value({ ...frame, offset: frame.nextOffset }, 6, false)) {
    frame.mix = 0;
  }
  return {
    active: true,
    entity: value(frame, 2, false), ownerSession: value(frame, 3, false), ownerEntity: value(frame, 4, false),
    team: value(frame, 5, false), modelId: value(frame, 6, false), colormap: value(frame, 7, false),
    movetype: value(frame, 8, false), solid: value(frame, 9, false), effects: value(frame, 10, false),
    health: value(frame, 11, false), x: value(frame, 12), y: value(frame, 13), z: value(frame, 14),
    vx: value(frame, 15), vy: value(frame, 16), vz: value(frame, 17), pitch: angle(frame, 18),
    yaw: angle(frame, 19), roll: angle(frame, 20), body: value(frame, 21, false), skin: value(frame, 22, false),
    sequence: value(frame, 23, false), gaitsequence: value(frame, 24, false), frame: value(frame, 25),
    framerate: value(frame, 26), animtime: value(frame, 27), scale: value(frame, 28, false),
    rendermode: value(frame, 29, false), renderamt: value(frame, 30, false), renderfx: value(frame, 31, false),
    color: [32, 33, 34].map(index => value(frame, index, false)),
    controller: [35, 36, 37, 38].map(index => value(frame, index, false)),
    blending: [39, 40].map(index => value(frame, index, false)), aiment: value(frame, 41, false)
  };
}

function entitySnapshot(track, time) {
  const frame = trackFrame(track, time);
  if (!frame || value(frame, 1, false) !== 1) return null;
  if (frame.nextOffset !== frame.offset &&
      value(frame, 6, false) !== value({ ...frame, offset: frame.nextOffset }, 6, false)) {
    frame.mix = 0;
  }
  return {
    active: true,
    ownerSession: value(frame, 2, false), ownerEntity: value(frame, 3, false),
    team: value(frame, 4, false), health: value(frame, 5, false), modelId: value(frame, 6, false),
    colormap: value(frame, 7, false), movetype: value(frame, 8, false), solid: value(frame, 9, false),
    effects: value(frame, 10, false), flags: value(frame, 11, false),
    x: value(frame, 12), y: value(frame, 13), z: value(frame, 14),
    vx: value(frame, 15), vy: value(frame, 16), vz: value(frame, 17),
    pitch: angle(frame, 18), yaw: angle(frame, 19), roll: angle(frame, 20),
    avelPitch: value(frame, 21), avelYaw: value(frame, 22), avelRoll: value(frame, 23),
    body: value(frame, 24, false), skin: value(frame, 25, false), sequence: value(frame, 26, false),
    gaitsequence: value(frame, 27, false), frame: value(frame, 28), framerate: value(frame, 29),
    animtime: value(frame, 30), scale: value(frame, 31, false),
    rendermode: value(frame, 32, false), renderamt: value(frame, 33, false),
    renderfx: value(frame, 34, false), color: [35, 36, 37].map(index => value(frame, index, false)),
    controller: [38, 39, 40, 41].map(index => value(frame, index, false)),
    blending: [42, 43].map(index => value(frame, index, false)), aiment: value(frame, 44, false)
  };
}

function brushSnapshot(track, time) {
  const frame = trackFrame(track, time, true, Number.POSITIVE_INFINITY);
  if (!frame) return null;
  const span = frame.data[frame.nextOffset] - frame.data[frame.offset];
  const moving = [5, 6, 7, 11, 12, 13]
    .some(index => Math.abs(frame.data[frame.offset + index]) >= 0.001);
  if (frame.nextOffset !== frame.offset &&
      (value(frame, 1, false) !== frame.data[frame.nextOffset + 1] || (span > 0.25 && !moving))) {
    frame.mix = 0;
  }
  return {
    active: value(frame, 1, false) === 1,
    x: value(frame, 2), y: value(frame, 3), z: value(frame, 4),
    vx: value(frame, 5), vy: value(frame, 6), vz: value(frame, 7),
    pitch: angle(frame, 8), yaw: angle(frame, 9), roll: angle(frame, 10),
    avelPitch: value(frame, 11), avelYaw: value(frame, 12), avelRoll: value(frame, 13),
    effects: value(frame, 14, false), solid: value(frame, 15, false),
    movetype: value(frame, 16, false), rendermode: value(frame, 17, false),
    renderamt: value(frame, 18, false), renderfx: value(frame, 19, false),
    color: [20, 21, 22].map(index => value(frame, index, false))
  };
}

function buildableVisualTeam(track, frame, time) {
  const ownerSessions = [frame.ownerSession, track.definition?.initialOwnerSession]
    .map(Number)
    .filter(Number.isFinite)
    .map(Math.round);
  for (const ownerSession of new Set(ownerSessions)) {
    if (!ownerSession) continue;
    const ownerTrack = state.playerBySession.get(ownerSession);
    const ownerFrame = ownerTrack ? playerSnapshot(ownerTrack, time) : null;
    if (ownerFrame?.team) return ownerFrame.team;
    const rosterTeam = state.roster.find(row => row.sessionId === ownerSession)?.team;
    if (rosterTeam) return rosterTeam;
  }
  const representedTeams = new Set(state.players
    .map(player => playerSnapshot(player, time)?.team)
    .filter(Boolean));
  if (representedTeams.size === 1) return representedTeams.values().next().value;
  return Math.round(frame.team);
}

function fallbackPlayerMesh(team, preserveNativeOrigin = false) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: teamInfo(team).color,
    roughness: 0.62,
    metalness: 0.05
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(15, 42, 6, 10), material);
  body.position.y = preserveNativeOrigin ? 0 : 36;
  group.add(body);
  return group;
}

function modelUrl(classId, team, ducking = false) {
  const info = CLASS_MODELS[classId] || CLASS_MODELS[0];
  const classic = info[0] === "civilian" ? info[1] : `${info[1]}2`;
  const teamSuffix = `_${teamInfo(team).name.toLowerCase()}`;
  const poseSuffix = ducking ? "_crouch" : "";
  return `assets/tfc/models/player/variants/${info[0]}/${classic}${teamSuffix}${poseSuffix}.glb?v=20260810playerpaths1`;
}

async function modelAsset(classId, team, ducking = false) {
  return loadModelAsset(modelUrl(classId, team, ducking));
}

async function loadModelAsset(url) {
  const assetUrl = url?.includes("/assets/tfc/models/")
    ? `${url}${url.includes("?") ? "&" : "?"}v=${TFC_MODEL_ASSET_VERSION}`
    : url;
  if (!modelCache.has(assetUrl)) {
    modelCache.set(assetUrl, new Promise(resolve => {
      loader.load(assetUrl, gltf => resolve(gltf.scene || null), undefined, () => resolve(null));
    }));
  }
  return modelCache.get(assetUrl);
}

function catalogUrl(modelId, expectedKind) {
  if (!modelId) return null;
  const recorded = state.renderModels.get(Number(modelId));
  if (!recorded) return null;
  const recordedPath = String(recorded.path || "").replace(/\\/g, "/").toLowerCase();
  // Some schema-7 recordings do not carry a semantic backpack metadata row,
  // but the model path still identifies the same canonical world pickup.
  // Resolve this before enforcing the catalog kind so a generic/mislabeled
  // render-model row cannot become the diagnostic wireframe.
  if (expectedKind === "entity" &&
      /(?:^|\/)models\/(?:w_)?(?:backpack|backpack2|medpack|medkit)(?:2)?\.mdl$/i.test(recordedPath)) {
    return state.modelCatalog.get("models/backpack.mdl")?.url || "/assets/tfc/models/backpack.glb";
  }
  if (recorded.kind !== expectedKind) return null;
  let catalog = state.modelCatalog.get(recordedPath);
  // Some server builds report the resupply pickup under a slightly different
  // backpack/medkit model name, although the visual asset is the same TFC
  // world backpack. Keep those recordings on the real model instead of the
  // diagnostic wireframe used for unresolved entities.
  if (!catalog && expectedKind === "entity" &&
      /(?:^|\/)models\/(?:w_)?(?:backpack|backpack2|medpack|medkit)(?:2)?\.mdl$/i.test(recordedPath)) {
    catalog = state.modelCatalog.get("models/backpack.mdl");
  }
  return catalog && (
    catalog.kind === expectedKind || expectedKind === "entity" ||
    (expectedKind === "objective" && catalog.kind === "entity")
  )
    ? catalog.url
    : null;
}

function objectiveTeam(definition, objectiveId) {
  const identity = [
    definition?.targetname,
    definition?.classname,
    definition?.model
  ].filter(Boolean).join(" ").toLowerCase();
  for (const [number, info] of Object.entries(TEAM)) {
    if (identity.includes(info.name.toLowerCase())) return Number(number);
  }
  return ((Math.max(1, Number(objectiveId) || 1) - 1) % 4) + 1;
}

function objectiveModelUrl(team) {
  const name = teamInfo(team).name.toLowerCase();
  return `/assets/tfc/models/objectives/flag_${name}.glb?v=20260810modelpaths1`;
}

async function setObjectiveModel(track) {
  const asset = await loadModelAsset(
    catalogUrl(track.definition?.modelId, "objective") || objectiveModelUrl(track.team)
  );
  if (!asset || track.mesh.userData.hasObjectiveModel) return;
  const model = asset.clone(true);
  model.traverse(child => {
    if (child.isMesh) child.frustumCulled = false;
  });
  track.mesh.clear();
  track.mesh.add(model);
  track.mesh.userData.hasObjectiveModel = true;
}

function playerMotionUniforms() {
  return {
    walk: { value: 0 },
    phase: { value: 0 },
    air: { value: 0 },
    tuck: { value: 0 },
    minY: { value: -36 },
    height: { value: PLAYER_STANDING_VISUAL_HEIGHT },
    centerZ: { value: 0 }
  };
}

function installPlayerMotionShader(material, motion) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      replayWalk: motion.walk,
      replayPhase: motion.phase,
      replayAir: motion.air,
      replayTuck: motion.tuck,
      replayMinY: motion.minY,
      replayHeight: motion.height,
      replayCenterZ: motion.centerZ
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
uniform float replayWalk;
uniform float replayPhase;
uniform float replayAir;
uniform float replayTuck;
uniform float replayMinY;
uniform float replayHeight;
uniform float replayCenterZ;
mat2 replayRotate(float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, sine, -sine, cosine);
}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
float replaySafeHeight = max(replayHeight, 1.0);
float replayNormalizedY = (position.y - replayMinY) / replaySafeHeight;
float replayLegMask = 1.0 - smoothstep(0.50, 0.55, replayNormalizedY);
float replaySidePhase = replayPhase + (position.z < replayCenterZ ? 3.14159265 : 0.0);
float replayStride = sin(replaySidePhase);
float replayHipAngle = replayStride * 0.62 * replayWalk + 1.02 * replayTuck;
float replayKneeAngle = -max(0.0, replayStride) * 0.72 * replayWalk - 1.28 * replayTuck;
float replayHipY = replayMinY + replaySafeHeight * 0.51;
float replayKneeY = replayMinY + replaySafeHeight * 0.255;
vec2 replayHip = vec2(0.0, replayHipY);
vec2 replayKnee = vec2(0.0, replayKneeY);
vec2 replayUpper = replayHip + replayRotate(replayHipAngle) * (transformed.xy - replayHip);
vec2 replayLower = replayHip + replayRotate(replayHipAngle) * (
  (replayKnee - replayHip) + replayRotate(replayKneeAngle) * (transformed.xy - replayKnee)
);
float replayLowerMix = 1.0 - smoothstep(0.245, 0.285, replayNormalizedY);
vec2 replayAnimated = mix(replayUpper, replayLower, replayLowerMix);
transformed.xy = mix(transformed.xy, replayAnimated, replayLegMask);
transformed.y += abs(sin(replayPhase)) * 0.75 * replayWalk * (1.0 - replayAir);
`);
  };
  material.customProgramCacheKey = () => "pickup-player-motion-v1";
  material.needsUpdate = true;
}

function clonedPlayerModel(
  asset,
  alignFeetToOrigin = false,
  targetHeight = PLAYER_STANDING_VISUAL_HEIGHT,
  motion = null
) {
  const model = asset.clone(true);
  model.traverse(child => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    if (motion) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map(material => {
          const copy = material.clone();
          installPlayerMotionShader(copy, motion);
          return copy;
        });
      } else if (child.material) {
        child.material = child.material.clone();
        installPlayerMotionShader(child.material, motion);
      }
    }
  });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  if (motion) {
    motion.minY.value = bounds.min.y;
    motion.height.value = size.y;
    motion.centerZ.value = (bounds.min.z + bounds.max.z) * 0.5;
  }
  model.scale.setScalar(scale);
  model.userData.replayScale = scale;
  // Studio models are authored around the GoldSrc entity origin. Schema 3
  // records that origin directly, so moving bounds.min.y to zero lifts the
  // player by about 36 units. Only the legacy schema-2 fallback expects a
  // feet-at-origin visual because its render object keeps the old hull offset.
  if (alignFeetToOrigin) model.position.y = -bounds.min.y * scale;
  return model;
}

async function setPlayerModel(track, classId, team, modelId = 0, ducking = false) {
  const pose = ducking ? "crouch" : "stand";
  if (track.mesh.userData.modelClass === classId && track.mesh.userData.modelTeam === team &&
      track.mesh.userData.playerModelId === modelId && track.mesh.userData.modelPose === pose) return;
  track.mesh.userData.modelClass = classId;
  track.mesh.userData.modelTeam = team;
  track.mesh.userData.playerModelId = modelId;
  track.mesh.userData.modelPose = pose;
  const recordedUrl = catalogUrl(modelId, "player");
  const asset = CLASS_MODELS[classId]
    ? await modelAsset(classId, team, ducking)
    : recordedUrl ? await loadModelAsset(recordedUrl) : await modelAsset(0, team, ducking);
  if (!asset || track.mesh.userData.modelClass !== classId || track.mesh.userData.modelTeam !== team ||
      track.mesh.userData.playerModelId !== modelId || track.mesh.userData.modelPose !== pose) return;
  const targetHeight = ducking ? PLAYER_CROUCH_VISUAL_HEIGHT : PLAYER_STANDING_VISUAL_HEIGHT;
  const model = clonedPlayerModel(
    asset,
    track.schemaVersion === 2,
    targetHeight,
    track.motionUniforms
  );
  track.modelVisual.clear();
  track.modelVisual.add(model);
  track.weaponVisual.scale.setScalar(model.userData.replayScale || 1);
}

function thirdPersonModelUrl(model, classId) {
  if (!model || model.kind !== "weapon") return null;
  const name = model.path.split("/").pop();
  if (!/^p_[A-Za-z0-9_.-]+\.mdl$/i.test(name)) return null;
  const catalog = state.modelCatalog.get(model.path);
  const classKey = CLASS_MODELS[classId]?.[0];
  return catalog?.heldVariants?.[classKey] || catalog?.url || null;
}

async function setWeaponModel(track, modelId, classId) {
  const weaponKey = `${modelId}:${classId}`;
  if (track.mesh.userData.weaponModelKey === weaponKey) return;
  track.mesh.userData.weaponModelKey = weaponKey;
  track.mesh.userData.weaponModelId = modelId;
  track.weaponVisual.clear();
  track.weaponModel = null;
  track.weaponMuzzleLocal = null;
  if (!modelId) return;
  const url = thirdPersonModelUrl(state.renderModels.get(modelId), classId);
  if (!url) return;
  const asset = await loadModelAsset(url);
  if (!asset || track.mesh.userData.weaponModelKey !== weaponKey) return;
  const model = asset.clone(true);
  model.traverse(child => { if (child.isMesh) child.frustumCulled = false; });
  track.weaponVisual.add(model);
  track.weaponModel = model;
  track.weaponMuzzleLocal = modelBarrelTip(model);
}

function modelBarrelTip(model) {
  model.updateMatrixWorld(true);
  const vertices = [];
  model.traverse(child => {
    const positions = child.isMesh ? child.geometry?.getAttribute("position") : null;
    if (!positions) return;
    for (let index = 0; index < positions.count; index += 1) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, index);
      child.localToWorld(vertex);
      model.worldToLocal(vertex);
      vertices.push(vertex);
    }
  });
  if (!vertices.length) return null;
  const maxX = Math.max(...vertices.map(vertex => vertex.x));
  const tip = vertices.filter(vertex => vertex.x >= maxX - 1.5);
  return tip.reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
    .multiplyScalar(1 / tip.length);
}

async function setBuildableModel(track, modelId, team) {
  const modelKey = `${modelId}:${team}`;
  if (track.mesh.userData.modelKey === modelKey) return;
  track.mesh.userData.modelKey = modelKey;
  track.mesh.userData.modelId = modelId;
  track.visual.clear();
  if (!modelId) return;
  const recorded = state.renderModels.get(Number(modelId));
  const catalog = recorded?.kind === "buildable" ? state.modelCatalog.get(recorded.path) : null;
  const teamKey = teamInfo(team).name.toLowerCase();
  const url = catalog?.teamVariants?.[teamKey] || catalog?.url || null;
  if (!url) return;
  const asset = await loadModelAsset(url);
  if (!asset || track.mesh.userData.modelKey !== modelKey) return;
  const model = asset.clone(true);
  model.traverse(child => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    if (Array.isArray(child.material)) child.material = child.material.map(material => material.clone());
    else if (child.material) child.material = child.material.clone();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material?.color) material.userData.replayBaseColor = material.color.clone();
    }
  });
  track.visual.add(model);
  delete track.mesh.userData.renderSignature;
}

function glowTexture() {
  if (replayGlowTexture) return replayGlowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(255,255,255,0.98)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.48)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  replayGlowTexture = new THREE.CanvasTexture(canvas);
  replayGlowTexture.colorSpace = THREE.SRGBColorSpace;
  return replayGlowTexture;
}

function createGlowSprite(color = 0xffffff, opacity = 0.8, size = 32) {
  const material = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity: THREE.MathUtils.clamp(opacity, 0, 1),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  material.userData.replayBaseColor = material.color.clone();
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = 35;
  sprite.userData.replayGlowSprite = true;
  return sprite;
}

async function loadRecordedSprite(recordedPath) {
  const normalizedPath = String(recordedPath || "").trim().replace(/\\/g, "/").toLowerCase();
  const url = RECORDED_SPRITE_PATHS.get(normalizedPath);
  if (!url) return null;
  if (!recordedSpriteCache.has(normalizedPath)) {
    recordedSpriteCache.set(normalizedPath, fetch(`${url}?v=20260805schema6sprites1`)
      .then(response => response.ok ? response.arrayBuffer() : null)
      .then(buffer => buffer ? parseReplaySprite(buffer, normalizedPath) : null)
      .catch(() => null));
  }
  return recordedSpriteCache.get(normalizedPath);
}

function createRecordedSprite(frames) {
  const first = frames[0];
  const width = Number(first?.image?.width) || 48;
  const height = Number(first?.image?.height) || 48;
  const material = new THREE.SpriteMaterial({
    map: first,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  material.userData.replayBaseColor = material.color.clone();
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 35;
  sprite.userData.replaySpriteFrames = frames;
  return sprite;
}

function isNonVisualEntityClass(classname) {
  return /^trigger_/i.test(String(classname || ""));
}

async function setEntityModel(track, modelId) {
  if (track.mesh.userData.modelId === modelId) return;
  track.mesh.userData.modelId = modelId;
  track.mesh.userData.diagnosticFallback = false;
  track.mesh.userData.spriteFallback = false;
  track.mesh.userData.nativeSprite = false;
  track.visual.clear();
  const recorded = state.renderModels.get(Number(modelId));
  const semantic = sceneMetadataAt("entity", track.entityId);
  const classname = String(track.definition?.classname || "").toLowerCase();
  const isSprite = semantic?.kind === "sprite" || /\.spr$/i.test(recorded?.path || "");
  // GoldSrc trigger entities are invisible collision volumes. Model id zero
  // likewise means there is no recorded visual, not an unknown model.
  if (!Number(modelId) || isNonVisualEntityClass(classname)) return;
  // Static env_glow entities are already represented by buildMapLights. Do
  // not draw a second generic object at the same origin.
  if (classname === "env_glow") return;
  // Backpacks are a semantic entity, but older/custom AMXX builds can report
  // different model filenames (or omit the matching catalog row). The TFC
  // world backpack is the canonical visual for all of those recordings, so
  // prefer it before falling back to the diagnostic wireframe.
  const recordedPath = String(recorded?.path || "").replace(/\\/g, "/").toLowerCase();
  const url = /(?:^|\/)models\/aimpack\.mdl$/i.test(recordedPath)
    ? (state.modelCatalog.get("models/aimpack.mdl")?.url || "/assets/tfc/models/aimpack.glb")
    : semantic?.kind === "backpack"
      ? (state.modelCatalog.get("models/backpack.mdl")?.url || "/assets/tfc/models/backpack.glb")
    : catalogUrl(modelId, "entity");
  if (!url) {
    if (isSprite) {
      const frames = await loadRecordedSprite(recorded?.path);
      if (track.mesh.userData.modelId !== modelId) return;
      if (frames?.length) {
        track.visual.add(createRecordedSprite(frames));
        track.mesh.userData.nativeSprite = true;
      } else {
        track.visual.add(createGlowSprite(0xffffff, 0.8, 48));
        track.mesh.userData.spriteFallback = true;
      }
      delete track.mesh.userData.renderSignature;
      return;
    }
    track.visual.add(new THREE.Mesh(
      new THREE.BoxGeometry(12, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xaed7ff, wireframe: true })
    ));
    track.mesh.userData.diagnosticFallback = true;
    return;
  }
  const asset = await loadModelAsset(url);
  if (!asset || track.mesh.userData.modelId !== modelId) return;
  const model = asset.clone(true);
  model.traverse(child => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    if (Array.isArray(child.material)) child.material = child.material.map(material => material.clone());
    else if (child.material) child.material = child.material.clone();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material?.color) material.userData.replayBaseColor = material.color.clone();
    }
  });
  track.visual.clear();
  track.visual.add(model);
  delete track.mesh.userData.renderSignature;
}

async function setProjectileCatalogModel(track, definitionSignature) {
  // Canonical projectile visuals can carry renderer-owned children such as
  // the rocket flare. Replacing the group with the catalog GLB would silently
  // discard those effects after they were constructed.
  if (track.definition?.ignoreRecordedModel || track.definition?.flare) return;
  const url = catalogUrl(track.recordedDefinition?.modelId, "projectile");
  if (!url) return;
  const asset = await loadModelAsset(url);
  if (!asset || !track.mesh || track.definitionSignature !== definitionSignature) return;
  const model = asset.clone(true);
  model.traverse(child => { if (child.isMesh) child.frustumCulled = false; });
  track.mesh.clear?.();
  track.mesh.add?.(model);
}

function layCorpseModel(model, side) {
  model.rotation.z = side * Math.PI / 2;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (Number.isFinite(bounds.min.y)) model.position.y -= bounds.min.y;
  return model;
}

async function setCorpseModel(corpse) {
  const asset = await modelAsset(corpse.classId, corpse.team);
  if (!asset || corpse.mesh.userData.hasCorpseModel) return;
  const model = layCorpseModel(clonedPlayerModel(asset), corpse.side);
  corpse.mesh.clear();
  corpse.mesh.add(model);
  corpse.mesh.userData.hasCorpseModel = true;
}

function settleCorpse(corpse) {
  if (!mapModel || !corpse?.mesh) return false;
  scene.updateMatrixWorld(true);
  const origin = world.localToWorld(sourcePoint(corpse.x, corpse.y, corpse.z));
  origin.y += 8;
  corpseGroundRay.set(origin, corpseDown);
  corpseGroundRay.near = 0;
  corpseGroundRay.far = 8192;
  const hit = corpseGroundRay.intersectObject(mapModel, true).find(intersection =>
    isReplayMapGroundMaterial(
      intersection.object.material,
      intersection.face?.materialIndex || 0
    )
  );
  if (!hit) return false;
  const ground = corpseRoot.worldToLocal(hit.point.clone());
  corpse.mesh.position.y = ground.y + 1;
  corpse.grounded = true;
  return true;
}

function settleCorpses() {
  for (const corpse of state.corpses) settleCorpse(corpse);
}

function projectileRemoval(track) {
  const { frames, stride } = track;
  let lastActiveOffset = -1;
  for (let offset = 0; offset < frames.length; offset += stride) {
    if (frames[offset + 1] === 1) {
      lastActiveOffset = offset;
      continue;
    }
    if (lastActiveOffset < 0 || frames[offset] - frames[lastActiveOffset] > 0.25) return null;
    return {
      time: frames[offset],
      x: frames[lastActiveOffset + 2],
      y: frames[lastActiveOffset + 3],
      z: frames[lastActiveOffset + 4]
    };
  }
  return null;
}

function corpseRecords(track) {
  const records = [];
  const { frames, stride } = track;
  let previousOffset = -1;
  let previousAlive = false;
  let deathIndex = 0;

  for (let offset = 0; offset < frames.length; offset += stride) {
    const alive = frames[offset + 10] === 1;
    if (previousAlive && !alive && previousOffset >= 0) {
      records.push({
        sessionId: track.sessionId,
        startsAt: frames[offset],
        endsAt: frames[offset] + CORPSE_LIFETIME_SECONDS,
        x: frames[previousOffset + 1],
        y: frames[previousOffset + 2],
        z: frames[previousOffset + 3],
        yaw: frames[previousOffset + 8],
        team: Math.round(frames[previousOffset + 11]),
        classId: Math.round(frames[previousOffset + 12]),
        buttons: Math.round(frames[previousOffset + 14]),
        side: ((track.sessionId + deathIndex) % 2) ? 1 : -1
      });
      deathIndex += 1;
    }
    previousAlive = alive;
    previousOffset = offset;
  }
  return records;
}

function buildVisuals() {
  for (const track of state.players) {
    if (track.mesh) continue;
    const roster = state.roster.find(row => row.sessionId === track.sessionId);
    const team = roster?.team || 0;
    track.mesh = new THREE.Group();
    track.playerVisual = new THREE.Group();
    track.modelVisual = new THREE.Group();
    track.weaponVisual = new THREE.Group();
    track.motionUniforms = playerMotionUniforms();
    track.motionPhase = 0;
    track.motionWalk = 0;
    track.motionAir = 0;
    track.motionTuck = 0;
    track.motionLastTime = null;
    track.motionLastX = null;
    track.motionLastY = null;
    track.motionAirUntil = -Infinity;
    track.modelVisual.add(fallbackPlayerMesh(team, track.schemaVersion >= 3));
    track.playerVisual.add(track.modelVisual, track.weaponVisual);
    track.mesh.add(track.playerVisual);
    track.mesh.visible = false;
    track.mesh.userData.sessionId = track.sessionId;
    playerRoot.add(track.mesh);
    track.acFireVisual = createAssaultCannonVisual();
    hitscanRoot.add(track.acFireVisual.group);

    // Completed replays can keep an independent corpse after the player has
    // respawned. The engine body queue may be released in under a second, so
    // its corpse_end event is not a useful visual lifetime for this fallback.
    if (!LIVE_MODE) {
      for (const corpse of corpseRecords(track)) {
        const recordedDeath = replaySchemaVersion() >= 6
          ? playerDeathAt(corpse.sessionId, corpse.startsAt + 0.001)
          : null;
        if (replaySchemaVersion() >= 6 && (!recordedDeath || recordedDeath.gibbed)) continue;
        corpse.mesh = new THREE.Group();
        corpse.mesh.visible = false;
        corpse.mesh.position.copy(sourcePoint(corpse.x, corpse.y, corpse.z));
        if (track.schemaVersion === 2) {
          corpse.mesh.position.y -= (corpse.buttons & 4) ? 18 : 36;
        }
        corpse.mesh.rotation.y = THREE.MathUtils.degToRad(corpse.yaw);
        corpse.mesh.add(layCorpseModel(fallbackPlayerMesh(corpse.team), corpse.side));
        corpseRoot.add(corpse.mesh);
        state.corpses.push(corpse);
        void setCorpseModel(corpse);
      }
    }

    const { frames, stride } = track;
    let previousOffset = -1;
    for (let offset = 0; offset < frames.length; offset += stride) {
      if (previousOffset >= 0) {
        const previousAlive = frames[previousOffset + 10] === 1;
        const alive = frames[offset + 10] === 1;
        const previousHealth = Number(frames[previousOffset + 15]);
        const health = Number(frames[offset + 15]);
        const damage = previousHealth - health;
        if (previousAlive && Number.isFinite(damage) && damage > 0 && (alive || health <= 0)) {
          const positionOffset = alive ? offset : previousOffset;
          const position = sourcePoint(
            frames[positionOffset + 1],
            frames[positionOffset + 2],
            frames[positionOffset + 3]
          );
          const crouched = track.schemaVersion >= 3
            ? frames[positionOffset + 17] === 1
            : Boolean(Math.round(frames[positionOffset + 14]) & 4);
          position.y += crouched ? 24 : 43;
          const effect = projectileVisuals.blood(position, frames[offset], damage);
          state.bloodEffects.push(effect);
          bloodRoot.add(effect.group);
        }
      }
      previousOffset = offset;
    }
  }
  for (const track of state.projectiles) {
    const rawRecorded = state.projectileDefinitions.get(track.projectileId);
    // In live mode a projectile definition can precede its render_models row.
    // Re-resolve the model id here so a late dictionary row reclassifies a
    // bare catalog rocket as the flare-enabled canonical rocket visual.
    const resolvedModel = rawRecorded?.model ||
      state.renderModels.get(Number(rawRecorded?.modelId))?.path || "";
    const recorded = rawRecorded && resolvedModel !== rawRecorded.model
      ? { ...rawRecorded, model: resolvedModel }
      : rawRecorded;
    const definitionSignature = recorded
      ? `${recorded.modelId || 0}:${recorded.classname || ""}:${resolvedModel}:${recorded.ownerWeapon || 0}`
      : "pending";
    if (track.mesh && track.definitionSignature === definitionSignature) continue;
    track.recordedDefinition = recorded;
    track.definition = replayProjectileDefinition(recorded);
    if (!track.mesh) {
      track.mesh = new THREE.Group();
      projectileRoot.add(track.mesh);
    }
    track.definitionSignature = definitionSignature;
    if (track.rocketTrail) {
      projectileRoot.remove(track.rocketTrail);
      track.rocketTrail.geometry.dispose();
      track.rocketTrail.material.dispose();
      track.rocketTrail = null;
    }
    track.mesh.clear();
    // A white sphere is useful in completed-replay diagnostics, but confusing
    // in a live feed while its dictionary/model row is only milliseconds late.
    // Known projectile types retain their intentional fallback geometry.
    if (recorded && track.definition.key !== "unknown") {
      track.mesh.add(projectileVisuals.projectile(track.definition));
      if (track.definition.flare) {
        track.rocketTrail = projectileVisuals.rocketTrail();
        projectileRoot.add(track.rocketTrail);
      }
    }
    track.mesh.visible = false;
    void setProjectileCatalogModel(track, definitionSignature);
    const removal = track.impactCreated ? null : projectileRemoval(track);
    if (removal && recorded && track.definition.impact !== "none") {
      const impact = projectileVisuals.impact(
        track.definition,
        sourcePoint(removal.x, removal.y, removal.z),
        removal.time
      );
      state.impacts.push(impact);
      impactRoot.add(impact.group);
      track.impactCreated = true;
    }
  }
  for (const track of state.objectives) {
    if (track.mesh) continue;
    const definition = state.objectiveDefinitions.get(track.objectiveId);
    track.definition = definition;
    track.team = objectiveTeam(definition, track.objectiveId);
    const color = teamInfo(track.team).color;
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(14, 30, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18 })
    );
    track.mesh = new THREE.Group();
    track.mesh.add(placeholder);
    track.mesh.visible = false;
    objectiveRoot.add(track.mesh);
    void setObjectiveModel(track);
  }
  for (const track of state.buildables) {
    if (track.mesh) continue;
    track.definition = state.buildableDefinitions.get(track.buildableId);
    track.mesh = new THREE.Group();
    track.visual = new THREE.Group();
    const color = teamInfo(0).color;
    track.visual.add(new THREE.Mesh(
      new THREE.BoxGeometry(28, 42, 28),
      new THREE.MeshStandardMaterial({ color, wireframe: true })
    ));
    track.mesh.add(track.visual);
    track.mesh.visible = false;
    track.mesh.userData.buildableId = track.buildableId;
    buildableRoot.add(track.mesh);
  }
  for (const track of state.entities) {
    if (track.mesh) continue;
    track.definition = state.entityDefinitions.get(track.entityId);
    track.mesh = new THREE.Group();
    track.visual = new THREE.Group();
    track.mesh.add(track.visual);
    track.mesh.visible = false;
    track.mesh.userData.entityId = track.entityId;
    entityRoot.add(track.mesh);
  }
}

function bindBrushNodes() {
  if (!mapModel) return;
  const nodes = new Map();
  mapModel.traverse(child => {
    if (/^\*[1-9]\d*$/.test(child.name) && !nodes.has(child.name)) nodes.set(child.name, child);
  });
  for (const track of state.brushes) {
    if (track.node) continue;
    track.definition = state.brushDefinitions.get(track.brushId);
    track.node = nodes.get(track.definition?.model) || null;
    if (!track.node) continue;
    track.nonVisual = isNonVisualEntityClass(track.definition?.classname);
    if (track.nonVisual) {
      track.node.visible = false;
      continue;
    }
    track.node.userData.brushId = track.brushId;
    track.node.traverse(child => {
      if (!child.isMesh) return;
      if (Array.isArray(child.material)) child.material = child.material.map(material => material.clone());
      else if (child.material) child.material = child.material.clone();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material?.color) material.userData.replayBaseColor = material.color.clone();
      }
    });
  }
}

function buildRoster() {
  const container = $("pickup-roster");
  container.innerHTML = "";
  const grouped = new Map();
  for (const row of state.roster) {
    if (!grouped.has(row.team)) grouped.set(row.team, []);
    grouped.get(row.team).push(row);
  }
  for (const [team, rows] of [...grouped].sort((a, b) => a[0] - b[0])) {
    const info = teamInfo(team);
    const group = document.createElement("section");
    group.className = "pickup-team-group";
    group.style.setProperty("--team-color", info.css);
    const heading = document.createElement("div");
    heading.className = "pickup-team-heading";
    heading.innerHTML = `<span></span><small>${rows.length} players</small>`;
    heading.querySelector("span").textContent = info.name;
    const players = document.createElement("div");
    players.className = "pickup-team-players";
    group.append(heading, players);
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pickup-player";
      button.dataset.sessionId = row.sessionId;
      button.style.setProperty("--team-color", info.css);
      button.innerHTML = `
        <span class="pickup-player-dot"></span>
        <span class="pickup-player-copy"><strong></strong><small></small></span>
        <span class="pickup-player-state">—</span>`;
      button.querySelector("strong").textContent = row.name;
      button.querySelector("small").textContent = row.steamid;
      button.addEventListener("click", () => selectPlayer(row.sessionId));
      players.appendChild(button);
    }
    container.appendChild(group);
  }
  $("pickup-roster-count").textContent = `${state.roster.length} sessions`;
}

function eventDescription(event) {
  const actor = state.roster.find(row => row.sessionId === event.actorSession)?.name;
  const target = state.roster.find(row => row.sessionId === event.targetSession)?.name;
  const label = String(event.event || "event").replace(/_/g, " ");
  if (actor && target) return `${actor} ${label} ${target}`;
  if (actor) return `${actor} · ${label}${event.text ? ` · ${event.text}` : ""}`;
  return `${label}${event.text ? ` · ${event.text}` : ""}`;
}

function prettyWeaponName(value) {
  const label = String(value || "").trim();
  if (!label) return "";
  return label
    .replace(/^tf[_-]?/i, "")
    .replace(/^weapon[_-]?/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function deathNoticeWeapon(raw) {
  const direct = prettyWeaponName(raw?.text);
  if (direct) return direct;
  const time = Number(raw?.time) || 0;
  const actorSession = Number(raw?.actorSession) || 0;
  const targetSession = Number(raw?.targetSession) || 0;
  const notice = state.sceneEvents.find(event =>
    event.event === "death_notice" &&
    Math.abs((Number(event.time) || 0) - time) < 0.1 &&
    Number(event.actorSession) === actorSession &&
    Number(event.targetSession) === targetSession &&
    String(event.text || "").trim()
  );
  const noticeWeapon = prettyWeaponName(notice?.text);
  if (noticeWeapon) return noticeWeapon;
  const lastShot = [...state.events].reverse().find(event =>
    event.event === "weapon_fire" &&
    Number(event.actorSession) === actorSession &&
    (Number(event.time) || 0) <= time &&
    time - (Number(event.time) || 0) <= 1.5 &&
    String(event.text || "").trim()
  );
  return prettyWeaponName(lastShot?.text);
}

function buildKillFeedEvents() {
  const rows = [];
  const seen = new Set();
  const add = (raw, source) => {
    if (String(raw?.event || "").toLowerCase() !== "death") return;
    const time = Math.max(0, Number(raw?.time) || 0);
    const actorSession = Number(raw?.actorSession) || 0;
    const targetSession = Number(raw?.targetSession) || 0;
    const key = Math.round(time * 1000) + "|" + actorSession + "|" + targetSession;
    if (seen.has(key)) return;
    seen.add(key);
    const actor = analysisRosterRow(actorSession);
    const target = analysisRosterRow(targetSession);
    const actorName = actor?.name || "Unknown player";
    const targetName = target?.name || "Unknown player";
    const suicide = actorSession > 0 && actorSession === targetSession;
    const weapon = deathNoticeWeapon(raw);
    const text = suicide
      ? `${targetName} died from suicide`
      : actorSession && targetSession
        ? `${actorName} killed ${targetName}${weapon ? " with " + weapon : ""}`
        : `${targetName} died`;
    rows.push({
      id: source + "-" + key,
      time,
      text,
      suicide,
      actorName,
      targetName,
      weapon
    });
  };
  state.events.forEach((event, index) => add(event, "events-" + index));
  state.sceneEvents.forEach((event, index) => add(event, "scene-" + index));
  return rows.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

function renderKillFeed(force = false) {
  const feed = $("replay-kill-feed");
  const container = $("replay-kill-events");
  if (!feed || !container) return;
  const current = state.playbackTime;
  const recent = state.killFeedEvents
    .filter(event => event.time <= current + 0.001 && event.time >= current - 12)
    .slice(-6);
  const key = Math.floor(current) + "|" + recent.map(event => event.id).join(",");
  if (!force && key === state.lastKillFeedRenderKey) return;
  state.lastKillFeedRenderKey = key;
  container.innerHTML = "";
  feed.hidden = recent.length === 0;
  for (const event of recent) {
    const item = document.createElement("article");
    item.className = "replay-kill-event" + (event.suicide ? " suicide" : "");
    const time = document.createElement("time");
    time.textContent = formatTime(event.time);
    const copy = document.createElement("p");
    copy.textContent = event.text;
    item.append(time, copy);
    container.appendChild(item);
  }
}

function pickupTimelineEvent(event) {
  const gains = [
    [event.shells, "shells"], [event.bullets, "bullets"], [event.cells, "cells"],
    [event.rockets, "rockets"], [event.nade1, "grenade 1"], [event.nade2, "grenade 2"],
    [event.health, "health"], [event.armor, "armor"]
  ].filter(([amount]) => amount > 0).map(([amount, label]) => `+${amount} ${label}`);
  return {
    ...event,
    event: `picked up ${String(event.objectKind || "item").replace(/_/g, " ")}`,
    text: gains.join(" · ")
  };
}

function timelineEvents() {
  return [
    ...state.events,
    ...state.sceneEvents.filter(event => event.event === "pickup").map(pickupTimelineEvent)
  ].sort((a, b) => a.time - b.time || (a.sequence || 0) - (b.sequence || 0));
}


const ANALYSIS_MAX_MARKERS = 360;
const ANALYSIS_MAX_ROWS = 48;
const ANALYSIS_CATEGORY_COLORS = {
  objectives: "#facc15",
  combat: "#fb7185",
  player: "#60a5fa",
  scene: "#a78bfa"
};

function analysisCategory(type, source) {
  const value = String(type || "").toLowerCase();
  if (/(capture|flag|goal|objective|pickup|round|recording)/.test(value)) return "objectives";
  if (/(kill|death|damage|hit|fire|weapon|attack|shot|rocket|grenade|suicide|gib)/.test(value)) return "combat";
  if (/(join|connect|disconnect|leave|team|class|respawn|ready)/.test(value)) return "player";
  if (source === "scene" || /(entity|buildable|brush|spawn|activate|deactivate|remove|corpse|map)/.test(value)) {
    return "scene";
  }
  return "scene";
}

function humanizeAnalysisType(type) {
  const value = String(type || "event").replace(/^flag_entity_/, "flag ");
  const label = value.replace(/[_-]+/g, " ").trim();
  return label ? label.replace(/\b\w/g, letter => letter.toUpperCase()) : "Event";
}

function analysisRosterRow(sessionId) {
  return state.roster.find(row => Number(row.sessionId) === Number(sessionId)) || null;
}

function analysisColor(category, teamNumber) {
  return teamNumber ? teamInfo(teamNumber).css : ANALYSIS_CATEGORY_COLORS[category] || "#94a3b8";
}

function isFlagPickupEvent(raw) {
  const identity = [raw?.event, raw?.text, raw?.objectKind, raw?.objectStream]
    .filter(Boolean).join(" ").toLowerCase();
  const isObjectivePickup = raw?.event === "pickup" && raw?.objectStream === "objective";
  const isFlag = isObjectivePickup || /(flag|ctf|item_tfgoal|goalitem)/.test(identity);
  const isPickup = /(carried|pickup|pick_up|picked|take|taken|touch|grab)/.test(identity);
  if (!isFlag || !isPickup) return false;
  if (raw?.event === "pickup") {
    return raw?.objectStream === "objective" || /(flag|goal|objective)/.test(identity);
  }
  return true;
}

function flagCaptureCarrier(raw, index, source) {
  if (source !== "events.csv") return 0;
  const identity = [raw?.event, raw?.text].filter(Boolean).join(" ").toLowerCase();
  if (/capture/.test(identity) && /flag|goal|ctf/.test(identity)) {
    return Number(raw?.actorSession) || 0;
  }
  if (raw?.event !== "flag_entity_base" || !raw?.entity) return 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = state.events[cursor];
    if (previous.entity !== raw.entity || !String(previous.event).startsWith("flag_entity_")) continue;
    return previous.event === "flag_entity_carried" ? Number(previous.actorSession) || 0 : 0;
  }
  return 0;
}

function flagPickupHeldMoreThanTwoSeconds(raw, source) {
  const pickupTime = Math.max(0, Number(raw?.time) || 0);
  let followupEvents = [];
  let matchesFollowup = () => false;
  if (source === "events.csv" && raw?.event === "flag_pickup") {
    followupEvents = state.events;
    const actor = Number(raw.actorSession) || 0;
    const team = String(raw.text || "").toLowerCase();
    matchesFollowup = event => event.event === "flag_release" &&
      (!actor || Number(event.actorSession) === actor) &&
      (!team || String(event.text || "").toLowerCase() === team);
  } else if (source === "events.csv" && raw?.event === "flag_entity_carried") {
    followupEvents = state.events;
    const entity = Number(raw.entity) || 0;
    matchesFollowup = event => ["flag_entity_dropped", "flag_entity_base"].includes(event.event) &&
      (!entity || Number(event.entity) === entity);
  } else {
    return true;
  }
  const followup = followupEvents.find(event =>
    (Number(event.time) || 0) > pickupTime && matchesFollowup(event)
  );
  const endTime = followup ? Number(followup.time) : state.duration;
  return endTime - pickupTime > 2;
}

function normalizeAnalysisEvent(raw, source, index) {
  const type = String(raw?.event || "event").toLowerCase();
  const time = Math.max(0, Number(raw?.time) || 0);
  const actor = analysisRosterRow(raw?.actorSession);
  const target = analysisRosterRow(raw?.targetSession);
  const category = analysisCategory(type, source);
  const actorName = actor?.name || "";
  const targetName = target?.name || "";
  const names = actorName && targetName
    ? actorName + " → " + targetName
    : actorName || targetName || "";
  const text = String(raw?.text || "").trim();
  const isCapture = type === "flag_capture" || /capture/.test(type);
  const object = raw?.objectKind || raw?.objectStream || "";
  const quantities = [
    ["health", raw?.health], ["armor", raw?.armor], ["shells", raw?.shells],
    ["bullets", raw?.bullets], ["cells", raw?.cells], ["rockets", raw?.rockets],
    ["nade1", raw?.nade1], ["nade2", raw?.nade2]
  ].filter(([, amount]) => Number(amount) > 0).map(([name, amount]) => name + " +" + amount);
  const detailParts = [names, text, object, ...quantities].filter(Boolean);
  const teamNumber = actor?.team || target?.team || 0;
  return {
    id: source + "-" + index + "-" + Math.round(time * 1000),
    time,
    timeMs: Math.round(time * 1000),
    category,
    type,
    label: isCapture ? "Flag captured" : "Flag picked up",
    actorSession: Number(raw?.actorSession) || 0,
    targetSession: Number(raw?.targetSession) || 0,
    playerName: actorName || targetName || "",
    team: teamInfo(teamNumber).name,
    teamNumber,
    color: isCapture ? "#facc15" : analysisColor(category, teamNumber),
    details: detailParts.join(" · ") || "No additional event metadata",
    source,
    raw,
    isFlagPickup: !isCapture,
    isFlagCapture: isCapture
  };
}

function buildAnalysisEvents() {
  const raw = [
    ...state.events.map((event, index) => ({ event, source: "events.csv", index })),
    ...state.sceneEvents.map((event, index) => ({ event, source: "scene_events.csv", index }))
  ];
  const captures = state.events.map((event, index) => {
    const carrier = flagCaptureCarrier(event, index, "events.csv");
    if (!carrier) return null;
    return {
      event: { ...event, event: "flag_capture", actorSession: carrier },
      source: "events.csv",
      index: "capture-" + index
    };
  }).filter(Boolean);
  const normalized = [...raw, ...captures]
    .filter(item => item.event.event === "flag_capture" || (
      isFlagPickupEvent(item.event) && flagPickupHeldMoreThanTwoSeconds(item.event, item.source)
    ))
    .map(item => normalizeAnalysisEvent(item.event, item.source, item.index));
  const pickups = new Map();
  for (const event of normalized) {
    const key = event.timeMs + "|" + event.actorSession + "|" + event.targetSession + "|" +
      event.playerName + "|" + (event.isFlagCapture ? "capture" : "pickup");
    const existing = pickups.get(key);
    if (!existing || (existing.type === "flag_entity_carried" && event.type === "flag_pickup")) {
      pickups.set(key, event);
    }
  }
  return [...pickups.values()]
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

function analysisMatches(event) {
  return event.isFlagPickup === true || event.isFlagCapture === true;
}

function visibleAnalysisEvents() {
  return state.analysisEvents.filter(analysisMatches);
}

function analysisMarkerEvents(events) {
  if (events.length <= ANALYSIS_MAX_MARKERS) return events;
  const duration = Math.max(.001, state.duration);
  const buckets = new Map();
  for (const event of events) {
    const bucket = Math.min(ANALYSIS_MAX_MARKERS - 1, Math.floor(event.time / duration * ANALYSIS_MAX_MARKERS));
    const key = bucket + ":" + event.category + ":" + (event.isFlagCapture ? "capture" : "pickup");
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.label = existing.label + " +" + (existing.count - 1);
      existing.details = existing.details + " · " + existing.count + " events in this interval";
    } else {
      buckets.set(key, { ...event, count: 1, id: "aggregate-" + key });
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function analysisEventAtId(id) {
  return state.analysisEvents.find(event => event.id === id) ||
    state.visibleAnalysisEvents.find(event => event.id === id) ||
    state.selectedAnalysisEventData || null;
}

function renderAnalysisDetail(event = analysisEventAtId(state.selectedAnalysisEvent)) {
  const title = $("analysis-detail-title");
  const meta = $("analysis-detail-meta");
  const copy = $("analysis-detail-copy");
  const seek = $("analysis-detail-seek");
  if (!title || !meta || !copy || !seek) return;
  if (!event) {
    title.textContent = "Select an event";
    meta.textContent = "Click an event to jump to the carrier";
    copy.textContent = "Selection starts five seconds before the pickup and switches to the relevant player POV.";
    seek.disabled = true;
    return;
  }
  title.textContent = event.count > 1 ? event.label + " · " + event.count + " grouped" : event.label;
  meta.textContent = formatTime(event.time) + " · flag pickup";
  copy.textContent = event.details;
  seek.disabled = false;
}

function seekToAnalysisEvent(event) {
  if (!event) return;
  const limit = LIVE_MODE ? state.liveEdge : state.duration;
  const focusSession = analysisFocusSession(event);
  state.playbackTime = Math.min(limit, Math.max(0, event.time - 5));
  if (LIVE_MODE) state.followLive = false;
  if (focusSession && state.playerBySession.has(Number(focusSession))) {
    selectPlayer(focusSession);
    setCameraMode("pov");
  }
  updateScene();
  renderAnalysisDetail(event);
}

function analysisFocusSession(event) {
  const explicitSession = Number(event.actorSession || event.targetSession);
  if (explicitSession) return explicitSession;
  const objectId = Number(event.raw?.objectId);
  const entityId = Number(event.raw?.entity);
  if (!objectId && !entityId) return 0;
  for (const track of state.objectives) {
    const definition = state.objectiveDefinitions.get(track.objectiveId);
    if (objectId && track.objectiveId !== objectId) continue;
    if (entityId && Number(definition?.entity) !== entityId) continue;
    const snapshot = objectiveSnapshot(track, event.time);
    if (snapshot?.carrierSession) return snapshot.carrierSession;
  }
  return 0;
}

function selectAnalysisEvent(event) {
  if (!event) return;
  state.selectedAnalysisEvent = event.id;
  state.selectedAnalysisEventData = event;
  seekToAnalysisEvent(event);
  document.querySelectorAll(".analysis-event-marker, .analysis-event-row, .replay-flag-marker").forEach(node => {
    node.classList.toggle("selected", node.dataset.analysisId === event.id);
  });
}

function renderAnalysisTimeline(force = false) {
  state.analysisEvents = buildAnalysisEvents();
  const events = visibleAnalysisEvents();
  state.visibleAnalysisEvents = events;
  const markerEvents = analysisMarkerEvents(events);
  const duration = Math.max(.001, state.duration);
  const markerLayer = $("analysis-markers");
  const list = $("analysis-event-list");
  const count = $("analysis-event-count");
  const scrubMarkerLayer = $("replay-flag-markers");
  if (!scrubMarkerLayer) return;
  if (!force && state.analysisRenderKey === state.analysisFilter + "|" + state.analysisPlayer + "|" + state.analysisEvents.length) {
    updateAnalysisPlayback();
    return;
  }
  state.analysisRenderKey = state.analysisFilter + "|" + state.analysisPlayer + "|" + state.analysisEvents.length;
  if (count) count.textContent = events.length.toLocaleString() + " flag pickups";
  if (markerLayer) markerLayer.innerHTML = "";
  if (list) list.innerHTML = "";
  scrubMarkerLayer.innerHTML = "";
  for (const event of markerEvents) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "replay-flag-marker" + (event.isFlagCapture ? " replay-capture-marker" : "");
    marker.dataset.analysisId = event.id;
    marker.title = formatTime(event.time) + " · " + event.label + (event.playerName ? " by " + event.playerName : "");
    marker.setAttribute("aria-label", marker.title);
    marker.style.left = Math.min(100, Math.max(0, event.time / duration * 100)) + "%";
    marker.style.setProperty("--event-color", event.color);
    marker.addEventListener("click", () => selectAnalysisEvent(event));
    scrubMarkerLayer.appendChild(marker);
  }
  if (markerLayer) markerLayer.innerHTML = "";
  updateAnalysisPlayback();
}

function updateAnalysisPlayback() {
  const playhead = $("analysis-playhead");
  const current = $("analysis-current-time");
  const duration = Math.max(.001, state.duration);
  if (playhead) playhead.style.left = Math.min(100, Math.max(0, state.playbackTime / duration * 100)) + "%";
  if (current) current.textContent = formatTime(state.playbackTime);
  const events = state.visibleAnalysisEvents || [];
  let active = null;
  for (const event of events) {
    if (event.time > state.playbackTime) break;
    active = event;
  }
  const activeId = active?.id || "";
  if (activeId === state.activeAnalysisEvent) return;
  state.activeAnalysisEvent = activeId;
  document.querySelectorAll(".analysis-event-marker, .analysis-event-row, .replay-flag-marker").forEach(node => {
    node.classList.toggle("active", Boolean(activeId) && node.dataset.analysisId === activeId);
  });
}

function wireAnalysisControls() {
  $("analysis-detail-seek")?.addEventListener("click", () => {
    seekToAnalysisEvent(analysisEventAtId(state.selectedAnalysisEvent));
  });
}


function selectPlayer(sessionId) {
  if (!state.playerBySession.has(Number(sessionId))) return;
  state.selectedSession = Number(sessionId);
  document.querySelectorAll(".pickup-player").forEach(button => {
    button.classList.toggle("active", Number(button.dataset.sessionId) === state.selectedSession);
  });
  const roster = state.roster.find(row => row.sessionId === state.selectedSession);
  if (roster) {
    $("pickup-selected-name").textContent = roster.name;
    $("pickup-selected-team").style.setProperty("--team-color", teamInfo(roster.team).css);
  }
}

function updatePlayerMotion(track, frame, crouched) {
  const previousTime = track.motionLastTime;
  const elapsed = previousTime == null ? 0 : state.playbackTime - previousTime;
  const continuous = elapsed >= 0 && elapsed <= 0.25;
  const horizontalSpeed = Math.hypot(frame.vx, frame.vy);
  const recordedAir = frame.schemaVersion >= 3 && (
    frame.sequence === 8 || frame.sequence === 9 ||
    frame.gaitsequence === 8 || frame.gaitsequence === 9
  );
  if (recordedAir || Math.abs(frame.vz) > 32) {
    track.motionAirUntil = state.playbackTime + PLAYER_AIR_HOLD_SECONDS;
  }
  const airborne = state.playbackTime < track.motionAirUntil;
  const walkTarget = !airborne && !crouched
    ? THREE.MathUtils.clamp((horizontalSpeed - 10) / 190, 0, 1)
    : 0;
  const airTarget = airborne ? 1 : 0;
  const tuckTarget = airborne ? (crouched ? 0.38 : 1) : 0;

  if (continuous && track.motionLastX != null && track.motionLastY != null) {
    const distance = Math.hypot(frame.x - track.motionLastX, frame.y - track.motionLastY);
    if (distance < 96) track.motionPhase += (distance / PLAYER_STRIDE_LENGTH) * Math.PI * 2;
    const blend = 1 - Math.exp(-elapsed * PLAYER_MOTION_RESPONSE);
    track.motionWalk = THREE.MathUtils.lerp(track.motionWalk, walkTarget, blend);
    track.motionAir = THREE.MathUtils.lerp(track.motionAir, airTarget, blend);
    track.motionTuck = THREE.MathUtils.lerp(track.motionTuck, tuckTarget, blend);
  } else {
    track.motionPhase = (state.playbackTime * Math.max(horizontalSpeed, 80) / PLAYER_STRIDE_LENGTH) * Math.PI * 2;
    track.motionWalk = walkTarget;
    track.motionAir = airTarget;
    track.motionTuck = tuckTarget;
  }

  track.motionUniforms.phase.value = track.motionPhase;
  track.motionUniforms.walk.value = track.motionWalk;
  track.motionUniforms.air.value = track.motionAir;
  track.motionUniforms.tuck.value = track.motionTuck;
  track.motionLastTime = state.playbackTime;
  track.motionLastX = frame.x;
  track.motionLastY = frame.y;
}

function updatePlayers() {
  for (const track of state.players) {
    if (!track.mesh) continue;
    const frame = playerSnapshot(track, state.playbackTime);
    const joined = state.roster.find(row => row.sessionId === track.sessionId)?.joinedMs / 1000 || 0;
    track.mesh.visible = Boolean(frame && state.playbackTime >= joined);
    if (!frame || state.playbackTime < joined) {
      if (track.acFireVisual) track.acFireVisual.group.visible = false;
      continue;
    }
    const death = replaySchemaVersion() >= 6 ? playerDeathAt(track.sessionId) : null;
    // Live mode uses the player-backed fall while data is still arriving.
    // Completed replays use the independent corpse meshes built above so a
    // respawn does not move or erase the prior body.
    const playerBackedCorpse = Boolean(LIVE_MODE && death && !death.gibbed);
    track.mesh.position.copy(sourcePoint(frame.x, frame.y, frame.z));
    // Schema 3 records the authoritative entity origin, including crouch transitions.
    // Keep the legacy visual offset only for schema 2's basic fallback.
    if (frame.schemaVersion === 2) track.mesh.position.y -= isDucking(frame) ? 18 : 36;
    track.mesh.rotation.y = THREE.MathUtils.degToRad(frame.schemaVersion >= 3 ? frame.bodyYaw : frame.yaw);
    const crouched = frame.schemaVersion >= 3 && isDucking(frame);
    if (frame.alive) {
      updatePlayerMotion(track, frame, crouched);
    } else {
      track.motionUniforms.walk.value = 0;
      track.motionUniforms.air.value = 0;
      track.motionUniforms.tuck.value = 0;
    }
    const fallProgress = playerBackedCorpse
      ? THREE.MathUtils.smoothstep(state.playbackTime - death.startsAt, 0, 0.65)
      : 0;
    const deathSide = ((track.sessionId + (death?.deathId || 0)) % 2) ? 1 : -1;
    track.playerVisual.position.y = crouched ? 2.5 : 0;
    track.weaponVisual.position.y = crouched ? -18 : 0;
    track.playerVisual.rotation.x = THREE.MathUtils.degToRad(frame.schemaVersion >= 3 ? frame.bodyPitch : 0);
    track.playerVisual.rotation.z =
      THREE.MathUtils.degToRad(frame.schemaVersion >= 3 ? frame.bodyRoll : 0) +
      deathSide * fallProgress * Math.PI / 2;
    const isSelectedPov =
      state.cameraMode === "pov" && track.sessionId === state.selectedSession;
    track.mesh.visible = (frame.alive || playerBackedCorpse) && !isSelectedPov;
    void setPlayerModel(track, frame.classId, frame.team, frame.playerModelId || 0, crouched);
    if (frame.schemaVersion >= 3) {
      void setWeaponModel(track, frame.weaponModelId, frame.classId);
      Object.assign(track.playerVisual.userData, {
        recordedPlayerModel: state.renderModels.get(frame.playerModelId)?.path || null,
        recordedPlayerAsset: catalogUrl(frame.playerModelId, "player"),
        body: frame.body, skin: frame.skin, sequence: frame.sequence,
        gaitsequence: frame.gaitsequence, frame: frame.frame, framerate: frame.framerate,
        animtime: frame.animtime, controller: frame.controller, blending: frame.blending
      });
    }
    if (death) {
      track.playerVisual.userData.death = {
        deathId: death.deathId,
        sequence: death.deathSequence || frame.sequence || 0,
        gaitsequence: death.deathGaitSequence || frame.gaitsequence || 0,
        frame: frame.frame || 0,
        gibDirective: death.gibDirective,
        lethalDamageBits: death.lethalDamageBits,
        inflictor: death.inflictor,
        weaponNotice: death.weaponNotice
      };
    } else {
      delete track.playerVisual.userData.death;
    }
    updateAssaultCannonVisual(track, frame, state.playbackTime);

    const button = document.querySelector(`.pickup-player[data-session-id="${track.sessionId}"]`);
    if (button) {
      button.classList.toggle("dead", !frame.alive);
      button.querySelector(".pickup-player-state").textContent = frame.alive ? `${frame.health} HP` : "DEAD";
    }
  }
}

function updateBuildables() {
  for (const track of state.buildables) {
    if (!track.mesh) continue;
    const frame = buildableSnapshot(track, state.playbackTime);
    track.mesh.visible = Boolean(frame && !(frame.effects & 128));
    if (!frame || !track.mesh.visible) continue;
    track.mesh.position.copy(sourcePoint(frame.x, frame.y, frame.z));
    track.mesh.rotation.set(
      THREE.MathUtils.degToRad(frame.pitch),
      THREE.MathUtils.degToRad(frame.yaw),
      THREE.MathUtils.degToRad(frame.roll)
    );
    track.mesh.scale.setScalar(frame.scale > 0 ? frame.scale : 1);
    // A few recorder builds emitted the engine entity's stale team field for
    // sentries. The owner snapshot is authoritative for the buildable palette.
    const visualTeam = buildableVisualTeam(track, frame, state.playbackTime);
    void setBuildableModel(track, frame.modelId, visualTeam);
    const signature = [frame.renderamt, ...frame.color, frame.rendermode, frame.renderfx].join(":");
    if (track.mesh.userData.renderSignature !== signature) {
      track.mesh.userData.renderSignature = signature;
      // GoldSrc ignores renderamt for kRenderNormal. Recorder snapshots often
      // contain renderamt=0 for ordinary opaque sentries and dispensers.
      const opacity = frame.rendermode === 0
        ? 1
        : THREE.MathUtils.clamp(frame.renderamt / 255, 0, 1);
      const tint = new THREE.Color(
        THREE.MathUtils.clamp(frame.color[0] / 255, 0, 1),
        THREE.MathUtils.clamp(frame.color[1] / 255, 0, 1),
        THREE.MathUtils.clamp(frame.color[2] / 255, 0, 1)
      );
      track.visual.traverse(child => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!material) continue;
          if (material.color && material.userData.replayBaseColor) {
            material.color.copy(material.userData.replayBaseColor);
            if (frame.rendermode !== 0 && frame.color.some(channel => channel > 0)) {
              material.color.multiply(tint);
            }
          }
          material.opacity = opacity;
          material.transparent = opacity < 1 || frame.rendermode !== 0;
          material.depthWrite = opacity >= 1;
        }
      });
    }
    Object.assign(track.mesh.userData, {
      ownerSession: frame.ownerSession, team: frame.team, visualTeam, health: frame.health,
      body: frame.body, skin: frame.skin, sequence: frame.sequence,
      gaitsequence: frame.gaitsequence, animationFrame: frame.frame,
      framerate: frame.framerate, animtime: frame.animtime,
      controller: frame.controller, blending: frame.blending, aiment: frame.aiment,
      unsupportedGoldSrcState: ["body", "skin", "sequence", "gaitsequence", "controller", "blending", "aiment"]
    });
  }
}

function updateEntities() {
  for (const track of state.entities) {
    if (!track.mesh) continue;
    const frame = entitySnapshot(track, state.playbackTime);
    const semantic = sceneMetadataAt("entity", track.entityId);
    const nonVisual = isNonVisualEntityClass(track.definition?.classname);
    const substitutedCorpseBody = semantic?.kind === "corpse_body";
    track.mesh.visible = Boolean(
      frame && !(frame.effects & 128) && !nonVisual && !substitutedCorpseBody
    );
    if (!frame || !track.mesh.visible) continue;
    track.mesh.position.copy(sourcePoint(frame.x, frame.y, frame.z));
    track.mesh.rotation.set(
      THREE.MathUtils.degToRad(frame.pitch),
      THREE.MathUtils.degToRad(frame.yaw),
      THREE.MathUtils.degToRad(frame.roll)
    );
    void setEntityModel(track, frame.modelId);
    track.visual.traverse(child => {
      const frames = child.userData?.replaySpriteFrames;
      if (!child.isSprite || !frames?.length) return;
      const frameIndex = Math.abs(Math.floor(frame.frame || 0)) % frames.length;
      const texture = frames[frameIndex];
      if (child.material.map !== texture) {
        child.material.map = texture;
        child.material.needsUpdate = true;
      }
    });
    track.mesh.scale.setScalar(
      track.mesh.userData.diagnosticFallback || track.mesh.userData.spriteFallback ||
      track.mesh.userData.nativeSprite
        ? 1
        : (frame.scale > 0 ? frame.scale : 1)
    );
    const signature = [frame.renderamt, ...frame.color, frame.rendermode, frame.renderfx].join(":");
    if (track.mesh.userData.renderSignature !== signature) {
      track.mesh.userData.renderSignature = signature;
      const opacity = frame.rendermode === 0 ? 1 : THREE.MathUtils.clamp(frame.renderamt / 255, 0, 1);
      const tint = new THREE.Color(
        THREE.MathUtils.clamp(frame.color[0] / 255, 0, 1),
        THREE.MathUtils.clamp(frame.color[1] / 255, 0, 1),
        THREE.MathUtils.clamp(frame.color[2] / 255, 0, 1)
      );
      track.visual.traverse(child => {
        if (!child.isMesh && !child.isSprite) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!material) continue;
          if (material.color && material.userData.replayBaseColor) {
            material.color.copy(material.userData.replayBaseColor);
            if (frame.rendermode !== 0 && frame.color.some(channel => channel > 0)) material.color.multiply(tint);
          }
          material.opacity = opacity;
          material.transparent = opacity < 1 || frame.rendermode !== 0;
          material.depthWrite = child.isSprite ? false : opacity >= 1;
          material.needsUpdate = true;
        }
      });
    }
    Object.assign(track.mesh.userData, {
      classname: track.definition?.classname || "",
      model: state.renderModels.get(frame.modelId)?.path || "",
      ownerSession: frame.ownerSession, ownerEntity: frame.ownerEntity,
      team: frame.team, health: frame.health, movetype: frame.movetype,
      solid: frame.solid, flags: frame.flags, body: frame.body, skin: frame.skin,
      sequence: frame.sequence, gaitsequence: frame.gaitsequence,
      animationFrame: frame.frame, framerate: frame.framerate, animtime: frame.animtime,
      controller: frame.controller, blending: frame.blending, aiment: frame.aiment,
      unsupportedGoldSrcState: ["body", "skin", "sequence", "gaitsequence", "controller", "blending", "aiment"]
    });
    Object.assign(track.mesh.userData, {
      semanticKind: semantic?.kind || null,
      semanticIdentity: semantic?.key || sceneObjectKey("entity", track.entityId),
      sourceSession: semantic?.sourceSession || 0,
      deathId: semantic?.deathId || 0,
      reserveAmmoAtDeath: semantic?.kind === "backpack" ? {
        shells: semantic.shells, bullets: semantic.bullets, cells: semantic.cells,
        rockets: semantic.rockets, nade1: semantic.nade1, nade2: semantic.nade2
      } : null,
      semanticReason: semantic?.reason || ""
    });
  }
}

function updateBrushes() {
  for (const track of state.brushes) {
    if (!track.node) continue;
    if (track.nonVisual || isNonVisualEntityClass(track.definition?.classname)) {
      track.node.visible = false;
      continue;
    }
    const frame = brushSnapshot(track, state.playbackTime);
    track.node.visible = Boolean(frame?.active && !(frame.effects & 128));
    if (!track.node.visible) continue;
    track.node.position.set(frame.x, frame.z, -frame.y);
    track.node.rotation.set(
      THREE.MathUtils.degToRad(frame.pitch),
      THREE.MathUtils.degToRad(frame.yaw),
      THREE.MathUtils.degToRad(frame.roll)
    );
    const signature = [frame.renderamt, ...frame.color, frame.rendermode, frame.renderfx].join(":");
    if (track.node.userData.renderSignature === signature) continue;
    track.node.userData.renderSignature = signature;
    const opacity = frame.rendermode === 0 ? 1 : THREE.MathUtils.clamp(frame.renderamt / 255, 0, 1);
    const tint = new THREE.Color(
      THREE.MathUtils.clamp(frame.color[0] / 255, 0, 1),
      THREE.MathUtils.clamp(frame.color[1] / 255, 0, 1),
      THREE.MathUtils.clamp(frame.color[2] / 255, 0, 1)
    );
    track.node.traverse(child => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        if (material.color && material.userData.replayBaseColor) {
          material.color.copy(material.userData.replayBaseColor);
          if (frame.rendermode !== 0 && frame.color.some(channel => channel > 0)) material.color.multiply(tint);
        }
        material.opacity = opacity;
        material.transparent = opacity < 1 || frame.rendermode !== 0;
        material.depthWrite = opacity >= 1;
        material.needsUpdate = true;
      }
    });
  }
}

function updateMapTriggeredBrushes() {
  const now = state.playbackTime;
  for (const visual of mapTriggeredBrushes) {
    const disabled = visual.controllerTrack && buttonActivationTimes(visual.controllerTrack).some(
      time => time <= now && time + visual.duration >= now
    );
    visual.node.visible = visual.startsOn ? !disabled : Boolean(disabled);
  }
}

function buildMapEntityBrushes(gltf) {
  mapRotators = [];
  mapTriggeredBrushes = [];
  if (!mapModel) return;
  const nodes = new Map();
  mapModel.traverse(child => {
    if (/^\*[1-9]\d*$/.test(child.name) && !nodes.has(child.name)) nodes.set(child.name, child);
  });
  const entities = Array.isArray(gltf?.userData?.goldsrcEntities)
    ? gltf.userData.goldsrcEntities : [];
  for (const entity of entities) {
    const node = nodes.get(entity?.model);
    // BSP trigger brushes define gameplay volumes only. Their faces can still
    // exist in converted GLBs, so hide the complete submodel before applying
    // any entity transform.
    if (node && isNonVisualEntityClass(entity?.classname)) {
      node.visible = false;
      continue;
    }
    // phantom_lg renders its security lasers as translucent illusionary
    // shield brushes rather than env_beam entities. Pair each team shield
    // with the recorded security button so it disappears for the map's
    // 45-second disabled window and returns with the gameplay trigger.
    if (
      node && String(state.metadata?.map || "").toLowerCase() === "phantom_lg" &&
      entity?.classname === "func_illusionary" && /^[br]shield$/i.test(entity?.targetname || "")
    ) {
      const family = String(entity.targetname).charAt(0).toLowerCase();
      const buttonTarget = `${family}trigger2`;
      const controllerTrack = state.brushes.find(track => {
        const brush = state.brushDefinitions.get(track.brushId);
        return ["func_button", "func_rot_button"].includes(brush?.classname) &&
          brush?.target === buttonTarget;
      }) || null;
      const buttonEntity = entities.find(candidate =>
        ["func_button", "func_rot_button"].includes(candidate?.classname) &&
        candidate?.target === buttonTarget
      );
      mapTriggeredBrushes.push({
        node,
        family,
        controllerTrack,
        duration: Math.max(0.1, Number(buttonEntity?.wait) || 45),
        startsOn: true
      });
    }
    const position = entityPoint(entity?.origin);
    if (!node || !position) continue;
    node.position.copy(position);
    const angles = entityNumbers(entity.angles);
    node.rotation.set(
      THREE.MathUtils.degToRad(angles[0] || 0),
      THREE.MathUtils.degToRad(angles[1] || 0),
      THREE.MathUtils.degToRad(angles[2] || 0)
    );
    if (entity.classname !== "func_rotating") continue;
    const spawnflags = Math.round(Number(entity.spawnflags) || 0);
    if (!(spawnflags & 1)) continue;
    const axis = spawnflags & 4
      ? new THREE.Vector3(1, 0, 0)
      : spawnflags & 8 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    mapRotators.push({
      node,
      axis,
      baseQuaternion: node.quaternion.clone(),
      radiansPerSecond: THREE.MathUtils.degToRad(Number(entity.speed) || 0) * (spawnflags & 2 ? -1 : 1)
    });
  }
}

function updateMapRotators() {
  for (const rotator of mapRotators) {
    if (rotator.node.userData.brushId) continue;
    rotator.node.quaternion.copy(rotator.baseQuaternion).multiply(
      new THREE.Quaternion().setFromAxisAngle(rotator.axis, state.playbackTime * rotator.radiansPerSecond)
    );
  }
}

function brushBaseTransform(track) {
  const { frames, stride } = track;
  for (let offset = 0; offset < frames.length; offset += stride) {
    if (frames[offset + 1] !== 1) continue;
    return {
      x: frames[offset + 2], y: frames[offset + 3], z: frames[offset + 4],
      pitch: frames[offset + 8], yaw: frames[offset + 9], roll: frames[offset + 10]
    };
  }
  return null;
}

function angleDistance(a, b) {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

function brushAtBase(track, frame) {
  const base = track.beamBaseTransform || (track.beamBaseTransform = brushBaseTransform(track));
  return Boolean(base && frame?.active &&
    Math.hypot(frame.x - base.x, frame.y - base.y, frame.z - base.z) < 0.25 &&
    angleDistance(frame.pitch, base.pitch) < 0.1 &&
    angleDistance(frame.yaw, base.yaw) < 0.1 &&
    angleDistance(frame.roll, base.roll) < 0.1);
}

function lightningNoise(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function updateLightningStrike(visual) {
  if (!visual.userData.isLightning || !visual.visible) return;
  const rate = 3;
  const cycle = state.playbackTime * rate + visual.userData.lightningSeed * 0.17;
  const phase = cycle - Math.floor(cycle);
  if (!(phase < 0.22 || (phase > 0.34 && phase < 0.43))) {
    visual.visible = false;
    return;
  }

  const bucket = Math.floor(cycle * 2);
  if (visual.userData.lightningBucket === bucket) return;
  visual.userData.lightningBucket = bucket;
  const start = visual.userData.lightningStart;
  const end = visual.userData.lightningEnd;
  const direction = end.clone().sub(start);
  const length = direction.length();
  const forward = direction.clone().normalize();
  const side = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 0.01) side.crossVectors(forward, new THREE.Vector3(1, 0, 0));
  side.normalize();
  const vertical = new THREE.Vector3().crossVectors(forward, side).normalize();
  const amplitude = THREE.MathUtils.clamp(length * 0.075, 18, 64);
  const points = [];
  const count = visual.userData.lightningSegments.length;
  for (let index = 0; index <= count; index += 1) {
    const ratio = index / count;
    const taper = Math.sin(Math.PI * ratio);
    const point = start.clone().lerp(end, ratio);
    if (index > 0 && index < count) {
      const noiseSeed = bucket * 97 + visual.userData.lightningSeed * 31 + index;
      point.addScaledVector(side, lightningNoise(noiseSeed) * amplitude * taper);
      point.addScaledVector(vertical, lightningNoise(noiseSeed + 19) * amplitude * 0.7 * taper);
    }
    points.push(point);
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index < count; index += 1) {
    const segment = visual.userData.lightningSegments[index];
    const delta = points[index + 1].clone().sub(points[index]);
    segment.position.copy(points[index]).add(points[index + 1]).multiplyScalar(0.5);
    segment.quaternion.setFromUnitVectors(up, delta.clone().normalize());
    segment.scale.y = delta.length();
  }
}

function updateMapBeams() {
  if (!mapBeamGroup) return;
  for (const visual of mapBeamGroup.children) {
    const controllers = visual.userData.controllerTracks || [];
    if (!controllers.length) {
      visual.visible = visual.userData.captureTriggered
        ? flagCapturePulseActive(visual.userData.capturePulseDuration)
        : visual.userData.startsOn;
      updateLightningStrike(visual);
      continue;
    }
    // A button's recorded position is authoritative even when the map omits
    // a positive wait/pulse duration.
    if (buttonPulseActive(visual)) {
      visual.visible = !visual.userData.startsOn;
      continue;
    }
    const controllersAtBase = controllers.every(track => brushAtBase(
      track,
      brushSnapshot(track, state.playbackTime)
    ));
    visual.visible = visual.userData.startsOn ? controllersAtBase : !controllersAtBase;
    updateLightningStrike(visual);
  }
}

function entityNumbers(value, fallback = []) {
  const values = String(value || "").trim().split(/\s+/).map(Number).filter(Number.isFinite);
  return values.length ? values : fallback;
}

function entityPoint(value) {
  const values = entityNumbers(value);
  return values.length >= 3 ? sourcePoint(values[0], values[1], values[2]) : null;
}

function entityLightColor(entity) {
  const values = entityNumbers(entity?._light || entity?.rendercolor, [255, 255, 255]);
  return new THREE.Color(
    THREE.MathUtils.clamp((values[0] ?? 255) / 255, 0, 1),
    THREE.MathUtils.clamp((values[1] ?? values[0] ?? 255) / 255, 0, 1),
    THREE.MathUtils.clamp((values[2] ?? values[0] ?? 255) / 255, 0, 1)
  );
}

function entityLightBrightness(entity) {
  const values = entityNumbers(entity?._light);
  if (values.length >= 4) return THREE.MathUtils.clamp(values[3], 1, 1000);
  if (values.length === 1) return THREE.MathUtils.clamp(values[0], 1, 1000);
  return THREE.MathUtils.clamp(Number(entity?.renderamt) || 180, 1, 1000);
}

function entityOutputs(entity, knownTargetnames) {
  const outputs = new Set();
  if (entity?.target) outputs.add(entity.target);
  if (entity?.classname === "multi_manager") {
    for (const key of Object.keys(entity)) {
      const candidate = key.replace(/#\d+$/, "");
      if (knownTargetnames.has(candidate)) outputs.add(candidate);
    }
  }
  return outputs;
}

function entityActivationTargets(targets, entities) {
  const reachable = new Set([...targets].filter(Boolean));
  const knownTargetnames = new Set(entities.map(entity => entity?.targetname).filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entity of entities) {
      const targetname = String(entity?.targetname || "");
      if (!targetname || reachable.has(targetname)) continue;
      const outputs = entityOutputs(entity, knownTargetnames);
      if (![...outputs].some(output => reachable.has(output))) continue;
      reachable.add(targetname);
      changed = true;
    }
  }
  return reachable;
}

function entitySyncTargets(entity, activationGroups) {
  const targetname = String(entity?.targetname || "");
  const targets = new Set(targetname ? [targetname] : []);
  for (const outputs of activationGroups) {
    if (targetname && outputs.has(targetname)) outputs.forEach(target => targets.add(target));
  }
  return targets;
}

function beamControllerTracks(syncTargets, triggerTargets = new Set()) {
  const exact = state.brushes.filter(track => {
    const brush = state.brushDefinitions.get(track.brushId);
    return BEAM_CONTROLLER_CLASSES.has(brush?.classname) && syncTargets.has(brush?.targetname);
  });
  const buttons = state.brushes.filter(track => {
    const brush = state.brushDefinitions.get(track.brushId);
    return ["func_button", "func_rot_button"].includes(brush?.classname) &&
      triggerTargets.has(brush?.target);
  });
  if (exact.length || buttons.length) return [...new Set([...exact, ...buttons])];

  // Some GoldSrc maps (including schtop) toggle a security system through a
  // multi_manager without directly naming its moving func_train. Associate
  // red_*/blue_* outputs with the matching red_door/blue_door recorded train.
  const families = new Set([...syncTargets].map(target => {
    const match = String(target).toLowerCase().match(/^([^_]+)_/);
    return match?.[1] || "";
  }).filter(Boolean));
  return state.brushes.filter(track => {
    const brush = state.brushDefinitions.get(track.brushId);
    const targetname = String(brush?.targetname || "").toLowerCase();
    const family = targetname.match(/^([^_]+)_/)?.[1];
    return brush?.classname === "func_train" && family && families.has(family);
  });
}

function flagCapturePulseActive(duration) {
  const now = state.playbackTime;
  return state.events.some((event, eventIndex) => {
    if (event.time > now || event.time + duration < now) return false;
    const identity = `${event.event || ""} ${event.text || ""}`.toLowerCase();
    if (/flag[_\s-]*(?:cap|capture|capped)|(?:cap|capture|capped)[_\s-]*flag|ctf[_\s-]*(?:cap|capture)/.test(identity)) {
      return true;
    }
    if (event.event !== "flag_entity_base" || !event.entity) return false;
    for (let index = eventIndex - 1; index >= 0; index -= 1) {
      const previous = state.events[index];
      if (previous.entity !== event.entity || !String(previous.event).startsWith("flag_entity_")) continue;
      return previous.event === "flag_entity_carried";
    }
    return false;
  });
}

function buttonActivationTimes(track) {
  if (Array.isArray(track.buttonActivationTimes)) return track.buttonActivationTimes;
  const times = [];
  const base = brushBaseTransform(track);
  let wasAtBase = true;
  if (base) {
    for (let offset = 0; offset < track.frames.length; offset += track.stride) {
      const atBase = track.frames[offset + 1] === 1 &&
        Math.hypot(
          track.frames[offset + 2] - base.x,
          track.frames[offset + 3] - base.y,
          track.frames[offset + 4] - base.z
        ) < 0.25;
      if (wasAtBase && !atBase) times.push(track.frames[offset]);
      wasAtBase = atBase;
    }
  }

  if (!times.length && track.node) {
    const bounds = new THREE.Box3().setFromObject(track.node).expandByVector(
      new THREE.Vector3(80, 64, 80)
    );
    for (const player of state.players) {
      const { frames, stride } = player;
      for (let offset = 0; offset < frames.length; offset += stride) {
        if (frames[offset + 10] !== 1 || !(Math.round(frames[offset + 14]) & 32)) continue;
        const position = sourcePoint(frames[offset + 1], frames[offset + 2], frames[offset + 3]);
        if (bounds.containsPoint(position)) times.push(frames[offset]);
      }
    }
  }
  track.buttonActivationTimes = times.sort((a, b) => a - b);
  return track.buttonActivationTimes;
}

function buttonPulseActive(visual) {
  const now = state.playbackTime;
  const duration = visual.userData.controllerPulseDuration;
  return visual.userData.controllerTracks.some(track => {
    const brush = state.brushDefinitions.get(track.brushId);
    if (!["func_button", "func_rot_button"].includes(brush?.classname)) return false;
    // Some maps omit func_button "wait" and rely on the button's actual
    // movement. Keep the beam disabled for the whole time the button is
    // visibly pressed instead of reducing that activation to a zero-length
    // pulse.
    const frame = brushSnapshot(track, now);
    if (frame?.active && !brushAtBase(track, frame)) return true;
    const base = brushBaseTransform(track);
    if (base && state.players.some(player => {
      const playerFrame = playerSnapshot(player, now);
      return playerFrame?.alive && (playerFrame.buttons & 32) &&
        Math.hypot(playerFrame.x - base.x, playerFrame.y - base.y, playerFrame.z - base.z) < 128;
    })) return true;
    return buttonActivationTimes(track).some(time => time <= now && time + duration >= now);
  });
}

function entityControllers(entity, activationGroups) {
  const syncTargets = entitySyncTargets(entity, activationGroups);
  return state.brushes.filter(track => {
    const brush = state.brushDefinitions.get(track.brushId);
    return LIGHT_CONTROLLER_CLASSES.has(brush?.classname) && syncTargets.has(brush?.targetname);
  });
}

function entityDirection(entity, targets) {
  const origin = entityPoint(entity?.origin);
  const target = entity?.target ? targets.get(entity.target) : null;
  if (origin && target) return target.clone().sub(origin).normalize();
  const angles = entityNumbers(entity?.angles);
  const pitch = Number(entity?.pitch ?? angles[0] ?? 0);
  const yaw = Number(entity?.angle ?? angles[1] ?? 0);
  const pitchRadians = THREE.MathUtils.degToRad(pitch);
  const yawRadians = THREE.MathUtils.degToRad(yaw);
  return new THREE.Vector3(
    Math.cos(pitchRadians) * Math.cos(yawRadians),
    -Math.sin(pitchRadians),
    -Math.cos(pitchRadians) * Math.sin(yawRadians)
  ).normalize();
}

function lightStyleFactor(style, time) {
  const pattern = LIGHT_STYLE_PATTERNS[style];
  if (!pattern) return 1;
  const index = Math.floor(Math.max(0, time) * 10) % pattern.length;
  return THREE.MathUtils.clamp((pattern.charCodeAt(index) - 97) / 12, 0, 2);
}

function mapLightTriggeredOn(definition) {
  if (definition.linkedTriggeredBrushes.length) {
    return definition.linkedTriggeredBrushes.some(visual => visual.node.visible);
  }
  if (definition.linkedButtonTracks.length) {
    const buttonActive = definition.linkedButtonTracks.some(track =>
      buttonActivationTimes(track).some(time =>
        time <= state.playbackTime && time + definition.buttonPulseDuration >= state.playbackTime
      )
    );
    return definition.startsOn ? !buttonActive : buttonActive;
  }
  if (definition.linkedBeams.length) {
    return definition.linkedBeams.some(beam => beam.visible);
  }
  if (!definition.controllers.length) return definition.startsOn;
  const controllersAtBase = definition.controllers.every(track => brushAtBase(
    track,
    brushSnapshot(track, state.playbackTime)
  ));
  return definition.startsOn ? controllersAtBase : !controllersAtBase;
}

function updateMapLights() {
  if (!mapLightDefinitions.length) return;
  const eligible = [];
  for (const definition of mapLightDefinitions) {
    const style = lightStyleFactor(definition.style, state.playbackTime);
    definition.light.intensity = definition.baseIntensity * style;
    definition.triggeredOn = style > 0.01 && mapLightTriggeredOn(definition);
    definition.light.visible = false;
    if (definition.glow) definition.glow.visible = definition.triggeredOn;
    if (definition.triggeredOn) {
      definition.distanceToCamera = definition.light.position.distanceToSquared(camera.position);
      eligible.push(definition);
    }
  }
  eligible.sort((a, b) => a.distanceToCamera - b.distanceToCamera);
  for (let index = 0; index < Math.min(MAX_ACTIVE_MAP_LIGHTS, eligible.length); index += 1) {
    eligible[index].light.visible = true;
  }
}

function buildMapLights(gltf) {
  mapLightRoot.clear();
  mapLightDefinitions = [];
  sun.color.set(0xffffff);
  sun.intensity = 1.8;
  sun.position.set(1000, 1800, 700);
  hemisphere.color.set(0xcfe8ff);
  hemisphere.groundColor.set(0x131820);
  hemisphere.intensity = 2.2;

  const entities = gltf?.userData?.goldsrcEntities;
  if (!Array.isArray(entities)) return;
  const knownTargetnames = new Set(entities.map(entity => entity?.targetname).filter(Boolean));
  const activationGroups = entities.map(entity => entityOutputs(entity, knownTargetnames));
  const targets = new Map();
  for (const entity of entities) {
    const point = entityPoint(entity?.origin);
    if (entity?.targetname && point && !targets.has(entity.targetname)) targets.set(entity.targetname, point);
  }

  const environment = entities.find(entity => entity?.classname === "light_environment");
  if (environment) {
    const brightness = entityLightBrightness(environment);
    const direction = entityDirection(environment, targets);
    const environmentColor = entityLightColor(environment);
    const peak = Math.max(environmentColor.r, environmentColor.g, environmentColor.b, 0.001);
    environmentColor.multiplyScalar(1 / peak);
    sun.color.copy(environmentColor);
    sun.intensity = THREE.MathUtils.clamp(1.8 + brightness / 600, 1.8, 3.5);
    sun.position.copy(direction.multiplyScalar(-1800));
    hemisphere.color.copy(environmentColor).lerp(new THREE.Color(0xcfe8ff), 0.65);
    hemisphere.intensity = THREE.MathUtils.clamp(2.2 + brightness / 1000, 2.2, 3.2);
  }

  for (const [entityIndex, entity] of entities.entries()) {
    if (!["light", "light_spot", "env_glow"].includes(entity?.classname)) continue;
    const position = entityPoint(entity.origin);
    if (!position) continue;
    const brightness = entityLightBrightness(entity);
    const color = entityLightColor(entity);
    const isGlow = entity.classname === "env_glow";
    const isSwitchLight = Boolean(entity.targetname) || Number(entity.style) >= 32;
    const distance = isSwitchLight
      ? THREE.MathUtils.clamp(220 + brightness * 5, 450, 1800)
      : THREE.MathUtils.clamp(280 + brightness * 1.8, 320, 1800);
    const baseIntensity = isSwitchLight
      ? THREE.MathUtils.clamp(brightness * 8, 335, 2670)
      : THREE.MathUtils.clamp(brightness / (isGlow ? 12 : 7), 1, 45);
    let light;
    if (entity.classname === "light_spot") {
      const outerCone = THREE.MathUtils.clamp(Number(entity._cone) || 45, 5, 120);
      const innerCone = THREE.MathUtils.clamp(Number(entity._cone2) || outerCone * 0.7, 1, outerCone);
      light = new THREE.SpotLight(
        color, baseIntensity, distance, THREE.MathUtils.degToRad(outerCone / 2),
        THREE.MathUtils.clamp(1 - innerCone / outerCone, 0.05, 0.85), 1
      );
      light.target.position.copy(position).add(entityDirection(entity, targets).multiplyScalar(512));
      mapLightRoot.add(light.target);
    } else {
      light = new THREE.PointLight(color, baseIntensity, distance, 1);
    }
    light.position.copy(position);
    light.visible = false;
    mapLightRoot.add(light);

    let glow = null;
    if (isGlow) {
      const glowSize = THREE.MathUtils.clamp(
        (Number(entity.scale) || 0.35) * 72,
        16,
        72
      );
      glow = createGlowSprite(
        color,
        THREE.MathUtils.clamp((Number(entity.renderamt) || 150) / 255, 0.15, 1),
        glowSize
      );
      glow.position.copy(position);
      mapLightRoot.add(glow);
    }

    const syncTargets = entitySyncTargets(entity, activationGroups);
    let linkedBeams = mapBeamGroup?.children.filter(beam => {
      const beamTargets = beam.userData.syncTargets;
      return beamTargets instanceof Set && [...syncTargets].some(target => beamTargets.has(target));
    }) || [];
    if (/switchlight/i.test(String(entity.targetname || "")) && mapBeamGroup?.children.length) {
      const nearestBeam = mapBeamGroup.children.reduce((nearest, beam) => {
        const midpoint = beam.userData.midpoint;
        if (!midpoint) return nearest;
        const distance = midpoint.distanceToSquared(position);
        return !nearest || distance < nearest.distance ? { beam, distance } : nearest;
      }, null);
      if (nearestBeam) linkedBeams = [nearestBeam.beam];
    }
    const phantomButtonLight = String(entity.targetname || "").toLowerCase().match(/^([br])buttonlight2$/);
    const linkedTriggeredBrushes = phantomButtonLight
      ? mapTriggeredBrushes.filter(visual => visual.family === phantomButtonLight[1])
      : [];
    const activationTargets = entityActivationTargets(syncTargets, entities);
    const linkedButtonTracks = state.brushes.filter(track => {
      const brush = state.brushDefinitions.get(track.brushId);
      return ["func_button", "func_rot_button"].includes(brush?.classname) &&
        activationTargets.has(brush?.target);
    });
    const buttonPulseDuration = Math.max(
      0,
      ...entities
        .filter(candidate => ["func_button", "func_rot_button"].includes(candidate?.classname) &&
          activationTargets.has(candidate?.target))
        .map(candidate => Number(candidate.wait) || 0)
    );

    mapLightDefinitions.push({
      entityIndex, light, glow, baseIntensity,
      style: Math.round(Number(entity.style) || 0),
      startsOn: !(Math.round(Number(entity.spawnflags) || 0) & 1),
      controllers: entityControllers(entity, activationGroups),
      linkedBeams,
      linkedTriggeredBrushes,
      linkedButtonTracks,
      buttonPulseDuration
    });
  }
  updateMapLights();
}

function updateCorpses() {
  for (const corpse of state.corpses) {
    corpse.mesh.visible =
      state.playbackTime >= corpse.startsAt &&
      state.playbackTime < corpse.endsAt;
  }
}

function updateProjectiles() {
  projectileRoot.visible = state.showProjectiles;
  impactRoot.visible = state.showProjectiles;
  hitscanRoot.visible = state.showProjectiles;
  if (!state.showProjectiles) return;
  for (const track of state.projectiles) {
    if (!track.mesh) continue;
    const frame = projectileSnapshot(track, state.playbackTime);
    track.mesh.visible = Boolean(frame);
    if (track.rocketTrail) {
      const samples = [];
      const cutoff = state.playbackTime - 1;
      let wasActive = false;
      for (let offset = 0; offset < track.frames.length; offset += track.stride) {
        const time = track.frames[offset];
        if (time > state.playbackTime) break;
        const active = track.frames[offset + 1] === 1;
        if (active && !wasActive) samples.length = 0;
        wasActive = active;
        if (time < cutoff || !active) continue;
        const sample = {
          time,
          point: sourcePoint(
            track.frames[offset + 2],
            track.frames[offset + 3],
            track.frames[offset + 4]
          )
        };
        const previous = samples[samples.length - 1];
        if (previous) {
          const elapsed = Math.max(0.001, sample.time - previous.time);
          if (sample.point.distanceTo(previous.point) / elapsed > 2400) samples.length = 0;
        }
        samples.push(sample);
      }
      projectileVisuals.updateRocketTrail(track.rocketTrail, samples, state.playbackTime, 1);
    }
    if (!frame) continue;
    track.mesh.position.copy(sourcePoint(frame.x, frame.y, frame.z));
    projectileVisuals.rotate(track.mesh, track.definition, frame.yaw, state.playbackTime);
  }
  for (const impact of state.impacts) {
    projectileVisuals.updateImpact(impact, state.playbackTime);
  }
}

function updateBloodEffects() {
  for (const effect of state.bloodEffects) {
    projectileVisuals.updateBlood(effect, state.playbackTime);
  }
}

function carriedObjectivePose(frame) {
  const bodyYaw = THREE.MathUtils.degToRad(frame.schemaVersion >= 3 ? frame.bodyYaw : frame.yaw);
  const position = sourcePoint(frame.x, frame.y, frame.z);
  const forward = new THREE.Vector3(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw));
  position.addScaledVector(forward, -CARRIED_OBJECTIVE_BACK_OFFSET);
  position.y += isDucking(frame)
    ? CARRIED_OBJECTIVE_CROUCH_HEIGHT
    : CARRIED_OBJECTIVE_STAND_HEIGHT;
  return { position, yaw: bodyYaw + Math.PI / 2 };
}

function droppedObjectivePosition(frame) {
  const position = sourcePoint(frame.x, frame.y, frame.z);
  if (!mapModel) return position;

  scene.updateMatrixWorld(true);
  const origin = world.localToWorld(position.clone());
  origin.y += 64;
  corpseGroundRay.set(origin, corpseDown);
  corpseGroundRay.near = 0;
  corpseGroundRay.far = 8192;
  const hit = corpseGroundRay.intersectObject(mapModel, true).find(intersection =>
    isReplayMapGroundMaterial(
      intersection.object.material,
      intersection.face?.materialIndex || 0
    )
  );
  if (!hit) return position;

  const grounded = objectiveRoot.worldToLocal(hit.point.clone());
  grounded.y += 1;
  return grounded;
}

function updateObjectives() {
  objectiveRoot.visible = state.showObjectives;
  if (!state.showObjectives) return;
  for (const track of state.objectives) {
    if (!track.mesh) continue;
    const frame = objectiveSnapshot(track, state.playbackTime);
    track.mesh.visible = Boolean(frame);
    if (!frame) continue;
    const carrier = frame.carrierSession ? state.playerBySession.get(frame.carrierSession) : null;
    const carrierFrame = carrier ? playerSnapshot(carrier, state.playbackTime) : null;
    if (carrierFrame) {
      const pose = carriedObjectivePose(carrierFrame);
      track.mesh.position.copy(pose.position);
      track.mesh.rotation.y = pose.yaw;
    } else {
      track.mesh.position.copy(frame.state === 2
        ? droppedObjectivePosition(frame)
        : sourcePoint(frame.x, frame.y, frame.z));
      track.mesh.rotation.y = THREE.MathUtils.degToRad(frame.yaw);
    }
    const semantic = sceneMetadataAt("objective", track.objectiveId);
    Object.assign(track.mesh.userData, {
      semanticKind: semantic?.kind || null,
      semanticIdentity: semantic?.key || sceneObjectKey("objective", track.objectiveId),
      sourceSession: semantic?.sourceSession || 0,
      deathId: semantic?.deathId || 0,
      semanticReason: semantic?.reason || ""
    });
  }
}

function viewDirection(frame) {
  const yaw = THREE.MathUtils.degToRad(frame.yaw);
  const pitch = THREE.MathUtils.degToRad(frame.pitch);
  return new THREE.Vector3(
    Math.cos(pitch) * Math.cos(yaw),
    -Math.sin(pitch),
    -Math.cos(pitch) * Math.sin(yaw)
  ).normalize();
}

function selectedFrame() {
  return playerSnapshot(state.playerBySession.get(state.selectedSession), state.playbackTime);
}

function selectedFlagObjective() {
  if (!state.selectedSession) return null;
  return state.objectives.find(track => {
    const definition = state.objectiveDefinitions.get(track.objectiveId);
    const identity = [definition?.classname, definition?.model, definition?.targetname]
      .filter(Boolean).join(" ").toLowerCase();
    if (!/(flag|goal|ctf)/.test(identity)) return false;
    return objectiveSnapshot(track, state.playbackTime)?.carrierSession === state.selectedSession;
  }) || null;
}

function selectedWeaponName(frame) {
  if (frame?.schemaVersion >= 7 && frame.weaponName && frame.weaponName !== "unknown") {
    return frame.weaponName;
  }
  const model = state.renderModels.get(Number(frame?.weaponModelId));
  const path = String(model?.path || "");
  const file = path.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
  const fromModel = prettyWeaponName(file.replace(/^[pvw]_/, ""));
  return fromModel || (frame?.weapon ? `Weapon ${frame.weapon}` : "—");
}

function currentReserveAmmo(frame) {
  if (!frame || frame.schemaVersion < 7) return -1;
  switch (Number(frame.weapon)) {
    case 6: case 7: case 8: case 9: case 20:
      return frame.ammoShells;
    case 10: case 11: case 21:
      return frame.ammoBullets;
    case 13: case 15: case 17:
      return frame.ammoCells;
    case 12: case 14: case 22:
      return frame.ammoRockets;
    default:
      return -1;
  }
}

function hudAmmoValue(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0
    ? String(Math.round(Number(value))) : "—";
}

function isMeleeWeapon(frame) {
  const identity = [frame?.weaponName, selectedWeaponName(frame)]
    .filter(Boolean).join(" ").toLowerCase();
  return /(spanner|wrench|knife|axe|crowbar|medkit|bioweapon)/.test(identity);
}

function hudAmmoDisplay(frame) {
  if (!frame || frame.schemaVersion < 7 || isMeleeWeapon(frame)) {
    return { visible: false, text: "" };
  }
  const clip = Number(frame.clipAmmo);
  const clipMax = Number(frame.clipMax);
  const reserve = Number(currentReserveAmmo(frame));
  if (Number.isFinite(clip) && clip >= 0 && Number.isFinite(reserve) && reserve >= 0) {
    return { visible: true, text: `${Math.round(clip)} / ${Math.round(reserve)}` };
  }
  if (Number.isFinite(clip) && clip >= 0 && Number.isFinite(clipMax) && clipMax > 0) {
    return { visible: true, text: `${Math.round(clip)} / ${Math.round(clipMax)}` };
  }
  const singleValue = Number.isFinite(reserve) && reserve >= 0
    ? reserve
    : clip;
  return { visible: true, text: hudAmmoValue(singleValue) };
}

function grenadeIconType(type) {
  return ({
    24: "caltrop", 25: "concussion", 26: "normal", 27: "nail",
    28: "mirv", 29: "napalm", 30: "gas", 31: "emp"
  })[Number(type)] || "unknown";
}

function updateCamera() {
  if (state.cameraMode === "free") return;
  const frame = selectedFrame();
  if (!frame) return;
  const point = sourcePoint(frame.x, frame.y, frame.z);
  const direction = viewDirection(frame);
  if (state.cameraMode === "pov") {
    point.y += isDucking(frame) ? 12 : 28;
    camera.position.copy(point);
    camera.lookAt(point.clone().add(direction.multiplyScalar(320)));
  } else if (state.cameraMode === "chase") {
    const target = point.clone().add(new THREE.Vector3(0, 34, 0));
    camera.position.copy(target.clone().sub(direction.multiplyScalar(180)).add(new THREE.Vector3(0, 70, 0)));
    camera.lookAt(target);
  } else {
    camera.position.set(point.x, point.y + 1250, point.z + 20);
    camera.lookAt(point);
  }
}

function updateSelectedStats() {
  const frame = selectedFrame();
  const objective = $("pickup-selected-objective");
  const flagTrack = selectedFlagObjective();
  if (objective) objective.hidden = !flagTrack;
  const hudFlag = $("replay-hud-flag");
  if (hudFlag) hudFlag.hidden = !flagTrack;
  if (flagTrack) {
    const carrier = state.roster.find(row => row.sessionId === state.selectedSession);
    const carrierLabel = carrier?.name ? `Flag carrier: ${carrier.name}` : "Flag carrier";
    hudFlag.setAttribute("aria-label", carrierLabel);
    hudFlag.title = carrierLabel;
    $("replay-hud-flag-label").textContent = "FLAG";
  }
  if (!frame) {
    $("replay-hud-health").textContent = "—";
    $("replay-hud-armor").textContent = "—";
    $("replay-hud-weapon-name").textContent = "—";
    $("replay-hud-ammo").textContent = "— / —";
    $("replay-hud-ammo").classList.add("is-hidden");
    $("replay-hud-ammo-icon").classList.add("is-hidden");
    $("replay-hud-gren1-count").textContent = "—";
    $("replay-hud-gren2-count").textContent = "—";
    return;
  }
  $("pickup-selected-class").textContent = `${className(frame.classId)} · ${frame.alive ? "Alive" : "Dead"}`;
  $("pickup-stat-health").textContent = frame.health;
  $("pickup-stat-armor").textContent = frame.armor;
  const reserve = currentReserveAmmo(frame);
  const ammoDisplay = hudAmmoDisplay(frame);
  const ammoText = ammoDisplay.text || "—";
  $("pickup-stat-ammo").textContent = ammoText;
  $("pickup-stat-weapon").textContent = selectedWeaponName(frame);
  $("replay-hud-health").textContent = frame.health;
  $("replay-hud-armor").textContent = frame.armor;
  $("replay-hud-ammo").textContent = ammoText;
  $("replay-hud-ammo").classList.toggle("is-hidden", !ammoDisplay.visible);
  $("replay-hud-ammo-icon").classList.toggle("is-hidden", !ammoDisplay.visible);
  $("replay-hud-weapon-name").textContent = selectedWeaponName(frame);
  for (const [slot, type, count] of [
    [1, frame.gren1Type, frame.gren1Count], [2, frame.gren2Type, frame.gren2Count]
  ]) {
    const icon = $(`replay-hud-gren${slot}-icon`);
    if (icon) {
      icon.dataset.type = grenadeIconType(type);
      icon.title = type > 0 ? `Grenade ${slot}: ${grenadeIconType(type)}` : `Grenade ${slot}: empty`;
    }
    $(`replay-hud-gren${slot}-count`).textContent = hudAmmoValue(count);
  }
}

function updateScene() {
  updatePlayers();
  updateCorpses();
  updateProjectiles();
  updateBloodEffects();
  updateObjectives();
  updateBuildables();
  updateEntities();
  updateBrushes();
  updateMapTriggeredBrushes();
  updateMapRotators();
  updateMapBeams();
  updateCamera();
  updateMapLights();
  updateSelectedStats();
  renderKillFeed();
  updateAnalysisPlayback();
  updateClipEditor();
  $("replay-clock").textContent = formatTime(state.playbackTime);
  if (document.activeElement !== $("replay-slider")) {
    $("replay-slider").value = String(Math.round(state.playbackTime * 1000));
  }
}

function liveDelaySeconds() {
  return Math.max(0, state.liveEdge - state.playbackTime);
}

function setLiveChrome(mode) {
  if (!LIVE_MODE) return;
  const signal = $("pickup-live-signal");
  const label = $("pickup-live-state");
  if (!signal || !label) return;
  signal.className = `pickup-live-signal ${mode}`;
  label.textContent = mode === "live"
    ? "LIVE"
    : mode === "delayed"
      ? "DELAYED"
      : mode === "ended"
        ? "FEED ENDED"
        : "CONNECTING";
  document.body.classList.toggle("live-delayed", mode === "delayed");
}

function updateLiveHud() {
  if (!LIVE_MODE) return;
  const delay = liveDelaySeconds();
  const slider = $("replay-slider");
  const minimum = Math.max(0, state.liveEdge - state.liveBufferSeconds);
  if (state.duration > 0) setClipBounds(state.clipStart, state.clipEnd);
  slider.min = String(Math.round(minimum * 1000));
  slider.max = String(Math.max(1, Math.round(state.liveEdge * 1000)));
  $("pickup-live-buffer-label").textContent = minimum > 0
    ? `${formatTime(minimum)}–${formatTime(state.liveEdge)}`
    : `Rolling ${Math.round(state.liveBufferSeconds / 60)}:00 buffer`;

  const atLiveEdge = !state.liveEnded && state.followLive && delay <= LIVE_TARGET_LATENCY_SECONDS + 0.2;
  $("pickup-live-delay").textContent = state.liveEnded
    ? "ROUND COMPLETE"
    : atLiveEdge
      ? "LIVE"
      : `-${formatTime(delay)}`;
  const jump = $("replay-jump-live");
  if (jump) jump.disabled = state.liveEnded || atLiveEdge;
  setLiveChrome(state.liveEnded ? "ended" : atLiveEdge ? "live" : state.liveReady ? "delayed" : "connecting");
}

function jumpToLive() {
  if (!LIVE_MODE || !state.liveReady || state.liveEnded) return;
  state.followLive = true;
  state.playbackTime = Math.max(0, state.liveEdge - LIVE_TARGET_LATENCY_SECONDS);
  setPlaying(true);
  updateLiveHud();
  updateScene();
}

function mapAssetUrl(map) {
  return `assets/maps/${encodeURIComponent(map)}/${encodeURIComponent(map)}.glb?v=20260801skies1`;
}

function buildMapSky(gltf) {
  const definition = gltf?.userData?.goldsrcSky;
  if (!Array.isArray(definition?.faces) || definition.faces.length !== 6) return;
  const map = encodeURIComponent(state.metadata.map);
  const urls = definition.faces.map(face =>
    `assets/maps/${map}/${String(face).split("/").map(encodeURIComponent).join("/")}?v=20260801skies1`
  );
  skyLoader.load(urls, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    scene.background = texture;
  }, undefined, () => {
    scene.background = new THREE.Color(0x070a0f);
  });
}

function buildMapBeams(gltf) {
  if (mapBeamGroup) world.remove(mapBeamGroup);
  mapBeamGroup = new THREE.Group();
  mapBeamGroup.name = "goldsrc-entity-beams";
  world.add(mapBeamGroup);

  const definitions = gltf?.userData?.goldsrcBeams;
  if (!Array.isArray(definitions)) return;
  const entities = Array.isArray(gltf?.userData?.goldsrcEntities)
    ? gltf.userData.goldsrcEntities : [];
  const knownTargetnames = new Set(entities.map(entity => entity?.targetname).filter(Boolean));
  const managers = entities.filter(entity => entity?.classname === "multi_manager").map(entity => ({
    entity,
    outputs: entityOutputs(entity, knownTargetnames)
  }));
  const demolish2 = String(state.metadata?.map || "").toLowerCase() === "demolish2_b6";
  const buttonTracks = state.brushes.filter(track => {
    const brush = state.brushDefinitions.get(track.brushId);
    return ["func_button", "func_rot_button"].includes(brush?.classname);
  });
  const up = new THREE.Vector3(0, 1, 0);

  for (const [beamIndex, definition] of definitions.entries()) {
    if (!Array.isArray(definition?.start) || !Array.isArray(definition?.end)) continue;
    // The matching recorded brush track below supplies trigger timing. Beams
    // without a recorded controller remain visible as static map hazards.
    const start = sourcePoint(...definition.start);
    const end = sourcePoint(...definition.end);
    const delta = end.clone().sub(start);
    const length = delta.length();
    if (!Number.isFinite(length) || length < 0.01) continue;

    const channels = Array.isArray(definition.color) ? definition.color : [255, 64, 48];
    const color = new THREE.Color(
      THREE.MathUtils.clamp(Number(channels[0]) / 255, 0, 1),
      THREE.MathUtils.clamp(Number(channels[1]) / 255, 0, 1),
      THREE.MathUtils.clamp(Number(channels[2]) / 255, 0, 1)
    );
    const opacity = THREE.MathUtils.clamp(Number(definition.brightness ?? 255) / 255, 0.18, 1);
    const radius = THREE.MathUtils.clamp(Number(definition.width || 8) * 0.22, 0.7, 8);
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const rotation = new THREE.Quaternion().setFromUnitVectors(up, delta.clone().normalize());
    const syncTargets = new Set(
      (Array.isArray(definition.syncTargets) ? definition.syncTargets : [definition.targetname]).filter(Boolean)
    );
    // Maps such as openfire_lowgrens route a laser toggle through trigger
    // relays and info_tfgoal entities instead of a multi_manager. Resolve the
    // target graph backwards so the recorded button becomes the controller.
    const activationTargets = entityActivationTargets(syncTargets, entities);
    const controllingManagers = managers.filter(manager =>
      [...syncTargets].some(target => manager.outputs.has(target))
    );
    const triggerTargets = new Set(
      [...activationTargets,
        ...controllingManagers.map(manager => manager.entity.targetname).filter(Boolean)]
    );
    const captureTriggered = entities.some(entity =>
      triggerTargets.has(entity?.target) &&
      /capture/i.test(`${entity?.netname || ""} ${entity?.message || ""}`)
    );
    const isLightning = captureTriggered && Number(definition.noise || 0) >= 64;
    let controllerPulseDuration = 0;
    for (const manager of controllingManagers) {
      for (const [key, value] of Object.entries(manager.entity)) {
        if (syncTargets.has(key.replace(/#\d+$/, ""))) {
          controllerPulseDuration = Math.max(controllerPulseDuration, Number(value) || 0);
        }
      }
    }
    for (const button of entities) {
      if (!["func_button", "func_rot_button"].includes(button?.classname) ||
          !activationTargets.has(button?.target)) continue;
      controllerPulseDuration = Math.max(controllerPulseDuration, Number(button.wait) || 0);
    }
    const visual = new THREE.Group();
    visual.userData.startsOn = definition.startsOn !== false;
    visual.userData.syncTargets = syncTargets;
    visual.userData.midpoint = midpoint.clone();
    visual.userData.controllerTracks = beamControllerTracks(syncTargets, triggerTargets);
    if (demolish2 && !visual.userData.controllerTracks.some(track => {
      const brush = state.brushDefinitions.get(track.brushId);
      return ["func_button", "func_rot_button"].includes(brush?.classname);
    })) {
      const nearestButton = buttonTracks.reduce((nearest, track) => {
        const base = brushBaseTransform(track);
        if (!base) return nearest;
        const position = sourcePoint(base.x, base.y, base.z);
        const distance = midpoint.distanceToSquared(position);
        return !nearest || distance < nearest.distance ? { track, distance } : nearest;
      }, null);
      if (nearestButton) visual.userData.controllerTracks = [nearestButton.track];
    }
    visual.userData.controllerPulseDuration = controllerPulseDuration;
    visual.userData.captureTriggered = captureTriggered;
    visual.userData.capturePulseDuration = controllerPulseDuration || 5;
    visual.userData.isLightning = isLightning;
    visual.userData.lightningSeed = beamIndex + 1;
    visual.userData.lightningStart = start;
    visual.userData.lightningEnd = end;
    visual.userData.lightningSegments = [];
    mapBeamGroup.add(visual);

    const addBeamLayer = (layerRadius, layerOpacity) => {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: layerOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      });
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(layerRadius, layerRadius, 1, 8, 1, true),
        material
      );
      beam.position.copy(midpoint);
      beam.quaternion.copy(rotation);
      beam.scale.y = length;
      beam.renderOrder = 40;
      beam.frustumCulled = false;
      visual.add(beam);
    };

    if (isLightning) {
      const haloGeometry = new THREE.CylinderGeometry(radius * 2.2, radius * 2.2, 1, 6, 1, true);
      const coreGeometry = new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 1, 6, 1, true);
      const haloMaterial = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: opacity * 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      const coreMaterial = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      for (let index = 0; index < 12; index += 1) {
        const segment = new THREE.Group();
        for (const [geometry, material] of [[haloGeometry, haloMaterial], [coreGeometry, coreMaterial]]) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 40;
          mesh.frustumCulled = false;
          segment.add(mesh);
        }
        visual.userData.lightningSegments.push(segment);
        visual.add(segment);
      }
    } else {
      addBeamLayer(radius * 2.4, opacity * 0.2);
      addBeamLayer(radius, opacity);
    }
  }

}

function loadMap() {
  markReplayTiming("map-load-start", { map: state.metadata?.map || "" });
  loader.load(mapAssetUrl(state.metadata.map), gltf => {
    mapModel = gltf.scene;
    mapModel.position.copy(sourcePoint(0, 0, 0));
    mapModel.traverse(child => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        configureReplayMapMaterial(material, THREE.DoubleSide);
      }
    });
    buildMapEntityBrushes(gltf);
    world.add(mapModel);
    settleCorpses();
    bindBrushNodes();
    buildMapSky(gltf);
    buildMapBeams(gltf);
    updateBrushes();
    updateMapTriggeredBrushes();
    updateMapBeams();
    buildMapLights(gltf);
    if (grid) grid.visible = false;
    state.sceneReady = true;
    markReplayTiming("map-load-end", { map: state.metadata?.map || "" });
    updateScene();
    markEditorReady();
  }, undefined, () => {
    if (grid) grid.visible = true;
    markReplayTiming("map-load-error", { map: state.metadata?.map || "" });
  });
}

function setupWorld() {
  const firstTrack = state.players.find(track => track.frames.length >= track.stride);
  if (firstTrack) {
    state.origin = {
      x: firstTrack.frames[1],
      y: firstTrack.frames[2],
      z: firstTrack.frames[3]
    };
  }
  grid = new THREE.GridHelper(10000, 40, 0x64748b, 0x1e293b);
  world.add(grid);
  buildVisuals();
  loadMap();
}

function setPlaying(value) {
  state.playing = Boolean(value);
  if (LIVE_MODE && !state.playing) state.followLive = false;
  $("replay-play").textContent = state.playing ? "Pause" : "Play";
  document.body.classList.toggle("replay-playing", state.playing);
}

function setCameraMode(mode) {
  state.cameraMode = mode;
  $("replay-camera").textContent = `Camera: ${mode.toUpperCase()}`;
  $("replay-camera-label").textContent = mode.toUpperCase();
  $("pickup-free-help").hidden = mode !== "free";
  $("replay-crosshair").hidden = mode === "free" || mode === "overview";
  if (mode === "free") {
    const frame = selectedFrame();
    if (frame) camera.position.copy(sourcePoint(frame.x, frame.y, frame.z).add(new THREE.Vector3(0, 180, 260)));
  }
}

function freeDirection() {
  const cosPitch = Math.cos(state.freePitch);
  return new THREE.Vector3(
    Math.sin(state.freeYaw) * cosPitch,
    Math.sin(state.freePitch),
    -Math.cos(state.freeYaw) * cosPitch
  ).normalize();
}

function updateFreeCamera(delta) {
  if (state.cameraMode !== "free") return;
  const forward = freeDirection();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const movement = new THREE.Vector3();
  if (freeKeys.has("KeyW")) movement.add(forward);
  if (freeKeys.has("KeyS")) movement.sub(forward);
  if (freeKeys.has("KeyD")) movement.add(right);
  if (freeKeys.has("KeyA")) movement.sub(right);
  if (freeKeys.has("KeyE")) movement.y += 1;
  if (freeKeys.has("KeyQ")) movement.y -= 1;
  if (movement.lengthSq()) camera.position.add(movement.normalize().multiplyScalar(1100 * delta));
  camera.lookAt(camera.position.clone().add(forward));
}

function wireControls() {
  $("replay-play").addEventListener("click", () => {
    const next = !state.playing;
    if (LIVE_MODE && next && liveDelaySeconds() <= LIVE_TARGET_LATENCY_SECONDS + 0.5 && !state.liveEnded) {
      state.followLive = true;
    }
    setPlaying(next);
  });
  const restart = $("replay-restart");
  if (restart) restart.addEventListener("click", () => {
    state.playbackTime = 0;
    setPlaying(true);
    updateScene();
  });
  $("replay-jump-live")?.addEventListener("click", jumpToLive);
  $("replay-camera").addEventListener("click", () => {
    const index = CAMERA_MODES.indexOf(state.cameraMode);
    setCameraMode(CAMERA_MODES[(index + 1) % CAMERA_MODES.length]);
  });
  $("replay-effects").addEventListener("click", event => {
    const enabled = !(state.showProjectiles && state.showObjectives);
    state.showProjectiles = enabled;
    state.showObjectives = enabled;
    event.currentTarget.classList.toggle("active", enabled);
    event.currentTarget.textContent = `Effects: ${enabled ? "On" : "Off"}`;
  });
  document.querySelectorAll("[data-speed]").forEach(button => {
    button.addEventListener("click", () => {
      state.speed = Number(button.dataset.speed);
      document.querySelectorAll("[data-speed]").forEach(item => item.classList.toggle("active", item === button));
    });
  });
  $("replay-slider").addEventListener("input", event => {
    const limit = LIVE_MODE ? state.liveEdge : state.duration;
    state.playbackTime = Math.min(limit, Number(event.target.value) / 1000);
    if (LIVE_MODE) state.followLive = false;
    updateScene();
  });
  const clipTitle = $("replay-clip-title");
  clipTitle?.addEventListener("input", event => { state.clipTitle = event.target.value; });
  $("replay-clip-toggle")?.addEventListener("click", () => setClipEditorOpen(!state.clipEditorOpen));
  $("replay-clip-close")?.addEventListener("click", () => setClipEditorOpen(false));
  $("replay-clip-set-start")?.addEventListener("click", () => setClipStartAt(state.playbackTime));
  $("replay-clip-set-end")?.addEventListener("click", () => setClipEndAt(state.playbackTime));
  $("replay-clip-reset")?.addEventListener("click", resetClip);
  $("replay-clip-loop")?.addEventListener("click", () => {
    state.clipLoop = !state.clipLoop;
    if (LIVE_MODE && state.clipLoop) state.followLive = false;
    if (state.clipLoop && (state.playbackTime < state.clipStart || state.playbackTime >= state.clipEnd)) {
      state.playbackTime = state.clipStart;
    }
    updateClipEditor();
    updateScene();
  });
  $("replay-clip-copy")?.addEventListener("click", copyClipLink);
  $("replay-clip-download")?.addEventListener("click", startClipExport);
  dragClipSelection($("replay-clip-selection"));
  dragClipHandle($("replay-clip-start-handle"), "start");
  dragClipHandle($("replay-clip-end-handle"), "end");
  dragClipEditor($("replay-clip-editor"));
  canvas.addEventListener("click", () => {
    if (state.cameraMode === "free") canvas.requestPointerLock?.();
  });
  document.addEventListener("mousemove", event => {
    if (state.cameraMode !== "free" || document.pointerLockElement !== canvas) return;
    state.freeYaw += event.movementX * 0.0022;
    state.freePitch = THREE.MathUtils.clamp(state.freePitch - event.movementY * 0.0022, -1.54, 1.54);
  });
  window.addEventListener("keydown", event => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName)) return;
    if (event.code === "Space") {
      event.preventDefault();
      setPlaying(!state.playing);
    }
    if (event.code === "KeyI" && !LIVE_MODE) setClipStartAt(state.playbackTime);
    if (event.code === "KeyO" && !LIVE_MODE) setClipEndAt(state.playbackTime);
    freeKeys.add(event.code);
  });
  window.addEventListener("keyup", event => freeKeys.delete(event.code));
  window.addEventListener("blur", () => freeKeys.clear());
  window.addEventListener("resize", resize);
  wireAnalysisControls();
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function beginPreviewTimingIfNeeded() {
  if (!HAS_REQUESTED_CLIP || DIRECT_CLIP_EXPORT || state.clipExport ||
      state.clipPreviewActive || state.clipPreviewComplete ||
      !(state.clipEnd > state.clipStart)) return;
  if (state.playbackTime < state.clipStart || state.playbackTime >= state.clipEnd) return;
  state.clipPreviewActive = true;
  replayTiming.previewPasses += 1;
  markReplayTiming("preview-render-start", {
    pass: replayTiming.previewPasses,
    clipStart: state.clipStart,
    clipEnd: state.clipEnd,
    sceneReady: state.sceneReady
  });
}

function endPreviewTimingIfNeeded() {
  if (!state.clipPreviewActive || state.playbackTime < state.clipEnd) return;
  state.clipPreviewActive = false;
  state.clipPreviewComplete = true;
  markReplayTiming("preview-render-end", {
    pass: replayTiming.previewPasses,
    playbackTime: state.playbackTime,
    sceneReady: state.sceneReady
  });
}

function tick(now) {
  const delta = Math.min(0.1, (now - state.lastTick) / 1000);
  state.lastTick = now;
  if (["deterministic", "webcodecs", "mjpeg-frames", "raw-frames"].includes(state.clipExport?.mode) ||
      (DIRECT_CLIP_EXPORT && !state.sceneReady)) {
    requestAnimationFrame(tick);
    return;
  }
  if (LIVE_MODE) {
    if (state.liveReady) {
      if (LIVE_SIMULATION && !state.liveEnded) {
        state.liveEdge = Math.min(state.duration, state.liveEdge + delta * state.feedSpeed);
        if (state.liveEdge >= state.duration) {
          state.liveEnded = true;
          state.followLive = false;
        }
      }
      const minimum = Math.max(0, state.liveEdge - state.liveBufferSeconds);
      if (state.followLive && !state.liveEnded) {
        const target = Math.max(minimum, state.liveEdge - LIVE_TARGET_LATENCY_SECONDS);
        state.playbackTime = LIVE_SIMULATION || target - state.playbackTime > 2
          ? target
          : Math.min(target, state.playbackTime + delta * 1.05);
      } else if (state.playing) {
        state.playbackTime = Math.min(state.liveEdge, state.playbackTime + delta * state.speed);
        if (state.clipLoop && state.clipEnd > state.clipStart && state.playbackTime >= state.clipEnd) {
          state.playbackTime = state.clipStart;
          state.followLive = false;
        } else if (!state.liveEnded && state.playbackTime >= state.liveEdge - LIVE_TARGET_LATENCY_SECONDS) {
          state.followLive = true;
        } else if (state.liveEnded && state.playbackTime >= state.liveEdge) {
          setPlaying(false);
        }
      }
      state.playbackTime = Math.max(minimum, Math.min(state.playbackTime, state.liveEdge));
      updateLiveHud();
    }
  } else if (state.playing) {
    state.playbackTime += delta * state.speed;
    if (state.clipLoop && state.clipEnd > state.clipStart && state.playbackTime >= state.clipEnd) {
      state.playbackTime = state.clipStart;
    } else if (state.playbackTime >= state.duration) {
      state.playbackTime = state.duration;
      setPlaying(false);
    }
  }
  beginPreviewTimingIfNeeded();
  const directIdle = DIRECT_CLIP_EXPORT && state.sceneReady && !state.clipExport &&
    !state.playing && state.directIdleFrameRendered;
  if (!directIdle) {
    updateScene();
    updateFreeCamera(delta);
    renderer.render(scene, camera);
    renderClipExportFrame();
    if (state.clipExport) state.clipExport.frames += 1;
    if (DIRECT_CLIP_EXPORT && state.sceneReady && !state.clipExport && !state.playing) {
      state.directIdleFrameRendered = true;
    }
  }
  endPreviewTimingIfNeeded();
  if (state.clipExport?.recorder && state.playbackTime >= state.clipEnd) finishClipExport();
  requestAnimationFrame(tick);
}

function loadTelemetry(files) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/assets/js/pickup-replay-worker.js?v=20260823clipwindow1");
    worker.onmessage = event => {
      if (event.data.type === "progress") setStatus(event.data.label);
      if (event.data.type === "error") {
        worker.terminate();
        reject(new Error(event.data.error));
      }
      if (event.data.type === "complete") {
        worker.terminate();
        resolve(event.data.payload);
      }
    };
    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message || "Replay worker failed."));
    };
    worker.postMessage({
      files,
      schemaVersion: state.metadata?.manifest?.schema_version,
      timeLimitSeconds: DIRECT_CLIP_EXPORT ? state.clipEnd + 1 : null
    });
  });
}

function latestTelemetryTime(payload) {
  let latest = 0;
  for (const collection of [
    payload.players, payload.projectiles, payload.objectives, payload.buildables, payload.brushes, payload.entities
  ]) {
    for (const track of collection || []) {
      const count = Math.floor(track.frames.length / track.stride);
      if (count) latest = Math.max(latest, track.frames[(count - 1) * track.stride]);
    }
  }
  for (const event of payload.events || []) latest = Math.max(latest, event.time || 0);
  for (const event of payload.sceneEvents || []) latest = Math.max(latest, event.time || 0);
  return latest;
}

function appendFrames(existing, incoming) {
  if (!existing.frames.length) {
    existing.frames = incoming.frames;
    if (incoming.weaponNames) existing.weaponNames = [...incoming.weaponNames];
    return;
  }
  const combined = new Float32Array(existing.frames.length + incoming.frames.length);
  combined.set(existing.frames);
  combined.set(incoming.frames, existing.frames.length);
  existing.frames = combined;
  if (existing.weaponNames || incoming.weaponNames) {
    existing.weaponNames = [...(existing.weaponNames || []), ...(incoming.weaponNames || [])];
  }
}

function mergeTracks(target, incoming, idKey) {
  const byId = new Map(target.map(track => [track[idKey], track]));
  for (const delta of incoming || []) {
    const existing = byId.get(delta[idKey]);
    if (existing) appendFrames(existing, delta);
    else {
      target.push(delta);
      byId.set(delta[idKey], delta);
    }
  }
}

function trimTrack(track, cutoff) {
  const count = Math.floor(track.frames.length / track.stride);
  let first = 0;
  while (first < count && track.frames[first * track.stride] < cutoff) first += 1;
  const keepFrom = Math.max(0, first - 1);
  if (keepFrom) {
    track.frames = track.frames.slice(keepFrom * track.stride);
    if (track.weaponNames?.length) track.weaponNames = track.weaponNames.slice(keepFrom);
  }
}

function trimLiveTelemetry() {
  const cutoff = Math.max(0, state.liveEdge - state.liveBufferSeconds - 2);
  for (const collection of [
    state.players, state.projectiles, state.objectives, state.buildables, state.brushes, state.entities
  ]) {
    for (const track of collection) trimTrack(track, cutoff);
  }
  state.events = state.events.filter(event => event.time >= cutoff);
  state.sceneEvents = state.sceneEvents.filter(event => event.time >= cutoff);
  state.killFeedEvents = buildKillFeedEvents();
  state.lastKillFeedRenderKey = "";
  rebuildSceneIndexes();
}

function installTelemetry(telemetry) {
  state.roster = telemetry.roster;
  state.renderModels = new Map(telemetry.renderModels.map(model => [model.modelId, model]));
  state.players = telemetry.players;
  state.playerBySession = new Map(state.players.map(track => [track.sessionId, track]));
  state.projectileDefinitions = new Map(telemetry.projectileDefinitions.map(def => [def.projectileId, def]));
  state.projectiles = telemetry.projectiles;
  state.objectiveDefinitions = new Map(telemetry.objectiveDefinitions.map(def => [def.objectiveId, def]));
  state.objectives = telemetry.objectives;
  state.buildableDefinitions = new Map(
    telemetry.buildableDefinitions.map(definition => [definition.buildableId, definition])
  );
  state.buildables = telemetry.buildables;
  state.brushDefinitions = new Map(
    telemetry.brushDefinitions.map(definition => [definition.brushId, definition])
  );
  state.brushes = telemetry.brushes;
  state.entityDefinitions = new Map(
    telemetry.entityDefinitions.map(definition => [definition.entityId, definition])
  );
  state.entities = telemetry.entities;
  state.entityById = new Map(state.entities.map(track => [track.entityId, track]));
  state.entityCensus = telemetry.entityCensus;
  state.sceneMetadataRows = telemetry.entityMetadata || [];
  state.sceneEvents = telemetry.sceneEvents || [];
  state.events = telemetry.events;
  state.killFeedEvents = buildKillFeedEvents();
  state.lastKillFeedRenderKey = "";
  rebuildSceneIndexes();
  buildRoster();
  const requestedSession = Number(
    new URLSearchParams(location.search).get("playerSession")
  );
  const initialSession =
    Number.isSafeInteger(requestedSession) &&
    state.playerBySession.has(requestedSession)
      ? requestedSession
      : state.roster[0]?.sessionId;
  selectPlayer(initialSession);
  setupWorld();
  renderAnalysisTimeline(true);
}

async function applyLiveDelta(telemetry) {
  let rosterChanged = false;
  const rosterIds = new Set(state.roster.map(row => row.sessionId));
  for (const row of telemetry.roster) {
    if (rosterIds.has(row.sessionId)) continue;
    state.roster.push(row);
    rosterIds.add(row.sessionId);
    rosterChanged = true;
  }
  for (const model of telemetry.renderModels) state.renderModels.set(model.modelId, model);
  for (const definition of telemetry.projectileDefinitions) {
    state.projectileDefinitions.set(definition.projectileId, definition);
  }
  for (const definition of telemetry.objectiveDefinitions) {
    state.objectiveDefinitions.set(definition.objectiveId, definition);
  }
  for (const definition of telemetry.buildableDefinitions) {
    state.buildableDefinitions.set(definition.buildableId, definition);
  }
  for (const definition of telemetry.brushDefinitions) {
    state.brushDefinitions.set(definition.brushId, definition);
  }
  for (const definition of telemetry.entityDefinitions) {
    state.entityDefinitions.set(definition.entityId, definition);
  }
  await projectileVisuals.preload(telemetry.projectileDefinitions);
  mergeTracks(state.players, telemetry.players, "sessionId");
  mergeTracks(state.projectiles, telemetry.projectiles, "projectileId");
  mergeTracks(state.objectives, telemetry.objectives, "objectiveId");
  mergeTracks(state.buildables, telemetry.buildables, "buildableId");
  mergeTracks(state.brushes, telemetry.brushes, "brushId");
  mergeTracks(state.entities, telemetry.entities, "entityId");
  state.entityById = new Map(state.entities.map(track => [track.entityId, track]));
  state.entityCensus.push(...telemetry.entityCensus);
  state.sceneMetadataRows.push(...(telemetry.entityMetadata || []));
  state.sceneEvents.push(...(telemetry.sceneEvents || []));
  state.events.push(...telemetry.events);
  state.killFeedEvents = buildKillFeedEvents();
  state.lastKillFeedRenderKey = "";
  rebuildSceneIndexes();
  state.playerBySession = new Map(state.players.map(track => [track.sessionId, track]));
  state.liveEdge = Math.max(state.liveEdge, latestTelemetryTime(telemetry));
  state.duration = state.liveEdge;
  trimLiveTelemetry();
  if (rosterChanged) {
    buildRoster();
    if (state.selectedSession != null) selectPlayer(state.selectedSession);
  }
  if (state.selectedSession == null) {
    const selectable = state.roster.find(row => state.playerBySession.has(row.sessionId));
    selectPlayer(selectable?.sessionId);
  }
  buildVisuals();
  bindBrushNodes();
  renderAnalysisTimeline(true);
}

let liveWorkerPending = null;

function ensureLiveWorker() {
  if (liveWorker) return;
  liveWorker = new Worker("/assets/js/pickup-replay-worker.js?v=20260823clipwindow1");
  liveWorker.onmessage = event => {
    if (event.data.type === "progress") return setStatus(event.data.label);
    if (!liveWorkerPending) return;
    if (event.data.type === "error") {
      const pending = liveWorkerPending;
      liveWorkerPending = null;
      pending.reject(new Error(event.data.error));
      return;
    }
    if (event.data.type === liveWorkerPending.expectedType) {
      const pending = liveWorkerPending;
      liveWorkerPending = null;
      pending.resolve(event.data);
    }
  };
  liveWorker.onerror = event => {
    if (!liveWorkerPending) return;
    const pending = liveWorkerPending;
    liveWorkerPending = null;
    pending.reject(new Error(event.message || "Live replay worker failed."));
  };
}

function requestLiveWorker(message, expectedType) {
  ensureLiveWorker();
  if (liveWorkerPending) return Promise.reject(new Error("Live telemetry parser is already busy."));
  return new Promise((resolve, reject) => {
    liveWorkerPending = { expectedType, resolve, reject };
    liveWorker.postMessage(message);
  });
}

function queueLiveBatch(batch) {
  const sequence = Number(batch?.sequence);
  if (!Number.isSafeInteger(sequence) || sequence <= liveQueuedSequence) return;
  if (sequence !== liveQueuedSequence + 1) {
    location.reload();
    return;
  }
  liveQueuedSequence = sequence;
  liveBatchQueue = liveBatchQueue.then(async () => {
    const parsed = await requestLiveWorker({ type: "live-append", batch }, "live-delta");
    await applyLiveDelta(parsed.payload);
    state.liveSequence = sequence;
    if (batch.final) {
      state.liveEnded = true;
      state.followLive = false;
    }
    updateLiveHud();
    setStatus("");
  }).catch(error => {
    console.error("[pickup-live]", error);
    liveEventSource?.close();
    setLiveChrome("connecting");
    setStatus(error.message || "Live telemetry update failed.");
  });
}

function connectLiveEvents(metadata, sequence) {
  liveQueuedSequence = sequence;
  liveEventSource = new EventSource(`${metadata.events}?after=${encodeURIComponent(sequence)}`);
  liveEventSource.addEventListener("open", () => {
    if (state.liveReady) setStatus("");
  });
  liveEventSource.addEventListener("batch", event => {
    try {
      queueLiveBatch(JSON.parse(event.data));
    } catch {
      setStatus("The live feed sent an invalid update.");
      liveEventSource.close();
    }
  });
  liveEventSource.addEventListener("final", () => {
    state.liveEnded = true;
    state.followLive = false;
    updateLiveHud();
  });
  liveEventSource.addEventListener("reset", () => location.reload());
  liveEventSource.addEventListener("error", () => {
    if (!state.liveEnded) {
      setLiveChrome("connecting");
      setStatus("Live feed interrupted; reconnecting…");
    }
  });
}

async function loadTfcModelCatalog() {
  const response = await fetch(`/assets/tfc/models/manifest.json?v=${TFC_MODEL_ASSET_VERSION}`, { cache: "force-cache" });
  if (!response.ok) throw new Error(`TFC model catalog request failed (${response.status})`);
  const catalog = await response.json();
  return new Map(Object.entries(catalog.models || {}));
}

function cleanupReplayObjects() {
  liveEventSource?.close();
  liveEventSource = null;
  liveWorker?.terminate();
  liveWorker = null;
  for (const root of [
    playerRoot, corpseRoot, projectileRoot, objectiveRoot, buildableRoot, entityRoot,
    impactRoot, hitscanRoot, bloodRoot
  ]) {
    root.clear();
  }
  state.bloodEffects = [];
  state.playerBySession.clear();
  state.projectileDefinitions.clear();
  state.objectiveDefinitions.clear();
  state.buildableDefinitions.clear();
  state.brushDefinitions.clear();
  state.entityDefinitions.clear();
  state.entityById.clear();
  state.entityCensus = [];
  state.entityMetadata.clear();
  state.sceneMetadataRows = [];
  state.sceneEvents = [];
  state.sceneDeathsBySession.clear();
}

async function initRealLive() {
  const identity = { ...queryIdentity(), serverId: LIVE_SERVER_ID.toLowerCase() };
  setLiveChrome("connecting");
  setStatus(`Connecting to ${identity.serverId.toUpperCase()}…`);
  const metadataResponse = await fetch(
    `/api/pickup-live/viewer/${encodeURIComponent(identity.serverId)}/${encodeURIComponent(identity.matchId)}/${identity.round}`,
    { cache: "no-store" }
  );
  const metadata = await metadataResponse.json();
  if (!metadataResponse.ok) {
    throw new Error(metadata.error === "live_stream_not_found"
      ? `No live feed is running for ${identity.serverId.toUpperCase()} ${identity.matchId}, round ${identity.round}.`
      : metadata.error || `Live feed request failed (${metadataResponse.status})`);
  }
  const queryMap = new URLSearchParams(location.search).get("map") || "";
  if (!metadata.map && /^[A-Za-z0-9_-]{1,64}$/.test(queryMap)) metadata.map = queryMap;
  if (!metadata.map) throw new Error("The live feed is connected, but its map is not available yet.");
  state.metadata = { ...metadata, manifest: { schema_version: metadata.schemaVersion } };
  state.liveBufferSeconds = Number(metadata.bufferSeconds) || LIVE_BUFFER_SECONDS;
  $("replay-title").textContent = `${metadata.map} · ${metadata.matchId} / Round ${metadata.round}`;
  $("replay-subtitle").textContent = `${metadata.serverId.toUpperCase()} · direct server telemetry`;
  $("replay-round-status").textContent = metadata.active ? "LIVE TELEMETRY" : "FEED STALE";
  $("replay-duration").textContent = "LIVE";
  $("replay-slider").max = "1";
  document.title = `NoName TFC | ${metadata.map} Pickup Live`;

  const [snapshotResponse, modelCatalog] = await Promise.all([
    fetch(metadata.snapshot, { cache: "no-store" }),
    loadTfcModelCatalog()
  ]);
  const snapshot = await snapshotResponse.json();
  if (!snapshotResponse.ok) throw new Error(snapshot.error || `Live snapshot failed (${snapshotResponse.status})`);
  const parsed = await requestLiveWorker({
    type: "live-reset",
    files: snapshot.files,
    schemaVersion: snapshot.schemaVersion,
    sequence: snapshot.sequence
  }, "live-complete");
  state.modelCatalog = modelCatalog;
  setStatus("Loading projectile models and effects…");
  await projectileVisuals.preload(parsed.payload.projectileDefinitions);
  installTelemetry(parsed.payload);
  state.liveEdge = latestTelemetryTime(parsed.payload);
  state.duration = state.liveEdge;
  state.liveSequence = snapshot.sequence;
  state.liveEnded = Boolean(snapshot.final);
  state.liveReady = true;
  state.followLive = !state.liveEnded;
  const requestedClip = clipQuery();
  setClipBounds(requestedClip.start ?? Math.max(0, state.liveEdge - Math.min(state.liveBufferSeconds, CLIP_MAX_SECONDS)), requestedClip.end ?? state.liveEdge);
  state.clipTitle = requestedClip.title;
  if (requestedClip.start != null || requestedClip.end != null) state.clipEditorOpen = true;
  state.playbackTime = Math.max(0, state.liveEdge - LIVE_TARGET_LATENCY_SECONDS);
  setPlaying(true);
  updateLiveHud();
  updateScene();
  setStatus("");
  if (!state.liveEnded) connectLiveEvents(metadata, snapshot.sequence);
}

async function init() {
  markReplayTiming("replay-init-start", {
    direct: DIRECT_CLIP_EXPORT,
    fastDirectExport: FAST_DIRECT_EXPORT,
    webdriver: navigator.webdriver === true,
    headlessChrome: HEADLESS_CHROME,
    explicitDirectExport: EXPLICIT_DIRECT_EXPORT
  });
  wireControls();
  resize();
  requestAnimationFrame(tick);
  try {
    if (LIVE_PAGE && LIVE_SERVER_ID && !LIVE_REAL) throw new Error("Missing or invalid live server ID.");
    if (LIVE_REAL) {
      await initRealLive();
      return;
    }
    const identity = queryIdentity();
    markReplayTiming("replay-data-load-start", identity);
    const response = await fetch(
      `/api/pickup-replays/viewer/${encodeURIComponent(identity.matchId)}/${identity.round}`,
      { cache: "no-store" }
    );
    const metadata = await response.json();
    if (!response.ok) throw new Error(metadata.error || `Replay request failed (${response.status})`);
    markReplayTiming("replay-metadata-loaded", {
      durationMs: metadata.durationMs,
      snapshots: metadata.snapshots
    });
    state.metadata = metadata;
    state.duration = metadata.durationMs / 1000;
    const requestedClip = clipQuery();
    setClipBounds(requestedClip.start ?? 0, requestedClip.end ?? Math.min(state.duration, CLIP_MAX_SECONDS));
    state.clipTitle = requestedClip.title;
    if (requestedClip.start != null || requestedClip.end != null) {
      state.playbackTime = state.clipStart;
      state.clipEditorOpen = true;
      if (DIRECT_CLIP_EXPORT) {
        setPlaying(false);
        markReplayTiming("preview-render-skipped", { reason: "direct-export" });
      }
    }
    $("replay-title").textContent = `${metadata.map} · ${metadata.matchId} / Round ${metadata.round}`;
    $("replay-subtitle").textContent = LIVE_SIMULATION
      ? `${metadata.sourceServer || "recorded server"} · simulated ${state.feedSpeed}x telemetry delivery`
      : `${metadata.snapshots.toLocaleString()} snapshots · ${metadata.rowCounts.players.toLocaleString()} player rows · ${metadata.rowCounts.projectiles.toLocaleString()} projectile rows`;
    $("replay-round-status").textContent = LIVE_SIMULATION
      ? "SIMULATED FEED"
      : `${metadata.status} · ${metadata.reason || "no reason"}`;
    $("replay-duration").textContent = LIVE_SIMULATION ? "LIVE" : formatTime(state.duration);
    $("replay-slider").max = String(LIVE_SIMULATION ? 1 : Math.max(1, metadata.durationMs));
    document.title = LIVE_SIMULATION
      ? `NoName TFC | ${metadata.map} Pickup Live Prototype`
      : `NoName TFC | ${metadata.map} 4v4 Replay`;

    const [telemetry, modelCatalog] = await Promise.all([
      loadTelemetry(metadata.files),
      loadTfcModelCatalog()
    ]);
    markReplayTiming("replay-telemetry-loaded", {
      players: telemetry.players?.length || 0,
      projectiles: telemetry.projectiles?.length || 0
    });
    setStatus("Loading projectile models and effects…");
    await projectileVisuals.preload(telemetry.projectileDefinitions);
    state.modelCatalog = modelCatalog;
    installTelemetry(telemetry);
    markReplayTiming("replay-data-load-end", {
      selectedSession: state.selectedSession,
      playerSession: PAGE_QUERY.get("playerSession")
    });
    if (LIVE_SIMULATION) {
      const requestedFeedSpeed = Number(new URLSearchParams(location.search).get("feedSpeed"));
      state.feedSpeed = Number.isFinite(requestedFeedSpeed)
        ? THREE.MathUtils.clamp(requestedFeedSpeed, 0.25, 16)
      : 1;
      state.liveEdge = Math.min(state.duration, LIVE_TARGET_LATENCY_SECONDS);
      setClipBounds(requestedClip.start ?? Math.max(0, state.liveEdge - Math.min(state.liveBufferSeconds, CLIP_MAX_SECONDS)), requestedClip.end ?? state.liveEdge);
      state.playbackTime = Math.max(0, state.liveEdge - LIVE_TARGET_LATENCY_SECONDS);
      state.liveReady = true;
      state.followLive = true;
      setPlaying(true);
      $("replay-subtitle").textContent =
        `${metadata.sourceServer || "recorded server"} · simulated ${state.feedSpeed}x telemetry delivery`;
      updateLiveHud();
    }
    updateScene();
    setStatus("");
  } catch (error) {
    console.error("[pickup-replay]", error);
    setPlaying(false);
    setStatus(error.message || "Replay unavailable.");
  }
}

window.addEventListener("beforeunload", cleanupReplayObjects, { once: true });
init();
