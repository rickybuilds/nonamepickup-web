"use strict";

const crypto = require("crypto");
const dgram = require("dgram");

const MAX_PACKET_BYTES = 65_507;
const MAX_PACKETS_PER_SECOND = 256;
const MAX_BYTES_PER_SECOND = 512 * 1024;
const MAX_CONNECTIONS = 64;
const MAX_CONNECTIONS_PER_IP = 4;
const MAX_PENDING_UDP_PACKETS = 16;
const RELAY_PATH = "/api/live/relay";

const TARGETS = Object.freeze({
  // Browser spectators connect to the public HLTV proxy, never directly to
  // a pickup game server. Each proxy is the only spectator occupying a slot
  // on its game server at :27015.
  east: Object.freeze({ host: "108.61.128.120", port: 27020, transport: "hltv" }),
  central: Object.freeze({ host: "64.177.123.157", port: 27020, transport: "hltv" }),
  west: Object.freeze({ host: "149.28.78.158", port: 27020, transport: "hltv" })
});

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

function rewriteBrowserConnect(payload, hashedCdKey) {
  if (payload.length < 6 || payload[0] !== 255 || payload[1] !== 255 || payload[2] !== 255 || payload[3] !== 255 || payload[4] !== 99) {
    return payload;
  }

  const command = payload.subarray(4).toString("latin1");
  const match = command.match(/^connect\s+(\d+)\s+(-?\d+)\s+"([^"]*)"\s+"([^"]*)"/);
  if (!match) return payload;

  const protocolInfo = parseInfoString(match[3]);
  protocolInfo.set("prot", "2");
  protocolInfo.set("unique", "-1");
  protocolInfo.set("raw", hashedCdKey);
  protocolInfo.delete("cdkey");

  const userInfo = parseInfoString(match[4]);
  userInfo.delete("*hltv");

  const rewritten = `connect ${match[1]} ${match[2]} "${serializeInfoString(protocolInfo)}" "${serializeInfoString(userInfo)}"${command.slice(match[0].length)}`;
  return Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from(rewritten, "latin1")]);
}

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

function firstHeader(value) {
  return String(value || "").split(",", 1)[0].trim().toLowerCase();
}

function requestIp(request) {
  return firstHeader(request.headers["x-forwarded-for"]) || request.socket.remoteAddress || "unknown";
}

function hostCandidates(request) {
  return [
    firstHeader(request.headers["x-forwarded-host"]),
    firstHeader(request.headers.host)
  ].filter(Boolean);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const originHost = originUrl.host.toLowerCase();
  const originHostname = originUrl.hostname.toLowerCase();
  return hostCandidates(request).some(candidate => {
    const hostname = candidate.replace(/:\d+$/, "");
    return candidate === originHost || hostname === originHostname;
  });
}

function registerRelayStatusRoute(app, path = RELAY_PATH) {
  if (!app) return;
  app.get(path, (_req, res) => {
    res.json({
      ok: true,
      transport: "websocket",
      path,
      targets: Object.keys(TARGETS)
    });
  });
}

function attachUdpRelay(server, options = {}) {
  const { WebSocket, WebSocketServer } = require("ws");
  const path = options.path || RELAY_PATH;
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PACKET_BYTES, perMessageDeflate: false });
  const connectionsByIp = new Map();
  let connections = 0;

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://relay.local");
    if (url.pathname !== path) return;

    const target = TARGETS[url.searchParams.get("server") || ""];
    const ip = requestIp(request);
    if (!target) return rejectUpgrade(socket, "400 Bad Request", "Unknown TFC relay target.");
    if (!isSameOrigin(request)) {
      console.warn("[live-relay] origin rejected", {
        origin: request.headers.origin || "",
        host: request.headers.host || "",
        forwardedHost: request.headers["x-forwarded-host"] || "",
        forwardedProto: request.headers["x-forwarded-proto"] || ""
      });
      return rejectUpgrade(socket, "403 Forbidden", "Relay origin rejected.");
    }
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
    let udpReady = false;
    const pending = [];
    let windowStarted = Date.now();
    let packets = 0;
    let bytes = 0;
    let reportedAuthRewrite = false;
    // ReHLTV accepts legacy spectator clients downstream. A fresh protocol 2
    // identity per WebSocket avoids duplicate spectator IDs without retaining
    // a client identifier or pretending to own a Steam account. This transport
    // must only target the HLTV listener, not the game server itself.
    const hashedCdKey = crypto.randomBytes(16).toString("hex");

    connections += 1;
    connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);

    const close = () => {
      if (closed) return;
      closed = true;
      connections -= 1;
      const remaining = (connectionsByIp.get(ip) || 1) - 1;
      if (remaining > 0) connectionsByIp.set(ip, remaining);
      else connectionsByIp.delete(ip);
      pending.length = 0;
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
    udp.connect(target.port, target.host, () => {
      udpReady = true;
      for (const packet of pending) udp.send(packet);
      pending.length = 0;
    });

    ws.on("message", (message, isBinary) => {
      const payload = Buffer.isBuffer(message) ? message : Buffer.concat(Array.isArray(message) ? message : [message]);
      if (!isBinary || payload.length < 1 || payload.length > MAX_PACKET_BYTES) return close();
      const now = Date.now();
      if (now - windowStarted >= 1000) {
        windowStarted = now;
        packets = 0;
        bytes = 0;
      }
      packets += 1;
      bytes += payload.length;
      if (packets > MAX_PACKETS_PER_SECOND || bytes > MAX_BYTES_PER_SECOND) return close();
      const outbound = target.transport === "hltv"
        ? rewriteBrowserConnect(payload, hashedCdKey)
        : payload;
      if (outbound !== payload && !reportedAuthRewrite) {
        reportedAuthRewrite = true;
        console.info(`[live-relay] ${serverKey} browser spectator using protocol 2 HLTV transport`);
      }
      if (!udpReady) {
        if (pending.length >= MAX_PENDING_UDP_PACKETS) return close();
        pending.push(outbound);
        return;
      }
      udp.send(outbound);
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

module.exports = { attachUdpRelay, registerRelayStatusRoute, TARGETS, RELAY_PATH };
