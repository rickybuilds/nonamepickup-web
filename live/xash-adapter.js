import { loadGameAssets, mountGameAssets } from "./asset-loader.js?v=20260826t";
import { LOCAL_MASTER_ADDRESS, UdpWebSocketRelay, installSockfsRelayBridge } from "./udp-relay.js?v=20260827p";
import { installTouchKeyboard } from "./touch-keyboard.js?v=20260827c";

const CONFIG_STORAGE_KEY = "tfc-config";

function restoreConfig(fs) {
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (saved) fs.writeFile("/rodir/tfc/config.cfg", new TextEncoder().encode(saved));
  } catch {
    // Browser storage may be disabled; the in-memory configuration still works.
  }
}

function ensureDownloadConfig(fs) {
  // The browser client cannot use the normal GoldSrc download dialog. Keep
  // automatic downloads enabled for resources advertised by an HLTV proxy.
  // sv_downloadurl itself remains an HLDS server setting.
  try {
    const configPath = "/rodir/tfc/config.cfg";
    let existing = "";
    try { existing = new TextDecoder().decode(fs.readFile(configPath)); } catch {}
    const missing = [
      ["cl_allowdownload", "cl_allowdownload 1"],
      ["cl_download_ingame", "cl_download_ingame 1"],
      ["cl_downloadfilter", "cl_downloadfilter all"]
    ].filter(([name]) => !new RegExp(`^\\s*${name}\\b`, "mi").test(existing))
      .map(([, line]) => line);
    if (missing.length) {
      const separator = existing && !existing.endsWith("\n") ? "\n" : "";
      fs.writeFile(configPath, new TextEncoder().encode(existing + separator + missing.join("\n") + "\n"));
    }
  } catch {
    // A read-only or unusual runtime filesystem should not block spectator startup.
  }
}

function ensureFavoriteServers(fs, servers) {
  try {
    const path = "/rodir/tfc/favorite_servers.lst";
    let existing = "";
    try { existing = new TextDecoder().decode(fs.readFile(path)); } catch {}
    const entries = existing.split(/\s+/).filter(Boolean);
    const known = new Set();
    for (let index = 0; index + 1 < entries.length; index += 2) {
      known.add(`${entries[index]} ${entries[index + 1]}`);
    }
    const defaults = Object.values(servers || {})
      .filter(server => server?.available && server.host && server.port)
      .map(server => `${server.host}:${server.port} 49`)
      .filter(entry => !known.has(entry));
    if (!defaults.length) return;
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    fs.writeFile(path, new TextEncoder().encode(existing + separator + defaults.join("\n") + "\n"));
  } catch {
    // A read-only runtime filesystem should not prevent the spectator from starting.
  }
}

function saveConfig(fs) {
  try {
    const data = fs.readFile("/rodir/tfc/config.cfg");
    localStorage.setItem(CONFIG_STORAGE_KEY, new TextDecoder().decode(data));
  } catch {
    // Config may not exist yet during early startup or private browsing.
  }
}

function ensureEngineShape(engine) {
  for (const method of ["init", "main", "Cmd_ExecuteString"]) {
    if (typeof engine?.[method] !== "function") {
      throw new Error(`The Xash3D runtime is missing ${method}().`);
    }
  }
}

function installExtraMouseBindings(engine) {
  const bindings = { 3: "MOUSE4", 4: "MOUSE5" };
  const actions = { MOUSE4: "+gren1", MOUSE5: "+gren2" };
  const active = new Set();
  for (const [button, key] of Object.entries(bindings)) {
    const action = actions[key];
    try { engine.Cmd_ExecuteString(`bind ${key} "${action}"`); } catch {}
    const buttonNumber = Number(button);
    window.addEventListener("mousedown", event => {
      if (event.button !== buttonNumber) return;
      event.preventDefault();
      if (active.has(key)) return;
      active.add(key);
      engine.Cmd_ExecuteString(action);
    }, { capture: true });
    window.addEventListener("mouseup", event => {
      if (event.button !== buttonNumber) return;
      event.preventDefault();
      if (!active.delete(key)) return;
      engine.Cmd_ExecuteString(`-${action.slice(1)}`);
    }, { capture: true });
    window.addEventListener("auxclick", event => {
      if (event.button === buttonNumber) event.preventDefault();
    }, { capture: true });
  }
  window.addEventListener("blur", () => {
    for (const key of active) engine.Cmd_ExecuteString(`-${actions[key].slice(1)}`);
    active.clear();
  });
}

function installSpectatorMovementBindings(engine) {
  const bindings = {
    w: "+forward",
    a: "+moveleft",
    s: "+back",
    d: "+moveright"
  };
  for (const [key, command] of Object.entries(bindings)) {
    engine.Cmd_ExecuteString(`bind "${key}" "${command}"`);
  }
}

function isExpectedRelayServerListWarning(message, servers) {
  const match = String(message || "").match(/Warning: unexpected server list packet from (\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
  if (!match) return false;
  const host = match[1];
  const port = Number(match[2]);
  return Object.values(servers || {}).some(server => server.host === host && server.port === port);
}

function viewportSize() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  return { w, h };
}

function renderSize() {
  const { w, h } = viewportSize();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return {
    width: Math.max(1, Math.floor(w * dpr)),
    height: Math.max(1, Math.floor(h * dpr))
  };
}

function videoModeSize() {
  const { w, h } = viewportSize();
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

function touchModeEnabled() {
  const requested = new URLSearchParams(location.search).get("touch");
  return requested === "1" || (requested !== "0" && navigator.maxTouchPoints > 0 && matchMedia("(hover: none)").matches);
}

export function sizeCanvas(canvas, resizeBuffer = false) {
  const { w, h } = viewportSize();
  if (resizeBuffer) {
    const { width, height } = renderSize();
    canvas.width = width;
    canvas.height = height;
  }
  canvas.style.setProperty("width", `${w}px`, "important");
  canvas.style.setProperty("height", `${h}px`, "important");
}

export async function runtimeAvailable(runtimeModule) {
  try {
    const response = await fetch(runtimeModule, { method: "HEAD", cache: "no-store" });
    const contentType = String(response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();

    // The production static host serves /live/index.html as a 200 fallback for
    // unknown /live/* paths. A status-only probe therefore reports a missing
    // runtime as ready. Native module imports require a JavaScript MIME type,
    // so use the same requirement here before enabling the launch button.
    return response.ok && /(?:javascript|ecmascript)$/.test(contentType);
  } catch {
    return false;
  }
}

export async function createXashClient({ canvas, config, server, onStatus = () => {} }) {
  // Match the WebGL render buffer to the visible viewport before SDL creates
  // its context. Resizing only the CSS box leaves HTML's 300x150 canvas
  // default in place, producing a heavily enlarged and cropped-looking view.
  sizeCanvas(canvas, true);
  onStatus("Loading the Xash3D WebAssembly runtime…");
  let runtime;
  try {
    runtime = await import(config.runtimeModule);
  } catch (cause) {
    throw new Error("The Xash3D WASM runtime has not been deployed yet.", { cause });
  }
  const Xash3D = runtime.Xash3D || runtime.default;

  if (typeof Xash3D !== "function") {
    throw new Error("The runtime module does not export Xash3D.");
  }

  let engine;
  const spectatorCommandTimers = new Set();
  const scheduleSpectatorCommand = () => {
    if (!config.spectatorCommand) return;
    for (const offset of [0, 3000, 6000]) {
      const timer = window.setTimeout(() => {
        spectatorCommandTimers.delete(timer);
        engine?.Cmd_ExecuteString(config.spectatorCommand);
      }, config.spectatorDelayMs + offset);
      spectatorCommandTimers.add(timer);
    }
  };

  onStatus("Opening the TFC UDP relay…");
  const relay = new UdpWebSocketRelay(
    runtime.Net,
    config.relayPath,
    server,
    config.servers,
    config.playerPassword,
    scheduleSpectatorCommand
  );
  await relay.open();
  const restoreWebSocket = installSockfsRelayBridge(config.relayPath, config.servers);

  const resolve = value => new URL(value, location.href).href;
  const [gameFiles, extrasResponse, valveExtrasResponse] = await Promise.all([
    loadGameAssets(config.gameAssetsManifest, onStatus),
    fetch(resolve(config.extrasArchive), { cache: "force-cache" }),
    config.valveExtrasArchive ? fetch(resolve(config.valveExtrasArchive), { cache: "force-cache" }) : Promise.resolve(null)
  ]);
  if (!extrasResponse.ok) throw new Error("The TF15 client asset archive is unavailable.");
  const extras = new Uint8Array(await extrasResponse.arrayBuffer());
  const valveExtras = valveExtrasResponse && valveExtrasResponse.ok
    ? new Uint8Array(await valveExtrasResponse.arrayBuffer())
    : null;

  onStatus("Starting Xash3D…");
  const browserAlert = window.alert;
  window.alert = message => {
    const text = String(message || "");
    if (text.includes("addons/metamod/dlls/metamod_emscripten_wasm32.wasm")) {
      console.info("[live/xash] skipped the server-only Metamod module.");
      return;
    }
    console.warn("[live/xash alert]", message);
  };

  const filesystem = resolve(config.runtimeLibraries.filesystem);
  engine = new Xash3D({
    canvas,
    renderer: "gles3compat",
    arguments: ["-windowed", "-game", config.gameDirectory],
    filesMap: {
      "/rodir/filesystem_stdio.wasm": filesystem
    },
    libraries: {
      xash: resolve(config.runtimeLibraries.xash),
      filesystem,
      menu: resolve(config.runtimeLibraries.menu),
      client: resolve(config.runtimeLibraries.client),
      // TFC has no in-browser server library. Keep Host_Main from preloading
      // dlls/hl_emscripten_wasm32.wasm (or a mismatched tfc_*.wasm).
      server: null,
      render: {
        gles3compat: resolve(config.runtimeLibraries.renderer)
      }
    },
    module: {
      print(message) {
        // The native menu keeps refreshing Favorites behind the game. Our
        // local master response is intentionally sourced from an allowlisted
        // HLTV endpoint, which Xash labels "unexpected" even though it is the
        // response requested by this browser adapter.
        if (isExpectedRelayServerListWarning(message, config.servers)) return;
        console.info("[live/xash]", message);
      },
      printErr(message) {
        console.error("[live/xash]", message);
      },
      callbacks: {
        gameReady() {
          if (!touchModeEnabled()) return;
          engine?.Cmd_ExecuteString("touch_enable 1");
          engine?.Cmd_ExecuteString("osk_enable 0");
          engine?.Cmd_ExecuteString("con_fontscale 1.8");
        }
      },
      // Override the wrapper default so the HL server dylib is not preloaded.
      dynamicLibraries: [
        "filesystem_stdio.wasm",
        "libref_webgl2.wasm",
        "cl_dlls/menu_emscripten_wasm32.wasm",
        "cl_dlls/client_emscripten_wasm32.wasm",
        "/rodir/filesystem_stdio.wasm"
      ]
    }
  });
  engine.net = relay.net;

  ensureEngineShape(engine);
  let abortError = null;
  let gameFs = null;
  const onAbort = event => {
    abortError = event.reason instanceof Error ? event.reason : new Error(String(event.reason || "wasm abort"));
  };
  window.addEventListener("unhandledrejection", onAbort);
  try {
    await engine.init();
    gameFs = engine.em?.FS || engine.em?.Module?.FS;
    if (!gameFs) throw new Error("The Xash3D runtime did not expose a filesystem.");
    mountGameAssets(gameFs, gameFiles, extras, valveExtras);
    restoreConfig(gameFs);
    ensureDownloadConfig(gameFs);
    ensureFavoriteServers(gameFs, config.servers);
    if (!engine.running) engine.main();
    await new Promise(resolveReady => window.setTimeout(resolveReady, 250));
    if (engine.exited || abortError) {
      throw abortError || new Error("The Xash3D engine exited while loading the TFC client.");
    }
  } catch (cause) {
    const detail = String(cause?.message || cause || "");
    if (!detail || detail === "Infinity") {
      throw new Error("The TFC client aborted while starting Xash3D.", { cause });
    }
    throw cause;
  } finally {
    window.removeEventListener("unhandledrejection", onAbort);
  }
  await new Promise(resolveReady => window.setTimeout(resolveReady, 750));

  const touchEnabled = touchModeEnabled();
  // Some desktop browser shells report touch points even when the user is
  // using a mouse. Keep the native Xash touch HUD opt-in so it cannot cover
  // the spectator view unexpectedly; mobile users can use ?touch=1.
  engine.Cmd_ExecuteString(`touch_enable ${touchEnabled ? 1 : 0}`);
  if (touchEnabled) {
    engine.Cmd_ExecuteString("osk_enable 0");
    engine.Cmd_ExecuteString("con_fontscale 1.8");
  }

  // Xash applies the saved GoldSrc video mode while Host_Main starts. That
  // resets WebGL's viewport to 640x480 even though the canvas CSS fills the
  // page. Ask Xash/SDL to change modes so the renderer, drawing buffer, and
  // HUD all agree on the browser viewport.
  let activeVideoMode = "";
  const applyVideoMode = () => {
    sizeCanvas(canvas);
    // SDL applies devicePixelRatio when it creates the WebGL drawing buffer.
    // Pass CSS viewport pixels here so the scale is applied exactly once.
    const { width, height } = videoModeSize();
    const mode = `${width}x${height}`;
    if (mode === activeVideoMode) return;
    activeVideoMode = mode;
    engine.Cmd_ExecuteString(`vid_setmode ${width} ${height}`);
    console.info(`[live/xash] video mode ${mode}`);
  };
  applyVideoMode();
  onStatus("Xash3D is ready.");
  // The native menu validates the source of every master response before it
  // parses the server list. Register the adapter's local virtual master so the
  // in-game console does not label its Favorites response as unexpected.
  engine.Cmd_ExecuteString("clearmasters");
  engine.Cmd_ExecuteString(`addmaster ${LOCAL_MASTER_ADDRESS} gs`);
  installExtraMouseBindings(engine);
  installSpectatorMovementBindings(engine);
  // Apply the launcher choice once. Native Configuration changes made after
  // this point remain authoritative and are persisted in config.cfg.
  engine.Cmd_ExecuteString(`name \"${config.playerName.replaceAll('"', "")}\"`);
  if (touchEnabled) {
    installTouchKeyboard({ command: value => engine.Cmd_ExecuteString(String(value || "")) });
  }

  const persistConfig = () => saveConfig(gameFs);
  const configSaveTimer = window.setInterval(persistConfig, 20_000);
  window.addEventListener("beforeunload", persistConfig);

  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyVideoMode, 120);
  };
  const onViewportScroll = () => sizeCanvas(canvas);
  window.addEventListener("resize", onResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onResize);
    window.visualViewport.addEventListener("scroll", onViewportScroll);
  }

  return {
    connect(server) {
      const address = `${server.host}:${server.port}`;
      console.info(`[live/xash] connecting to ${address}`);
      const executeConnect = () => {
        engine.Cmd_ExecuteString(`password \"${config.playerPassword.replaceAll('"', "")}\"`);
        engine.Cmd_ExecuteString(`connect ${address}`);
      };

      executeConnect();

    },

    command(value) {
      engine.Cmd_ExecuteString(String(value || ""));
    },

    quit() {
      persistConfig();
      for (const timer of spectatorCommandTimers) window.clearTimeout(timer);
      spectatorCommandTimers.clear();
      window.clearInterval(configSaveTimer);
      window.removeEventListener("beforeunload", persistConfig);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", onResize);
        window.visualViewport.removeEventListener("scroll", onViewportScroll);
      }
      relay.close();
      restoreWebSocket();
      window.alert = browserAlert;
      if (typeof engine.quit === "function") engine.quit();
    }
  };
}
