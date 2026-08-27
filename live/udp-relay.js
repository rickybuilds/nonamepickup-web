function relayUrl(path, serverKey) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(path, `${protocol}//${location.host}`);
  url.searchParams.set("server", serverKey);
  return url;
}

function probeUrl(path, serverKey) {
  const url = new URL(path, location.origin);
  url.searchParams.set("server", serverKey);
  return url;
}

function ipTuple(host) {
  const values = host.split(".").map(Number);
  if (values.length !== 4 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error(`The relay target is not an IPv4 address: ${host}`);
  }
  return values;
}

function packetBytes(data) {
  if (data instanceof Uint8Array) return data.slice();
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  return new Uint8Array(data);
}

function parseInfoString(value) {
  const result = new Map();
  const parts = String(value || "").split("\\");
  for (let index = parts[0] ? 0 : 1; index + 1 < parts.length; index += 2) {
    if (parts[index]) result.set(parts[index], parts[index + 1]);
  }
  return result;
}

function serializeInfoString(values) {
  return [...values].map(([key, value]) => `\\${key}\\${value}`).join("");
}

function rewriteHltvConnect(payload, spectatorPassword) {
  if (payload.length < 6 || payload[0] !== 255 || payload[1] !== 255 || payload[2] !== 255 || payload[3] !== 255 || payload[4] !== 99) {
    return payload;
  }
  const command = new TextDecoder("latin1").decode(payload.subarray(4));
  const match = command.match(/^connect\s+(\d+)\s+(-?\d+)\s+"([^"]*)"\s+"([^"]*)"/);
  if (!match) return payload;

  const protocolInfo = parseInfoString(match[3]);
  protocolInfo.set("prot", "2");
  protocolInfo.set("unique", "-1");
  protocolInfo.set("raw", cryptoRandomToken());
  protocolInfo.delete("cdkey");

  const userInfo = parseInfoString(match[4]);
  // A browser watching an HLTV feed is a normal downstream spectator.
  // *hltv=1 identifies another relay proxy and makes ReHLTV send periodic
  // proxy-status packets whose layout is not the viewer protocol Xash parses.
  userInfo.delete("*hltv");
  userInfo.set("password", String(spectatorPassword || ""));
  const rewritten = `connect ${match[1]} ${match[2]} "${serializeInfoString(protocolInfo)}" "${serializeInfoString(userInfo)}"${command.slice(match[0].length)}`;
  const encoded = new TextEncoder().encode(rewritten);
  const result = new Uint8Array(4 + encoded.length);
  result.set([255, 255, 255, 255]);
  result.set(encoded, 4);
  return result;
}

function cryptoRandomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function endpointFrame(ip, port, payload) {
  const frame = new Uint8Array(6 + payload.length);
  frame.set(ip, 0);
  frame[4] = port >> 8 & 255;
  frame[5] = port & 255;
  frame.set(payload, 6);
  return frame;
}

function isEmscriptenPortFrame(data) {
  return data.length === 10
    && data[0] === 255 && data[1] === 255 && data[2] === 255 && data[3] === 255
    && data[4] === 112 && data[5] === 111 && data[6] === 114 && data[7] === 116;
}

function parseEndpointFrame(data, servers) {
  if (data.length < 7) return null;
  const ip = Array.from(data.subarray(0, 4));
  const port = data[4] << 8 | data[5];
  const host = ip.join(".");
  const known = Object.values(servers || {}).some(server => server.host === host && server.port === port);
  return known ? { ip, port, payload: data.subarray(6) } : null;
}

// The Xash menu library is built with Emscripten's regular SOCKFS networking,
// while the engine itself uses Net above. SOCKFS normally translates every
// UDP peer into ws://<game-server>, which is both the wrong protocol for HLTV
// and blocked when /live/ is served over HTTPS. Bridge only our allowlisted
// peers back through the same secure, endpoint-framed relay contract.
export function installSockfsRelayBridge(path, servers) {
  const NativeWebSocket = window.WebSocket;
  const targets = new Map(Object.values(servers || {})
    .filter(server => server?.key && server.host && server.port)
    .map(server => [server.host, server]));

  class SockfsRelayWebSocket extends EventTarget {
    static CONNECTING = NativeWebSocket.CONNECTING;
    static OPEN = NativeWebSocket.OPEN;
    static CLOSING = NativeWebSocket.CLOSING;
    static CLOSED = NativeWebSocket.CLOSED;

    constructor(value, protocols) {
      super();
      const requested = new URL(String(value), location.href);
      const target = requested.protocol === "ws:" ? targets.get(requested.hostname) : null;
      const requestedPort = requested.port ? Number(requested.port) : 0;
      // A missing port means ws:// port 80 and is commonly Xash trying to
      // reach a FastDL HTTP host. Never mistake that TCP traffic for HLTV UDP.
      if (!target || requestedPort !== target.port) {
        return protocols === undefined
          ? new NativeWebSocket(value)
          : new NativeWebSocket(value, protocols);
      }

      this.target = target;
      this.ip = ipTuple(target.host);
      this.socket = new NativeWebSocket(relayUrl(path, target.key));
      this.socket.binaryType = "arraybuffer";
      this.socket.addEventListener("open", () => this.emit(new Event("open")));
      this.socket.addEventListener("error", () => this.emit(new Event("error")));
      this.socket.addEventListener("close", event => {
        const forwarded = typeof CloseEvent === "function"
          ? new CloseEvent("close", { code: event.code, reason: event.reason, wasClean: event.wasClean })
          : new Event("close");
        this.emit(forwarded);
      });
      this.socket.addEventListener("message", event => {
        const frame = parseEndpointFrame(new Uint8Array(event.data), servers);
        if (!frame || frame.ip.join(".") !== target.host || frame.port !== target.port) return;
        const data = frame.payload.slice().buffer;
        this.emit(new MessageEvent("message", { data }));
      });
      console.info(`[live/relay] routed native menu socket for ${target.host}:${target.port} through WSS.`);
    }

    emit(event) {
      const handler = this[`on${event.type}`];
      if (typeof handler === "function") handler.call(this, event);
      this.dispatchEvent(event);
    }

    get url() { return this.socket.url; }
    get CONNECTING() { return NativeWebSocket.CONNECTING; }
    get OPEN() { return NativeWebSocket.OPEN; }
    get CLOSING() { return NativeWebSocket.CLOSING; }
    get CLOSED() { return NativeWebSocket.CLOSED; }
    get readyState() { return this.socket.readyState; }
    get bufferedAmount() { return this.socket.bufferedAmount; }
    get extensions() { return this.socket.extensions; }
    get protocol() { return this.socket.protocol; }
    get binaryType() { return this.socket.binaryType; }
    set binaryType(value) { this.socket.binaryType = value; }

    send(data) {
      const payload = packetBytes(data);
      // SOCKFS's WebSocket proxy protocol announces the local UDP port to a
      // generic proxy. Our relay already owns the association, so this control
      // packet must not be forwarded to HLTV.
      if (isEmscriptenPortFrame(payload)) return;
      this.socket.send(endpointFrame(this.ip, this.target.port, payload));
    }

    close(code, reason) {
      if (code === undefined) this.socket.close();
      else if (reason === undefined) this.socket.close(code);
      else this.socket.close(code, reason);
    }
  }

  window.WebSocket = SockfsRelayWebSocket;
  return () => {
    if (window.WebSocket === SockfsRelayWebSocket) window.WebSocket = NativeWebSocket;
  };
}

function packetKind(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length >= 5 && bytes[0] === 255 && bytes[1] === 255 && bytes[2] === 255 && bytes[3] === 255) {
    const type = bytes[4] >= 32 && bytes[4] <= 126 ? String.fromCharCode(bytes[4]) : `0x${bytes[4].toString(16)}`;
    return `connectionless ${type}`;
  }
  return "sequenced";
}

function normalizeLegacyHltvAccept(data, server) {
  // Valve HLTV BUILD 3378 accepts spectators with a fixed-width
  // `B0000000000000000` packet. Native GoldSrc understands it, but Xash3D-
  // FWGS expects the later tokenized S2C_CONNECTION representation.
  const isLegacyAccept = data.length === 21
    && data[0] === 255 && data[1] === 255 && data[2] === 255 && data[3] === 255
    && data[4] === 66
    && data.subarray(5).every(byte => byte === 48);
  if (!isLegacyAccept) return data;

  const response = new TextEncoder().encode(`B 0 "${server.host}:${server.port}" 0 3378\n`);
  const normalized = new Uint8Array(4 + response.length);
  normalized.set([255, 255, 255, 255]);
  normalized.set(response, 4);
  console.info("[live/relay] normalized the legacy HLTV acceptance packet for Xash3D.");
  return normalized;
}

function describeConnectAuth(data) {
  const text = new TextDecoder("latin1").decode(data);
  const quoted = [...text.matchAll(/"([^"]*)"/g)];
  const protocolInfo = quoted[0]?.[1] || "";
  const read = key => (protocolInfo.match(new RegExp(`\\\\${key}\\\\([^\\\\]*)`)) || [])[1] || "";
  const userInfo = parseInfoString(quoted[1]?.[1]);
  return {
    protocol: read("prot") || "unknown",
    rawBytes: read("raw").length,
    hasCdKey: Boolean(read("cdkey")),
    hltv: userInfo.get("*hltv") === "1",
    passwordBytes: (userInfo.get("password") || "").length
  };
}

function patchNetForIpv4(net) {
  net.connect = net.connect || (() => 0);
  net.getaddrinfo = function getaddrinfo(hostnamePtr, restrictPrt, hintsPtr, addrinfoPtr) {
    const host = this.em.AsciiToString(hostnamePtr);
    // Keep numeric game endpoints on the custom UDP adapter. Do not rewrite
    // arbitrary names: pub-<id>.r2.dev, for example, is a Cloudflare FastDL
    // host. Mapping it to the HLTV address turns an HTTP download attempt into
    // a bogus game-server socket and can feed unrelated bytes into the stream.
    const isLiteralIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    if (isLiteralIpv4) {
      const service = restrictPrt ? this.em.AsciiToString(restrictPrt) : "";
      const parsedPort = Number.parseInt(service, 10);
      const port = Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 0;
      const sa = this.em._malloc(16);
      this.em.writeSockaddr(sa, 2, host, port);
      const ai = this.em._malloc(32);
      this.em.HEAP32[ai + 4 >> 2] = 2;
      this.em.HEAP32[ai + 8 >> 2] = 2;
      this.em.HEAP32[ai + 12 >> 2] = 17;
      this.em.HEAPU32[ai + 24 >> 2] = 0;
      this.em.HEAPU32[ai + 20 >> 2] = sa;
      this.em.HEAP32[ai + 16 >> 2] = 16;
      this.em.HEAP32[ai + 28 >> 2] = 0;
      this.em.HEAPU32[addrinfoPtr >> 2] = ai;
      return 0;
    }
    // Net's stock fallback converts every hostname into a synthetic
    // 101.101.x.x peer. With no TCP WebSocket proxy behind that address, the
    // only result on HTTPS is a blocked ws:// request. Report it unresolved
    // instead; distributable custom files must be mounted as browser assets.
    return -2;
  };
}

async function diagnoseRelay(path, serverKey) {
  let response;
  try {
    response = await fetch(probeUrl(path, serverKey), { method: "GET", cache: "no-store" });
  } catch {
    throw new Error("The website API is unreachable, so the TFC UDP relay cannot start.");
  }
  if (response.status >= 500) {
    throw new Error("The website API is down, so the TFC UDP relay cannot start.");
  }
}

function answerMasterQuery(net, packet, scan, servers) {
  const filter = new TextDecoder("latin1").decode(scan);
  const isXash = filter.includes("\\clver\\");
  const bytes = [255, 255, 255, 255, 102, 10];
  if (isXash) {
    const keyHex = (filter.match(/\\key\\([0-9a-fA-F]+)/) || [])[1] || "0";
    const key = parseInt(keyHex, 16) >>> 0;
    bytes.push(127, key & 255, key >> 8 & 255, key >> 16 & 255, key >> 24 & 255, 0);
  }
  const list = Object.values(servers || {});
  for (const s of list) {
    if (!s.host || !s.port) continue;
    for (const b of s.host.split(".").map(Number)) bytes.push(b);
    // GoldSrc's A2M_GET_SERVERS response stores the UDP port low byte first.
    // Sending network-order bytes here makes the native browser decode every
    // configured HLTV endpoint as a different, invalid port.
    bytes.push(s.port & 255, s.port >> 8 & 255);
  }
  bytes.push(0, 0, 0, 0, 0, 0);
  net.incoming.push({
    ip: packet.ip,
    port: packet.port,
    data: new Int8Array(bytes)
  });
}

export class UdpWebSocketRelay {
  constructor(Net, path, server, servers = {}, spectatorPassword = "") {
    if (typeof Net !== "function") throw new Error("The Xash3D runtime does not export its network adapter.");
    this.path = path;
    this.server = server;
    this.servers = servers;
    this.spectatorPassword = spectatorPassword;
    this.sentPackets = 0;
    this.receivedPackets = 0;
    this.socket = null;
    this.lastPeer = { ip: ipTuple(server.host), port: server.port };
    this.net = new Net({
      sendto: packet => {
        const data = packet.data;
        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
        // The native browser can request any master-server region (the
        // default is commonly 0x00/US East, not 0xFF/World). Answer every
        // A2M_GET_SERVERS_BATCH2 request instead of only the World query.
        const scanAt = u8[0] === 49 && u8.length >= 2
          ? 0
          : u8[0] === 255 && u8[1] === 255 && u8[2] === 255 && u8[3] === 255 && u8[4] === 49 && u8.length >= 6
            ? 4
            : -1;
        if (scanAt >= 0) {
          answerMasterQuery(this.net, packet, u8.subarray(scanAt), this.servers);
          return;
        }
        if (packet.ip?.[0] === 101 && packet.ip?.[1] === 101) return;
        this.lastPeer = { ip: Array.from(packet.ip), port: packet.port };
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.sentPackets += 1;
        const outbound = rewriteHltvConnect(packetBytes(data), this.spectatorPassword);
        // Match the reference transport: carry the intended endpoint beside
        // each UDP payload so native Multiplayer can browse/connect to any
        // allowlisted HLTV target through the single WebSocket.
        this.socket.send(endpointFrame(packet.ip, packet.port, outbound));
        if (this.sentPackets <= 12) {
          console.info(`[live/relay] UDP send #${this.sentPackets}: ${packetKind(outbound)}, ${outbound.byteLength} bytes`);
        }
        if (outbound.length >= 5 && outbound[4] === 99) {
          console.info(`[live/relay] connect authentication ${JSON.stringify(describeConnectAuth(outbound))}`);
        }
        if (this.sentPackets === 1) {
          console.info(`[live/relay] sent first UDP packet to ${server.host}:${server.port}`);
        }
      }
    });
    patchNetForIpv4(this.net);
  }

  async open() {
    await diagnoseRelay(this.path, this.server.key);
    this.socket = new WebSocket(relayUrl(this.path, this.server.key));
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("message", event => {
      this.receivedPackets += 1;
      const frame = parseEndpointFrame(new Uint8Array(event.data), this.servers);
      const inboundPayload = frame?.payload || new Uint8Array(event.data);
      const inboundServer = frame
        ? { host: frame.ip.join("."), port: frame.port }
        : this.server;
      const inbound = normalizeLegacyHltvAccept(inboundPayload, inboundServer);
      if (this.receivedPackets <= 12) {
        console.info(`[live/relay] UDP receive #${this.receivedPackets}: ${packetKind(inbound)}, ${inbound.byteLength} bytes`);
      }
      if (inbound.length >= 5 && inbound[0] === 255 && inbound[1] === 255 && inbound[2] === 255 && inbound[3] === 255) {
        if (inbound[4] === 56) {
          console.warn("[live/relay] HLTV rejected the spectator password. Set spectatorpassword to pickup (or none) on the HLTV proxy.");
        } else if (inbound[4] === 57) {
          const reason = new TextDecoder("latin1").decode(inbound.subarray(5)).replaceAll("\0", "").trim();
          console.warn(`[live/relay] TFC server rejected the connection: ${reason || "no reason supplied"}`);
        }
      }
      if (this.receivedPackets === 1) {
        console.info(`[live/relay] received first UDP packet from ${this.server.host}:${this.server.port}`);
      }
      this.net.incoming.push({
        data: inbound,
        ip: frame?.ip || ipTuple(this.server.host),
        port: frame?.port || this.server.port
      });
    });

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("The UDP relay timed out.")), 10000);
      this.socket.addEventListener("open", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("nginx is not forwarding the WebSocket upgrade to /api/live/relay."));
      }, { once: true });
    });
  }

  close() {
    this.socket?.close(1000, "spectator closed");
  }
}
