import * as THREE from "three";

const MODEL_PATHS = new Map([
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

const SPRITE_PATHS = new Map([
  ["explode01", "/assets/sprites/explode01.spr"],
  ["explode02", "/assets/sprites/explode02.spr"],
  ["shockwave", "/assets/sprites/shockwave.spr"],
  ["animglow01", "/assets/sprites/animglow01.spr"]
]);

const DEFINITIONS = [
  { key: "conc", classnames: ["tf_weapon_concussiongrenade"], models: ["models/conc_grenade.mdl"], color: 0x22c55e, radius: 18, impact: "conc", effect: "shockwave" },
  { key: "grenade", classnames: ["tf_weapon_normalgrenade"], models: ["models/w_grenade.mdl"], color: 0xfacc15, radius: 18, impact: "generic", effect: "explode01" },
  { key: "rocket", classnames: ["tf_rpg_rocket"], models: ["models/rpgrocket.mdl"], color: 0xf97316, radius: 16, impact: "generic", effect: "explode01", yawOffset: 180, flare: true },
  { key: "pipe-blue", classnames: ["tf_gl_pipebomb"], models: ["models/pipebomb.mdl"], assetModel: "models/pipebomb_blue_variant", color: 0x3b82f6, radius: 17, impact: "generic", effect: "explode01" },
  { key: "pipe-yellow", classnames: ["tf_gl_grenade"], models: ["models/pipebomb.mdl"], assetModel: "models/pipebomb_yellow_variant", color: 0xfacc15, radius: 17, impact: "generic", effect: "explode01" },
  { key: "mirv", classnames: ["tf_weapon_mirvgrenade"], models: ["models/mirv_grenade.mdl"], color: 0xef4444, radius: 19, impact: "mirv", effect: "explode02", rotation: [-75, 180, 58], spinAxis: "z", spinSpeed: 2.5 },
  { key: "mirv-bomblet", classnames: ["tf_weapon_mirvbomblet"], models: ["models/bomblet.mdl"], color: 0xfb923c, radius: 12, impact: "mirvlet", effect: "explode01" },
  { key: "nail", classnames: ["tf_weapon_nailgrenade"], models: ["models/ngrenade.mdl"], color: 0x22d3ee, radius: 18, impact: "generic", effect: "explode01" },
  { key: "napalm", classnames: ["tf_weapon_napalmgrenade"], models: ["models/napalm.mdl"], color: 0xf97316, radius: 18, impact: "generic", effect: "explode01" }
];

const UNKNOWN = {
  key: "unknown",
  classnames: [],
  models: [],
  color: 0xe2e8f0,
  radius: 14,
  impact: "generic",
  effect: "explode01"
};

const normalized = value => String(value || "").trim().toLowerCase();

export function replayProjectileDefinition(recorded = {}) {
  const classname = normalized(recorded.classname);
  const model = normalized(recorded.model);
  const ownerWeapon = Number(recorded.ownerWeapon);

  // Both launcher projectiles report models/pipebomb.mdl, so the entity
  // classname must win before weapon or model fallbacks are considered.
  for (const definition of DEFINITIONS) {
    if (definition.classnames.includes(classname)) return definition;
  }

  const launcherProjectile =
    classname.includes("tf_gl_") || model.includes("pipebomb");
  if (launcherProjectile && ownerWeapon === 19) return DEFINITIONS[3];
  if (launcherProjectile && ownerWeapon === 18) return DEFINITIONS[4];

  for (const definition of DEFINITIONS) {
    if (model !== "models/pipebomb.mdl" && definition.models.includes(model)) return definition;
  }
  if (classname.includes("bomblet") || model.includes("bomblet")) return DEFINITIONS[6];
  if (classname.includes("mirv")) return DEFINITIONS[5];
  if (classname.includes("conc")) return DEFINITIONS[0];
  if (classname.includes("rocket") || model.includes("rocket") || model.includes("rpg")) return DEFINITIONS[2];
  if (classname.includes("napalm") || model.includes("napalm")) return DEFINITIONS[8];
  if (classname.includes("nailgrenade") || model.includes("ngrenade")) return DEFINITIONS[7];
  if (classname.includes("pipe") || model.includes("pipebomb")) return DEFINITIONS[3];
  if (classname.includes("grenade")) return DEFINITIONS[1];
  return UNKNOWN;
}

function fallbackMesh(definition) {
  const material = new THREE.MeshStandardMaterial({
    color: definition.color,
    emissive: definition.color,
    emissiveIntensity: 0.2,
    roughness: 0.4
  });
  if (definition.fallback === "pipe") {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(8, 20, 6, 10), material);
    mesh.rotation.z = Math.PI / 2;
    return mesh;
  }
  return new THREE.Mesh(new THREE.SphereGeometry(definition.radius, 16, 12), material);
}

function parseSprite(buffer, spriteKey) {
  const view = new DataView(buffer);
  if (view.byteLength < 42) throw new Error(`Invalid sprite: ${spriteKey}`);
  const signature = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (signature !== "IDSP" || view.getInt32(4, true) !== 2) {
    throw new Error(`Unsupported sprite: ${spriteKey}`);
  }
  const frameCount = view.getInt32(28, true);
  const paletteSize = view.getUint16(40, true);
  let offset = 42;
  const palette = [];
  for (let index = 0; index < paletteSize; index += 1) {
    palette.push([
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2)
    ]);
    offset += 3;
  }
  const frames = [];
  const transparent = paletteSize - 1;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameType = view.getInt32(offset, true);
    offset += 4;
    if (frameType !== 0) throw new Error(`Grouped sprite frame unsupported: ${spriteKey}`);
    offset += 8;
    const width = view.getInt32(offset, true);
    const height = view.getInt32(offset + 4, true);
    offset += 8;
    const pixels = width * height;
    if (width <= 0 || height <= 0 || offset + pixels > view.byteLength) {
      throw new Error(`Truncated sprite: ${spriteKey}`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(width, height);
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const paletteIndex = view.getUint8(offset + pixel);
      const color = palette[paletteIndex] || [255, 255, 255];
      const target = pixel * 4;
      image.data[target] = color[0];
      image.data[target + 1] = color[1];
      image.data[target + 2] = color[2];
      image.data[target + 3] = paletteIndex === transparent ? 0 : 255;
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    frames.push(texture);
    offset += pixels;
  }
  return frames;
}

function fallbackEffectTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (kind === "shockwave") {
    context.strokeStyle = "rgba(125,255,190,.95)";
    context.lineWidth = 10;
    context.beginPath();
    context.arc(64, 64, 34, 0, Math.PI * 2);
    context.stroke();
  } else {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,230,1)");
    gradient.addColorStop(.2, "rgba(255,220,92,.95)");
    gradient.addColorStop(.48, "rgba(251,113,36,.75)");
    gradient.addColorStop(1, "rgba(60,20,12,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ReplayProjectileVisuals {
  constructor(loader) {
    this.loader = loader;
    this.models = new Map();
    this.sprites = new Map();
    this.fallbackTextures = new Map();
  }

  async preload(recordedDefinitions) {
    const definitions = recordedDefinitions.map(replayProjectileDefinition);
    const models = new Set(definitions.map(
      definition => definition.assetModel || definition.models[0]
    ).filter(Boolean));
    const sprites = new Set([
      ...definitions.map(definition => definition.effect),
      ...(definitions.some(definition => definition.flare) ? ["animglow01"] : [])
    ]);
    await Promise.all([
      ...[...models].map(model => this.loadModel(model)),
      ...[...sprites].map(sprite => this.loadSprite(sprite))
    ]);
  }

  async loadModel(model) {
    const key = normalized(model);
    const path = MODEL_PATHS.get(key);
    if (!path) return null;
    if (!this.models.has(key)) {
      this.models.set(key, new Promise(resolve => {
        this.loader.load(`${path}?v=20260708projectilemodels1`, gltf => {
          const asset = gltf.scene || null;
          asset?.traverse(child => {
            if (child.isMesh) child.frustumCulled = false;
          });
          resolve(asset);
        }, undefined, () => resolve(null));
      }));
    }
    const asset = await this.models.get(key);
    this.models.set(key, asset);
    return asset;
  }

  async loadSprite(key) {
    if (!SPRITE_PATHS.has(key)) return null;
    if (!this.sprites.has(key)) {
      this.sprites.set(key, fetch(`${SPRITE_PATHS.get(key)}?v=20260709spr1`)
        .then(response => response.ok ? response.arrayBuffer() : null)
        .then(buffer => buffer ? parseSprite(buffer, key) : null)
        .catch(() => null));
    }
    const frames = await this.sprites.get(key);
    this.sprites.set(key, frames);
    return frames;
  }

  projectile(definition) {
    const modelKey = normalized(definition.assetModel || definition.models[0]);
    const asset = this.models.get(modelKey);
    const visual = asset && typeof asset.then !== "function"
      ? asset.clone(true)
      : fallbackMesh(definition);
    if (definition.flare) {
      const flare = this.sprite("animglow01", 0xffd166);
      flare.name = "rocketflare";
      flare.position.set(-30, 0, 0);
      flare.scale.set(56, 56, 1);
      visual.add(flare);
    }
    return visual;
  }

  sprite(key, color = 0xffffff) {
    const frames = this.sprites.get(key);
    const loaded = Array.isArray(frames) && frames.length ? frames : null;
    if (!this.fallbackTextures.has(key)) {
      this.fallbackTextures.set(key, fallbackEffectTexture(key === "shockwave" ? "shockwave" : "explode"));
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: loaded?.[0] || this.fallbackTextures.get(key),
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    sprite.userData.frames = loaded || [];
    return sprite;
  }

  shockwave(key, color) {
    const frames = this.sprites.get(key);
    const loaded = Array.isArray(frames) && frames.length ? frames : null;
    if (!this.fallbackTextures.has(key)) {
      this.fallbackTextures.set(key, fallbackEffectTexture("shockwave"));
    }
    const visual = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 36, 1, true),
      new THREE.MeshBasicMaterial({
        map: loaded?.[0] || this.fallbackTextures.get(key),
        color,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    visual.userData.frames = loaded || [];
    return visual;
  }

  impact(definition, position, start) {
    const color = definition.impact === "conc"
      ? 0xb8ffd8
      : definition.impact === "mirvlet" ? 0xffb066 : 0xffffff;
    const isShockwave = definition.impact === "conc";
    const visual = isShockwave
      ? this.shockwave(definition.effect, color)
      : this.sprite(definition.effect, color);
    const group = new THREE.Group();
    group.add(visual);
    group.position.copy(position);
    if (isShockwave) group.position.y += 18;
    group.visible = false;
    return {
      group,
      visual,
      isShockwave,
      start,
      duration: definition.impact === "mirv" || definition.impact === "conc" ? 0.75 : 0.46,
      maxSize: definition.impact === "mirv" ? 250 : definition.impact === "conc" ? 170 : 150
    };
  }

  updateImpact(impact, playbackTime) {
    const age = playbackTime - impact.start;
    if (age < 0 || age > impact.duration) {
      impact.group.visible = false;
      return;
    }
    const progress = age / impact.duration;
    const size = THREE.MathUtils.lerp(42, impact.maxSize, 1 - ((1 - progress) ** 2));
    impact.group.visible = true;
    if (impact.isShockwave) {
      const height = THREE.MathUtils.lerp(27, 66, progress);
      impact.visual.scale.set(size, height, size);
      impact.visual.position.y = height * 0.5 + 21 * progress;
    } else {
      impact.visual.scale.set(size, size, 1);
      impact.visual.material.rotation = -1.4 * progress;
    }
    impact.visual.material.opacity = 0.95 * (1 - progress);
    const frames = impact.visual.userData.frames;
    if (frames.length) {
      const frame = frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))];
      if (impact.visual.material.map !== frame) {
        impact.visual.material.map = frame;
        impact.visual.material.needsUpdate = true;
      }
    }
  }

  rotate(mesh, definition, yaw, playbackTime) {
    const base = definition.rotation || [0, 0, 0];
    mesh.rotation.set(
      THREE.MathUtils.degToRad(base[0]),
      THREE.MathUtils.degToRad(yaw + (definition.yawOffset || 0) + base[1]),
      THREE.MathUtils.degToRad(base[2])
    );
    if (definition.key !== "rocket") {
      const spin = playbackTime * (definition.spinSpeed || 1.2);
      mesh.rotation[definition.spinAxis || "y"] += spin;
    }
    const flare = mesh.getObjectByName?.("rocketflare");
    const frames = flare?.userData?.frames || [];
    if (frames.length) {
      const frame = frames[Math.floor((playbackTime * 12) % frames.length)];
      if (flare.material.map !== frame) {
        flare.material.map = frame;
        flare.material.needsUpdate = true;
      }
    }
  }
}
