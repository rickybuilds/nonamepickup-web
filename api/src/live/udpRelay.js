"use strict";

const dgram = require("dgram");
const { WebSocket, WebSocketServer } = require("ws");

const MAX_PACKET_BYTES = 65_507;
const MAX_PACKETS_PER_SECOND = 256;
const MAX_BYTES_PER_SECOND = 512 * 1024;
const MAX_CONNECTIONS = 64;
const MAX_CONNECTIONS_PER_IP = 4;

const TARGETS = Object.freeze({
  east: Object.freeze({ host: "108.61.128.120", port: 27015 }),
  central: Object.freeze({ host: "64.177.123.157", port: 27015 }),
  west: Object.freeze({ host: "149.28.78.158", port: 27015 })
});

function rejectUpgrade(socket, status, message) {
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${status}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: text/plain; charset=utf-8\r\n" +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
    body
  );
  socket.destroy();
}

function requestIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",", 1)[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",", 1)[0].trim();
  const protocol = String(request.headers["x-forwarded-proto"] || (request.socket.encrypted ? "https" : "http"))
    .split(",", 1)[0]
    .trim();
  return origin === `${protocol}://${host}`;
}

function attachUdpRelay(server, options = {}) {
  const path = options.path || "/api/live/relay";
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PACKET_BYTES, perMessageDeflate: false });
  const connectionsByIp = new Map();
  let connections = 0;

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://relay.local");
    if (url.pathname !== path) return;

    const target = TARGETS[url.searchParams.get("server") || ""];
    const ip = requestIp(request);
    if (!target) return rejectUpgrade(socket, "400 Bad Request", "Unknown TFC relay target.");
    if (!isSameOrigin(request)) return rejectUpgrade(socket, "403 Forbidden", "Relay origin rejected.");
    if (connections >= MAX_CONNECTIONS || (connectionsByIp.get(ip) || 0) >= MAX_CONNECTIONS_PER_IP) {
      return rejectUpgrade(socket, "503 Service Unavailable", "TFC relay capacity reached.");
    }

    request.liveRelay = { ip, target, serverKey: url.searchParams.get("server") };
    webSockets.handleUpgrade(request, socket, head, ws => webSockets.emit("connection", ws, request));
  });

  webSockets.on("connection", (ws, request) => {
    const { ip, target, serverKey } = request.liveRelay;
    const udp = dgram.createSocket("udp4");
    let closed = false;
    let windowStarted = Date.now();
    let packets = 0;
    let bytes = 0;

    connections += 1;
    connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);

    const close = () => {
      if (closed) return;
      closed = true;
      connections -= 1;
      const remaining = (connectionsByIp.get(ip) || 1) - 1;
      if (remaining > 0) connectionsByIp.set(ip, remaining);
      else connectionsByIp.delete(ip);
      try { udp.close(); } catch {}
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    };

    udp.on("message", message => {
      if (ws.readyState === WebSocket.OPEN) ws.send(message, { binary: true });
    });
    udp.on("error", error => {
      console.error(`[live-relay] ${serverKey} UDP error:`, error.message);
      close();
    });
    udp.connect(target.port, target.host);

    ws.on("message", (message, isBinary) => {
      if (!isBinary || message.length < 1 || message.length > MAX_PACKET_BYTES) return close();
      const now = Date.now();
      if (now - windowStarted >= 1000) {
        windowStarted = now;
        packets = 0;
        bytes = 0;
      }
      packets += 1;
      bytes += message.length;
      if (packets > MAX_PACKETS_PER_SECOND || bytes > MAX_BYTES_PER_SECOND) return close();
      udp.send(message);
    });
    ws.on("error", close);
    ws.on("close", close);
  });

  return {
    close() {
      for (const client of webSockets.clients) client.close(1001, "server shutdown");
      webSockets.close();
    }
  };
}

module.exports = { attachUdpRelay };
