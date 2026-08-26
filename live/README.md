# NoName browser spectator

`/live/` is the standalone browser-TFC client. The existing `/live.html` match
center and `/pickup-live.html` telemetry renderer remain independent fallbacks.

## Current state

The static shell is implemented and discovers the active NoName pickup through
`/api/queue`. It contains the three known pickup endpoints and launches through
an isolated Xash3D adapter once generated runtime artifacts exist under
`./runtime/`.

The launch command sequence is:

1. set a spectator display name;
2. set the public pickup password;
3. connect to the selected `host:port`;
4. request spectator mode after the connection starts.

Client-side spectator mode is convenience only. A relay allowlist and an
AMXX/server-side rule must prevent browser sessions from joining a playing
team.

## Source components

- Engine: `FWGS/xash3d-fwgs`
- Browser port/tooling: `yohimik/webxash3d-fwgs`
- TFC game code: `Velaron/tf15-client`
- Game assets: the legally distributable subset from Valve's dedicated-server
  package, subject to Valve's terms

The working public TFC browser port compiles the engine and TF15 game code to
WebAssembly and adds a browser-to-UDP relay. Its finished web build is not the
source for this directory.

## Build prerequisites

- Git with recursive submodule support
- Node.js and pnpm
- CMake
- Emscripten SDK (`emcc`, `emcmake`)
- A Linux or WSL/Docker build environment is strongly preferred

This Windows workstation currently has Node.js and pnpm, but CMake and
Emscripten are not installed. Install the native toolchain before generating
the runtime files.

## Relay contract

The browser cannot connect directly to HLDS UDP. The production relay must:

- accept secure browser transport (`wss://` or WebRTC data channels);
- allow only the configured NoName pickup endpoints;
- reject arbitrary destination hosts and ports;
- rate-limit sessions and packet volume;
- never expose or accept RCON credentials;
- attach or identify browser sessions so the server can force spectator mode;
- close the UDP association when the browser session ends.

The first supported target is Central at `64.177.123.157:27015`. Add East and
West after the end-to-end Central spectator path is verified.
