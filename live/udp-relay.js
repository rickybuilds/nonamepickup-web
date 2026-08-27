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
  return {
    protocol: read("prot") || "unknown",
    rawBytes: read("raw").length,
    hasCdKey: Boolean(read("cdkey")),
    hltv: /\\\\\*hltv\\\\1(?:\\\\|$)/.test(quoted[1]?.[1] || "")
  };
}

function patchNetForIpv4(net, relayHost, relayPort) {
  const original = typeof net.getaddrinfo === "function" ? net.getaddrinfo.bind(net) : null;
  net.connect = net.connect || (() => 0);
  net.getaddrinfo = function getaddrinfo(hostnamePtr, restrictPrt, hintsPtr, addrinfoPtr) {
    const host = this.em.AsciiToString(hostnamePtr);
    // HLTV/ReHLTV may advertise a generated public hostname after the
    // initial connection (for example pub-<id>.dev). The browser cannot
    // resolve that hostname, and it must not bypass the WebSocket relay
    // anyway. All traffic for this client is pinned to the selected relay
    // target, so resolve advertised hostnames to that already-validated IP.
    const isLiteralIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    const resolvedHost = isLiteralIpv4 ? host : relayHost;
    if (resolvedHost) {
      const service = restrictPrt ? this.em.AsciiToString(restrictPrt) : "";
      const parsedPort = Number.parseInt(service, 10);
      const port = !isLiteralIpv4 && relayPort
        ? relayPort
        : Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 0;
      const sa = this.em._malloc(16);
      this.em.writeSockaddr(sa, 2, resolvedHost, port);
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
    return original ? original(hostnamePtr, restrictPrt, hintsPtr, addrinfoPtr) : -1;
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
    bytes.push(s.port >> 8 & 255, s.port & 255);
  }
  bytes.push(0, 0, 0, 0, 0, 0);
  net.incoming.push({
    ip: packet.ip,
    port: packet.port,
    data: new Int8Array(bytes)
  });
}

export class UdpWebSocketRelay {
  constructor(Net, path, server, servers = {}) {
    if (typeof Net !== "function") throw new Error("The Xash3D runtime does not export its network adapter.");
    this.path = path;
    this.server = server;
    this.servers = servers;
    this.sentPackets = 0;
    this.receivedPackets = 0;
    this.socket = null;
    this.lastPeer = { ip: ipTuple(server.host), port: server.port };
    this.net = new Net({
      sendto: packet => {
        const data = packet.data;
        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
        const scanAt = u8[0] === 49 && u8[1] === 255 ? 0 : u8[0] === 255 && u8[1] === 255 && u8[2] === 255 && u8[3] === 255 && u8[4] === 49 && u8[5] === 255 ? 4 : -1;
        if (scanAt >= 0) {
          answerMasterQuery(this.net, packet, u8.subarray(scanAt), this.servers);
          return;
        }
        if (packet.ip?.[0] === 101 && packet.ip?.[1] === 101) return;
        this.lastPeer = { ip: Array.from(packet.ip), port: packet.port };
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.sentPackets += 1;
        const outbound = packetBytes(data);
        this.socket.send(outbound);
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
    patchNetForIpv4(this.net, server.host, server.port);
  }

  async open() {
    await diagnoseRelay(this.path, this.server.key);
    this.socket = new WebSocket(relayUrl(this.path, this.server.key));
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("message", event => {
      this.receivedPackets += 1;
      const inbound = normalizeLegacyHltvAccept(new Uint8Array(event.data), this.server);
      if (this.receivedPackets <= 12) {
        console.info(`[live/relay] UDP receive #${this.receivedPackets}: ${packetKind(inbound)}, ${inbound.byteLength} bytes`);
      }
      if (inbound.length >= 6 && inbound[0] === 255 && inbound[1] === 255 && inbound[2] === 255 && inbound[3] === 255 && inbound[4] === 57) {
        const reason = new TextDecoder("latin1").decode(inbound.subarray(5)).replaceAll("\0", "").trim();
        console.warn(`[live/relay] TFC server rejected the connection: ${reason || "no reason supplied"}`);
      }
      if (this.receivedPackets === 1) {
        console.info(`[live/relay] received first UDP packet from ${this.server.host}:${this.server.port}`);
      }
      this.net.incoming.push({
        data: inbound,
        // This WebSocket has one allowlisted UDP target. Always report that
        // real peer to Xash; the engine rejects challenge replies whose source
        // port does not match the address supplied to `connect`.
        ip: ipTuple(this.server.host),
        port: this.server.port
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
