import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import {
  ReplayProjectileVisuals,
  replayProjectileDefinition
} from "./replay-projectile-visuals.js?v=20260730pickup7";
import {
  configureReplayMapMaterial,
  isReplayMapGroundMaterial
} from "./replay-map-materials.js?v=20260730mapmaterials2";

const $ = id => document.getElementById(id);
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
const freeKeys = new Set();
const loader = new GLTFLoader();
const projectileVisuals = new ReplayProjectileVisuals(loader);
const modelCache = new Map();

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
  events: [],
  impacts: [],
  corpses: [],
  selectedSession: null,
  origin: { x: 0, y: 0, z: 0 },
  playbackTime: 0,
  duration: 0,
  speed: 1,
  playing: true,
  cameraMode: "pov",
  showProjectiles: true,
  showObjectives: true,
  lastTick: performance.now(),
  lastRosterSecond: -1,
  lastEventSecond: -1,
  freeYaw: 0,
  freePitch: -0.25
};

const canvas = $("replay-canvas");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a0f);
scene.fog = new THREE.Fog(0x070a0f, 3000, 15000);
const camera = new THREE.PerspectiveCamera(90, 1, 1, 50000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x131820, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(1000, 1800, 700);
scene.add(sun);
const world = new THREE.Group();
scene.add(world);
const playerRoot = new THREE.Group();
const corpseRoot = new THREE.Group();
const projectileRoot = new THREE.Group();
const objectiveRoot = new THREE.Group();
const impactRoot = new THREE.Group();
world.add(playerRoot, corpseRoot, projectileRoot, objectiveRoot, impactRoot);
let grid = null;
let mapModel = null;
const corpseGroundRay = new THREE.Raycaster();
const corpseDown = new THREE.Vector3(0, -1, 0);

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

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const millis = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${minutes}:${String(whole).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
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

function trackFrame(track, time, interpolate = true) {
  const data = track?.frames;
  const stride = track?.stride || 0;
  const count = stride ? Math.floor(data.length / stride) : 0;
  if (!count) return null;
  if (time < data[0] || time > data[(count - 1) * stride] + 0.25) return null;
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
  if (snapshot.schemaVersion === 3) Object.assign(snapshot, {
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
  return snapshot;
}

function isDucking(frame) {
  return frame.schemaVersion === 3 ? frame.ducking : Boolean(frame.buttons & 4);
}

function projectileSnapshot(track, time) {
  const frame = trackFrame(track, time);
  if (!frame || value(frame, 1, false) === 0) return null;
  return {
    state: value(frame, 1, false),
    x: value(frame, 2), y: value(frame, 3), z: value(frame, 4),
    yaw: angle(frame, 9)
  };
}

function objectiveSnapshot(track, time) {
  const frame = trackFrame(track, time);
  if (!frame) return null;
  return {
    state: value(frame, 1, false),
    carrierSession: Math.round(value(frame, 2, false)),
    x: value(frame, 5), y: value(frame, 6), z: value(frame, 7),
    yaw: angle(frame, 8)
  };
}

function fallbackPlayerMesh(team) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: teamInfo(team).color,
    roughness: 0.62,
    metalness: 0.05
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(15, 42, 6, 10), material);
  body.position.y = 36;
  group.add(body);
  return group;
}

function modelUrl(classId, team) {
  const info = CLASS_MODELS[classId] || CLASS_MODELS[0];
  const classic = info[0] === "civilian" ? info[1] : `${info[1]}2`;
  const teamSuffix = `_${teamInfo(team).name.toLowerCase()}`;
  return `assets/models/player/${info[0]}/${classic}${teamSuffix}.glb?v=20260730pickup1`;
}

async function modelAsset(classId, team) {
  return loadModelAsset(modelUrl(classId, team));
}

async function loadModelAsset(url) {
  if (!modelCache.has(url)) {
    modelCache.set(url, new Promise(resolve => {
      loader.load(url, gltf => resolve(gltf.scene || null), undefined, () => resolve(null));
    }));
  }
  return modelCache.get(url);
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
  return `/assets/models/objectives/flag_${name}.glb?v=20260730pickup1`;
}

async function setObjectiveModel(track) {
  const asset = await loadModelAsset(objectiveModelUrl(track.team));
  if (!asset || track.mesh.userData.hasObjectiveModel) return;
  const model = asset.clone(true);
  model.traverse(child => {
    if (child.isMesh) child.frustumCulled = false;
  });
  track.mesh.clear();
  track.mesh.add(model);
  track.mesh.userData.hasObjectiveModel = true;
}

function clonedPlayerModel(asset) {
  const model = asset.clone(true);
  model.traverse(child => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
  });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? 72 / size.y : 1;
  model.scale.setScalar(scale);
  model.position.y = -bounds.min.y * scale;
  return model;
}

async function setPlayerModel(track, classId, team) {
  if (track.mesh.userData.modelClass === classId && track.mesh.userData.modelTeam === team) return;
  track.mesh.userData.modelClass = classId;
  track.mesh.userData.modelTeam = team;
  const asset = await modelAsset(classId, team);
  if (!asset || track.mesh.userData.modelClass !== classId || track.mesh.userData.modelTeam !== team) return;
  const model = clonedPlayerModel(asset);
  track.playerVisual.clear();
  track.playerVisual.add(model);
}

function thirdPersonModelUrl(model) {
  if (!model || model.kind !== "weapon") return null;
  const name = model.path.split("/").pop();
  if (!/^p_[A-Za-z0-9_.-]+\.mdl$/i.test(name)) return null;
  return `/assets/${model.path.replace(/\.mdl$/i, ".glb")}`;
}

async function setWeaponModel(track, modelId) {
  if (track.mesh.userData.weaponModelId === modelId) return;
  track.mesh.userData.weaponModelId = modelId;
  track.weaponVisual.clear();
  if (!modelId) return;
  const url = thirdPersonModelUrl(state.renderModels.get(modelId));
  if (!url) return;
  const asset = await loadModelAsset(url);
  if (!asset || track.mesh.userData.weaponModelId !== modelId) return;
  const model = asset.clone(true);
  model.traverse(child => { if (child.isMesh) child.frustumCulled = false; });
  track.weaponVisual.add(model);
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
  for (let offset = 0; offset < frames.length; offset += stride) {
    if (frames[offset + 1] !== 0) continue;
    return {
      time: frames[offset],
      x: frames[offset + 2],
      y: frames[offset + 3],
      z: frames[offset + 4]
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
    const roster = state.roster.find(row => row.sessionId === track.sessionId);
    const team = roster?.team || 0;
    track.mesh = new THREE.Group();
    track.playerVisual = new THREE.Group();
    track.weaponVisual = new THREE.Group();
    track.playerVisual.add(fallbackPlayerMesh(team));
    track.mesh.add(track.playerVisual, track.weaponVisual);
    track.mesh.visible = false;
    track.mesh.userData.sessionId = track.sessionId;
    playerRoot.add(track.mesh);

    for (const corpse of corpseRecords(track)) {
      corpse.mesh = new THREE.Group();
      corpse.mesh.visible = false;
      corpse.mesh.position.copy(sourcePoint(corpse.x, corpse.y, corpse.z));
      corpse.mesh.position.y -= (corpse.buttons & 4) ? 18 : 36;
      corpse.mesh.rotation.y = THREE.MathUtils.degToRad(corpse.yaw);
      corpse.mesh.add(layCorpseModel(fallbackPlayerMesh(corpse.team), corpse.side));
      corpseRoot.add(corpse.mesh);
      state.corpses.push(corpse);
      void setCorpseModel(corpse);
    }
  }
  for (const track of state.projectiles) {
    const recorded = state.projectileDefinitions.get(track.projectileId);
    track.definition = replayProjectileDefinition(recorded);
    track.mesh = projectileVisuals.projectile(track.definition);
    track.mesh.visible = false;
    projectileRoot.add(track.mesh);
    const removal = projectileRemoval(track);
    if (removal) {
      const impact = projectileVisuals.impact(
        track.definition,
        sourcePoint(removal.x, removal.y, removal.z),
        removal.time
      );
      state.impacts.push(impact);
      impactRoot.add(impact.group);
    }
  }
  for (const track of state.objectives) {
    const definition = state.objectiveDefinitions.get(track.objectiveId);
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
    const heading = document.createElement("div");
    heading.className = "pickup-team-heading";
    heading.style.setProperty("--team-color", info.css);
    heading.textContent = info.name;
    container.appendChild(heading);
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
      container.appendChild(button);
    }
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

function renderEvents(force = false) {
  const second = Math.floor(state.playbackTime);
  if (!force && second === state.lastEventSecond) return;
  state.lastEventSecond = second;
  const nearby = state.events
    .filter(event => event.time <= state.playbackTime + 1 && event.time >= state.playbackTime - 18)
    .slice(-24)
    .reverse();
  const container = $("pickup-events");
  container.innerHTML = "";
  for (const event of nearby) {
    const item = document.createElement("article");
    item.className = `pickup-event${Math.abs(event.time - state.playbackTime) < 0.6 ? " active" : ""}`;
    const time = document.createElement("time");
    time.textContent = formatTime(event.time);
    const copy = document.createElement("p");
    copy.textContent = eventDescription(event);
    item.append(time, copy);
    container.appendChild(item);
  }
  $("pickup-event-count").textContent = state.events.length.toLocaleString();
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

function updatePlayers() {
  for (const track of state.players) {
    if (!track.mesh) continue;
    const frame = playerSnapshot(track, state.playbackTime);
    const joined = state.roster.find(row => row.sessionId === track.sessionId)?.joinedMs / 1000 || 0;
    track.mesh.visible = Boolean(frame && state.playbackTime >= joined);
    if (!frame) continue;
    track.mesh.position.copy(sourcePoint(frame.x, frame.y, frame.z));
    track.mesh.position.y -= isDucking(frame) ? 18 : 36;
    track.mesh.rotation.y = THREE.MathUtils.degToRad(frame.schemaVersion === 3 ? frame.bodyYaw : frame.yaw);
    track.playerVisual.rotation.x = THREE.MathUtils.degToRad(frame.schemaVersion === 3 ? frame.bodyPitch : 0);
    track.playerVisual.rotation.z = THREE.MathUtils.degToRad(frame.schemaVersion === 3 ? frame.bodyRoll : 0);
    const isSelectedPov =
      state.cameraMode === "pov" && track.sessionId === state.selectedSession;
    track.mesh.visible = frame.alive && !isSelectedPov;
    void setPlayerModel(track, frame.classId, frame.team);
    if (frame.schemaVersion === 3) {
      void setWeaponModel(track, frame.weaponModelId);
      Object.assign(track.playerVisual.userData, {
        recordedPlayerModel: state.renderModels.get(frame.playerModelId)?.path || null,
        body: frame.body, skin: frame.skin, sequence: frame.sequence,
        gaitsequence: frame.gaitsequence, frame: frame.frame, framerate: frame.framerate,
        animtime: frame.animtime, controller: frame.controller, blending: frame.blending
      });
    }

    const button = document.querySelector(`.pickup-player[data-session-id="${track.sessionId}"]`);
    if (button) {
      button.classList.toggle("dead", !frame.alive);
      button.querySelector(".pickup-player-state").textContent = frame.alive ? `${frame.health} HP` : "DEAD";
    }
  }
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
  if (!state.showProjectiles) return;
  for (const track of state.projectiles) {
    if (!track.mesh) continue;
    const frame = projectileSnapshot(track, state.playbackTime);
    track.mesh.visible = Boolean(frame);
    if (!frame) continue;
    track.mesh.position.copy(sourcePoint(frame.x, frame.y, frame.z));
    projectileVisuals.rotate(track.mesh, track.definition, frame.yaw, state.playbackTime);
  }
  for (const impact of state.impacts) {
    projectileVisuals.updateImpact(impact, state.playbackTime);
  }
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
    const point = carrierFrame
      ? sourcePoint(carrierFrame.x, carrierFrame.y, carrierFrame.z + 48)
      : sourcePoint(frame.x, frame.y, frame.z);
    track.mesh.position.copy(point);
    track.mesh.rotation.y = THREE.MathUtils.degToRad(frame.yaw);
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
  if (!frame) return;
  const speed = Math.hypot(frame.vx, frame.vy);
  $("pickup-selected-class").textContent = `${className(frame.classId)} · ${frame.alive ? "Alive" : "Dead"}`;
  $("pickup-stat-health").textContent = frame.health;
  $("pickup-stat-armor").textContent = frame.armor;
  $("pickup-stat-speed").textContent = Math.round(speed);
  $("pickup-stat-weapon").textContent = frame.weapon;
}

function updateScene() {
  updatePlayers();
  updateCorpses();
  updateProjectiles();
  updateObjectives();
  updateCamera();
  updateSelectedStats();
  renderEvents();
  $("replay-clock").textContent = formatTime(state.playbackTime);
  if (document.activeElement !== $("replay-slider")) {
    $("replay-slider").value = String(Math.round(state.playbackTime * 1000));
  }
}

function mapAssetUrl(map) {
  return `assets/maps/${encodeURIComponent(map)}/${encodeURIComponent(map)}.glb?v=20260730pickup1`;
}

function loadMap() {
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
    world.add(mapModel);
    settleCorpses();
    if (grid) grid.visible = false;
  }, undefined, () => {
    if (grid) grid.visible = true;
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
  $("replay-play").textContent = state.playing ? "Pause" : "Play";
  document.body.classList.toggle("replay-playing", state.playing);
}

function setCameraMode(mode) {
  state.cameraMode = mode;
  $("replay-camera").textContent = `Camera: ${mode.toUpperCase()}`;
  $("replay-camera-label").textContent = mode.toUpperCase();
  $("pickup-free-help").hidden = mode !== "free";
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
  $("replay-play").addEventListener("click", () => setPlaying(!state.playing));
  $("replay-restart").addEventListener("click", () => {
    state.playbackTime = 0;
    setPlaying(true);
    updateScene();
  });
  $("replay-camera").addEventListener("click", () => {
    const index = CAMERA_MODES.indexOf(state.cameraMode);
    setCameraMode(CAMERA_MODES[(index + 1) % CAMERA_MODES.length]);
  });
  $("replay-projectiles").addEventListener("click", event => {
    state.showProjectiles = !state.showProjectiles;
    event.currentTarget.classList.toggle("active", state.showProjectiles);
  });
  $("replay-objectives").addEventListener("click", event => {
    state.showObjectives = !state.showObjectives;
    event.currentTarget.classList.toggle("active", state.showObjectives);
  });
  document.querySelectorAll("[data-speed]").forEach(button => {
    button.addEventListener("click", () => {
      state.speed = Number(button.dataset.speed);
      document.querySelectorAll("[data-speed]").forEach(item => item.classList.toggle("active", item === button));
    });
  });
  $("replay-slider").addEventListener("input", event => {
    state.playbackTime = Math.min(state.duration, Number(event.target.value) / 1000);
    updateScene();
  });
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
    freeKeys.add(event.code);
  });
  window.addEventListener("keyup", event => freeKeys.delete(event.code));
  window.addEventListener("blur", () => freeKeys.clear());
  window.addEventListener("resize", resize);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function tick(now) {
  const delta = Math.min(0.1, (now - state.lastTick) / 1000);
  state.lastTick = now;
  if (state.playing) {
    state.playbackTime += delta * state.speed;
    if (state.playbackTime >= state.duration) {
      state.playbackTime = state.duration;
      setPlaying(false);
    }
  }
  updateScene();
  updateFreeCamera(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function loadTelemetry(files) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/assets/js/pickup-replay-worker.js?v=20260731schema3");
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
    worker.postMessage({ files, schemaVersion: state.metadata?.manifest?.schema_version });
  });
}

async function init() {
  wireControls();
  resize();
  requestAnimationFrame(tick);
  try {
    const identity = queryIdentity();
    const response = await fetch(
      `/api/pickup-replays/viewer/${encodeURIComponent(identity.matchId)}/${identity.round}`,
      { cache: "no-store" }
    );
    const metadata = await response.json();
    if (!response.ok) throw new Error(metadata.error || `Replay request failed (${response.status})`);
    state.metadata = metadata;
    state.duration = metadata.durationMs / 1000;
    $("replay-title").textContent = `${metadata.map} · ${metadata.matchId} / Round ${metadata.round}`;
    $("replay-subtitle").textContent =
      `${metadata.snapshots.toLocaleString()} snapshots · ${metadata.rowCounts.players.toLocaleString()} player rows · ${metadata.rowCounts.projectiles.toLocaleString()} projectile rows`;
    $("replay-round-status").textContent = `${metadata.status} · ${metadata.reason || "no reason"}`;
    $("replay-duration").textContent = formatTime(state.duration);
    $("replay-slider").max = String(Math.max(1, metadata.durationMs));
    document.title = `NoName TFC | ${metadata.map} 4v4 Replay`;

    const telemetry = await loadTelemetry(metadata.files);
    setStatus("Loading projectile models and effects…");
    await projectileVisuals.preload(telemetry.projectileDefinitions);
    state.roster = telemetry.roster;
    state.renderModels = new Map(telemetry.renderModels.map(model => [model.modelId, model]));
    state.players = telemetry.players;
    state.playerBySession = new Map(state.players.map(track => [track.sessionId, track]));
    state.projectileDefinitions = new Map(telemetry.projectileDefinitions.map(def => [def.projectileId, def]));
    state.projectiles = telemetry.projectiles;
    state.objectiveDefinitions = new Map(telemetry.objectiveDefinitions.map(def => [def.objectiveId, def]));
    state.objectives = telemetry.objectives;
    state.events = telemetry.events;
    buildRoster();
    selectPlayer(state.roster[0]?.sessionId);
    setupWorld();
    renderEvents(true);
    updateScene();
    setStatus("");
  } catch (error) {
    console.error("[pickup-replay]", error);
    setPlaying(false);
    setStatus(error.message || "Replay unavailable.");
  }
}

init();
