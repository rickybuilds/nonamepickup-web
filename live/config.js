export const LIVE_CONFIG = Object.freeze({
  runtimeModule: "./runtime/xash3d-fwgs.js",
  gameDirectory: "tfc",
  gameAssetsManifest: "./runtime/game-assets.json",
  extrasArchive: "./runtime/tf15client-extras.pk3?v=20260826o",
  valveExtrasArchive: "./runtime/valve-extras.pk3?v=20260826o",
  relayPath: "/api/live/relay",
  runtimeLibraries: Object.freeze({
    xash: "./runtime/xash.wasm?v=20260826o",
    filesystem: "./runtime/filesystem_stdio.wasm?v=20260826o",
    renderer: "./runtime/libref_webgl2.wasm?v=20260826o",
    menu: "./runtime/cl_dlls/menu_emscripten_wasm32.wasm?v=20260826o",
    client: "./runtime/cl_dlls/client_emscripten_wasm32.wasm?v=20260826o",
    server: null
  }),
  serverModulePath: "dlls/tfc_emscripten_wasm32.wasm",
  playerName: "NoName Spectator",
  playerPassword: "pickup",
  // HLTV mode 3 is free roaming; chase and first-person modes ignore movement.
  spectatorCommand: "spec_mode 3",
  spectatorDelayMs: 3500,
  servers: Object.freeze({
    east: Object.freeze({
      key: "east",
      name: "TFC East Live (HLTV)",
      host: "108.61.128.120",
      port: 27020,
      available: true
    }),
    central: Object.freeze({
      key: "central",
      name: "TFC Central Live (HLTV)",
      host: "64.177.123.157",
      port: 27020,
      available: true
    }),
    west: Object.freeze({
      key: "west",
      name: "TFC West Live (HLTV)",
      host: "149.28.78.158",
      port: 27020,
      available: true
    })
  })
});

export function serverAddress(server) {
  return `${server.host}:${server.port}`;
}
