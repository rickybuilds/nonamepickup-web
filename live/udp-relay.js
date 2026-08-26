function relayUrl(path, serverKey) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(path, `${protocol}//${location.host}`);
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

export class UdpWebSocketRelay {
  constructor(Net, path, server) {
    if (typeof Net !== "function") throw new Error("The Xash3D runtime does not export its network adapter.");
    this.server = server;
    this.sentPackets = 0;
    this.receivedPackets = 0;
    this.socket = new WebSocket(relayUrl(path, server.key));
    this.socket.binaryType = "arraybuffer";
    this.net = new Net({
      sendto: packet => {
        if (this.socket.readyState !== WebSocket.OPEN) return;
        this.sentPackets += 1;
        this.socket.send(packet.data.slice().buffer);
        if (this.sentPackets === 1) {
          console.info(`[live/relay] sent first UDP packet to ${server.host}:${server.port}`);
        }
      }
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("The UDP relay timed out.")), 10000);
      this.socket.addEventListener("open", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("The browser could not reach the TFC UDP relay."));
      }, { once: true });
      this.socket.addEventListener("message", event => {
        this.receivedPackets += 1;
        if (this.receivedPackets === 1) {
          console.info(`[live/relay] received first UDP packet from ${this.server.host}:${this.server.port}`);
        }
        this.net.incoming.push({
          data: new Int8Array(event.data),
          ip: ipTuple(this.server.host),
          port: this.server.port
        });
      });
    });
  }

  close() {
    this.socket.close(1000, "spectator closed");
  }
}
