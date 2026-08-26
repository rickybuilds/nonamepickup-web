export const LIVE_CONFIG = Object.freeze({
  runtimeModule: "./runtime/xash3d-fwgs.js",
  gameDirectory: "tfc",
  gameManifest: "./runtime/tfc-manifest.json",
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
