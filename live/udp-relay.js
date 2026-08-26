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

function patchNetForIpv4(net) {
  const original = typeof net.getaddrinfo === "function" ? net.getaddrinfo.bind(net) : null;
  net.connect = net.connect || (() => 0);
  net.getaddrinfo = function getaddrinfo(hostnamePtr, restrictPrt, hintsPtr, addrinfoPtr) {
    const host = this.em.AsciiToString(hostnamePtr);
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      const sa = this.em._malloc(16);
      this.em.writeSockaddr(sa, 2, host, 0);
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

export class UdpWebSocketRelay {
  constructor(Net, path, server) {
    if (typeof Net !== "function") throw new Error("The Xash3D runtime does not export its network adapter.");
    this.path = path;
    this.server = server;
    this.sentPackets = 0;
    this.receivedPackets = 0;
    this.socket = null;
    this.lastPeer = { ip: ipTuple(server.host), port: server.port };
    this.net = new Net({
      sendto: packet => {
        if (packet.ip?.[0] === 101 && packet.ip?.[1] === 101) return;
        this.lastPeer = { ip: Array.from(packet.ip), port: packet.port };
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.sentPackets += 1;
        this.socket.send(packetBytes(packet.data));
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
      if (this.receivedPackets === 1) {
        console.info(`[live/relay] received first UDP packet from ${this.server.host}:${this.server.port}`);
      }
      this.net.incoming.push({
        data: new Uint8Array(event.data),
        ip: this.lastPeer.ip,
        port: this.lastPeer.port
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
