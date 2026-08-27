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

The browser cannot connect directly to HLDS UDP. It opens a WebSocket to
`/api/live/relay?server=central` (also `east` / `west`). That is an API path
on the Node process, not `/live/api`. nginx already serves `/live/` as static
files; it must proxy `/api/live/relay` to the API with WebSocket upgrades.

The production relay must:

- accept secure browser transport (`wss://` or WebRTC data channels);
- allow only the configured NoName pickup endpoints;
- reject arbitrary destination hosts and ports;
- rate-limit sessions and packet volume;
- never expose or accept RCON credentials;
- attach or identify browser sessions so the server can force spectator mode;
- close the UDP association when the browser session ends.

The relay WebSocket carries a six-byte IPv4/port endpoint header before each
UDP payload. This lets the native TFC Multiplayer browser query and connect to
any configured allowlisted HLTV target while keeping all traffic on the relay.
After deploying relay changes, restart the API process and reload `/live/` so
the browser and server use the same framed transport.

The browser spectator targets the East, Central, and West HLTV proxies on UDP
port `27020`. The HLTV proxies connect upstream to their game servers on
`27015`.

The native Multiplayer/Favorites menu uses Emscripten's SOCKFS path rather than
the engine's network adapter. `/live/` bridges only exact allowlisted HLTV
`:27020` sockets from that path into the secure relay. Hostnames such as
`pub-<id>.r2.dev` are Cloudflare R2 FastDL hosts and must never be rewritten to
an HLTV IP address.

## Custom sound downloads

`sv_downloadurl` is an HLDS game-server setting; it does not belong in
`hltv.cfg`. Put it in each pickup server's `server.cfg`, using a URL that
contains the `tfc/` directory layout:

```cfg
sv_allowdownload 1
sv_downloadurl "https://downloads.example.net/tfc/"
```

For example, `sound/airshot.wav` must be available at
`https://downloads.example.net/tfc/sound/airshot.wav`. The files must also
exist under the corresponding `tfc/sound/` directory on the HLTV host. The
proxy needs to be able to obtain and transmit the files before a browser
spectator can receive them; putting them only on the website's FastDL host is
not sufficient for the proxy path.

After changing the game server configuration, restart the HLTV proxy and
verify the exact case and extension of every custom resource. The browser
client enables `cl_allowdownload`, `cl_download_ingame`, and
`cl_downloadfilter all` automatically, but it cannot repair a missing file or
an HLTV proxy that failed to transmit one.

The `ex_interp is a privileged variable` line is a server-side cvar
restriction warning. `GL_INVALID_OPERATION` is emitted by the WebGL renderer;
neither line explains a missing FastDL resource.

## Ubuntu deploy

The website API (`tfcapi` on port 4000) owns the relay. After pulling this
commit on the box:

```sh
cd /var/www/tfcbot/api
npm install
pm2 restart tfcapi
curl -sS http://127.0.0.1:4000/api/live/relay
```

That last command should return JSON with `"ok": true`. If it fails, `pm2 logs tfcapi`
usually means `ws` was not installed or the process is still down.

Then include `deploy/nginx/tfc-live-relay.conf` in the HTTPS server block and
reload nginx:

```sh
nginx -t && systemctl reload nginx
```

No extra inbound firewall port is required on the website. Browsers stay on
443. The API host must be allowed to send outbound UDP to the three HLTV
proxies on port 27020.
