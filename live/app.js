import { LIVE_CONFIG, serverAddress } from "./config.js?v=20260826ac";
import { createXashClient, runtimeAvailable, sizeCanvas } from "./xash-adapter.js?v=20260827d";

const $ = id => document.getElementById(id);
const clientRoot = $("live-client");
const canvas = $("canvas");
const launcher = $("live-launcher");
const launchButton = $("launch-button");
const launchDetail = $("launch-detail");
const serverSelect = $("server-select");
const serverName = $("server-name");
const serverAddressText = $("server-address");
const serverState = $("server-state");
const playerName = $("player-name");
const status = $("live-status");
const loading = $("live-loading");
const loadingMessage = $("loading-message");
const loadingServer = $("loading-server");
const loadingProgress = $("loading-progress");
const loadingProgressFill = $("loading-progress-fill");
const loadingStage = $("loading-stage");
const loadingPercent = $("loading-percent");
const liveActions = $("live-actions");
const menuButton = $("menu-button");
const fullscreenButton = $("fullscreen-button");
const exitButton = $("exit-button");

let xashClient = null;
let activeServerKey = null;
const PLAYER_NAME_KEY = "tfc-player-name";

try {
  playerName.value = localStorage.getItem(PLAYER_NAME_KEY) || LIVE_CONFIG.playerName;
} catch {
  playerName.value = LIVE_CONFIG.playerName;
}

function launchErrorMessage(error) {
  const raw = error == null ? "" : String(error.message || error);
  if (!raw || raw === "Infinity" || raw === "undefined") {
    return "The TFC client aborted while loading VGUI. Rebuild is required.";
  }
  return raw;
}

function setStatus(message, state = "") {
  status.className = `live-status${state ? ` ${state}` : ""}`;
  status.querySelector("span").textContent = message;
}

function loadingState(message) {
  const download = String(message).match(/Downloading TFC assets…\s*(\d+)%/i);
  if (download) {
    const assetPercent = Math.min(100, Number(download[1]));
    return { progress: 12 + Math.round(assetPercent * .72), stage: "DOWNLOADING ASSETS" };
  }
  if (/runtime/i.test(message)) return { progress: 4, stage: "LOADING ENGINE" };
  if (/relay/i.test(message)) return { progress: 9, stage: "OPENING LIVE RELAY" };
  if (/decompress/i.test(message)) return { progress: 86, stage: "UNPACKING ASSETS" };
  if (/prepared/i.test(message)) return { progress: 91, stage: "MOUNTING GAME FILES" };
  if (/starting xash/i.test(message)) return { progress: 95, stage: "STARTING TFC" };
  if (/connecting/i.test(message)) return { progress: 100, stage: "JOINING HLTV" };
  if (/ready/i.test(message)) return { progress: 98, stage: "FINALIZING" };
  return { progress: 2, stage: "INITIALIZING" };
}

function setLoading(message) {
  const { progress, stage } = loadingState(message);
  loadingMessage.textContent = message;
  loadingStage.textContent = stage;
  loadingPercent.textContent = `${progress}%`;
  loadingProgress.setAttribute("aria-valuenow", String(progress));
  loadingProgressFill.style.width = `${progress}%`;
  setStatus(message);
}

function selectedServer() {
  const selected = LIVE_CONFIG.servers[serverSelect.value];
  return selected?.available ? selected : LIVE_CONFIG.servers.central;
}

function renderSelectedServer() {
  const server = selectedServer();
  serverName.textContent = server.name;
  serverAddressText.textContent = serverAddress(server);
  const isActive = server.key === activeServerKey;
  serverState.textContent = isActive ? "LIVE" : "READY";
  serverState.classList.toggle("live", isActive);
}

function populateServerSelect() {
  const requested = new URLSearchParams(location.search).get("server")?.toLowerCase();
  for (const server of Object.values(LIVE_CONFIG.servers)) {
    if (!server.available) continue;
    const option = document.createElement("option");
    option.value = server.key;
    option.textContent = server.name;
    serverSelect.append(option);
  }
  serverSelect.value = LIVE_CONFIG.servers[requested]?.available ? requested : "central";
  renderSelectedServer();
}

async function discoverActiveServer() {
  try {
    const response = await fetch("/api/queue", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const active = Array.isArray(payload.liveMatches)
      ? payload.liveMatches.find(match => LIVE_CONFIG.servers[String(match.serverKey || "").toLowerCase()]?.available)
      : null;
    if (!active) return;

    activeServerKey = String(active.serverKey).toLowerCase();
    if (!new URLSearchParams(location.search).has("server")) {
      serverSelect.value = activeServerKey;
    }
    renderSelectedServer();
  } catch {
    // The static client remains usable with the configured server list.
  }
}

async function detectRuntime() {
  const available = await runtimeAvailable(LIVE_CONFIG.runtimeModule);
  launchButton.disabled = !available;
  launchDetail.textContent = available ? "WASM client ready" : "Runtime build required";
  setStatus(
    available
      ? "Browser client found. Choose a server and launch."
      : "Live shell ready; waiting for the Xash3D and TF15 WASM build.",
    available ? "ready" : ""
  );
}

async function launch() {
  const server = selectedServer();
  const name = playerName.value.trim().slice(0, 31) || LIVE_CONFIG.playerName;
  playerName.value = name;
  try { localStorage.setItem(PLAYER_NAME_KEY, name); } catch {}
  launchButton.disabled = true;
  setStatus("Starting the browser spectator…");
  clientRoot.classList.add("booting");
  launcher.classList.add("hidden");
  loading.classList.remove("hidden");
  loadingServer.textContent = `${server.name} · ${serverAddress(server)}`;
  setLoading("Preparing the browser client…");
  sizeCanvas(canvas);

  try {
    xashClient = await createXashClient({
      canvas,
      config: { ...LIVE_CONFIG, playerName: name },
      server,
      onStatus: setLoading
    });
    // Leave the user in the native TFC menu, like the reference client.
    // HLTV connection is initiated from that interactive menu instead of
    // bypassing Configuration, Multiplayer, Custom Game, and Previews.
    setLoading("TFC menu ready.");
    await new Promise(resolve => window.setTimeout(resolve, 1800));
    clientRoot.classList.remove("booting");
    clientRoot.classList.add("running");
    loading.classList.add("hidden");
    liveActions.classList.remove("hidden");
    canvas.focus();
  } catch (error) {
    console.error("[live/xash] launch failed", error);
    clientRoot.classList.remove("booting");
    clientRoot.classList.remove("running");
    loading.classList.add("hidden");
    launcher.classList.remove("hidden");
    setStatus(launchErrorMessage(error), "error");
    launchButton.disabled = false;
  }
}

function exit() {
  xashClient?.quit();
  xashClient = null;
  clientRoot.classList.remove("booting");
  clientRoot.classList.remove("running");
  loading.classList.add("hidden");
  launcher.classList.remove("hidden");
  liveActions.classList.add("hidden");
  launchButton.disabled = false;
  setStatus("Browser spectator stopped.", "ready");
}

populateServerSelect();
serverSelect.addEventListener("change", renderSelectedServer);
launchButton.addEventListener("click", launch);
exitButton.addEventListener("click", exit);
menuButton.addEventListener("click", () => {
  xashClient?.command("escape");
  canvas.focus();
});
fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await clientRoot.requestFullscreen();
  sizeCanvas(canvas);
  canvas.focus();
});

await Promise.all([discoverActiveServer(), detectRuntime()]);
