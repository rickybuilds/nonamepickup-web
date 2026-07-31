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

function rows(text, callback) {
  const firstBreak = text.indexOf("\n");
  if (firstBreak < 0) return;
  const headers = csvFields(text.slice(0, firstBreak).replace(/\r$/, ""));
  const index = Object.fromEntries(headers.map((name, position) => [name, position]));
  let start = firstBreak + 1;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    if (end > start) callback(csvFields(text.slice(start, end).replace(/\r$/, "")), index);
    start = end + 1;
  }
}

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

async function loadPlayers(url) {
  const tracks = new Map();
  rows(await text(url), (cols, i) => {
    const sessionId = number(cols[i.session_id]);
    if (!tracks.has(sessionId)) tracks.set(sessionId, []);
    tracks.get(sessionId).push(
      number(cols[i.time_ms]) / 1000,
      number(cols[i.x]), number(cols[i.y]), number(cols[i.z]),
      number(cols[i.vx]), number(cols[i.vy]), number(cols[i.vz]),
      number(cols[i.pitch]), number(cols[i.yaw]), number(cols[i.roll]),
      number(cols[i.alive]), number(cols[i.team]), number(cols[i.class]),
      number(cols[i.weapon]), number(cols[i.buttons]),
      number(cols[i.health]), number(cols[i.armor])
    );
  });
  return [...tracks].map(([sessionId, values]) => ({
    sessionId,
    stride: 17,
    frames: new Float32Array(values)
  }));
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
    self.postMessage({ type: "progress", label: "Loading roster…" });
    const roster = await loadRoster(files.roster);
    self.postMessage({ type: "progress", label: "Loading player snapshots…" });
    const players = await loadPlayers(files.players);
    self.postMessage({ type: "progress", label: "Loading projectile telemetry…" });
    const projectileDefinitions = await loadProjectileDefinitions(files.projectileDefs);
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
