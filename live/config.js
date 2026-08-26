export const LIVE_CONFIG = Object.freeze({
  runtimeModule: "./runtime/xash3d-fwgs.js",
  gameDirectory: "tfc",
  gameAssetsManifest: "./runtime/game-assets.json",
  extrasArchive: "./runtime/tf15client-extras.pk3",
  relayPath: "/api/live/relay",
  runtimeLibraries: Object.freeze({
    xash: "./runtime/xash.wasm",
    filesystem: "./runtime/filesystem_stdio.wasm",
    renderer: "./runtime/libref_webgl2.wasm",
    menu: "./runtime/cl_dlls/menu-stock_emscripten_wasm32.wasm",
    client: "./runtime/cl_dlls/client_emscripten_wasm32.wasm?v=20260826k",
    server: "./runtime/dlls/tfc_emscripten_wasm32.wasm"
  }),
  serverModulePath: "dlls/tfc_emscripten_wasm32.wasm",
  playerName: "NoName Spectator",
  playerPassword: "pickup",
  spectatorCommand: "spectate",
  spectatorDelayMs: 3500,
  servers: Object.freeze({
    east: Object.freeze({
      key: "east",
      name: "TFC East US Server",
      host: "108.61.128.120",
      port: 27015
    }),
    central: Object.freeze({
      key: "central",
      name: "TFC Central US Server",
      host: "64.177.123.157",
      port: 27015
    }),
    west: Object.freeze({
      key: "west",
      name: "TFC West US Server",
      host: "149.28.78.158",
      port: 27015
    })
  })
});

export function serverAddress(server) {
  return `${server.host}:${server.port}`;
}
