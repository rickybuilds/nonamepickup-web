import { loadGameAssets, mountGameAssets } from "./asset-loader.js?v=20260826t";
import { UdpWebSocketRelay } from "./udp-relay.js?v=20260826z";

const CONFIG_STORAGE_KEY = "tfc-config";

function restoreConfig(fs) {
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (saved) fs.writeFile("/rodir/tfc/config.cfg", new TextEncoder().encode(saved));
  } catch {
    // Browser storage may be disabled; the in-memory configuration still works.
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

function viewportSize() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  return { w, h };
}

function renderSize() {
  const { w, h } = viewportSize();
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const rawWidth = w * dpr;
  const rawHeight = h * dpr;
  const downscale = Math.min(1, 1920 / rawWidth, 1080 / rawHeight);
  return {
    width: Math.max(640, Math.round(rawWidth * downscale)),
    height: Math.max(360, Math.round(rawHeight * downscale))
  };
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
  // Match the WebGL render buffer to the physical viewport before SDL creates
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

  onStatus("Opening the TFC UDP relay…");
  const relay = new UdpWebSocketRelay(runtime.Net, config.relayPath, server, config.servers);
  await relay.open();

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
  const engine = new Xash3D({
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
        console.info("[live/xash]", message);
      },
      printErr(message) {
        console.error("[live/xash]", message);
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

  // Xash applies the saved GoldSrc video mode while Host_Main starts. That
  // resets WebGL's viewport to 640x480 even though the canvas CSS fills the
  // page. Ask Xash/SDL to change modes so the renderer, drawing buffer, and
  // HUD all agree on the browser viewport.
  let activeVideoMode = "";
  const applyVideoMode = () => {
    sizeCanvas(canvas);
    const { width, height } = renderSize();
    const mode = `${width}x${height}`;
    if (mode === activeVideoMode) return;
    activeVideoMode = mode;
    engine.Cmd_ExecuteString(`vid_setmode ${width} ${height}`);
    console.info(`[live/xash] video mode ${mode}`);
  };
  applyVideoMode();
  onStatus("Xash3D is ready.");

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
        engine.Cmd_ExecuteString(`name \"${config.playerName.replaceAll('"', "")}\"`);
        engine.Cmd_ExecuteString(`password \"${config.playerPassword.replaceAll('"', "")}\"`);
        engine.Cmd_ExecuteString(`connect ${address}`);
      };

      executeConnect();

      if (config.spectatorCommand) {
        window.setTimeout(() => {
          engine.Cmd_ExecuteString(config.spectatorCommand);
        }, config.spectatorDelayMs);
      }
    },

    command(value) {
      engine.Cmd_ExecuteString(String(value || ""));
    },

    quit() {
      persistConfig();
      window.clearInterval(configSaveTimer);
      window.removeEventListener("beforeunload", persistConfig);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", onResize);
        window.visualViewport.removeEventListener("scroll", onViewportScroll);
      }
      relay.close();
      window.alert = browserAlert;
      if (typeof engine.quit === "function") engine.quit();
    }
  };
}
