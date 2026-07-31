import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { configureReplayMapMaterial } from "./replay-map-materials.js?v=20260730mapmaterials1";

// replay-format:start
/**
 * @typedef {Object} ReplayFrame
 * @property {number} t
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} pitch
 * @property {number} yaw
 * @property {number} roll
 * @property {number} buttons
 * @property {string|null} viewmodel
 */
function optionalViewmodel(value) {
  if (value == null) return null;
  const viewmodel = String(value).trim();
  return !viewmodel || viewmodel === "-" ? null : viewmodel;
}

function frameColumns(frame) {
  if (typeof frame === "string") return frame.replace(/;\s*$/, "").split(",");
  if (Array.isArray(frame)) return frame;
  return null;
}

/** @returns {ReplayFrame|null} */
function decodeReplayFrame(frame) {
  const cols = frameColumns(frame);
  const values = cols
    ? cols.slice(0, 8).map(value => Number(String(value).trim()))
    : [frame?.t, frame?.x, frame?.y, frame?.z, frame?.pitch, frame?.yaw, frame?.roll, frame?.buttons].map(Number);
  if (values.length < 8 || values.some(value => !Number.isFinite(value))) return null;
  return {
    t: values[0],
    x: values[1],
    y: values[2],
    z: values[3],
    pitch: values[4],
    yaw: values[5],
    roll: values[6],
    buttons: Math.trunc(values[7]),
    viewmodel: optionalViewmodel(cols ? cols[8] : frame?.viewmodel)
  };
}

/** @returns {ReplayFrame[]} */
function decodeReplayFrames(frames) {
  if (typeof frames === "string") {
    return frames.split(";").map(part => part.trim()).filter(Boolean).map(decodeReplayFrame).filter(Boolean);
  }
  if (!Array.isArray(frames)) return [];
  return frames.map(decodeReplayFrame).filter(Boolean);
}

function firstProjectileFrames(frames) {
  if (!Array.isArray(frames)) return [];
  const seen = new Set();
  return [...frames]
    .filter(frame => Number.isFinite(Number(frame?.t)) && Number.isFinite(Number(frame?.projectileId)))
    .sort((a, b) => (Number(a.t) - Number(b.t)) || (Number(a.projectileId) - Number(b.projectileId)) || (Number(b.state) - Number(a.state)))
    .filter(frame => {
      const projectileId = Number(frame.projectileId);
      if (seen.has(projectileId)) return false;
      seen.add(projectileId);
      return true;
    });
}
// replay-format:end

const $ = id => document.getElementById(id);
const loader = new GLTFLoader();
const projectileAssetCache = new Map();
const spriteAssetCache = new Map();
const effectTextureCache = new Map();
const playerModelAssetCache = new Map();
const DEFAULT_REPLAY_FOV = 90;
const MIN_REPLAY_FOV = 45;
const MAX_REPLAY_FOV = 110;
const REPLAY_FOV_STEP = 5;
const REPLAY_FOV_STORAGE_KEY = "speedrunReplayFov";
const REPLAY_TRAIL_STORAGE_KEY = "speedrunReplayShowTrail";
const REPLAY_ZONES_STORAGE_KEY = "speedrunReplayShowZones";
const REPLAY_PLAYER_MODEL_STYLE_KEY = "speedrunReplayPlayerModelStyle";
const PLAYER_MODEL_ASSET_VERSION = "red5";
const PLAYER_MODEL_DISPLAY_HEIGHT = 72;
const STANDING_PLAYER_FOOT_OFFSET = 36;
const CROUCHED_PLAYER_FOOT_OFFSET = 18;
const STANDING_PLAYER_EYE_OFFSET = 28;
const CROUCHED_PLAYER_EYE_OFFSET = 12;
const FREE_ROAM_MOVE_SPEED = 1440;
const FREE_ROAM_LOOK_SENSITIVITY = 0.0022;
const FREE_ROAM_MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const GRENADE_HUD_FALLBACK_DURATION = 0.9;
const readReplayDebugFlag = () => {
  if (new URLSearchParams(window.location.search).get("debug") === "1") return true;
  try {
    return window.localStorage?.getItem?.("speedrunReplayDebug") === "1";
  } catch {
    return false;
  }
};
const REPLAY_DEBUG = readReplayDebugFlag();
const readStoredReplayToggle = (key, defaultValue = true) => {
  try {
    const value = window.localStorage?.getItem?.(key);
    if (value == null) return defaultValue;
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
};
const readStoredReplayFov = () => {
  try {
    const value = Number(window.localStorage?.getItem?.(REPLAY_FOV_STORAGE_KEY));
    if (!Number.isFinite(value)) return DEFAULT_REPLAY_FOV;
    return THREE.MathUtils.clamp(value, MIN_REPLAY_FOV, MAX_REPLAY_FOV);
  } catch {
    return DEFAULT_REPLAY_FOV;
  }
};
const readStoredPlayerModelStyle = () => {
  try {
    return window.localStorage?.getItem?.(REPLAY_PLAYER_MODEL_STYLE_KEY) === "new" ? "new" : "classic";
  } catch {
    return "classic";
  }
};
const SPRITE_ASSET_REGISTRY = new Map([
  ["explode01", { path: "/assets/sprites/explode01.spr", fallbackKind: "explode01" }],
  ["explode02", { path: "/assets/sprites/explode02.spr", fallbackKind: "explode01" }],
  ["shockwave", { path: "/assets/sprites/shockwave.spr", fallbackKind: "shockwave" }],
  ["smoke", { path: "/assets/sprites/smoke.spr", fallbackKind: "smoke" }],
  ["animglow01", { path: "/assets/sprites/animglow01.spr", fallbackKind: "rocketflare" }],
  ["hud_frag", { path: "/assets/models/640hud7.spr", fallbackKind: "explode01" }],
  ["hud_conc", { path: "/assets/models/640hud7o.spr", fallbackKind: "explode01" }]
]);
const GRENADE_HUD_CONFIG = new Map([
  ["frag", { label: "FRAG", pngPath: "/assets/models/hud_frag.png", color: "#facc15" }],
  ["conc", { label: "CONC", pngPath: "/assets/models/hud_conc.png", color: "#34d399" }],
  ["mirv", { label: "MIRV", pngPath: "/assets/models/hud_mirv.png", color: "#ef4444" }],
  ["nail", { label: "NAIL", pngPath: "/assets/models/hud_nail.png", color: "#22d3ee" }],
  ["emp", { label: "EMP", pngPath: "/assets/models/hud_emp.png", color: "#60a5fa" }]
]);
const PROJECTILE_MODEL_REGISTRY = new Map([
  ["models/conc_grenade.mdl", "/assets/models/conc_grenade.glb"],
  ["models/w_grenade.mdl", "/assets/models/grenade.glb"],
  ["models/rpgrocket.mdl", "/assets/models/rocket.glb"],
  ["models/pipebomb_yellow_variant", "/assets/models/pipebomb_yellow.glb"],
  ["models/pipebomb_blue_variant", "/assets/models/pipebomb_blue.glb"],
  ["models/mirv_grenade.mdl", "/assets/models/mirv.glb"],
  ["models/bomblet.mdl", "/assets/models/bomblet.glb"],
  ["models/ngrenade.mdl", "/assets/models/nailgrenade.glb"],
  ["models/napalm.mdl", "/assets/models/napalm.glb"]
]);

const PLAYER_MODEL_PATHS = new Map([
  [0, { folder: "civilian", file: "civilian", hasClassic: false }],
  [1, { folder: "scout", file: "scout", hasClassic: true }],
  [2, { folder: "sniper", file: "sniper", hasClassic: true }],
  [3, { folder: "soldier", file: "soldier", hasClassic: true }],
  [4, { folder: "demo", file: "demo", hasClassic: true }],
  [5, { folder: "medic", file: "medic", hasClassic: true }],
  [6, { folder: "hvyweapon", file: "hvyweapon", hasClassic: true }],
  [7, { folder: "pyro", file: "pyro", hasClassic: true }],
  [8, { folder: "spy", file: "spy", hasClassic: true }],
  [9, { folder: "engineer", file: "engineer", hasClassic: true }],
  [10, { folder: "civilian", file: "civilian", hasClassic: false }],
  [11, { folder: "civilian", file: "civilian", hasClassic: false }]
]);

const debugReplay = (...args) => {
  if (REPLAY_DEBUG) console.debug("[speedrun-replay]", ...args);
};

const warnReplay = (...args) => {
  if (REPLAY_DEBUG) console.warn("[speedrun-replay]", ...args);
};

function isMostlyWhiteColor(color) {
  if (!color || typeof color.r !== "number" || typeof color.g !== "number" || typeof color.b !== "number") return false;
  return color.r >= 0.92 && color.g >= 0.92 && color.b >= 0.92;
}

const PROJECTILE_DEFS = [
  { key: "conc", classnames: ["tf_weapon_concussiongrenade"], models: ["models/conc_grenade.mdl"], color: 0x22c55e, primitive: "sphere", radius: 18, impact: "conc", effect: "shockwave" },
  { key: "grenade", classnames: ["tf_weapon_normalgrenade"], models: ["models/w_grenade.mdl"], color: 0xfacc15, primitive: "sphere", radius: 18, impact: "generic", effect: "explode01" },
  { key: "rocket", classnames: ["tf_rpg_rocket"], models: ["models/rpgrocket.mdl"], color: 0xf97316, primitive: "rocket", radius: 16, impact: "generic", effect: "explode01", flare: true, flareSprite: "animglow01", smokeSprite: "smoke", modelYawOffsetDeg: 180 },
  { key: "pipe-yellow", classnames: ["tf_gl_pipebomb"], models: ["models/pipebomb.mdl"], assetModel: "models/pipebomb_yellow_variant", color: 0xfacc15, primitive: "pipe", radius: 17, impact: "generic", effect: "explode01", forceFallback: true },
  { key: "pipe-blue", classnames: ["tf_gl_grenade"], models: ["models/pipebomb.mdl"], assetModel: "models/pipebomb_blue_variant", color: 0x3b82f6, primitive: "pipe", radius: 17, impact: "generic", effect: "explode01", forceFallback: true },
  { key: "mirv", classnames: ["tf_weapon_mirvgrenade"], models: ["models/mirv_grenade.mdl"], color: 0xef4444, primitive: "sphere", radius: 19, impact: "mirv", effect: "explode02", modelRotationDeg: { x: -75, y: 180, z: 58 }, spinAxis: "z", spinSpeedRad: 0.0035 },
  { key: "mirv-bomblet", classnames: ["tf_weapon_mirvbomblet"], models: ["models/bomblet.mdl"], color: 0xfb923c, primitive: "sphere", radius: 12, impact: "mirvlet", effect: "explode01" },
  { key: "nail", classnames: ["tf_weapon_nailgrenade"], models: ["models/ngrenade.mdl"], color: 0x22d3ee, primitive: "sphere", radius: 18, impact: "generic", effect: "explode01" },
  { key: "napalm", classnames: ["tf_weapon_napalmgrenade"], models: ["models/napalm.mdl"], color: 0xf97316, primitive: "sphere", radius: 18, impact: "generic", effect: "explode01" },
  { key: "unknown", classnames: [], models: [], color: 0xffffff, primitive: "sphere", radius: 14, impact: "generic", effect: "explode01" }
];

const PROJECTILE_DEF_BY_KEY = new Map(PROJECTILE_DEFS.map(def => [def.key, def]));
const DEFAULT_PROJECTILE_DEF = PROJECTILE_DEF_BY_KEY.get("unknown");

const state = {
  replay: null,
  frames: [],
  normalized: [],
  projectileFrames: [],
  projectileTracks: [],
  projectileCount: 0,
  projectileImpacts: [],
  projectileSmokeEffects: [],
  grenadeHudEvents: [],
  zones: null,
  origin: null,
  primaryDuration: 0,
  duration: 0,
  playbackTime: 0,
  fov: readStoredReplayFov(),
  playerModelStyle: readStoredPlayerModelStyle(),
  speed: 1,
  showTrail: readStoredReplayToggle(REPLAY_TRAIL_STORAGE_KEY, true),
  showZones: readStoredReplayToggle(REPLAY_ZONES_STORAGE_KEY, true),
  overlaysVisible: true,
  cameraMode: "pov",
  freeCameraYaw: 0,
  freeCameraPitch: 0,
  playing: true,
  lastTick: performance.now(),
  frameIndex: 0,
  comparison: null,
  comparisonCandidatesLoaded: false
};
const freeRoamKeys = new Set();
let freeRoamDrag = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a0f);
scene.fog = new THREE.Fog(0x070a0f, 5000, 26000);

const canvas = $("replay-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const camera = new THREE.PerspectiveCamera(58, 1, 1, 100000);
camera.fov = state.fov;
camera.updateProjectionMatrix();

const root = new THREE.Group();
scene.add(root);

scene.add(new THREE.HemisphereLight(0xbfe7ff, 0x1d2633, 2.1));
const sun = new THREE.DirectionalLight(0xfff0c0, 2.5);
sun.position.set(-800, 1400, 900);
scene.add(sun);

const player = new THREE.Group();
player.visible = false;
player.renderOrder = 3;
root.add(player);

const comparisonPlayer = new THREE.Group();
comparisonPlayer.visible = false;
comparisonPlayer.renderOrder = 3;
root.add(comparisonPlayer);

let grid = null;
let trail = null;
let comparisonTrail = null;
let startMarker = null;
let finishMarker = null;
let zoneRoot = null;
let mapModel = null;
let projectileRoot = null;
let impactRoot = null;
let smokeRoot = null;
let overlaysHideTimer = null;
let activeGrenadeHudType = "";

function params() {
  return new URLSearchParams(window.location.search);
}

function firstParam(query, names) {
  for (const name of names) {
    const value = query.get(name);
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function playerModelInfo(replay) {
  const classId = Number(replay?.classId);
  return PLAYER_MODEL_PATHS.get(classId) || PLAYER_MODEL_PATHS.get(0);
}

function playerModelUrl(replay, style = state.playerModelStyle) {
  const info = playerModelInfo(replay);
  const suffix = style === "classic" && info.hasClassic ? "2" : "";
  return `assets/models/player/${encodeURIComponent(info.folder)}/${encodeURIComponent(info.file + suffix)}.glb?v=${PLAYER_MODEL_ASSET_VERSION}`;
}

function updatePrimaryPlayerVisibility() {
  player.visible = state.cameraMode === "free" && player.children.length > 0;
}

function loadPlayerModelAsset(url) {
  if (playerModelAssetCache.has(url)) return playerModelAssetCache.get(url);
  const promise = new Promise(resolve => {
    loader.load(
      url,
      gltf => resolve(gltf.scene || null),
      undefined,
      error => {
        warnReplay("player model load failed", { url, error });
        resolve(null);
      }
    );
  });
  playerModelAssetCache.set(url, promise);
  return promise;
}

async function setReplayPlayerModel(container, replay) {
  if (!container || !replay) return;
  const url = playerModelUrl(replay);
  const replayKey = `${replay.runId || "run"}:${url}`;
  container.userData.replayKey = replayKey;
  const source = await loadPlayerModelAsset(url);
  if (!source || container.userData.replayKey !== replayKey) return;

  const model = source.clone(true);
  model.traverse(child => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = 3;
  });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? PLAYER_MODEL_DISPLAY_HEIGHT / size.y : 1;
  model.scale.setScalar(scale);
  model.position.y = -bounds.min.y * scale;
  container.clear();
  container.add(model);
  if (container === player) updatePrimaryPlayerVisibility();
}

function updatePlayerModelStyleButton() {
  const button = $("replay-model-style");
  if (!button) return;
  const isNew = state.playerModelStyle === "new";
  button.textContent = `Models: ${isNew ? "New" : "Classic"}`;
  button.classList.toggle("active", isNew);
  button.setAttribute("aria-pressed", String(isNew));
}

async function setPlayerModelStyle(style) {
  state.playerModelStyle = style === "classic" ? "classic" : "new";
  try {
    window.localStorage?.setItem?.(REPLAY_PLAYER_MODEL_STYLE_KEY, state.playerModelStyle);
  } catch {}
  updatePlayerModelStyleButton();
  await Promise.all([
    state.replay ? setReplayPlayerModel(player, state.replay) : Promise.resolve(),
    state.comparison?.replay ? setReplayPlayerModel(comparisonPlayer, state.comparison.replay) : Promise.resolve()
  ]);
}

function setTrailVisible(visible) {
  state.showTrail = Boolean(visible);
  if (trail) trail.visible = state.showTrail;
  if (comparisonTrail) comparisonTrail.visible = state.showTrail;
  if (startMarker) startMarker.visible = state.showTrail;
  if (finishMarker) finishMarker.visible = state.showTrail;
  try {
    window.localStorage?.setItem?.(REPLAY_TRAIL_STORAGE_KEY, state.showTrail ? "1" : "0");
  } catch {}
  debugReplay("trail visibility changed", {
    showTrail: state.showTrail,
    trailVisible: trail?.visible ?? null,
    startMarkerVisible: startMarker?.visible ?? null,
    finishMarkerVisible: finishMarker?.visible ?? null,
    zoneRootVisible: zoneRoot?.visible ?? null
  });
  const button = $("replay-trail");
  if (button) button.classList.toggle("active", state.showTrail);
}

function setZoneVisualsVisible(visible) {
  if (zoneRoot) zoneRoot.visible = Boolean(visible);
  debugReplay("zone visibility changed", {
    showZones: Boolean(visible),
    zoneRootVisible: zoneRoot?.visible ?? null,
    checkpointCount: zoneRoot?.children?.length ?? 0
  });
  const button = $("replay-zones");
  if (button) button.classList.toggle("active", state.showZones);
}

function setZonesEnabled(visible) {
  state.showZones = Boolean(visible);
  try {
    window.localStorage?.setItem?.(REPLAY_ZONES_STORAGE_KEY, state.showZones ? "1" : "0");
  } catch {}
  setZoneVisualsVisible(state.showZones);
}

function setOverlaysVisible(visible) {
  state.overlaysVisible = Boolean(visible);
  const stage = document.querySelector(".replay-stage");
  if (!stage) return;
  stage.classList.toggle("overlays-hidden", !state.overlaysVisible);
}

function updateReplayFovLabel() {
  const label = $("replay-fov-label");
  if (label) label.textContent = `FOV: ${state.fov}`;
}

function setReplayFov(nextFov) {
  const clamped = THREE.MathUtils.clamp(Number(nextFov) || DEFAULT_REPLAY_FOV, MIN_REPLAY_FOV, MAX_REPLAY_FOV);
  state.fov = clamped;
  camera.fov = clamped;
  camera.updateProjectionMatrix();
  updateReplayFovLabel();
  try {
    window.localStorage?.setItem?.(REPLAY_FOV_STORAGE_KEY, String(clamped));
  } catch {}
}

function adjustReplayFov(delta) {
  setReplayFov(state.fov + delta);
}

function clearOverlaysHideTimer() {
  if (overlaysHideTimer == null) return;
  window.clearTimeout(overlaysHideTimer);
  overlaysHideTimer = null;
}

function scheduleOverlaysAutoHide() {
  clearOverlaysHideTimer();
  if (!state.playing) return;
  overlaysHideTimer = window.setTimeout(() => {
    overlaysHideTimer = null;
    if (state.playing) setOverlaysVisible(false);
  }, 1000);
}

function setStatus(message) {
  const el = $("replay-status");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
}

function grenadeHudTypeForFrame(frame) {
  const classname = normalizeKey(frame?.classname);
  const model = normalizeKey(frame?.model);
  if (classname.includes("concussiongrenade") || classname.includes("conc")) return "conc";
  if (classname.includes("mirv")) return "mirv";
  if (classname.includes("nailgrenade") || model.includes("ngrenade")) return "nail";
  if (classname.includes("emp")) return "emp";
  if (classname.includes("normalgrenade") || model.includes("w_grenade") || classname.includes("grenade")) return "frag";
  return "";
}

function generateGrenadeHudFallbackIcon(type) {
  const config = GRENADE_HUD_CONFIG.get(type);
  if (!config) return "";
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(7, 10, 15, 0.0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = config.color || "#e2e8f0";
  ctx.beginPath();
  ctx.arc(48, 36, 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(7, 10, 15, 0.92)";
  ctx.fillRect(42, 54, 12, 18);
  ctx.beginPath();
  ctx.moveTo(42, 71);
  ctx.lineTo(54, 71);
  ctx.lineTo(48, 82);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 16, 60, 66);

  return canvas.toDataURL("image/png");
}

function grenadeHudPreferredUrl(type) {
  const config = GRENADE_HUD_CONFIG.get(type);
  if (!config) return "";
  return config.pngPath || generateGrenadeHudFallbackIcon(type);
}

function showGrenadeHud(type) {
  const hud = $("replay-grenade-hud");
  const image = $("replay-grenade-hud-image");
  const label = $("replay-grenade-hud-label");
  const config = GRENADE_HUD_CONFIG.get(type);
  if (!hud || !image || !label || !config) return;
  const iconUrl = grenadeHudPreferredUrl(type);
  if (!iconUrl) {
    hideGrenadeHud();
    return;
  }
  activeGrenadeHudType = type;
  image.onerror = () => {
    image.onerror = null;
    image.src = generateGrenadeHudFallbackIcon(type);
  };
  image.src = iconUrl;
  image.alt = `${config.label} grenade`;
  label.textContent = config.label;
  hud.classList.add("visible");
}

function hideGrenadeHud() {
  const hud = $("replay-grenade-hud");
  if (hud) hud.classList.remove("visible");
  activeGrenadeHudType = "";
}

function buildGrenadeHudEvents(projectileFrames) {
  const events = [];
  const normalizedFrames = firstProjectileFrames(projectileFrames)
    .map(frame => normalizeProjectileFrame(frame, state.origin))
    .filter(frame => Number.isFinite(frame.rt) && frame.rt >= 0)
    .sort((a, b) => (a.rt - b.rt) || (a.projectileId - b.projectileId) || (b.state - a.state));

  for (const frame of normalizedFrames) {
    const type = grenadeHudTypeForFrame(frame);
    if (!type) continue;
    events.push({
      type,
      start: frame.rt,
      end: frame.rt + GRENADE_HUD_FALLBACK_DURATION
    });
  }

  return events;
}

function updateGrenadeHud() {
  let activeEvent = null;
  for (const event of state.grenadeHudEvents) {
    if (state.playbackTime < event.start || state.playbackTime > event.end) continue;
    if (!activeEvent || event.start > activeEvent.start) activeEvent = event;
  }

  if (!activeEvent) {
    if (activeGrenadeHudType) hideGrenadeHud();
    return;
  }

  if (activeGrenadeHudType !== activeEvent.type) {
    showGrenadeHud(activeEvent.type);
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function runTime(ms) {
  const value = Number(ms);
  return Number.isFinite(value) ? formatTime(value / 1000) : "-";
}

function apiReplayPath(query) {
  const runId = firstParam(query, ["runId", "run_id", "run"]);
  if (runId) {
    if (!/^\d+$/.test(runId) || Number(runId) <= 0) throw new Error("Invalid replay run ID.");
    return `/api/speedruns/replay/run/${encodeURIComponent(runId)}`;
  }
  const map = firstParam(query, ["map", "mapName", "m"]);
  const classId = firstParam(query, ["classId", "class", "class_id", "cls", "c"]);
  const steamid = firstParam(query, ["steamid", "steamId", "steam_id", "steam"]);
  if (!map || !classId || !steamid) {
    const missing = [
      !map ? "map" : "",
      !classId ? "classId" : "",
      !steamid ? "steamid" : ""
    ].filter(Boolean).join(", ");
    throw new Error(`Missing replay query params: ${missing}.`);
  }
  return `/api/speedruns/replay/${encodeURIComponent(map)}/${encodeURIComponent(classId)}/${encodeURIComponent(steamid)}`;
}

async function fetchReplay() {
  const res = await fetch(apiReplayPath(params()), { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Replay request failed (${res.status})`);
  return json;
}

function canonicalizeReplayUrl(replay) {
  const runId = Number(replay?.runId);
  if (!Number.isSafeInteger(runId) || runId <= 0) return;

  const url = new URL(window.location.href);
  url.searchParams.set("runId", String(runId));
  for (const key of ["run_id", "run", "map", "mapName", "m", "classId", "class", "class_id", "cls", "c", "steamid", "steamId", "steam_id", "steam"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

function toThreePoint(frame, origin) {
  return new THREE.Vector3(
    frame.x - origin.x,
    frame.z - origin.z,
    -(frame.y - origin.y)
  );
}

function interpolateRawReplayFrame(frames, time) {
  if (time <= Number(frames[0]?.t)) return { ...frames[0], t: time };
  const last = frames[frames.length - 1];
  if (time >= Number(last?.t)) return { ...last, t: time };

  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (Number(frames[mid].t) < time) low = mid + 1;
    else high = mid;
  }

  const b = frames[low];
  const a = frames[Math.max(0, low - 1)];
  const span = Math.max(0.0001, Number(b.t) - Number(a.t));
  const mix = Math.min(1, Math.max(0, (time - Number(a.t)) / span));
  return {
    ...a,
    t: time,
    x: THREE.MathUtils.lerp(Number(a.x), Number(b.x), mix),
    y: THREE.MathUtils.lerp(Number(a.y), Number(b.y), mix),
    z: THREE.MathUtils.lerp(Number(a.z), Number(b.z), mix),
    pitch: THREE.MathUtils.lerp(Number(a.pitch), Number(b.pitch), mix),
    yaw: lerpAngleDeg(Number(a.yaw), Number(b.yaw), mix),
    roll: THREE.MathUtils.lerp(Number(a.roll), Number(b.roll), mix),
    buttons: mix < 0.5 ? a.buttons : b.buttons
  };
}

function replayTimingWindow(frames, replay) {
  const fallbackStart = frames.find(frame => Number(frame.t) >= 0) || frames[0];
  const fallback = {
    startTime: Number(fallbackStart.t),
    endTime: Number(frames[frames.length - 1].t),
    source: "frame-zero"
  };
  const officialDuration = Number(replay?.timeMs) / 1000;
  const finish = replay?.zones?.finish;
  const finishPosition = finish?.position;
  if (!Number.isFinite(officialDuration) || officialDuration <= 0 || !finishPosition) return fallback;

  const firstTime = Number(frames[0].t);
  const lastTime = Number(frames[frames.length - 1].t);
  const radius = Math.max(1, Number(finish.radius) || 64);
  const eligible = frames.filter(frame => {
    const time = Number(frame.t);
    return Number.isFinite(time) && time - officialDuration >= firstTime - 0.05;
  });
  if (!eligible.length) return fallback;

  const horizontalDistanceSq = frame => {
    const dx = Number(frame.x) - Number(finishPosition.x);
    const dy = Number(frame.y) - Number(finishPosition.y);
    return dx * dx + dy * dy;
  };
  const firstInsideIndex = eligible.findIndex(frame => horizontalDistanceSq(frame) <= radius * radius);
  let finishFrame = null;
  if (firstInsideIndex >= 0) {
    finishFrame = eligible[firstInsideIndex];
    for (let index = firstInsideIndex + 1; index < eligible.length; index += 1) {
      const frame = eligible[index];
      if (horizontalDistanceSq(frame) > radius * radius) break;
      if (horizontalDistanceSq(frame) < horizontalDistanceSq(finishFrame)) finishFrame = frame;
    }
  } else {
    finishFrame = eligible.reduce((closest, frame) => (
      !closest || horizontalDistanceSq(frame) < horizontalDistanceSq(closest) ? frame : closest
    ), null);
  }

  const endTime = Number(finishFrame?.t);
  const startTime = endTime - officialDuration;
  if (!Number.isFinite(startTime) || startTime < firstTime - 0.05 || endTime > lastTime + 0.05) return fallback;
  return { startTime, endTime, source: "official-time" };
}

function timedReplayFrames(frames, replay) {
  const timing = replayTimingWindow(frames, replay);
  const middle = frames.filter(frame => Number(frame.t) > timing.startTime && Number(frame.t) < timing.endTime);
  return {
    timing,
    frames: [
      interpolateRawReplayFrame(frames, timing.startTime),
      ...middle,
      interpolateRawReplayFrame(frames, timing.endTime)
    ]
  };
}

function normalizeFrames(frames, replay) {
  const timed = timedReplayFrames(frames, replay);
  const originFrame = timed.frames[0];
  const origin = { x: originFrame.x, y: originFrame.y, z: originFrame.z, t: timed.timing.startTime };
  state.origin = origin;
  debugReplay("primary replay timing", timed.timing);
  return timed.frames.map(frame => ({
    ...frame,
    rt: frame.t - origin.t,
    p: toThreePoint(frame, origin)
  }));
}

function normalizeComparisonFrames(frames, replay) {
  const timed = timedReplayFrames(frames, replay);
  debugReplay("comparison replay timing", timed.timing);
  return timed.frames.map(frame => ({
    ...frame,
    rt: frame.t - timed.timing.startTime,
    p: toThreePoint(frame, state.origin)
  }));
}

function comparisonFrameAt(time) {
  const comparison = state.comparison;
  const frames = comparison?.normalized || [];
  if (!frames.length) return null;
  if (time <= 0) return frames[0];
  if (time >= comparison.duration) return frames[frames.length - 1];

  while (comparison.frameIndex < frames.length - 2 && frames[comparison.frameIndex + 1].rt < time) comparison.frameIndex += 1;
  while (comparison.frameIndex > 0 && frames[comparison.frameIndex].rt > time) comparison.frameIndex -= 1;

  const a = frames[comparison.frameIndex];
  const b = frames[comparison.frameIndex + 1] || a;
  const span = Math.max(0.0001, b.rt - a.rt);
  const mix = Math.min(1, Math.max(0, (time - a.rt) / span));
  return {
    ...a,
    p: a.p.clone().lerp(b.p, mix),
    pitch: THREE.MathUtils.lerp(a.pitch, b.pitch, mix),
    yaw: lerpAngleDeg(a.yaw, b.yaw, mix),
    roll: THREE.MathUtils.lerp(a.roll, b.roll, mix),
    buttons: mix < 0.5 ? a.buttons : b.buttons,
    viewmodel: mix < 1 ? a.viewmodel : b.viewmodel
  };
}

function clearRunObjects() {
  for (const object of [grid, trail, startMarker, finishMarker, zoneRoot, mapModel, projectileRoot, impactRoot, smokeRoot]) {
    if (!object) continue;
    root.remove(object);
    disposeObject(object);
  }
  grid = null;
  trail = null;
  startMarker = null;
  finishMarker = null;
  zoneRoot = null;
  mapModel = null;
  projectileRoot = null;
  impactRoot = null;
  smokeRoot = null;
}

function disposeObject(object) {
  object.traverse?.(child => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach(material => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
  object.geometry?.dispose?.();
  if (Array.isArray(object.material)) {
    object.material.forEach(material => material.dispose?.());
  } else {
    object.material?.dispose?.();
  }
}

function mapAssetUrl(mapName) {
  const safeMap = String(mapName || "").trim();
  if (!safeMap || !/^[a-z0-9_.-]+$/i.test(safeMap)) return "";
  return `assets/maps/${encodeURIComponent(safeMap)}/${encodeURIComponent(safeMap)}.glb?v=20260707textures2`;
}

function projectileModelUrl(modelPath) {
  const normalized = normalizeKey(modelPath);
  const relativePath = PROJECTILE_MODEL_REGISTRY.get(normalized);
  if (!relativePath) return "";
  const url = `${relativePath}?v=20260708projectilemodels1`;
  debugReplay("projectile GLB URL resolved", {
    modelPath,
    url
  });
  return url;
}

function loadMapModel(mapName) {
  const url = mapAssetUrl(mapName);
  if (!url || !state.origin) return;

  loader.load(
    url,
    gltf => {
      if (mapModel) {
        root.remove(mapModel);
        disposeObject(mapModel);
      }

      mapModel = gltf.scene;
      mapModel.name = `${mapName}-bsp-world`;
      mapModel.position.copy(toThreePoint({ x: 0, y: 0, z: 0 }, state.origin));
      mapModel.traverse(child => {
        if (!child.isMesh) return;
        child.frustumCulled = false;
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach(material => {
            configureReplayMapMaterial(material, THREE.DoubleSide);
          });
        }
      });
      root.add(mapModel);
      if (grid) grid.visible = false;
    },
    undefined,
    () => {
      if (grid) grid.visible = true;
    }
  );
}

function marker(color, labelY) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 8, 180, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: color === 0x34d399 ? 0x06351f : 0x37101b })
  );
  pole.position.y = 90;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(54, 7, 12, 36),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, emissive: color === 0x34d399 ? 0x052c1a : 0x2e0b14 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = labelY;
  group.add(pole, ring);
  return group;
}

function zonePrism(radius, height, color, opacity = 0.16) {
  const width = radius * 2;
  const depth = radius * 2;
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: Math.min(1, opacity + 0.45),
      depthWrite: false
    })
  );
  const baseOutline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-radius, -height / 2, -radius),
      new THREE.Vector3(radius, -height / 2, -radius),
      new THREE.Vector3(radius, -height / 2, radius),
      new THREE.Vector3(-radius, -height / 2, radius)
    ]),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: Math.min(1, opacity + 0.55),
      depthWrite: false
    })
  );
  group.add(shell, edges, baseOutline);
  return group;
}

function checkpointGate(radius, height, color, opacity = 0.18) {
  const width = radius * 2;
  const thickness = Math.max(6, Math.min(14, radius * 0.22));
  const geometry = new THREE.BoxGeometry(width, height, thickness);
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: Math.min(1, opacity + 0.48),
      depthWrite: false
    })
  );
  group.add(shell, edges);
  return group;
}

function checkpointLabel(number, color) {
  const size = 128;
  const canvas2d = document.createElement("canvas");
  canvas2d.width = size;
  canvas2d.height = size;
  const ctx = canvas2d.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = "700 54px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas2d);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  }));
  sprite.scale.set(42, 42, 1);
  return sprite;
}

function addZoneVisual(targetRoot, zone, color, label = null, opacity = 0.16) {
  if (!targetRoot || !zone?.position || !state.origin) return;
  const radius = Number(zone.radius);
  const height = Number(zone.height);
  const zoneKind = label != null ? "checkpoint" : color === 0x34d399 ? "start" : color === 0xfb7185 ? "finish" : "zone";
  const convertedPosition = toThreePoint(zone.position, state.origin);
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height) || height <= 0) {
    debugReplay("zone visual skipped", {
      kind: zoneKind,
      rawCheckpoint: label != null ? {
        checkpointNumber: zone.checkpointNumber ?? label,
        x: zone.position?.x ?? null,
        y: zone.position?.y ?? null,
        z: zone.position?.z ?? null,
        axis: zone.axis ?? null,
        yaw: zone.yaw ?? null
      } : null,
      finalRadius: radius,
      finalHeight: height,
      convertedPosition: {
        x: convertedPosition.x,
        y: convertedPosition.y,
        z: convertedPosition.z
      },
      meshCreated: false
    });
    return;
  }
  const isCheckpoint = label != null;
  const visual = isCheckpoint
    ? checkpointGate(radius, height, color, opacity)
    : zonePrism(radius, height, color, opacity);
  visual.position.copy(convertedPosition);
  if (!isCheckpoint) visual.position.y += height / 2;
  visual.traverse(child => {
    child.frustumCulled = false;
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        if (material) material.depthWrite = false;
      });
    }
  });
  const axis = Number(zone.axis);
  const yaw = Number(zone.yaw);
  if (isCheckpoint) {
    const axisRotation = axis === 1 ? Math.PI / 2 : 0;
    const yawRotation = Number.isFinite(yaw) ? THREE.MathUtils.degToRad(yaw) : 0;
    visual.rotation.y = axisRotation + yawRotation;
  } else if (Number.isFinite(yaw) && Math.abs(yaw) > 0.001) {
    visual.rotation.y = THREE.MathUtils.degToRad(yaw);
  }
  debugReplay("zone visual", {
    label: label ?? zoneKind,
    radius,
    height,
    axis: zone.axis ?? null,
    yaw: zone.yaw ?? null,
    shape: isCheckpoint ? "checkpoint-gate" : "square-prism",
    position: zone.position,
    rawCheckpoint: label != null ? {
      checkpointNumber: zone.checkpointNumber ?? label,
      x: zone.position?.x ?? null,
      y: zone.position?.y ?? null,
      z: zone.position?.z ?? null,
      axis: zone.axis ?? null,
      yaw: zone.yaw ?? null
    } : null,
    finalRadius: radius,
    finalHeight: height,
    convertedPosition: {
      x: convertedPosition.x,
      y: convertedPosition.y,
      z: convertedPosition.z
    },
    renderedCenter: {
      x: visual.position.x,
      y: visual.position.y,
      z: visual.position.z
    },
    renderedRotationYDeg: THREE.MathUtils.radToDeg(visual.rotation.y),
    meshCreated: true,
    meshVisible: visual.visible,
    yUp: true,
    baseAnchored: !isCheckpoint,
    centered: isCheckpoint
  });
  if (label) {
    const textSprite = checkpointLabel(label, "#fde047");
    textSprite.position.set(0, height + 20, 0);
    visual.add(textSprite);
  }
  targetRoot.add(visual);
}

function buildZoneVisuals() {
  if (!state.zones || !state.origin) return;
  zoneRoot = new THREE.Group();
  zoneRoot.name = "zones";
  addZoneVisual(zoneRoot, state.zones.start, 0x34d399, null, 0.14);
  addZoneVisual(zoneRoot, state.zones.finish, 0xfb7185, null, 0.14);
  for (const checkpoint of state.zones.checkpoints || []) {
    addZoneVisual(zoneRoot, checkpoint, 0xfacc15, checkpoint.checkpointNumber, 0.18);
  }
  debugReplay("zone visuals built", {
    hasStart: Boolean(state.zones.start),
    hasFinish: Boolean(state.zones.finish),
    checkpointCount: Array.isArray(state.zones.checkpoints) ? state.zones.checkpoints.length : 0,
    zoneRootChildren: zoneRoot.children.length
  });
  root.add(zoneRoot);
  setZoneVisualsVisible(state.showZones);
}

function buildSceneForReplay() {
  clearRunObjects();
  const points = state.normalized.map(frame => frame.p);
  const bounds = new THREE.Box3().setFromPoints(points);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxSpan = Math.max(size.x, size.z, 1200);
  const gridSize = Math.ceil(maxSpan / 1000) * 1000 + 2000;

  grid = new THREE.GridHelper(gridSize, Math.max(10, Math.round(gridSize / 500)), 0x64748b, 0x1e293b);
  grid.position.set(center.x, 0, center.z);
  root.add(grid);

  trail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 2 })
  );
  root.add(trail);

  startMarker = marker(0x34d399, 14);
  startMarker.position.copy(points[0]);
  root.add(startMarker);

  finishMarker = marker(0xfb7185, 14);
  finishMarker.position.copy(points[points.length - 1]);
  root.add(finishMarker);
  buildZoneVisuals();
  setTrailVisible(state.showTrail);
  setZoneVisualsVisible(state.showZones);

  projectileRoot = new THREE.Group();
  projectileRoot.name = "projectiles";
  root.add(projectileRoot);

  impactRoot = new THREE.Group();
  impactRoot.name = "projectile-impacts";
  root.add(impactRoot);

  smokeRoot = new THREE.Group();
  smokeRoot.name = "projectile-smoke";
  root.add(smokeRoot);
}

function setComparisonPanelOpen(open) {
  const panel = $("replay-compare-panel");
  const button = $("replay-compare-toggle");
  if (!panel || !button) return;
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(Boolean(open)));
  setOverlaysVisible(true);
  if (open) {
    clearOverlaysHideTimer();
  } else if (state.playing) {
    scheduleOverlaysAutoHide();
  }
}

function comparisonLabel(replay) {
  return `${replay.playerName || replay.steamid || "Unknown"} · ${runTime(replay.timeMs)} · ${replay.className || `Class ${replay.classId}`}`;
}

function updateComparisonLegend() {
  const comparison = state.comparison;
  const legend = $("replay-compare-legend");
  const removeButton = $("replay-compare-remove");
  const toggleButton = $("replay-compare-toggle");
  if (legend) legend.hidden = !comparison;
  if (removeButton) removeButton.hidden = !comparison;
  if (toggleButton) {
    toggleButton.classList.toggle("active", Boolean(comparison));
    toggleButton.textContent = comparison ? "Change run" : "Add run";
  }
  if (!comparison) return;

  $("replay-compare-primary").textContent = state.replay?.playerName || state.replay?.steamid || "Primary run";
  $("replay-compare-secondary").textContent = comparison.replay.playerName || comparison.replay.steamid || "Comparison run";
  const primaryMs = Number(state.replay?.timeMs);
  const comparisonMs = Number(comparison.replay.timeMs);
  let deltaText = "Finish-time delta unavailable";
  if (Number.isFinite(primaryMs) && Number.isFinite(comparisonMs)) {
    const delta = comparisonMs - primaryMs;
    const direction = delta === 0 ? "the same time as" : delta > 0 ? "slower than" : "faster than";
    deltaText = delta === 0
      ? "Same finish time"
      : `${formatTime(Math.abs(delta) / 1000)} ${direction} primary`;
  }
  $("replay-compare-delta").textContent = deltaText;
}

function clearComparison({ updateUrl = true } = {}) {
  if (comparisonTrail) {
    root.remove(comparisonTrail);
    disposeObject(comparisonTrail);
    comparisonTrail = null;
  }
  comparisonPlayer.visible = false;
  comparisonPlayer.clear();
  state.comparison = null;
  state.duration = state.primaryDuration;
  state.playbackTime = Math.min(state.playbackTime, state.duration);
  const slider = $("replay-slider");
  if (slider) slider.max = String(Math.max(1, Math.round(state.duration * 1000)));
  const duration = $("replay-duration");
  if (duration) duration.textContent = formatTime(state.duration);
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.delete("compareRunId");
    window.history.replaceState(null, "", url);
  }
  updateComparisonLegend();
}

async function loadComparison(path, { closePanel = true } = {}) {
  const addButton = $("replay-compare-add");
  const status = $("replay-compare-status");
  if (addButton) addButton.disabled = true;
  if (status) status.textContent = "Loading comparison replay...";

  try {
    const replay = await fetchJson(path);
    const frames = decodeReplayFrames(replay.frames);
    if (frames.length < 2) throw new Error("Comparison replay has too few frames.");
    if (replay.map !== state.replay?.map) throw new Error("Runs must be from the same map.");

    clearComparison({ updateUrl: false });
    const normalized = normalizeComparisonFrames(frames, replay);
    const duration = Math.max(0, normalized[normalized.length - 1].rt);
    state.comparison = { replay, normalized, duration, frameIndex: 0 };
    state.duration = Math.max(state.primaryDuration, duration);
    await setReplayPlayerModel(comparisonPlayer, replay);

    comparisonTrail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(normalized.map(frame => frame.p)),
      new THREE.LineBasicMaterial({ color: 0xf472b6, linewidth: 2 })
    );
    comparisonTrail.visible = state.showTrail;
    root.add(comparisonTrail);
    comparisonPlayer.visible = true;

    $("replay-slider").max = String(Math.max(1, Math.round(state.duration * 1000)));
    $("replay-duration").textContent = formatTime(state.duration);
    const url = new URL(window.location.href);
    url.searchParams.set("compareRunId", String(replay.runId));
    window.history.replaceState(null, "", url);
    updateComparisonLegend();
    updatePlayer();
    renderReplayScene();
    if (status) status.textContent = `Comparing ${comparisonLabel(replay)}`;
    if (closePanel) setComparisonPanelOpen(false);
  } catch (error) {
    if (status) status.textContent = error?.message || "Could not load that replay.";
  } finally {
    if (addButton) addButton.disabled = !$("replay-compare-select")?.value;
  }
}

function addComparisonOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

async function loadComparisonCandidates() {
  if (state.comparisonCandidatesLoaded || !state.replay?.map) return;
  const select = $("replay-compare-select");
  const addButton = $("replay-compare-add");
  const status = $("replay-compare-status");
  if (!select) return;
  select.disabled = true;
  select.replaceChildren(new Option("Loading runs...", ""));

  try {
    const data = await fetchJson(`/api/speedruns/maps/${encodeURIComponent(state.replay.map)}`);
    const candidates = [];
    const seen = new Set();
    for (const row of data.leaderboard || []) {
      if (!row.hasReplay || !row.steamId || row.classId == null) continue;
      const isCurrentRun = row.steamId === state.replay.steamid
        && Number(row.classId) === Number(state.replay.classId)
        && Number(row.bestTimeMs) === Number(state.replay.timeMs);
      if (isCurrentRun) continue;
      const key = `${row.steamId}:${row.classId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        path: `/api/speedruns/replay/${encodeURIComponent(state.replay.map)}/${encodeURIComponent(row.classId)}/${encodeURIComponent(row.steamId)}`,
        label: `#${row.rank || "-"} ${row.playerName || row.steamId} — ${row.bestTimeDisplay || runTime(row.bestTimeMs)} (${row.className || `Class ${row.classId}`})`
      });
    }
    for (const row of data.recentRuns || []) {
      if (!row.hasReplay || !row.runId || Number(row.runId) === Number(state.replay.runId)) continue;
      const key = `run:${row.runId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        path: `/api/speedruns/replay/run/${encodeURIComponent(row.runId)}`,
        label: `Recent: ${row.playerName || row.steamId || "Unknown"} — ${row.timeDisplay || runTime(row.timeMs)} (${row.className || `Class ${row.classId}`})`
      });
    }

    select.replaceChildren(new Option(candidates.length ? "Choose a run..." : "No other replay-enabled runs", ""));
    for (const candidate of candidates) addComparisonOption(select, candidate.path, candidate.label);
    select.disabled = !candidates.length;
    addButton.disabled = true;
    state.comparisonCandidatesLoaded = true;
    if (status) status.textContent = candidates.length ? "" : "No other replay-enabled runs were found for this map.";
  } catch (error) {
    select.replaceChildren(new Option("Could not load runs", ""));
    if (status) status.textContent = error?.message || "Could not load runs.";
  }
}

function frameAt(time) {
  const frames = state.normalized;
  if (!frames.length) return null;
  if (time <= 0) return frames[0];
  if (time >= state.duration) return frames[frames.length - 1];

  while (state.frameIndex < frames.length - 2 && frames[state.frameIndex + 1].rt < time) state.frameIndex += 1;
  while (state.frameIndex > 0 && frames[state.frameIndex].rt > time) state.frameIndex -= 1;

  const a = frames[state.frameIndex];
  const b = frames[state.frameIndex + 1] || a;
  const span = Math.max(0.0001, b.rt - a.rt);
  const mix = Math.min(1, Math.max(0, (time - a.rt) / span));
  return {
    ...a,
    p: a.p.clone().lerp(b.p, mix),
    pitch: THREE.MathUtils.lerp(a.pitch, b.pitch, mix),
    yaw: lerpAngleDeg(a.yaw, b.yaw, mix),
    roll: THREE.MathUtils.lerp(a.roll, b.roll, mix),
    buttons: mix < 0.5 ? a.buttons : b.buttons
  };
}

function lerpAngleDeg(a, b, t) {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * t;
}

function viewDirection(frame) {
  const yaw = THREE.MathUtils.degToRad(frame.yaw);
  const pitch = THREE.MathUtils.degToRad(frame.pitch);
  const sourceForward = {
    x: Math.cos(pitch) * Math.cos(yaw),
    y: Math.cos(pitch) * Math.sin(yaw),
    z: -Math.sin(pitch)
  };
  return new THREE.Vector3(sourceForward.x, sourceForward.z, -sourceForward.y).normalize();
}

function updatePovCamera(frame) {
  const eye = frame.p.clone();
  const isCrouched = (Number(frame?.buttons || 0) & 4) !== 0;
  eye.y += isCrouched ? CROUCHED_PLAYER_EYE_OFFSET : STANDING_PLAYER_EYE_OFFSET;
  const lookAt = eye.clone().add(viewDirection(frame).multiplyScalar(320));
  camera.position.copy(eye);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookAt);
}

function freeRoamDirection() {
  const cosPitch = Math.cos(state.freeCameraPitch);
  return new THREE.Vector3(
    Math.sin(state.freeCameraYaw) * cosPitch,
    Math.sin(state.freeCameraPitch),
    -Math.cos(state.freeCameraYaw) * cosPitch
  ).normalize();
}

function applyFreeRoamLook() {
  const direction = freeRoamDirection();
  camera.up.set(0, 1, 0);
  camera.lookAt(camera.position.clone().add(direction));
}

function rotateFreeRoam(deltaX, deltaY) {
  if (state.cameraMode !== "free") return;
  state.freeCameraYaw += Number(deltaX || 0) * FREE_ROAM_LOOK_SENSITIVITY;
  state.freeCameraPitch = THREE.MathUtils.clamp(
    state.freeCameraPitch - (Number(deltaY || 0) * FREE_ROAM_LOOK_SENSITIVITY),
    THREE.MathUtils.degToRad(-89),
    THREE.MathUtils.degToRad(89)
  );
  applyFreeRoamLook();
}

function updateFreeRoamCamera(delta) {
  if (state.cameraMode !== "free") return;
  const forward = freeRoamDirection();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const movement = new THREE.Vector3();
  if (freeRoamKeys.has("KeyW")) movement.add(forward);
  if (freeRoamKeys.has("KeyS")) movement.sub(forward);
  if (freeRoamKeys.has("KeyD")) movement.add(right);
  if (freeRoamKeys.has("KeyA")) movement.sub(right);
  if (freeRoamKeys.has("KeyE")) movement.y += 1;
  if (freeRoamKeys.has("KeyQ")) movement.y -= 1;
  if (movement.lengthSq() > 0) {
    camera.position.addScaledVector(movement.normalize(), FREE_ROAM_MOVE_SPEED * delta);
  }
  applyFreeRoamLook();
}

function isTouchFreeRoamEnvironment() {
  return Boolean(
    window.matchMedia?.("(pointer: coarse)")?.matches
    || window.innerWidth <= 900
    || Number(navigator.maxTouchPoints || 0) > 0
  );
}

function updateFreeRoamHelp() {
  const help = $("replay-free-roam-help");
  if (!help) return;
  const isTouch = isTouchFreeRoamEnvironment();
  const locked = document.pointerLockElement === canvas;
  help.innerHTML = isTouch
    ? `<strong>FREE ROAM</strong><span>Drag the replay to look · Use the pads to move</span>`
    : locked
    ? `<strong>FREE ROAM</strong><span>WASD move · Q/E down/up · Esc releases mouse</span>`
    : `<strong>FREE ROAM</strong><span>Click the replay to capture the mouse · WASD move · Q/E down/up</span>`;
  help.classList.toggle("locked", locked);
}

function setCameraMode(mode) {
  const nextMode = mode === "free" ? "free" : "pov";
  if (nextMode === "free" && !state.normalized.length) return;
  state.cameraMode = nextMode;
  freeRoamKeys.clear();

  const stage = document.querySelector(".replay-stage");
  const button = $("replay-camera-mode");
  const help = $("replay-free-roam-help");
  const touchControls = $("replay-free-roam-touch");
  stage?.classList.toggle("free-roam", nextMode === "free");
  if (button) {
    button.classList.toggle("active", nextMode === "free");
    button.setAttribute("aria-pressed", nextMode === "free" ? "true" : "false");
    button.textContent = nextMode === "free" ? "Camera: Free" : "Camera: POV";
  }
  if (help) help.hidden = nextMode !== "free";
  if (touchControls) touchControls.hidden = nextMode !== "free";
  updatePrimaryPlayerVisibility();

  if (nextMode === "free") {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    state.freeCameraYaw = Math.atan2(direction.x, -direction.z);
    state.freeCameraPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
    updateFreeRoamHelp();
    setOverlaysVisible(!isTouchFreeRoamEnvironment());
  } else {
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    const frame = frameAt(state.playbackTime);
    if (frame) updatePovCamera(frame);
    setOverlaysVisible(true);
  }
}

function frameSpeed() {
  const frames = state.normalized;
  const index = Math.min(Math.max(state.frameIndex, 0), frames.length - 2);
  const a = frames[index];
  const b = frames[index + 1];
  if (!a || !b) return 0;
  const dt = b.rt - a.rt;
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return a.p.distanceTo(b.p) / dt;
}

function buttonText(buttons) {
  const value = Number(buttons || 0);
  const parts = [];
  if (value & 1) parts.push("Attack");
  if (value & 2) parts.push("Jump");
  if (value & 4) parts.push("Duck");
  if (value & 8) parts.push("Forward");
  if (value & 16) parts.push("Back");
  if (value & 128) parts.push("Turn Left");
  if (value & 256) parts.push("Turn Right");
  if (value & 512) parts.push("Move Left");
  if (value & 1024) parts.push("Move Right");
  if (value & 2048) parts.push("Attack2");
  if (value & 4096) parts.push("Run");
  return parts.length ? parts.join(" ") : String(value || 0);
}

const REPLAY_INPUT_MASKS = {
  attack: 1,
  jump: 2,
  duck: 4,
  forward: 8,
  back: 16,
  left: 512,
  right: 1024,
  attack2: 2048
};

function updateInputHud(frame, speedValue) {
  const value = Math.trunc(Number(frame?.buttons) || 0);
  document.querySelectorAll("[data-input]").forEach(key => {
    const mask = REPLAY_INPUT_MASKS[key.dataset.input];
    const pressed = Boolean(mask && (value & mask));
    key.classList.toggle("pressed", pressed);
    key.setAttribute("aria-pressed", String(pressed));
  });
  const speedometer = $("replay-speedometer-value");
  if (speedometer) speedometer.textContent = Math.round(speedValue).toLocaleString();
}

function updateStats(frame) {
  const speed = $("replay-stat-speed");
  const position = $("replay-stat-position");
  const look = $("replay-stat-look");
  const buttons = $("replay-stat-buttons");
  const speedValue = frameSpeed();
  if (speed) speed.textContent = `${Math.round(speedValue).toLocaleString()} HU/s`;
  if (position) position.textContent = `${frame.x.toFixed(1)}, ${frame.y.toFixed(1)}, ${frame.z.toFixed(1)}`;
  if (look) look.textContent = `P ${frame.pitch.toFixed(1)} / Y ${frame.yaw.toFixed(1)}`;
  if (buttons) buttons.textContent = buttonText(frame.buttons);
  updateInputHud(frame, speedValue);
}

function normalizeProjectileFrame(frame, origin) {
  return {
    ...frame,
    rt: frame.t - origin.t,
    p: toThreePoint(frame, origin)
  };
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function projectileDefinitionForFrame(frame) {
  const classname = normalizeKey(frame.classname);
  const model = normalizeKey(frame.model);

  // Both launcher projectiles share models/pipebomb.mdl. Resolve their
  // authoritative entity class before attempting any model-based fallback.
  for (const def of PROJECTILE_DEFS) {
    if (def === DEFAULT_PROJECTILE_DEF) continue;
    if (def.classnames.some(value => normalizeKey(value) === classname)) return def;
  }

  for (const def of PROJECTILE_DEFS) {
    if (def === DEFAULT_PROJECTILE_DEF || model === "models/pipebomb.mdl") continue;
    if (def.models.some(value => normalizeKey(value) === model)) {
      debugReplay("projectile registry matched recorded model", {
        recordedModel: frame.model,
        projectileKey: def.key,
        glbPath: PROJECTILE_MODEL_REGISTRY.get(model) || null
      });
      return def;
    }
  }

  if (classname.includes("mirv")) return PROJECTILE_DEF_BY_KEY.get("mirv");
  if (classname.includes("conc")) return PROJECTILE_DEF_BY_KEY.get("conc");
  if (classname.includes("rocket") || model.includes("rocket") || model.includes("rpg")) return PROJECTILE_DEF_BY_KEY.get("rocket");
  if (classname.includes("bomblet") || model.includes("bomblet")) return PROJECTILE_DEF_BY_KEY.get("mirv-bomblet");
  if (classname.includes("napalm") || model.includes("napalm")) return PROJECTILE_DEF_BY_KEY.get("napalm");
  if (classname.includes("nailgrenade") || model.includes("ngrenade")) return PROJECTILE_DEF_BY_KEY.get("nail");
  if (classname.includes("grenade")) return PROJECTILE_DEF_BY_KEY.get("grenade");
  if (classname.includes("pipe") || model.includes("pipebomb")) return PROJECTILE_DEF_BY_KEY.get("pipe-yellow");
  return DEFAULT_PROJECTILE_DEF;
}

function projectileModelKeyForDef(def) {
  if (def?.assetModel) return normalizeKey(def.assetModel);
  if (!def?.models?.length) return "";
  return normalizeKey(def.models[0]);
}

function prepareLoadedProjectileModel(sceneObject) {
  if (!sceneObject) return null;
  sceneObject.traverse(child => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => {
      if (!material) return;
      material.side = THREE.DoubleSide;
      material.depthWrite = !material.transparent;
    });
  });
  return sceneObject;
}

function applyProjectileMaterialOverrides(object, def) {
  if (!object || !def) return;
  const tintFallbackKeys = new Set(["grenade", "mirv", "mirv-bomblet", "nail", "napalm"]);
  object.traverse(child => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const nextMaterials = materials.map(material => {
      if (!material) return material;
      const next = material.clone();
      const materialName = String(next.name || "").toLowerCase();

      if (def.key === "pipe-yellow" || def.key === "pipe-blue") {
        if (materialName.startsWith("remap_")) {
          next.transparent = true;
          next.opacity = 1.0;
          next.blending = THREE.AdditiveBlending;
          next.depthWrite = false;
          next.emissive?.setHex?.(0x000000);
          next.color?.setHex?.(0xffffff);
        } else {
          next.transparent = false;
          next.opacity = 1.0;
          next.blending = THREE.NormalBlending;
          next.depthWrite = true;
          next.emissive?.setHex?.(0x000000);
        }
      }

      const hasTextureMap = Boolean(next.map);
      const shouldTintFallback = tintFallbackKeys.has(def.key) && (
        !hasTextureMap ||
        isMostlyWhiteColor(next.color)
      );
      if (shouldTintFallback) {
        next.color?.setHex?.(def.color);
        next.emissive?.setHex?.(0x000000);
        if ("roughness" in next) next.roughness = 0.5;
        if ("metalness" in next) next.metalness = 0.05;
        debugReplay("applied projectile fallback tint", {
          projectile: def.key,
          material: next.name || child.name || "unnamed",
          reason: !hasTextureMap ? "missing_texture_map" : "mostly_white_material"
        });
      }

      next.needsUpdate = true;
      return next;
    });
    child.material = Array.isArray(child.material) ? nextMaterials : nextMaterials[0];
  });
}

function loadProjectileModel(modelPath) {
  const modelKey = normalizeKey(modelPath);
  if (!modelKey) return Promise.resolve(null);
  if (!PROJECTILE_MODEL_REGISTRY.has(modelKey)) return Promise.resolve(null);
  if (!projectileAssetCache.has(modelKey)) {
    projectileAssetCache.set(modelKey, new Promise(resolve => {
      const url = projectileModelUrl(modelKey);
      if (!url) {
        resolve(null);
        return;
      }
      debugReplay("requesting projectile GLB", {
        modelKey,
        url
      });
      loader.load(
        url,
        gltf => {
          debugReplay("projectile GLB loaded", {
            modelKey,
            url,
            hasScene: Boolean(gltf.scene)
          });
          resolve(prepareLoadedProjectileModel(gltf.scene || null));
        },
        undefined,
        error => {
          warnReplay("projectile GLB failed to load", {
            modelKey,
            url,
            error: error?.message || error || "unknown_error"
          });
          resolve(null);
        }
      );
    }));
  }
  return projectileAssetCache.get(modelKey);
}

async function preloadProjectileAssets(projectileFrames) {
  const modelKeys = new Set(
    projectileFrames
      .map(projectileDefinitionForFrame)
      .map(projectileModelKeyForDef)
      .filter(Boolean)
  );
  await Promise.all([...modelKeys].map(loadProjectileModel));
}

function fallbackProjectileMesh(def) {
  const material = new THREE.MeshStandardMaterial({
    color: def.color,
    emissive: def.color,
    emissiveIntensity: 0.2,
    roughness: 0.38,
    metalness: 0.1
  });

  if (def.primitive === "rocket") {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 34, 12), material.clone());
    body.rotation.z = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(9, 16, 12), material.clone());
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 24;
    const finMaterial = material.clone();
    const finGeometry = new THREE.BoxGeometry(2, 10, 14);
    [-8, 8].forEach(y => {
      const fin = new THREE.Mesh(finGeometry, finMaterial.clone());
      fin.position.set(-10, y, 0);
      group.add(fin);
    });
    body.position.x = 6;
    group.add(body, tip);
    return group;
  }

  if (def.primitive === "pipe") {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(8, 20, 6, 10), material);
    mesh.rotation.z = Math.PI / 2;
    return mesh;
  }

  return new THREE.Mesh(new THREE.SphereGeometry(def.radius, 18, 18), material);
}

function cloneProjectileVisual(def) {
  if (def?.forceFallback) {
    debugReplay("projectile instance forced to fallback mesh", {
      projectileKey: def?.key || "unknown"
    });
    return fallbackProjectileMesh(def);
  }
  const modelKey = projectileModelKeyForDef(def);
  const cached = modelKey ? projectileAssetCache.get(modelKey) : null;
  const resolved = cached && typeof cached.then !== "function" ? cached : null;
  if (resolved) {
    const clone = resolved.clone(true);
    applyProjectileMaterialOverrides(clone, def);
    debugReplay("projectile instance using GLB model", {
      projectileKey: def?.key || "unknown",
      modelKey,
      tinted: false
    });
    return clone;
  }
  debugReplay("projectile instance using fallback mesh", {
    projectileKey: def?.key || "unknown",
    modelKey
  });
  return fallbackProjectileMesh(def);
}

function applyProjectileRotation(mesh, def, yawDeg = 0, spinDeg = 0) {
  const base = def?.modelRotationDeg || {};
  const spinAxis = def?.spinAxis || "y";
  const rotationDeg = {
    x: base.x || 0,
    y: yawDeg + (def?.modelYawOffsetDeg || 0) + (base.y || 0),
    z: base.z || 0
  };
  rotationDeg[spinAxis] += spinDeg;
  mesh.rotation.set(
    THREE.MathUtils.degToRad(rotationDeg.x),
    THREE.MathUtils.degToRad(rotationDeg.y),
    THREE.MathUtils.degToRad(rotationDeg.z)
  );
}

async function finalizeProjectileAssetCache(modelKeys) {
  for (const modelKey of modelKeys) {
    if (!modelKey || !projectileAssetCache.has(modelKey)) continue;
    const loaded = await projectileAssetCache.get(modelKey);
    projectileAssetCache.set(modelKey, loaded);
  }
}

function spriteAssetUrl(spriteKey) {
  const entry = SPRITE_ASSET_REGISTRY.get(spriteKey);
  if (!entry?.path) return "";
  return `${entry.path}?v=20260709spr1`;
}

function paletteIndexAlpha(index, transparentIndex) {
  return index === transparentIndex ? 0 : 255;
}

function parseGoldSrcSprite(buffer, spriteKey) {
  const view = new DataView(buffer);
  if (view.byteLength < 42) throw new Error(`Sprite ${spriteKey} is too small.`);

  const ident = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (ident !== "IDSP") throw new Error(`Sprite ${spriteKey} has invalid signature ${ident}.`);

  const version = view.getInt32(4, true);
  if (version !== 2) throw new Error(`Sprite ${spriteKey} uses unsupported version ${version}.`);

  const spriteType = view.getInt32(8, true);
  const textureFormat = view.getInt32(12, true);
  const radius = view.getFloat32(16, true);
  const width = view.getInt32(20, true);
  const height = view.getInt32(24, true);
  const frameCount = view.getInt32(28, true);
  const beamLength = view.getFloat32(32, true);
  const syncType = view.getInt32(36, true);
  const paletteSize = view.getUint16(40, true);
  let offset = 42;

  if (!paletteSize || offset + (paletteSize * 3) > view.byteLength) {
    throw new Error(`Sprite ${spriteKey} has an invalid palette.`);
  }

  const palette = new Array(paletteSize);
  for (let i = 0; i < paletteSize; i += 1) {
    palette[i] = [
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2)
    ];
    offset += 3;
  }

  const frames = [];
  const transparentIndex = paletteSize - 1;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    if (offset + 20 > view.byteLength) {
      throw new Error(`Sprite ${spriteKey} frame ${frameIndex} is truncated.`);
    }

    const frameType = view.getInt32(offset, true);
    offset += 4;
    if (frameType !== 0) {
      throw new Error(`Sprite ${spriteKey} frame ${frameIndex} uses unsupported frame type ${frameType}.`);
    }

    const originX = view.getInt32(offset, true);
    const originY = view.getInt32(offset + 4, true);
    const frameWidth = view.getInt32(offset + 8, true);
    const frameHeight = view.getInt32(offset + 12, true);
    offset += 16;

    if (frameWidth <= 0 || frameHeight <= 0) {
      throw new Error(`Sprite ${spriteKey} frame ${frameIndex} has invalid dimensions ${frameWidth}x${frameHeight}.`);
    }

    const pixelCount = frameWidth * frameHeight;
    if (offset + pixelCount > view.byteLength) {
      throw new Error(`Sprite ${spriteKey} frame ${frameIndex} pixel data is truncated.`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(frameWidth, frameHeight);

    for (let i = 0; i < pixelCount; i += 1) {
      const paletteIndex = view.getUint8(offset + i);
      const paletteColor = palette[paletteIndex] || palette[transparentIndex] || [255, 255, 255];
      const out = i * 4;
      imageData.data[out] = paletteColor[0];
      imageData.data[out + 1] = paletteColor[1];
      imageData.data[out + 2] = paletteColor[2];
      imageData.data[out + 3] = paletteIndexAlpha(paletteIndex, transparentIndex);
    }

    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    frames.push({
      texture,
      originX,
      originY,
      width: frameWidth,
      height: frameHeight
    });

    offset += pixelCount;
  }

  return {
    spriteKey,
    spriteType,
    textureFormat,
    radius,
    width,
    height,
    frameCount,
    beamLength,
    syncType,
    frames
  };
}

function getLoadedSpriteAsset(spriteKey) {
  const cached = spriteAssetCache.get(spriteKey);
  return cached && typeof cached.then !== "function" ? cached : null;
}

function resolveSpriteFallbackKind(spriteKey, explicitFallbackKind = "") {
  if (explicitFallbackKind) return explicitFallbackKind;
  return SPRITE_ASSET_REGISTRY.get(spriteKey)?.fallbackKind || "explode01";
}

function loadSpriteAsset(spriteKey) {
  if (!spriteKey || !SPRITE_ASSET_REGISTRY.has(spriteKey)) return Promise.resolve(null);
  if (!spriteAssetCache.has(spriteKey)) {
    spriteAssetCache.set(spriteKey, (async () => {
      const url = spriteAssetUrl(spriteKey);
      if (!url) return null;

      debugReplay("requesting sprite asset", { spriteKey, url });
      const response = await fetch(url, { cache: "no-store" }).catch(error => {
        warnReplay("sprite fetch failed", {
          spriteKey,
          url,
          error: error?.message || error || "unknown_error"
        });
        return null;
      });

      if (!response) return null;
      if (!response.ok) {
        warnReplay("sprite request returned non-OK status", {
          spriteKey,
          url,
          status: response.status
        });
        return null;
      }

      const buffer = await response.arrayBuffer();
      try {
        const parsed = parseGoldSrcSprite(buffer, spriteKey);
        debugReplay("sprite asset loaded", {
          spriteKey,
          url,
          frames: parsed.frames.length,
          size: `${parsed.width}x${parsed.height}`
        });
        return parsed;
      } catch (error) {
        warnReplay("sprite parse failed", {
          spriteKey,
          url,
          error: error?.message || error || "unknown_error"
        });
        return null;
      }
    })());
  }
  return spriteAssetCache.get(spriteKey);
}

async function preloadSpriteAssets(spriteKeys) {
  await Promise.all([...spriteKeys].filter(Boolean).map(loadSpriteAsset));
}

async function finalizeSpriteAssetCache(spriteKeys) {
  for (const spriteKey of spriteKeys) {
    if (!spriteKey || !spriteAssetCache.has(spriteKey)) continue;
    const loaded = await spriteAssetCache.get(spriteKey);
    spriteAssetCache.set(spriteKey, loaded);
  }
}

function makeRadialTexture(kind) {
  if (effectTextureCache.has(kind)) return effectTextureCache.get(kind);

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;

  if (kind === "conc") {
    ctx.strokeStyle = "rgba(125, 255, 190, 0.92)";
    ctx.lineWidth = 8;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(cx, cy, 18 + i * 17, 0, Math.PI * 2);
      ctx.stroke();
    }
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 62);
    glow.addColorStop(0, "rgba(220, 255, 240, 0.65)");
    glow.addColorStop(0.42, "rgba(34, 197, 94, 0.28)");
    glow.addColorStop(1, "rgba(34, 197, 94, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === "rocketflare") {
    const flare = ctx.createRadialGradient(cx, cy, 0, cx, cy, 58);
    flare.addColorStop(0, "rgba(255, 255, 235, 1)");
    flare.addColorStop(0.18, "rgba(255, 210, 80, 0.95)");
    flare.addColorStop(0.44, "rgba(255, 95, 24, 0.56)");
    flare.addColorStop(1, "rgba(255, 95, 24, 0)");
    ctx.fillStyle = flare;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === "smoke") {
    const smoke = ctx.createRadialGradient(cx, cy, 8, cx, cy, 60);
    smoke.addColorStop(0, "rgba(255, 255, 255, 0.75)");
    smoke.addColorStop(0.18, "rgba(214, 214, 214, 0.52)");
    smoke.addColorStop(0.58, "rgba(132, 132, 132, 0.24)");
    smoke.addColorStop(1, "rgba(90, 90, 90, 0)");
    ctx.fillStyle = smoke;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === "shockwave") {
    ctx.strokeStyle = "rgba(125, 255, 190, 0.95)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(220, 255, 240, 0.45)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.stroke();
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 62);
    glow.addColorStop(0, "rgba(220, 255, 240, 0)");
    glow.addColorStop(0.5, "rgba(34, 197, 94, 0.12)");
    glow.addColorStop(1, "rgba(34, 197, 94, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  } else {
    const explosion = ctx.createRadialGradient(cx, cy, 0, cx, cy, 64);
    explosion.addColorStop(0, "rgba(255, 255, 230, 1)");
    explosion.addColorStop(0.18, "rgba(255, 220, 92, 0.95)");
    explosion.addColorStop(0.38, "rgba(251, 113, 36, 0.82)");
    explosion.addColorStop(0.68, "rgba(185, 28, 28, 0.34)");
    explosion.addColorStop(1, "rgba(60, 20, 12, 0)");
    ctx.fillStyle = explosion;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "rgba(255, 247, 180, 0.7)";
    ctx.lineWidth = 5;
    for (let i = 0; i < 10; i += 1) {
      const angle = (Math.PI * 2 * i) / 10;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * 18, cy + Math.sin(angle) * 18);
      ctx.lineTo(cx + Math.cos(angle) * 54, cy + Math.sin(angle) * 54);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  effectTextureCache.set(kind, texture);
  return texture;
}

function effectMapFor(spriteKey, fallbackKind) {
  const asset = getLoadedSpriteAsset(spriteKey);
  return asset?.frames?.[0]?.texture || makeRadialTexture(resolveSpriteFallbackKind(spriteKey, fallbackKind));
}

function createSprite(spriteKey, fallbackKind = "explode01", color = 0xffffff, opacity = 1) {
  const asset = getLoadedSpriteAsset(spriteKey);
  const map = effectMapFor(spriteKey, fallbackKind);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  sprite.frustumCulled = false;
  sprite.userData.spriteKey = spriteKey;
  sprite.userData.fallbackKind = resolveSpriteFallbackKind(spriteKey, fallbackKind);
  sprite.userData.spriteFrameCount = asset?.frames?.length || 1;
  sprite.userData.spriteFrameIndex = 0;
  return sprite;
}

function createShockwaveEffect(spriteKey, fallbackKind = "shockwave", color = 0xffffff, opacity = 1) {
  const asset = getLoadedSpriteAsset(spriteKey);
  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 36, 1, true),
    new THREE.MeshBasicMaterial({
      map: effectMapFor(spriteKey, fallbackKind),
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  cylinder.frustumCulled = false;
  cylinder.userData.spriteKey = spriteKey;
  cylinder.userData.fallbackKind = resolveSpriteFallbackKind(spriteKey, fallbackKind);
  cylinder.userData.spriteFrameCount = asset?.frames?.length || 1;
  cylinder.userData.spriteFrameIndex = 0;
  return cylinder;
}

function setSpriteFrame(sprite, normalizedProgress = 0) {
  if (!sprite?.material) return;
  const spriteKey = sprite.userData.spriteKey;
  const fallbackKind = sprite.userData.fallbackKind || "explode01";
  const asset = getLoadedSpriteAsset(spriteKey);
  const frames = asset?.frames || [];
  if (!frames.length) {
    const fallbackTexture = makeRadialTexture(fallbackKind);
    if (sprite.material.map !== fallbackTexture) {
      sprite.material.map = fallbackTexture;
      sprite.material.needsUpdate = true;
    }
    sprite.userData.spriteFrameCount = 1;
    sprite.userData.spriteFrameIndex = 0;
    return;
  }

  const clamped = Math.min(1, Math.max(0, normalizedProgress));
  const frameIndex = Math.min(frames.length - 1, Math.floor(clamped * frames.length));
  const frame = frames[frameIndex];
  if (!frame) return;
  if (sprite.material.map !== frame.texture) {
    sprite.material.map = frame.texture;
    sprite.material.needsUpdate = true;
  }
  sprite.userData.spriteFrameCount = frames.length;
  sprite.userData.spriteFrameIndex = frameIndex;
}

function addRocketFlare(mesh, def) {
  if (!mesh || !def?.flare) return;
  const flare = createSprite(def.flareSprite || "animglow01", "rocketflare", 0xffd166, 0.82);
  flare.name = "rocketflare";
  flare.position.set(-30, 0, 0);
  flare.scale.set(56, 56, 1);
  mesh.add(flare);
}

function createImpactVisual(def, frame) {
  const group = new THREE.Group();
  const position = frame.p.clone();
  const impactType = def.impact;
  const effectKey = def.effect || "explode01";
  const spriteColor = impactType === "conc" ? 0xb8ffd8 : impactType === "mirvlet" ? 0xffb066 : 0xffffff;
  const fallbackKind = impactType === "conc" ? "shockwave" : "explode01";
  const visual = impactType === "conc"
    ? createShockwaveEffect(effectKey, fallbackKind, spriteColor, 0.95)
    : createSprite(effectKey, fallbackKind, spriteColor, 0.95);
  group.add(visual);
  setSpriteFrame(visual, 0);

  group.visible = false;
  group.position.copy(position);
  if (impactType === "conc") group.position.y += 18;

  return {
    group,
    visual,
    start: frame.rt,
    duration: impactType === "mirv" ? 0.75 : impactType === "mirvlet" ? 0.48 : impactType === "conc" ? 0.75 : 0.42,
    startSize: impactType === "conc" ? 44 : 42,
    maxSize: impactType === "mirv" ? 250 : impactType === "mirvlet" ? 136 : impactType === "conc" ? 170 : 150,
    startHeight: impactType === "conc" ? 27 : 0,
    maxHeight: impactType === "conc" ? 66 : 0,
    rise: impactType === "conc" ? 21 : 0,
    spin: impactType === "conc" ? 0.9 : -1.4
  };
}

function createSmokeVisual(position, start) {
  const sprite = createSprite("smoke", "smoke", 0xf1f5f9, 0.26);
  setSpriteFrame(sprite, 0);
  sprite.visible = false;
  sprite.position.copy(position);
  return {
    sprite,
    basePosition: position.clone(),
    start,
    duration: 0.42,
    startSize: 10,
    maxSize: 24
  };
}

function buildProjectileState(projectileFrames) {
  const normalizedFrames = projectileFrames
    .map(frame => normalizeProjectileFrame(frame, state.origin))
    .sort((a, b) => (a.rt - b.rt) || (a.projectileId - b.projectileId) || (b.state - a.state));

  const tracksById = new Map();
  const impacts = [];

  for (const frame of normalizedFrames) {
    const def = projectileDefinitionForFrame(frame);
    let track = tracksById.get(frame.projectileId);

    if (!track) {
      track = {
        id: frame.projectileId,
        owner: frame.owner,
        classname: frame.classname,
        model: frame.model,
        def,
        frames: [],
        removal: null,
        mesh: null
      };
      tracksById.set(frame.projectileId, track);
    }

    if (frame.state === 0) {
      track.removal = frame;
      impacts.push(createImpactVisual(track.def, frame));
      continue;
    }

    track.frames.push(frame);
  }

  const tracks = [...tracksById.values()]
    .filter(track => track.frames.length)
    .sort((a, b) => a.frames[0].rt - b.frames[0].rt);

  const smokeEffects = buildProjectileSmokeEffects(tracks);
  const projectileCount = tracks.length || tracksById.size;
  return { normalizedFrames, tracks, projectileCount, impacts, smokeEffects };
}

function buildProjectileSmokeEffects(tracks) {
  const smokeEffects = [];
  for (const track of tracks) {
    if (!track?.def?.smokeSprite) continue;
    const startTime = track.frames[0]?.rt;
    const endTime = track.removal?.rt ?? track.frames[track.frames.length - 1]?.rt;
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) continue;

    for (let t = startTime; t < endTime; t += 0.02) {
      const sample = projectilePositionAt(track, t);
      if (!sample?.position) continue;
      smokeEffects.push(createSmokeVisual(sample.position, t));
    }
  }
  return smokeEffects;
}

function projectilePositionAt(track, time) {
  const frames = track.frames;
  if (!frames.length || time < frames[0].rt) return null;
  if (track.removal && time >= track.removal.rt) return null;

  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (frames[mid].rt <= time) low = mid;
    else high = mid - 1;
  }

  const current = frames[low];
  const next = frames[low + 1] || null;
  if (!next || next.rt <= current.rt || time >= next.rt) {
    return {
      frame: current,
      position: current.p.clone(),
      yaw: current.yaw
    };
  }

  const mix = Math.min(1, Math.max(0, (time - current.rt) / (next.rt - current.rt)));
  const position = current.p.clone().lerp(next.p, mix);
  const yaw = lerpAngleDeg(current.yaw, next.yaw, mix);
  return { frame: current, position, yaw };
}

function updateProjectileVisuals() {
  for (const track of state.projectileTracks) {
    if (!track.mesh) continue;
    const sample = projectilePositionAt(track, state.playbackTime);
    if (!sample) {
      track.mesh.visible = false;
      continue;
    }

    track.mesh.visible = true;
    track.mesh.position.copy(sample.position);
    const flare = track.mesh.getObjectByName?.("rocketflare");
    if (flare) setSpriteFrame(flare, state.playbackTime % 1);
    if (track.def.primitive === "rocket") {
      applyProjectileRotation(track.mesh, track.def, sample.yaw, 0);
    } else {
      const spinAxis = track.def.spinAxis || "y";
      const currentSpinRad = track.mesh.rotation[spinAxis] || 0;
      const spinSpeedRad = track.def.spinSpeedRad || 0.01;
      const spinDeg = THREE.MathUtils.radToDeg(currentSpinRad + spinSpeedRad);
      applyProjectileRotation(track.mesh, track.def, 0, spinDeg);
    }
  }
}

function updateImpactVisuals() {
  for (const impact of state.projectileImpacts) {
    const age = state.playbackTime - impact.start;
    if (age < 0 || age > impact.duration) {
      impact.group.visible = false;
      continue;
    }

    const t = age / impact.duration;
    const eased = 1 - ((1 - t) * (1 - t));
    const size = THREE.MathUtils.lerp(impact.startSize, impact.maxSize, eased);
    const height = THREE.MathUtils.lerp(impact.startHeight || 0, impact.maxHeight || 0, eased);
    const fade = 1 - t;

    impact.group.visible = true;
    if (impact.visual.isSprite) {
      impact.visual.scale.set(size, size, 1);
    } else {
      impact.visual.scale.set(size, Math.max(1, height), size);
      impact.visual.position.y = (height * 0.5) + (impact.rise * t);
    }
    impact.visual.material.opacity = 0.95 * fade;
    if (impact.visual.isSprite) impact.visual.material.rotation = impact.spin * t;
    setSpriteFrame(impact.visual, t);
  }
}

function updateSmokeVisuals() {
  for (const smoke of state.projectileSmokeEffects) {
    const age = state.playbackTime - smoke.start;
    if (age < 0 || age > smoke.duration) {
      smoke.sprite.visible = false;
      continue;
    }

    const t = age / smoke.duration;
    const eased = 1 - ((1 - t) * (1 - t));
    const size = THREE.MathUtils.lerp(smoke.startSize, smoke.maxSize, eased);
    const fade = 1 - t;

    smoke.sprite.visible = true;
    smoke.sprite.position.copy(smoke.basePosition);
    smoke.sprite.position.y += age * 6;
    smoke.sprite.scale.set(size, size, 1);
    smoke.sprite.material.opacity = 0.22 * fade;
    smoke.sprite.material.rotation = t * 0.2;
    setSpriteFrame(smoke.sprite, t);
  }
}

function playerFootOffset(frame) {
  return (Number(frame?.buttons || 0) & 4)
    ? CROUCHED_PLAYER_FOOT_OFFSET
    : STANDING_PLAYER_FOOT_OFFSET;
}

function updatePlayer() {
  const frame = frameAt(state.playbackTime);
  if (!frame) return;
  player.position.copy(frame.p);
  player.position.y -= playerFootOffset(frame);
  player.rotation.y = THREE.MathUtils.degToRad(Number(frame.yaw || 0));

  const comparisonFrame = comparisonFrameAt(state.playbackTime);
  if (comparisonFrame) {
    comparisonPlayer.visible = true;
    comparisonPlayer.position.copy(comparisonFrame.p);
    comparisonPlayer.position.y -= playerFootOffset(comparisonFrame);
    comparisonPlayer.rotation.y = THREE.MathUtils.degToRad(Number(comparisonFrame.yaw || 0));
  } else {
    comparisonPlayer.visible = false;
  }

  if (state.cameraMode === "pov") updatePovCamera(frame);
  updateStats(frame);
  updateProjectileVisuals();
  updateImpactVisuals();
  updateSmokeVisuals();
  updateGrenadeHud();

  const slider = $("replay-slider");
  if (slider && document.activeElement !== slider) slider.value = String(Math.round(state.playbackTime * 1000));
  const clock = $("replay-clock");
  if (clock) clock.textContent = formatTime(state.playbackTime);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function renderReplayScene() {
  renderer.render(scene, camera);
}

function setPlaying(playing) {
  state.playing = Boolean(playing);
  document.body.classList.toggle("replay-playing", state.playing);
  const playButton = $("replay-play");
  if (playButton) playButton.textContent = state.playing ? "Pause" : "Play";
  const touchPlayButton = $("replay-free-roam-play");
  if (touchPlayButton) {
    touchPlayButton.textContent = state.playing ? "PAUSE" : "PLAY";
    touchPlayButton.setAttribute("aria-label", state.playing ? "Pause replay" : "Play replay");
  }
  if (state.playing) {
    scheduleOverlaysAutoHide();
  } else {
    clearOverlaysHideTimer();
    setOverlaysVisible(state.cameraMode === "free" && isTouchFreeRoamEnvironment() ? false : true);
  }
}

function isInteractiveTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, select, textarea, button")) return true;
  if (target.closest("[contenteditable=\"true\"]")) return true;
  return target.isContentEditable;
}

function nearestReplayFrameIndex(time) {
  const frames = state.normalized;
  if (!frames.length) return 0;
  if (time <= frames[0].rt) return 0;
  const lastIndex = frames.length - 1;
  if (time >= frames[lastIndex].rt) return lastIndex;

  let low = 0;
  let high = lastIndex;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].rt < time) low = mid + 1;
    else high = mid;
  }

  const nextIndex = Math.min(lastIndex, low);
  const prevIndex = Math.max(0, nextIndex - 1);
  return Math.abs(frames[nextIndex].rt - time) < Math.abs(time - frames[prevIndex].rt)
    ? nextIndex
    : prevIndex;
}

function jumpToReplayFrame(index) {
  const frames = state.normalized;
  if (!frames.length) return;
  const clampedIndex = THREE.MathUtils.clamp(index, 0, frames.length - 1);
  state.frameIndex = clampedIndex;
  state.playbackTime = frames[clampedIndex].rt;
  updatePlayer();
  renderReplayScene();
}

function stepReplayFrame(direction) {
  if (!state.normalized.length) return;
  setPlaying(false);
  setOverlaysVisible(true);
  const currentIndex = nearestReplayFrameIndex(state.playbackTime);
  jumpToReplayFrame(currentIndex + direction);
}

function tick(now) {
  const delta = Math.min(0.1, (now - state.lastTick) / 1000);
  state.lastTick = now;
  if (state.playing) {
    state.playbackTime += delta * state.speed;
    if (state.playbackTime >= state.duration) {
      state.playbackTime = state.duration;
      setPlaying(false);
      setOverlaysVisible(true);
    }
  }
  updatePlayer();
  updateFreeRoamCamera(delta);
  renderReplayScene();
  requestAnimationFrame(tick);
}

async function exportReplayWebM() {
  const button = $("replay-export");
  if (!button || !renderer?.domElement) return;

  if (!window.MediaRecorder) {
    alert("Replay export is not supported in this browser.");
    return;
  }

  const oldPlaying = state.playing;
  const oldTime = state.playbackTime;
  const oldSpeed = state.speed;

  button.disabled = true;
  button.textContent = "Recording...";

  state.playbackTime = 0;
  state.frameIndex = 0;
  state.speed = 1;
  state.playing = true;

  const stream = renderer.domElement.captureStream(60);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = event => {
    if (event.data?.size) chunks.push(event.data);
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);

    const map = state.replay?.map || "speedrun";
    const cls = state.replay?.className || "class";
    const playerName = state.replay?.playerName || "player";

    const a = document.createElement("a");
    a.href = url;
    a.download = `${map}_${cls}_${playerName}_replay.webm`.replace(/[^a-z0-9_.-]+/gi, "_");
    a.click();

    URL.revokeObjectURL(url);

    state.playbackTime = oldTime;
    state.frameIndex = 0;
    state.speed = oldSpeed;
    setPlaying(oldPlaying);

    button.disabled = false;
    button.textContent = "Export Replay";
  };

  recorder.start();

  const checkDone = setInterval(() => {
    if (state.playbackTime >= state.duration) {
      clearInterval(checkDone);
      setPlaying(false);
      recorder.stop();
    }
  }, 100);
}

function wireControls() {
  $("replay-play")?.addEventListener("click", () => {
    setPlaying(!state.playing);
    if (state.playing) {
      setOverlaysVisible(true);
      scheduleOverlaysAutoHide();
    }
  });

  $("replay-export")?.addEventListener("click", () => {
    setOverlaysVisible(true);
    exportReplayWebM();
  });

  $("replay-restart")?.addEventListener("click", () => {
    state.playbackTime = 0;
    state.frameIndex = 0;
    if (state.comparison) state.comparison.frameIndex = 0;
    setPlaying(true);
    setOverlaysVisible(true);
    scheduleOverlaysAutoHide();
    updatePlayer();
    renderReplayScene();
  });

  document.querySelectorAll("[data-speed]").forEach(button => {
    button.addEventListener("click", () => {
      state.speed = Number(button.dataset.speed) || 1;
      setOverlaysVisible(true);
      document.querySelectorAll("[data-speed]").forEach(item => item.classList.toggle("active", item === button));
    });
  });

  $("replay-trail")?.addEventListener("click", () => {
    setOverlaysVisible(true);
    setTrailVisible(!state.showTrail);
  });

  $("replay-zones")?.addEventListener("click", () => {
    setOverlaysVisible(true);
    setZonesEnabled(!state.showZones);
  });

  $("replay-model-style")?.addEventListener("click", () => {
    setOverlaysVisible(true);
    setPlayerModelStyle(state.playerModelStyle === "new" ? "classic" : "new");
  });

  $("replay-camera-mode")?.addEventListener("click", () => {
    setCameraMode(state.cameraMode === "free" ? "pov" : "free");
  });

  $("replay-fov-decrease")?.addEventListener("click", () => {
    setOverlaysVisible(true);
    adjustReplayFov(-REPLAY_FOV_STEP);
  });

  $("replay-fov-increase")?.addEventListener("click", () => {
    setOverlaysVisible(true);
    adjustReplayFov(REPLAY_FOV_STEP);
  });

  $("replay-slider")?.addEventListener("input", event => {
    state.playbackTime = Math.min(state.duration, Math.max(0, Number(event.target.value) / 1000));
    state.frameIndex = 0;
    if (state.comparison) state.comparison.frameIndex = 0;
    setOverlaysVisible(true);
    if (!state.playing) {
      updatePlayer();
      renderReplayScene();
    }
  });

  canvas.addEventListener("click", event => {
    if (!$("replay-compare-panel")?.hidden) {
      setComparisonPanelOpen(false);
      return;
    }
    if (state.cameraMode === "free") {
      setOverlaysVisible(false);
      if (!event.sourceCapabilities?.firesTouchEvents && document.pointerLockElement !== canvas) {
        const request = canvas.requestPointerLock?.();
        if (request?.catch) request.catch(() => setOverlaysVisible(true));
      }
      return;
    }
    if (!state.playing) {
      setOverlaysVisible(true);
      return;
    }
    setOverlaysVisible(!state.overlaysVisible);
  });

  canvas.addEventListener("pointerdown", event => {
    if (state.cameraMode !== "free") return;
    if (event.pointerType === "mouse" && canvas.requestPointerLock) return;
    freeRoamDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", event => {
    if (!freeRoamDrag || freeRoamDrag.id !== event.pointerId || state.cameraMode !== "free") return;
    rotateFreeRoam(event.clientX - freeRoamDrag.x, event.clientY - freeRoamDrag.y);
    freeRoamDrag.x = event.clientX;
    freeRoamDrag.y = event.clientY;
    event.preventDefault();
  });

  const endFreeRoamDrag = event => {
    if (!freeRoamDrag || freeRoamDrag.id !== event.pointerId) return;
    freeRoamDrag = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener("pointerup", endFreeRoamDrag);
  canvas.addEventListener("pointercancel", endFreeRoamDrag);

  document.querySelectorAll("[data-free-roam-key]").forEach(button => {
    const key = button.dataset.freeRoamKey;
    const release = event => {
      freeRoamKeys.delete(key);
      button.classList.remove("pressed");
      if (event?.pointerId != null && button.hasPointerCapture?.(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
    };
    button.addEventListener("pointerdown", event => {
      if (state.cameraMode !== "free") return;
      event.preventDefault();
      event.stopPropagation();
      freeRoamKeys.add(key);
      button.classList.add("pressed");
      button.setPointerCapture?.(event.pointerId);
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("contextmenu", event => event.preventDefault());
  });

  $("replay-free-roam-touch")?.addEventListener("click", event => {
    event.stopPropagation();
    if (event.target.closest("[data-free-roam-action='play']")) {
      if (!state.playing && state.playbackTime >= state.duration) {
        state.playbackTime = 0;
        state.frameIndex = 0;
        if (state.comparison) state.comparison.frameIndex = 0;
        updatePlayer();
      }
      setPlaying(!state.playing);
      setOverlaysVisible(false);
      return;
    }
    if (event.target.closest("[data-free-roam-action='pov']")) setCameraMode("pov");
  });

  document.addEventListener("mousemove", event => {
    if (state.cameraMode === "free" && document.pointerLockElement === canvas) {
      rotateFreeRoam(event.movementX, event.movementY);
    }
  });

  document.addEventListener("pointerlockchange", () => {
    updateFreeRoamHelp();
    if (state.cameraMode === "free" && document.pointerLockElement !== canvas) setOverlaysVisible(true);
  });

  $("replay-compare-toggle")?.addEventListener("click", () => {
    const panel = $("replay-compare-panel");
    const willOpen = Boolean(panel?.hidden);
    setComparisonPanelOpen(willOpen);
    if (willOpen) loadComparisonCandidates();
  });

  $("replay-compare-close")?.addEventListener("click", () => setComparisonPanelOpen(false));

  $("replay-compare-select")?.addEventListener("change", event => {
    const addButton = $("replay-compare-add");
    if (addButton) addButton.disabled = !event.target.value;
    const status = $("replay-compare-status");
    if (status) status.textContent = "";
  });

  $("replay-compare-add")?.addEventListener("click", () => {
    const path = $("replay-compare-select")?.value;
    if (path) loadComparison(path);
  });

  $("replay-compare-remove")?.addEventListener("click", () => {
    clearComparison();
    const status = $("replay-compare-status");
    if (status) status.textContent = "Comparison removed.";
    setComparisonPanelOpen(false);
    updatePlayer();
    renderReplayScene();
  });

  document.querySelectorAll(".replay-topbar, .replay-stats, .replay-controls").forEach(element => {
    element.addEventListener("pointerdown", () => {
      setOverlaysVisible(true);
    });
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("replay-compare-panel")?.hidden) {
      event.preventDefault();
      setComparisonPanelOpen(false);
      return;
    }
    if (state.cameraMode === "free" && FREE_ROAM_MOVEMENT_KEYS.has(event.code) && !isInteractiveTypingTarget(event.target)) {
      event.preventDefault();
      freeRoamKeys.add(event.code);
      return;
    }
    if (event.repeat || isInteractiveTypingTarget(event.target)) return;
    if (event.code === "Space") {
      event.preventDefault();
      setPlaying(!state.playing);
      if (state.playing) {
        setOverlaysVisible(true);
        scheduleOverlaysAutoHide();
      }
      return;
    }
    if (event.code === "ArrowLeft") {
      event.preventDefault();
      stepReplayFrame(-1);
      return;
    }
    if (event.code === "ArrowRight") {
      event.preventDefault();
      stepReplayFrame(1);
      return;
    }
    if (event.key === "[") {
      event.preventDefault();
      setOverlaysVisible(true);
      adjustReplayFov(-REPLAY_FOV_STEP);
      return;
    }
    if (event.key === "]") {
      event.preventDefault();
      setOverlaysVisible(true);
      adjustReplayFov(REPLAY_FOV_STEP);
      return;
    }
  });

  window.addEventListener("keyup", event => {
    freeRoamKeys.delete(event.code);
  });

  window.addEventListener("blur", () => freeRoamKeys.clear());

  window.addEventListener("resize", resize);
}

async function setupProjectileVisuals() {
  if (!projectileRoot || !impactRoot || !smokeRoot) return;

  for (const track of state.projectileTracks) {
    const mesh = cloneProjectileVisual(track.def);
    addRocketFlare(mesh, track.def);
    mesh.visible = false;
    projectileRoot.add(mesh);
    track.mesh = mesh;
  }

  for (const impact of state.projectileImpacts) {
    impactRoot.add(impact.group);
  }

  for (const smoke of state.projectileSmokeEffects) {
    smokeRoot.add(smoke.sprite);
  }
}

async function init() {
  wireControls();
  updatePlayerModelStyleButton();
  setReplayFov(state.fov);
  resize();
  requestAnimationFrame(tick);

  try {
    const replay = await fetchReplay();
    const frames = decodeReplayFrames(replay.frames);
    if (frames.length < 2) throw new Error("Replay has too few frames.");

    state.replay = replay;
    canonicalizeReplayUrl(replay);
    await setReplayPlayerModel(player, replay);
    state.frames = frames;
    state.normalized = normalizeFrames(frames, replay);
    state.primaryDuration = Math.max(0, state.normalized[state.normalized.length - 1].rt);
    state.duration = state.primaryDuration;
    state.playbackTime = 0;
    state.frameIndex = 0;
    state.projectileFrames = Array.isArray(replay.projectileEvents)
      ? replay.projectileEvents
      : Array.isArray(replay.projectileFrames) ? replay.projectileFrames : [];
    state.grenadeHudEvents = [];
    state.zones = replay.zones || null;
    if (state.zones) {
      debugReplay("zone payload", {
        map: replay.map || null,
        start: state.zones.start ? {
          radius: state.zones.start.radius,
          height: state.zones.start.height
        } : null,
        finish: state.zones.finish ? {
          radius: state.zones.finish.radius,
          height: state.zones.finish.height
        } : null,
        checkpointDefaults: state.zones.defaults ? {
          radius: state.zones.defaults.checkpointRadius ?? state.zones.defaults.radius ?? null,
          height: state.zones.defaults.checkpointHeight ?? state.zones.defaults.height ?? null
        } : null,
        checkpoints: Array.isArray(state.zones.checkpoints)
          ? state.zones.checkpoints.map(checkpoint => ({
            checkpointNumber: checkpoint.checkpointNumber,
            rawCheckpoint: {
              x: checkpoint.position?.x ?? null,
              y: checkpoint.position?.y ?? null,
              z: checkpoint.position?.z ?? null,
              axis: checkpoint.axis ?? 0,
              yaw: checkpoint.yaw ?? 0
            },
            radius: checkpoint.radius,
            height: checkpoint.height,
            axis: checkpoint.axis ?? 0,
            yaw: checkpoint.yaw ?? 0
          }))
          : []
      });
    }
    const spriteKeys = new Set(["explode01", "explode02", "shockwave", "smoke", "animglow01"]);
    await preloadProjectileAssets(state.projectileFrames);
    await preloadSpriteAssets(spriteKeys);
    await finalizeProjectileAssetCache(new Set(
      state.projectileFrames
        .map(projectileDefinitionForFrame)
        .map(projectileModelKeyForDef)
        .filter(Boolean)
    ));
    await finalizeSpriteAssetCache(spriteKeys);
    const projectileState = buildProjectileState(state.projectileFrames);
    state.projectileTracks = projectileState.tracks;
    const reportedProjectileCount = Object.values(replay.projectileUsage || {})
      .reduce((total, count) => total + Math.max(0, Number(count) || 0), 0);
    state.projectileCount = reportedProjectileCount || projectileState.projectileCount;
    state.projectileImpacts = projectileState.impacts;
    state.projectileSmokeEffects = projectileState.smokeEffects;
    state.grenadeHudEvents = buildGrenadeHudEvents(state.projectileFrames);
    hideGrenadeHud();

    $("replay-title").textContent = `${replay.map || "Map"} / ${replay.className || `Class ${replay.classId}`}`;
    const projectileSummary = state.projectileCount
      ? ` · ${state.projectileCount.toLocaleString()} ${state.projectileCount === 1 ? "projectile" : "projectiles"}`
      : "";
    $("replay-subtitle").textContent = `${replay.playerName || replay.steamid || "Unknown"} · ${runTime(replay.timeMs)} · ${state.normalized.length.toLocaleString()} frames${projectileSummary}`;
    $("replay-duration").textContent = runTime(replay.timeMs);
    $("replay-slider").max = String(Math.max(1, Math.round(state.duration * 1000)));
    $("replay-map-link").href = `speedrun-map.html?map=${encodeURIComponent(replay.map || "")}`;
    document.title = `NoName TFC | ${replay.map || "Speedrun"} Replay`;

    buildSceneForReplay();
    const cameraButton = $("replay-camera-mode");
    if (cameraButton) cameraButton.disabled = false;
    setOverlaysVisible(true);
    await setupProjectileVisuals();
    loadMapModel(replay.map);
    updateComparisonLegend();

    const compareRunId = firstParam(params(), ["compareRunId", "compare_run_id"]);
    if (compareRunId && /^\d+$/.test(compareRunId) && Number(compareRunId) !== Number(replay.runId)) {
      await loadComparison(`/api/speedruns/replay/run/${encodeURIComponent(compareRunId)}`, { closePanel: true });
    }
    updatePlayer();
    setStatus("");
  } catch (error) {
    console.error("[speedrun-replay]", error);
    setPlaying(false);
    setStatus(error.message || "Replay unavailable.");
  }
}

init();
