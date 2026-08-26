function ensureEngineShape(engine) {
  for (const method of ["init", "main", "Cmd_ExecuteString"]) {
    if (typeof engine?.[method] !== "function") {
      throw new Error(`The Xash3D runtime is missing ${method}().`);
    }
  }
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

export async function createXashClient({ canvas, config, onStatus = () => {} }) {
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

  const engine = new Xash3D({
    canvas,
    arguments: ["-game", config.gameDirectory],
    gameManifest: config.gameManifest
  });

  ensureEngineShape(engine);
  await engine.init();
  engine.main();
  onStatus("Xash3D is ready.");

  return {
    connect(server) {
      const address = `${server.host}:${server.port}`;
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
      if (typeof engine.quit === "function") engine.quit();
    }
  };
}
