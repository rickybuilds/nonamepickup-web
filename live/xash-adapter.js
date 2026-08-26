import { loadGameAssets, mountGameAssets } from "./asset-loader.js?v=20260826d";
import { UdpWebSocketRelay } from "./udp-relay.js?v=20260826h";

function ensureEngineShape(engine) {
  for (const method of ["init", "main", "Cmd_ExecuteString"]) {
    if (typeof engine?.[method] !== "function") {
      throw new Error(`The Xash3D runtime is missing ${method}().`);
    }
  }
}

export function sizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || window.innerWidth;
  const cssHeight = canvas.clientHeight || window.innerHeight;
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
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
  sizeCanvas(canvas);
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
  const relay = new UdpWebSocketRelay(runtime.Net, config.relayPath, server);
  await relay.open();

  const resolve = value => new URL(value, location.href).href;
  const [gameFiles, extrasResponse] = await Promise.all([
    loadGameAssets(config.gameAssetsManifest, onStatus),
    fetch(resolve(config.extrasArchive), { cache: "force-cache" })
  ]);
  if (!extrasResponse.ok) throw new Error("The TF15 client asset archive is unavailable.");
  const extras = new Uint8Array(await extrasResponse.arrayBuffer());

  onStatus("Mounting TFC and starting Xash3D…");
  const browserAlert = window.alert;
  window.alert = message => console.error("[live/xash alert]", message);

  // Browser spectators connect to remote HLDS. Do not preload a local TFC
  // server WASM — the public TFC web client also omits it.
  const engine = new Xash3D({
    canvas,
    renderer: "gles3compat",
    arguments: ["-windowed", "-game", config.gameDirectory, "+_vgui_menus", "0"],
    libraries: {
      xash: resolve(config.runtimeLibraries.xash),
      filesystem: resolve(config.runtimeLibraries.filesystem),
      menu: resolve(config.runtimeLibraries.menu),
      client: resolve(config.runtimeLibraries.client),
      server: null,
      render: {
        gles3compat: resolve(config.runtimeLibraries.renderer)
      }
    },
    module: {
      preRun(module) {
        mountGameAssets(module.FS, gameFiles, extras);
      },
      print(message) {
        console.info("[live/xash]", message);
      },
      printErr(message) {
        console.error("[live/xash]", message);
      }
    }
  });
  engine.net = relay.net;

  ensureEngineShape(engine);
  let abortError = null;
  const onAbort = event => {
    abortError = event.reason instanceof Error ? event.reason : new Error(String(event.reason || "wasm abort"));
  };
  window.addEventListener("unhandledrejection", onAbort);
  try {
    await engine.init();
    await new Promise(resolveReady => window.setTimeout(resolveReady, 50));
    if (engine.exited || abortError) {
      throw abortError || new Error("The Xash3D engine exited while loading the TFC client.");
    }
  } catch (cause) {
    const detail = String(cause?.message || cause || "");
    if (!detail || detail === "Infinity") {
      throw new Error("The TFC client aborted while loading VGUI.", { cause });
    }
    throw cause;
  } finally {
    window.removeEventListener("unhandledrejection", onAbort);
  }
  sizeCanvas(canvas);
  engine.main();
  await new Promise(resolveReady => window.setTimeout(resolveReady, 750));
  onStatus("Xash3D is ready.");

  const onResize = () => sizeCanvas(canvas);
  window.addEventListener("resize", onResize);

  return {
    connect(server) {
      const address = `${server.host}:${server.port}`;
      console.info(`[live/xash] connecting to ${address}`);
      engine.Cmd_ExecuteString(`name \"${config.playerName.replaceAll('"', "")}\"`);
      engine.Cmd_ExecuteString(`password \"${config.playerPassword.replaceAll('"', "")}\"`);
      engine.Cmd_ExecuteString(`connect ${address}`);

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
      window.removeEventListener("resize", onResize);
      relay.close();
      window.alert = browserAlert;
      if (typeof engine.quit === "function") engine.quit();
    }
  };
}
