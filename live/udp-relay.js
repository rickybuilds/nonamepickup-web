const LOCAL_MASTER = Object.freeze({
  host: "203.0.113.1",
  ip: Object.freeze([203, 0, 113, 1]),
  port: 27010
});

export const LOCAL_MASTER_ADDRESS = `${LOCAL_MASTER.host}:${LOCAL_MASTER.port}`;

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

function relayDebugEnabled() {
  return new URLSearchParams(location.search).has("debug");
}

const tracedPacketShapes = new Set();
const tracedNetchanStates = new Set();

const MUNGE2_TABLE = Object.freeze([0x05, 0x61, 0x7a, 0xed, 0x1b, 0xca, 0x0d, 0x9b, 0x4a, 0xf1, 0x64, 0xc7, 0xb5, 0x8e, 0xdf, 0xa0]);

function swapUint32(value) {
  return ((value & 0xff) << 24) | ((value & 0xff00) << 8) | ((value >>> 8) & 0xff00) | (value >>> 24);
}

function unmungedGoldSrcPayload(data, sequence) {
  const payload = data.slice(8);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const words = Math.floor(payload.length / 4);
  for (let index = 0; index < words; index += 1) {
    let word = view.getUint32(index * 4, true) ^ sequence;
    view.setUint32(index * 4, word >>> 0, true);
    for (let byte = 0; byte < 4; byte += 1) {
      payload[index * 4 + byte] ^= 0xa5 | (byte << byte) | byte | MUNGE2_TABLE[(index + byte) & 15];
    }
    word = swapUint32(view.getUint32(index * 4, true)) ^ ~sequence;
    view.setUint32(index * 4, word >>> 0, true);
  }
  return payload;
}

function netchanTrace(data) {
  if (data.length < 8 || (data[0] === 255 && data[1] === 255 && data[2] === 255 && data[3] === 255)) return "";
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sequenceWord = view.getUint32(0, true);
  const acknowledgementWord = view.getUint32(4, true);
  const sequence = sequenceWord & 0x3fffffff;
  const acknowledgement = acknowledgementWord & 0x3fffffff;
  let detail = ` seq=${sequence}${sequenceWord >>> 31 ? "R" : ""} ack=${acknowledgement}${acknowledgementWord >>> 31 ? "R" : ""}`;
  if (!(sequenceWord & 0x40000000)) return detail;

  const payload = unmungedGoldSrcPayload(data, sequence & 0xff);
  if (payload.length < 9 || payload[0] === 0) return `${detail} fragments=none`;
  const fragmentId = new DataView(payload.buffer, payload.byteOffset + 1, 4).getUint32(0, true);
  const fragment = fragmentId >>> 16;
  const total = fragmentId & 0xffff;
  const offset = (payload[5] | payload[6] << 8) << 3;
  const length = (payload[7] | payload[8] << 8) << 3;
  return `${detail} fragment=${fragment}/${total} offset=${offset} length=${length >>> 3}B`;
}

function tracePacket(direction, ip, port, data) {
  if (!relayDebugEnabled()) return;
  const kind = packetKind(data);
  const shape = `${direction}:${kind}:${data.length}`;
  const preview = tracedPacketShapes.has(shape)
    ? ""
    : ` head=${Array.from(data.subarray(0, 24), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  tracedPacketShapes.add(shape);
  const state = kind === "sequenced" ? netchanTrace(data) : "";
  const stateKey = `${direction}:${state}`;
  const stateDetail = state && !tracedNetchanStates.has(stateKey) ? state : "";
  tracedNetchanStates.add(stateKey);
  if (tracedNetchanStates.size > 256) tracedNetchanStates.clear();
  console.info(`[live/relay] ${direction} ${ip.join(".")}:${port} ${kind} (${data.length} bytes).${preview}${stateDetail}`);
}

function normalizeLegacyHltvAccept(data) {
  // Valve HLTV BUILD 3378 accepts spectators with a fixed-width
  // `B0000000000000000` packet. Xash recognizes the preceding `A...`
  // challenge as GoldSrc, whose accept token must be exactly `B`.
  const isLegacyAccept = data.length === 21
    && data[0] === 255 && data[1] === 255 && data[2] === 255 && data[3] === 255
    && data[4] === 66
    && data.subarray(5).every(byte => byte === 48);
  if (!isLegacyAccept) return data;

  const normalized = new Uint8Array([255, 255, 255, 255, 66, 0]);
  console.info("[live/relay] normalized legacy HLTV acceptance for GoldSrc mode.");
  return normalized;
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

function patchNetReceive(net) {
  // xash3d-fwgs 1.2.2's Net.recvfrom() mistakes the value *at* errno for the
  // errno address. On an empty UDP poll it therefore writes EWOULDBLOCK into
  // arbitrary Wasm memory, causing Xash's repeating NET_QueuePacket errors
  // and corrupting the next packet read. Keep its packet contract, but write
  // errno through the actual pointer returned by getErrnoLocation().
  net.recvfrom = function recvfrom(fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr) {
    const packet = this.incoming.pull();
    const em = this.em;
    if (!packet) {
      const errnoPtr = em?.Module?.ccall?.("getErrnoLocation", "number", [], []);
      if (errnoPtr) em.setValue(errnoPtr, 73, "i32"); // EWOULDBLOCK
      return -1;
    }

    const data = packet.data;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
    const copyLength = Math.min(bufLen, bytes.length);
    if (copyLength > 0) em.HEAPU8.set(bytes.subarray(0, copyLength), bufPtr);
    if (sockaddrPtr) {
      const port = packet.port;
      em.HEAP16[sockaddrPtr >> 1] = 2;
      em.HEAP8[sockaddrPtr + 2] = port >> 8 & 255;
      em.HEAP8[sockaddrPtr + 3] = port & 255;
      em.HEAP8[sockaddrPtr + 4] = packet.ip[0];
      em.HEAP8[sockaddrPtr + 5] = packet.ip[1];
      em.HEAP8[sockaddrPtr + 6] = packet.ip[2];
      em.HEAP8[sockaddrPtr + 7] = packet.ip[3];
    }
    if (socklenPtr) em.HEAP32[socklenPtr >> 2] = 16;
    return copyLength;
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
    // Xash accepts server-list packets only from an address registered as a
    // master. Attribute this locally generated response to our documentation-
    // range virtual master instead of whichever HLTV endpoint was queried.
    ip: LOCAL_MASTER.ip,
    port: LOCAL_MASTER.port,
    data: new Int8Array(bytes)
  });
}

export class UdpWebSocketRelay {
  constructor(Net, path, server, servers = {}, onAccepted = () => {}) {
    if (typeof Net !== "function") throw new Error("The Xash3D runtime does not export its network adapter.");
    this.path = path;
    this.server = server;
    this.servers = servers;
    this.onAccepted = onAccepted;
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
          // Favorites are populated locally and queried directly. Do not
          // synthesize an Internet-master reply: Xash renders a warning for
          // locally injected server-list packets before JS can filter it.
          return;
        }
        if (packet.ip?.[0] === 101 && packet.ip?.[1] === 101) return;
        const peer = Array.from(packet.ip);
        this.lastPeer = { ip: peer, port: packet.port };
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        // Keep the browser leg as a raw framed UDP bridge. The API relay is
        // the sole owner of authentication rewriting, preventing two layers
        // from mutating the same GoldSrc connect packet differently.
        tracePacket("out", peer, packet.port, u8);
        this.socket.send(endpointFrame(peer, packet.port, packetBytes(data)));
      }
    });
    patchNetForIpv4(this.net);
    patchNetReceive(this.net);
  }

  async open() {
    await diagnoseRelay(this.path, this.server.key);
    this.socket = new WebSocket(relayUrl(this.path, this.server.key));
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("message", event => {
      const frame = parseEndpointFrame(new Uint8Array(event.data), this.servers);
      const inboundPayload = frame?.payload || new Uint8Array(event.data);
      const inboundServer = frame
        ? { host: frame.ip.join("."), port: frame.port }
        : this.server;
      const inbound = normalizeLegacyHltvAccept(inboundPayload);
      tracePacket("in", frame?.ip || ipTuple(this.server.host), frame?.port || this.server.port, inbound);
      if (inbound.length >= 5 && inbound[0] === 255 && inbound[1] === 255 && inbound[2] === 255 && inbound[3] === 255 && inbound[4] === 66) {
        this.onAccepted(inboundServer);
      }
      if (inbound.length >= 5 && inbound[0] === 255 && inbound[1] === 255 && inbound[2] === 255 && inbound[3] === 255) {
        if (inbound[4] === 56) {
          console.warn("[live/relay] HLTV rejected the spectator password. Set spectatorpassword to pickup (or none) on the HLTV proxy.");
        } else if (inbound[4] === 57) {
          const reason = new TextDecoder("latin1").decode(inbound.subarray(5)).replaceAll("\0", "").trim();
          console.warn(`[live/relay] TFC server rejected the connection: ${reason || "no reason supplied"}`);
        }
      }
      this.net.incoming.push({
        // Use a standalone signed-byte buffer. The runtime's Net adapter
        // creates a Uint8Array from the backing buffer; retaining this
        // subarray's non-zero offset would prepend the six-byte relay frame.
        data: new Int8Array(inbound.slice().buffer),
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
