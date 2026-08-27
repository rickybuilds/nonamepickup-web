import { LIVE_CONFIG } from "./config.js?v=20260826ac";
import { createXashClient, runtimeAvailable, sizeCanvas } from "./xash-adapter.js?v=20260827c";

const $ = id => document.getElementById(id);
const canvas = $("xash-canvas");
const overlay = $("overlay");
const loadingBar = $("loading-bar");
const loadingPercent = $("loading-percent");
const loadingStatus = $("loading-status");
const loadingServers = $("loading-servers");
const exitButton = $("exit-button");
let xashClient = null;

function loadingProgress(message) {
  const download = String(message).match(/Downloading TFC assets…\s*(\d+)%/i);
  if (download) return 12 + Math.round(Math.min(100, Number(download[1])) * .72);
  if (/runtime/i.test(message)) return 4;
  if (/relay/i.test(message)) return 9;
  if (/decompress/i.test(message)) return 86;
  if (/prepared/i.test(message)) return 91;
  if (/starting xash/i.test(message)) return 95;
  if (/connecting/i.test(message)) return 100;
  if (/ready/i.test(message)) return 98;
  return 2;
}

function setLoading(message) {
  const progress = loadingProgress(message);
  loadingStatus.textContent = message;
  loadingPercent.textContent = `${progress}%`;
  loadingBar.style.width = `${progress}%`;
}

function showError(error) {
  loadingStatus.classList.add("error");
  loadingStatus.textContent = String(error?.message || error || "The browser client failed to start.");
}

async function bootstrap() {
  const servers = Object.values(LIVE_CONFIG.servers).filter(server => server.available);
  loadingServers.innerHTML = `<b>${servers.length} HLTV servers available</b><br>${servers.map(server => server.name).join(" · ")}`;
  try {
    if (!await runtimeAvailable(LIVE_CONFIG.runtimeModule)) throw new Error("The Xash3D runtime has not been deployed yet.");
    sizeCanvas(canvas);
    setLoading("starting engine");
    // The central endpoint is only the initial relay anchor. Native TFC
    // Multiplayer performs the actual server selection through framed relay
    // packets, just like the reference client.
    xashClient = await createXashClient({
      canvas,
      config: LIVE_CONFIG,
      server: LIVE_CONFIG.servers.central,
      onStatus: setLoading
    });
    canvas.style.display = "block";
    overlay.classList.add("gone");
    exitButton.classList.remove("hidden");
    canvas.focus();
  } catch (error) {
    console.error("[live/xash] bootstrap failed", error);
    showError(error);
  }
}

function exit() {
  xashClient?.quit();
  xashClient = null;
  canvas.style.display = "none";
  overlay.classList.remove("gone");
  exitButton.classList.add("hidden");
}

exitButton.addEventListener("click", exit);
window.addEventListener("resize", () => sizeCanvas(canvas));
bootstrap();
