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
const PLAYER_STANDING_VISUAL_HEIGHT = 72;
const PLAYER_CROUCH_VISUAL_HEIGHT = 40;
const PLAYER_STRIDE_LENGTH = 58;
const PLAYER_MOTION_RESPONSE = 12;
const PLAYER_AIR_HOLD_SECONDS = 0.18;
const IN_ATTACK = 1;
const AC_ROUNDS_PER_SECOND = 12;
const AC_TRACER_RANGE = 900;
const TFC_MODEL_ASSET_VERSION = "20260731schema3fix5";
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
  modelCatalog: new Map(),
  buildableDefinitions: new Map(),
  buildables: [],
  brushDefinitions: new Map(),
  brushes: [],
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
const buildableRoot = new THREE.Group();
const impactRoot = new THREE.Group();
const hitscanRoot = new THREE.Group();
world.add(playerRoot, corpseRoot, projectileRoot, objectiveRoot, buildableRoot, impactRoot, hitscanRoot);
let grid = null;
let mapModel = null;
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
    ? [10, 11, 12, 19, 20]
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
  return snapshot;
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
  return `assets/models/player/${info[0]}/${classic}${teamSuffix}${poseSuffix}.glb?v=20260731crouch1`;
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
  if (!recorded || recorded.kind !== expectedKind) return null;
  const catalog = state.modelCatalog.get(recorded.path);
  return catalog?.kind === expectedKind ? catalog.url : null;
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

async function setProjectileCatalogModel(track) {
  const url = catalogUrl(track.recordedDefinition?.modelId, "projectile");
  if (!url) return;
  const asset = await loadModelAsset(url);
  if (!asset || !track.mesh) return;
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
    track.recordedDefinition = recorded;
    track.definition = replayProjectileDefinition(recorded);
    track.mesh = new THREE.Group();
    track.mesh.add(projectileVisuals.projectile(track.definition));
    track.mesh.visible = false;
    projectileRoot.add(track.mesh);
    void setProjectileCatalogModel(track);
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
}

function bindBrushNodes() {
  if (!mapModel) return;
  const nodes = new Map();
  mapModel.traverse(child => {
    if (/^\*[1-9]\d*$/.test(child.name) && !nodes.has(child.name)) nodes.set(child.name, child);
  });
  for (const track of state.brushes) {
    track.definition = state.brushDefinitions.get(track.brushId);
    track.node = nodes.get(track.definition?.model) || null;
    if (!track.node) continue;
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
    track.mesh.position.copy(sourcePoint(frame.x, frame.y, frame.z));
    // Schema 3 records the authoritative entity origin, including crouch transitions.
    // Keep the legacy visual offset only for schema 2's basic fallback.
    if (frame.schemaVersion === 2) track.mesh.position.y -= isDucking(frame) ? 18 : 36;
    track.mesh.rotation.y = THREE.MathUtils.degToRad(frame.schemaVersion >= 3 ? frame.bodyYaw : frame.yaw);
    const crouched = frame.schemaVersion >= 3 && isDucking(frame);
    updatePlayerMotion(track, frame, crouched);
    track.playerVisual.position.y = crouched ? 2.5 : 0;
    track.weaponVisual.position.y = crouched ? -18 : 0;
    track.playerVisual.rotation.x = THREE.MathUtils.degToRad(frame.schemaVersion >= 3 ? frame.bodyPitch : 0);
    track.playerVisual.rotation.z = THREE.MathUtils.degToRad(frame.schemaVersion >= 3 ? frame.bodyRoll : 0);
    const isSelectedPov =
      state.cameraMode === "pov" && track.sessionId === state.selectedSession;
    track.mesh.visible = frame.alive && !isSelectedPov;
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

function updateBrushes() {
  for (const track of state.brushes) {
    if (!track.node) continue;
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
  updateBuildables();
  updateBrushes();
  updateCamera();
  updateSelectedStats();
  renderEvents();
  $("replay-clock").textContent = formatTime(state.playbackTime);
  if (document.activeElement !== $("replay-slider")) {
    $("replay-slider").value = String(Math.round(state.playbackTime * 1000));
  }
}

function mapAssetUrl(map) {
  return `assets/maps/${encodeURIComponent(map)}/${encodeURIComponent(map)}.glb?v=20260731brushes1`;
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
    bindBrushNodes();
    updateBrushes();
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
    const worker = new Worker("/assets/js/pickup-replay-worker.js?v=20260731brushes1");
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

async function loadTfcModelCatalog() {
  const response = await fetch("/assets/tfc/models/manifest.json?v=20260731schema3fix5", { cache: "force-cache" });
  if (!response.ok) throw new Error(`TFC model catalog request failed (${response.status})`);
  const catalog = await response.json();
  return new Map(Object.entries(catalog.models || {}));
}

function cleanupReplayObjects() {
  for (const root of [playerRoot, corpseRoot, projectileRoot, objectiveRoot, buildableRoot, impactRoot, hitscanRoot]) {
    root.clear();
  }
  state.playerBySession.clear();
  state.projectileDefinitions.clear();
  state.objectiveDefinitions.clear();
  state.buildableDefinitions.clear();
  state.brushDefinitions.clear();
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

    const [telemetry, modelCatalog] = await Promise.all([
      loadTelemetry(metadata.files),
      loadTfcModelCatalog()
    ]);
    setStatus("Loading projectile models and effects…");
    await projectileVisuals.preload(telemetry.projectileDefinitions);
    state.roster = telemetry.roster;
    state.renderModels = new Map(telemetry.renderModels.map(model => [model.modelId, model]));
    state.modelCatalog = modelCatalog;
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

window.addEventListener("beforeunload", cleanupReplayObjects, { once: true });
init();
