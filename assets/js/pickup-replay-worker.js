function csvFields(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === "\"") {
        if (line[i + 1] === "\"") {
          value += "\"";
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      fields.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  fields.push(value);
  return fields;
}

async function rows(url, callback, expectedHeaders = null) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Telemetry request failed (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming telemetry is unavailable.");
  const decoder = new TextDecoder();
  let pending = "";
  let headers = null;
  let index = null;
  let rowNumber = 0;
  const consume = line => {
    const fields = csvFields(line.replace(/\r$/, ""));
    if (!headers) {
      headers = fields;
      if (expectedHeaders &&
          (headers.length !== expectedHeaders.length || headers.some((name, position) => name !== expectedHeaders[position]))) {
        throw new Error("Telemetry CSV header does not match its replay schema.");
      }
      index = Object.fromEntries(headers.map((name, position) => [name, position]));
      return;
    }
    if (fields.length !== headers.length) throw new Error(`Telemetry CSV row ${rowNumber + 1} has the wrong width.`);
    if (line.length) callback(fields, index);
    rowNumber += 1;
  };
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary;
    while ((boundary = pending.indexOf("\n")) >= 0) {
      consume(pending.slice(0, boundary));
      pending = pending.slice(boundary + 1);
    }
    if (done) break;
  }
  if (pending) consume(pending);
  if (!headers) throw new Error("Telemetry CSV is empty.");
}

function validateHeaders(headers, expectedHeaders) {
  if (expectedHeaders &&
      (headers.length !== expectedHeaders.length || headers.some((name, index) => name !== expectedHeaders[index]))) {
    throw new Error("Telemetry CSV header does not match its replay schema.");
  }
}

const PLAYERS_V2_COLUMNS = [
  "snapshot", "time_ms", "session_id", "slot", "alive", "team", "class",
  "goalitem_flags", "weapon", "buttons", "health", "armor", "x", "y", "z",
  "vx", "vy", "vz", "pitch", "yaw", "roll"
];
const PLAYERS_V3_COLUMNS = [...PLAYERS_V2_COLUMNS,
  "ducking", "oldbuttons", "player_model_id", "weapon_model_id", "body", "skin",
  "sequence", "gaitsequence", "frame", "framerate", "animtime", "body_pitch",
  "body_yaw", "body_roll", "controller0", "controller1", "controller2", "controller3",
  "blending0", "blending1"
];

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

class Float32Builder {
  constructor(chunkSize = 65536) {
    this.chunkSize = chunkSize;
    this.chunks = [];
    this.current = new Float32Array(chunkSize);
    this.offset = 0;
    this.length = 0;
  }

  push(...values) {
    for (const value of values) {
      if (this.offset === this.current.length) {
        this.chunks.push(this.current);
        this.current = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
      this.current[this.offset++] = value;
      this.length += 1;
    }
  }

  finish() {
    const output = new Float32Array(this.length);
    let target = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, target);
      target += chunk.length;
    }
    output.set(this.current.subarray(0, this.offset), target);
    this.chunks = [];
    this.current = new Float32Array(0);
    return output;
  }
}

async function loadRoster(url) {
  const output = [];
  await rows(url, (cols, i) => {
    output.push({
      sessionId: number(cols[i.session_id]),
      slot: number(cols[i.slot]),
      userid: number(cols[i.userid]),
      steamid: cols[i.steamid] || "",
      name: cols[i.name] || "Unknown",
      team: number(cols[i.initial_team]),
      isBot: number(cols[i.is_bot]) === 1,
      joinedMs: number(cols[i.joined_ms])
    });
  });
  return output;
}

async function loadRenderModels(url) {
  const models = [];
  const seen = new Set();
  await rows(url, (cols, i) => {
    const modelId = number(cols[i.model_id]);
    const kind = cols[i.kind];
    const modelPath = cols[i.path] || "";
    if (!Number.isSafeInteger(modelId) || modelId < 1 || seen.has(modelId) ||
        !["player", "weapon", "projectile", "objective", "buildable"].includes(kind) ||
        modelPath.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(modelPath) || /^[a-z]:/i.test(modelPath) ||
        modelPath.replace(/\\/g, "/").split("/").some(part => !part || part === "." || part === "..") ||
        !/^models\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.mdl$/i.test(modelPath.replace(/\\/g, "/"))) {
      throw new Error("Invalid render model dictionary.");
    }
    seen.add(modelId);
    models.push({ modelId, kind, path: modelPath.replace(/\\/g, "/").toLowerCase(), firstSeenMs: number(cols[i.first_seen_ms]) });
  }, ["model_id", "kind", "path", "first_seen_ms"]);
  return models;
}

async function loadPlayers(url, schemaVersion, renderModels) {
  const tracks = new Map();
  const models = new Map(renderModels.map(model => [model.modelId, model]));
  await rows(url, (cols, i) => {
    const sessionId = number(cols[i.session_id]);
    if (!tracks.has(sessionId)) tracks.set(sessionId, new Float32Builder());
    const values = [
      number(cols[i.time_ms]) / 1000,
      number(cols[i.x]), number(cols[i.y]), number(cols[i.z]),
      number(cols[i.vx]), number(cols[i.vy]), number(cols[i.vz]),
      number(cols[i.pitch]), number(cols[i.yaw]), number(cols[i.roll]),
      number(cols[i.alive]), number(cols[i.team]), number(cols[i.class]),
      number(cols[i.weapon]), number(cols[i.buttons]),
      number(cols[i.health]), number(cols[i.armor])
    ];
    if (schemaVersion >= 3) {
      const playerModelId = number(cols[i.player_model_id]);
      const weaponModelId = number(cols[i.weapon_model_id]);
      for (const [id, kind] of [[playerModelId, "player"], [weaponModelId, "weapon"]]) {
        if (!Number.isSafeInteger(id) || id < 0 || (id !== 0 && models.get(id)?.kind !== kind)) {
          throw new Error("Player snapshot references an invalid render model.");
        }
      }
      values.push(
        number(cols[i.ducking]), number(cols[i.oldbuttons]), playerModelId, weaponModelId,
        number(cols[i.body]), number(cols[i.skin]), number(cols[i.sequence]),
        number(cols[i.gaitsequence]), number(cols[i.frame]), number(cols[i.framerate]),
        number(cols[i.animtime]), number(cols[i.body_pitch]), number(cols[i.body_yaw]),
        number(cols[i.body_roll]), number(cols[i.controller0]), number(cols[i.controller1]),
        number(cols[i.controller2]), number(cols[i.controller3]), number(cols[i.blending0]),
        number(cols[i.blending1])
      );
    }
    tracks.get(sessionId).push(...values);
  }, schemaVersion === 2 ? PLAYERS_V2_COLUMNS : PLAYERS_V3_COLUMNS);
  return [...tracks].map(([sessionId, values]) => ({
    sessionId,
    schemaVersion,
    stride: schemaVersion >= 3 ? 37 : 17,
    frames: values.finish()
  }));
}

function playerWeaponAt(players, sessionId, timeSeconds) {
  const track = players.find(candidate => candidate.sessionId === sessionId);
  if (!track?.frames?.length) return 0;
  const { frames, stride } = track;
  const count = Math.floor(frames.length / stride);
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle * stride] <= timeSeconds) low = middle;
    else high = middle - 1;
  }
  let offset = low * stride;
  const nextOffset = Math.min(count - 1, low + 1) * stride;
  if (
    nextOffset !== offset &&
    Math.abs(frames[nextOffset] - timeSeconds) < Math.abs(frames[offset] - timeSeconds)
  ) {
    offset = nextOffset;
  }
  return Math.round(frames[offset + 13] || 0);
}

async function loadProjectileDefinitions(url, schemaVersion, renderModels) {
  const definitions = [];
  const models = new Map(renderModels.map(model => [model.modelId, model]));
  const expected = schemaVersion === 2
    ? ["projectile_id", "entity", "owner_session", "classname", "model", "spawned_ms"]
    : ["projectile_id", "entity", "owner_session", "classname", "model_id", "spawned_ms"];
  await rows(url, (cols, i) => {
    const modelId = schemaVersion >= 3 ? number(cols[i.model_id]) : 0;
    definitions.push({
      projectileId: number(cols[i.projectile_id]),
      ownerSession: number(cols[i.owner_session]),
      classname: cols[i.classname] || "",
      modelId,
      model: schemaVersion >= 3 ? (models.get(modelId)?.path || "") : (cols[i.model] || ""),
      spawnedMs: number(cols[i.spawned_ms])
    });
  }, expected);
  return definitions;
}

async function loadProjectiles(url) {
  const tracks = new Map();
  await rows(url, (cols, i) => {
    const projectileId = number(cols[i.projectile_id]);
    if (!tracks.has(projectileId)) tracks.set(projectileId, new Float32Builder());
    tracks.get(projectileId).push(
      number(cols[i.time_ms]) / 1000,
      number(cols[i.state]),
      number(cols[i.x]), number(cols[i.y]), number(cols[i.z]),
      number(cols[i.vx]), number(cols[i.vy]), number(cols[i.vz]),
      number(cols[i.pitch]), number(cols[i.yaw]), number(cols[i.roll])
    );
  });
  return [...tracks].map(([projectileId, values]) => ({
    projectileId,
    stride: 11,
    frames: values.finish()
  }));
}

async function loadObjectiveDefinitions(url, schemaVersion, renderModels) {
  const definitions = [];
  const models = new Map(renderModels.map(model => [model.modelId, model]));
  const expected = schemaVersion === 2
    ? ["objective_id", "entity", "classname", "model", "targetname", "base_x", "base_y", "base_z", "base_yaw", "first_seen_ms"]
    : ["objective_id", "entity", "classname", "model_id", "targetname", "base_x", "base_y", "base_z", "base_yaw", "first_seen_ms"];
  await rows(url, (cols, i) => {
    const modelId = schemaVersion >= 3 ? number(cols[i.model_id]) : 0;
    definitions.push({
      objectiveId: number(cols[i.objective_id]),
      classname: cols[i.classname] || "",
      modelId,
      model: schemaVersion >= 3 ? (models.get(modelId)?.path || "") : (cols[i.model] || ""),
      targetname: cols[i.targetname] || "",
      baseX: number(cols[i.base_x]),
      baseY: number(cols[i.base_y]),
      baseZ: number(cols[i.base_z]),
      baseYaw: number(cols[i.base_yaw]),
      firstSeenMs: number(cols[i.first_seen_ms])
    });
  }, expected);
  return definitions;
}

async function loadObjectives(url) {
  const tracks = new Map();
  await rows(url, (cols, i) => {
    const objectiveId = number(cols[i.objective_id]);
    if (!tracks.has(objectiveId)) tracks.set(objectiveId, new Float32Builder());
    tracks.get(objectiveId).push(
      number(cols[i.time_ms]) / 1000,
      number(cols[i.state]), number(cols[i.carrier_session]),
      number(cols[i.solid]), number(cols[i.effects]),
      number(cols[i.x]), number(cols[i.y]), number(cols[i.z]), number(cols[i.yaw])
    );
  });
  return [...tracks].map(([objectiveId, values]) => ({
    objectiveId,
    stride: 9,
    frames: values.finish()
  }));
}

const BUILDABLE_DEFS_COLUMNS = [
  "buildable_id", "entity", "kind", "classname", "initial_owner_session", "first_seen_ms"
];
const BUILDABLES_COLUMNS = [
  "snapshot", "time_ms", "buildable_id", "entity", "active", "owner_session", "owner_entity", "team",
  "model_id", "colormap", "movetype", "solid", "effects", "health", "x", "y", "z", "vx", "vy", "vz",
  "pitch", "yaw", "roll", "body", "skin", "sequence", "gaitsequence", "frame", "framerate", "animtime",
  "scale", "rendermode", "renderamt", "renderfx", "render_r", "render_g", "render_b", "controller0",
  "controller1", "controller2", "controller3", "blending0", "blending1", "aiment"
];

async function loadBuildableDefinitions(url) {
  const definitions = [];
  const seen = new Set();
  await rows(url, (cols, i) => {
    const buildableId = number(cols[i.buildable_id]);
    const kind = cols[i.kind] || "";
    if (!Number.isSafeInteger(buildableId) || buildableId < 1 || seen.has(buildableId) ||
        !["sentry", "dispenser", "building"].includes(kind)) {
      throw new Error("Invalid buildable definition.");
    }
    seen.add(buildableId);
    definitions.push({
      buildableId,
      entity: number(cols[i.entity]),
      kind,
      classname: cols[i.classname] || "",
      initialOwnerSession: number(cols[i.initial_owner_session]),
      firstSeenMs: number(cols[i.first_seen_ms])
    });
  }, BUILDABLE_DEFS_COLUMNS);
  return definitions;
}

async function loadBuildables(url, definitions, renderModels) {
  const tracks = new Map();
  const ids = new Set(definitions.map(definition => definition.buildableId));
  const models = new Map(renderModels.map(model => [model.modelId, model]));
  await rows(url, (cols, i) => {
    const buildableId = number(cols[i.buildable_id]);
    const modelId = number(cols[i.model_id]);
    if (!ids.has(buildableId) || !Number.isSafeInteger(modelId) || modelId < 0 ||
        (modelId !== 0 && models.get(modelId)?.kind !== "buildable")) {
      throw new Error("Buildable state references an invalid definition or model.");
    }
    if (!tracks.has(buildableId)) tracks.set(buildableId, new Float32Builder());
    tracks.get(buildableId).push(
      number(cols[i.time_ms]) / 1000,
      number(cols[i.active]), number(cols[i.entity]), number(cols[i.owner_session]), number(cols[i.owner_entity]),
      number(cols[i.team]), modelId, number(cols[i.colormap]), number(cols[i.movetype]), number(cols[i.solid]),
      number(cols[i.effects]), number(cols[i.health]), number(cols[i.x]), number(cols[i.y]), number(cols[i.z]),
      number(cols[i.vx]), number(cols[i.vy]), number(cols[i.vz]), number(cols[i.pitch]), number(cols[i.yaw]),
      number(cols[i.roll]), number(cols[i.body]), number(cols[i.skin]), number(cols[i.sequence]),
      number(cols[i.gaitsequence]), number(cols[i.frame]), number(cols[i.framerate]), number(cols[i.animtime]),
      number(cols[i.scale]), number(cols[i.rendermode]), number(cols[i.renderamt]), number(cols[i.renderfx]),
      number(cols[i.render_r]), number(cols[i.render_g]), number(cols[i.render_b]), number(cols[i.controller0]),
      number(cols[i.controller1]), number(cols[i.controller2]), number(cols[i.controller3]),
      number(cols[i.blending0]), number(cols[i.blending1]), number(cols[i.aiment])
    );
  }, BUILDABLES_COLUMNS);
  return [...tracks].map(([buildableId, values]) => ({
    buildableId,
    stride: 42,
    frames: values.finish()
  }));
}

const BRUSH_DEFS_COLUMNS = [
  "brush_id", "entity", "classname", "model", "targetname", "target", "spawnflags", "first_seen_ms"
];
const BRUSHES_COLUMNS = [
  "snapshot", "time_ms", "brush_id", "active", "x", "y", "z", "vx", "vy", "vz",
  "pitch", "yaw", "roll", "avel_pitch", "avel_yaw", "avel_roll", "effects", "solid",
  "movetype", "rendermode", "renderamt", "renderfx", "render_r", "render_g", "render_b"
];
const BRUSH_CLASSES = new Set([
  "func_door", "func_door_rotating", "func_button", "func_rot_button", "func_plat",
  "func_platrot", "func_train", "func_tracktrain"
]);

async function loadBrushDefinitions(url) {
  const definitions = [];
  const seen = new Set();
  await rows(url, (cols, i) => {
    const brushId = number(cols[i.brush_id]);
    const classname = cols[i.classname] || "";
    const model = cols[i.model] || "";
    if (!Number.isSafeInteger(brushId) || brushId < 1 || seen.has(brushId) ||
        !BRUSH_CLASSES.has(classname) || !/^\*[1-9]\d*$/.test(model)) {
      throw new Error("Invalid brush definition.");
    }
    seen.add(brushId);
    definitions.push({
      brushId,
      entity: number(cols[i.entity]),
      classname,
      model,
      targetname: cols[i.targetname] || "",
      target: cols[i.target] || "",
      spawnflags: number(cols[i.spawnflags]),
      firstSeenMs: number(cols[i.first_seen_ms])
    });
  }, BRUSH_DEFS_COLUMNS);
  return definitions;
}

async function loadBrushes(url, definitions) {
  const tracks = new Map();
  const ids = new Set(definitions.map(definition => definition.brushId));
  await rows(url, (cols, i) => {
    const brushId = number(cols[i.brush_id]);
    if (!ids.has(brushId)) throw new Error("Brush state references an invalid definition.");
    if (!tracks.has(brushId)) tracks.set(brushId, new Float32Builder());
    tracks.get(brushId).push(
      number(cols[i.time_ms]) / 1000, number(cols[i.active]),
      number(cols[i.x]), number(cols[i.y]), number(cols[i.z]),
      number(cols[i.vx]), number(cols[i.vy]), number(cols[i.vz]),
      number(cols[i.pitch]), number(cols[i.yaw]), number(cols[i.roll]),
      number(cols[i.avel_pitch]), number(cols[i.avel_yaw]), number(cols[i.avel_roll]),
      number(cols[i.effects]), number(cols[i.solid]), number(cols[i.movetype]),
      number(cols[i.rendermode]), number(cols[i.renderamt]), number(cols[i.renderfx]),
      number(cols[i.render_r]), number(cols[i.render_g]), number(cols[i.render_b])
    );
  }, BRUSHES_COLUMNS);
  return [...tracks].map(([brushId, values]) => ({ brushId, stride: 23, frames: values.finish() }));
}

async function loadEvents(url) {
  const output = [];
  await rows(url, (cols, i) => {
    output.push({
      time: number(cols[i.time_ms]) / 1000,
      event: cols[i.event] || "event",
      actorSession: number(cols[i.actor_session]),
      targetSession: number(cols[i.target_session]),
      entity: number(cols[i.entity]),
      value1: number(cols[i.value1]),
      value2: number(cols[i.value2]),
      intValue1: number(cols[i.int_value1]),
      intValue2: number(cols[i.int_value2]),
      text: cols[i.text] || ""
    });
  });
  return output;
}

self.onmessage = async event => {
  try {
    const files = event.data.files;
    const schemaVersion = Number(event.data.schemaVersion);
    if (![2, 3, 4].includes(schemaVersion)) throw new Error("Unsupported replay schema version.");
    self.postMessage({ type: "progress", label: "Loading roster…" });
    const roster = await loadRoster(files.roster);
    const renderModels = schemaVersion >= 3 ? await loadRenderModels(files.renderModels) : [];
    self.postMessage({ type: "progress", label: "Loading player snapshots…" });
    const players = await loadPlayers(files.players, schemaVersion, renderModels);
    self.postMessage({ type: "progress", label: "Loading projectile telemetry…" });
    const projectileDefinitions = await loadProjectileDefinitions(files.projectileDefs, schemaVersion, renderModels);
    for (const definition of projectileDefinitions) {
      definition.ownerWeapon = playerWeaponAt(
        players,
        definition.ownerSession,
        definition.spawnedMs / 1000
      );
    }
    const projectiles = await loadProjectiles(files.projectiles);
    self.postMessage({ type: "progress", label: "Loading objectives and events…" });
    const objectiveDefinitions = await loadObjectiveDefinitions(files.objectiveDefs, schemaVersion, renderModels);
    const objectives = await loadObjectives(files.objectives);
    const buildableDefinitions = schemaVersion >= 3
      ? await loadBuildableDefinitions(files.buildableDefs) : [];
    const buildables = schemaVersion >= 3
      ? await loadBuildables(files.buildables, buildableDefinitions, renderModels) : [];
    const brushDefinitions = schemaVersion === 4 ? await loadBrushDefinitions(files.brushDefs) : [];
    const brushes = schemaVersion === 4 ? await loadBrushes(files.brushes, brushDefinitions) : [];
    const events = await loadEvents(files.events);
    const transfer = [
      ...players.map(track => track.frames.buffer),
      ...projectiles.map(track => track.frames.buffer),
      ...objectives.map(track => track.frames.buffer),
      ...buildables.map(track => track.frames.buffer),
      ...brushes.map(track => track.frames.buffer)
    ];
    self.postMessage({
      type: "complete",
      payload: {
        roster,
        renderModels,
        players,
        projectileDefinitions,
        projectiles,
        objectiveDefinitions,
        objectives,
        buildableDefinitions,
        buildables,
        brushDefinitions,
        brushes,
        events
      }
    }, transfer);
  } catch (error) {
    self.postMessage({ type: "error", error: error?.message || "Telemetry loading failed." });
  }
};
