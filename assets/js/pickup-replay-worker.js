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

function rows(text, callback, expectedHeaders = null) {
  const firstBreak = text.indexOf("\n");
  if (firstBreak < 0) return;
  const headers = csvFields(text.slice(0, firstBreak).replace(/\r$/, ""));
  if (expectedHeaders &&
      (headers.length !== expectedHeaders.length || headers.some((name, index) => name !== expectedHeaders[index]))) {
    throw new Error("Telemetry CSV header does not match its replay schema.");
  }
  const index = Object.fromEntries(headers.map((name, position) => [name, position]));
  let start = firstBreak + 1;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    if (end > start) callback(csvFields(text.slice(start, end).replace(/\r$/, "")), index);
    start = end + 1;
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

async function text(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Telemetry request failed (${response.status})`);
  return response.text();
}

async function loadRoster(url) {
  const output = [];
  rows(await text(url), (cols, i) => {
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
  rows(await text(url), (cols, i) => {
    const modelId = number(cols[i.model_id]);
    const kind = cols[i.kind];
    const modelPath = cols[i.path] || "";
    if (!Number.isSafeInteger(modelId) || modelId < 1 || (kind !== "player" && kind !== "weapon") ||
        modelPath.includes("\\") || modelPath.split("/").some(part => !part || part === "." || part === "..") ||
        !/^models\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.mdl$/i.test(modelPath)) {
      throw new Error("Invalid render model dictionary.");
    }
    models.push({ modelId, kind, path: modelPath, firstSeenMs: number(cols[i.first_seen_ms]) });
  }, ["model_id", "kind", "path", "first_seen_ms"]);
  return models;
}

async function loadPlayers(url, schemaVersion, renderModels) {
  const tracks = new Map();
  const models = new Map(renderModels.map(model => [model.modelId, model]));
  rows(await text(url), (cols, i) => {
    const sessionId = number(cols[i.session_id]);
    if (!tracks.has(sessionId)) tracks.set(sessionId, []);
    const values = [
      number(cols[i.time_ms]) / 1000,
      number(cols[i.x]), number(cols[i.y]), number(cols[i.z]),
      number(cols[i.vx]), number(cols[i.vy]), number(cols[i.vz]),
      number(cols[i.pitch]), number(cols[i.yaw]), number(cols[i.roll]),
      number(cols[i.alive]), number(cols[i.team]), number(cols[i.class]),
      number(cols[i.weapon]), number(cols[i.buttons]),
      number(cols[i.health]), number(cols[i.armor])
    ];
    if (schemaVersion === 3) {
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
    stride: schemaVersion === 3 ? 37 : 17,
    frames: new Float32Array(values)
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

async function loadProjectileDefinitions(url) {
  const definitions = [];
  rows(await text(url), (cols, i) => {
    definitions.push({
      projectileId: number(cols[i.projectile_id]),
      ownerSession: number(cols[i.owner_session]),
      classname: cols[i.classname] || "",
      model: cols[i.model] || "",
      spawnedMs: number(cols[i.spawned_ms])
    });
  });
  return definitions;
}

async function loadProjectiles(url) {
  const tracks = new Map();
  rows(await text(url), (cols, i) => {
    const projectileId = number(cols[i.projectile_id]);
    if (!tracks.has(projectileId)) tracks.set(projectileId, []);
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
    frames: new Float32Array(values)
  }));
}

async function loadObjectiveDefinitions(url) {
  const definitions = [];
  rows(await text(url), (cols, i) => {
    definitions.push({
      objectiveId: number(cols[i.objective_id]),
      classname: cols[i.classname] || "",
      model: cols[i.model] || "",
      targetname: cols[i.targetname] || "",
      baseX: number(cols[i.base_x]),
      baseY: number(cols[i.base_y]),
      baseZ: number(cols[i.base_z]),
      baseYaw: number(cols[i.base_yaw]),
      firstSeenMs: number(cols[i.first_seen_ms])
    });
  });
  return definitions;
}

async function loadObjectives(url) {
  const tracks = new Map();
  rows(await text(url), (cols, i) => {
    const objectiveId = number(cols[i.objective_id]);
    if (!tracks.has(objectiveId)) tracks.set(objectiveId, []);
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
    frames: new Float32Array(values)
  }));
}

async function loadEvents(url) {
  const output = [];
  rows(await text(url), (cols, i) => {
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
    if (schemaVersion !== 2 && schemaVersion !== 3) throw new Error("Unsupported replay schema version.");
    self.postMessage({ type: "progress", label: "Loading roster…" });
    const roster = await loadRoster(files.roster);
    const renderModels = schemaVersion === 3 ? await loadRenderModels(files.renderModels) : [];
    self.postMessage({ type: "progress", label: "Loading player snapshots…" });
    const players = await loadPlayers(files.players, schemaVersion, renderModels);
    self.postMessage({ type: "progress", label: "Loading projectile telemetry…" });
    const projectileDefinitions = await loadProjectileDefinitions(files.projectileDefs);
    for (const definition of projectileDefinitions) {
      definition.ownerWeapon = playerWeaponAt(
        players,
        definition.ownerSession,
        definition.spawnedMs / 1000
      );
    }
    const projectiles = await loadProjectiles(files.projectiles);
    self.postMessage({ type: "progress", label: "Loading objectives and events…" });
    const objectiveDefinitions = await loadObjectiveDefinitions(files.objectiveDefs);
    const objectives = await loadObjectives(files.objectives);
    const events = await loadEvents(files.events);
    const transfer = [
      ...players.map(track => track.frames.buffer),
      ...projectiles.map(track => track.frames.buffer),
      ...objectives.map(track => track.frames.buffer)
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
        events
      }
    }, transfer);
  } catch (error) {
    self.postMessage({ type: "error", error: error?.message || "Telemetry loading failed." });
  }
};
