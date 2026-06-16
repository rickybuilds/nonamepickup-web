// =============================================
// Live V2 — What is happening right now
// =============================================

(function () {
  const $ = id => document.getElementById(id);
  const fetchJSON = window.nnHelpers?.fetchJSON;
let selectedMatchId=null;
let livePollTimer=null;
let liveRequestInFlight=false;

  const fallbackEscapeHtml = value =>
    String(value ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
  const escapeHtml = window.nnHelpers?.escapeHtml || fallbackEscapeHtml;
  const escapeAttr = window.nnHelpers?.escapeAttr || (value =>
    escapeHtml(String(value ?? "").replace(/[\r\n]/g, ""))
  );
  const supporterBadge = window.nnHelpers?.supporterBadge;

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value ?? "—";
  }

  function formatAgo(ts) {
    if (!ts) return "—";
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts));
    if (diff < 5) return "just now";
    if (diff < 60) return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

	function renderMatchTabs(states){
	  const box=$("live2-match-tabs");
	  if(!box)return;

	  if(!Array.isArray(states)||states.length<=1){
		box.classList.add("hidden");
		box.innerHTML="";
		return;
	  }

	  box.classList.remove("hidden");

	  if(!selectedMatchId||!states.some(s=>String(s.match_id)===String(selectedMatchId))){
		selectedMatchId=states[0]?.match_id||null;
	  }

	  box.innerHTML=states.map(s=>`
		<button class="live2-match-tab ${String(s.match_id)===String(selectedMatchId)?"active":""}" data-match-id="${escapeAttr(s.match_id)}">
		  ${escapeHtml((s.serverKey||"").toUpperCase())}
		  <span class="live2-tab-sep">•</span>
		  <small>${escapeHtml(s.map||s.match_id)}</small>
		</button>
	  `).join("");

	  box.querySelectorAll(".live2-match-tab").forEach(btn=>{
		btn.addEventListener("click",()=>{
		  selectedMatchId=btn.dataset.matchId;
		  loadLive2();
		});
	  });
	}
  function playerId(p) {
    return p?.id || p?.player_id || "";
  }

  function playerName(p) {
    return p?.name || p?.player || p?.display_name || p?.id || "unknown";
  }

  function playerLink(p, className) {
    const id = playerId(p);
    const href = escapeAttr(`player.html?id=${encodeURIComponent(id)}`);
    const supporter = supporterBadge ? supporterBadge(id) : "";
    return `<a class="${escapeAttr(className)}" href="${href}">${escapeHtml(playerName(p))}${supporter}</a>`;
  }

  function renderQueue(queue, activeIds) {
    const slots = $("live2-queue-slots");
    if (!slots) return;

    const max = Number(queue.max || 8);
    const players = (queue.players || []).filter(p => !activeIds.has(String(p.id)));
    const count = players.length;
    const needed = Math.max(0, max - count);

    setText("live2-queue-title", `${count}/${max}`);
    setText("live2-needed", needed ? `need ${needed}` : "ready");
    setText("live2-queue-message", count ? `${count} player${count === 1 ? "" : "s"} waiting` : "Queue empty right now");

    slots.innerHTML = Array.from({ length: max }).map((_, i) => {
      const p = players[i];
      if (!p) return `<div class="live2-slot empty">Empty</div>`;
      return playerLink(p, "live2-slot filled");
    }).join("");
  }

  function renderRosters(match) {
    const team1 = $("live2-team1-roster");
    const team2 = $("live2-team2-roster");

    const blue = match?.blueTeam || [];
    const red = match?.redTeam || [];

    if (team1) {
      team1.innerHTML = blue.length
        ? blue.map(p => playerLink(p, "live2-player-pill")).join("")
        : `<div class="live2-empty">No Team 1 roster</div>`;
    }

    if (team2) {
      team2.innerHTML = red.length
        ? red.map(p => playerLink(p, "live2-player-pill")).join("")
        : `<div class="live2-empty">No Team 2 roster</div>`;
    }

    setText("live2-roster-count", `${blue.length + red.length} active`);
  }

  function renderEvents(events) {
    const box = $("live2-events");
    if (!box) return;

    const rows = Array.isArray(events) ? events : [];
    setText("live2-event-count", `${rows.length} event${rows.length === 1 ? "" : "s"}`);

    if (!rows.length) {
      box.innerHTML = `<div class="live2-idle-state"><strong>No cap events yet.</strong><span>Caps will appear here live once the bot writes them.</span></div>`;
      return;
    }

    box.innerHTML = rows.map(e => `
      <div class="live2-event">
        <div class="live2-event-icon">🏁</div>
        <div>
          <strong>${escapeHtml(e.player || "unknown")}</strong>
          <span>${escapeHtml(e.text || `Capture ${e.capNumber || ""}`)} • +${Number(e.scoreValue || 10)}</span>
        </div>
        <div class="live2-event-time">${formatAgo(e.ts)}</div>
      </div>
    `).join("");
  }

  function renderMatch(liveMatch, liveState) {
    const active = !!liveState?.active || !!liveMatch;

    $("live2-idle-state")?.classList.toggle("hidden", active);
	$("live2-last-cap")?.classList.toggle("hidden", !liveState?.lastCap);
	$("live2-timeleft-card")?.classList.toggle("hidden", !active);
	setText("live2-timeleft", active ? (liveState?.timeleft || "—") : "—");

    const pill = $("live2-status-pill");
    if (pill) pill.textContent = active ? "LIVE" : "STANDBY";

    const mapName = liveState?.map || liveMatch?.map_name || "";
    setText("live2-map-name", active ? (mapName || "Live Match") : "No active match");
    window.setMapImageFromName($("live2-map-image"), mapName, {
      containerSelector: ".live2-map-wrap"
    });

    const matchId = liveState?.match_id || liveMatch?.id || "—";
    setText("live2-intel-match", matchId);
    setText("live2-intel-map", mapName || "—");
    setText("live2-intel-round", liveState?.round || "—");
    setText("live2-intel-score", liveState?.currentScore ?? "—");
    setText("live2-updated", liveState?.updated_at ? `Updated ${formatAgo(liveState.updated_at)}` : "—");

    const link = $("live2-match-link");
    if (link) {
      link.textContent = matchId || "—";
      if (liveMatch?.hampalyzer_url) {
        link.href = liveMatch.hampalyzer_url;
        link.classList.remove("disabled");
      } else {
        link.href = "#";
      }
    }

const round = Number(liveState?.round || 0);

let roundText = "WAITING";

if (active) {

  if (round === 1) {

    roundText = "ROUND 1 LIVE";

  } else if (round === 2) {

    roundText = "ROUND 2 LIVE";

  } else {

    roundText = `ROUND ${round}`;

  }

}

setText(
  "live2-round-label",
  roundText
);
	const h1=liveState?.halfScores?.[0];
  const round1Score=h1?Math.max(Number(h1.blue||0),Number(h1.red||0)):0;
  const current=Number(liveState?.currentScore||0);

    if(!active){
      setText("live2-team1-score",0);
      setText("live2-team2-score",0);
    }else if(round===1){
      setText("live2-team1-score",current);
      setText("live2-team2-score",0);
    }else{
      setText("live2-team1-score",round1Score);
      setText("live2-team2-score",current);
    }

	setText("live2-caps", liveState?.liveCaps ?? 0);

    if (liveState?.lastCap) {
      setText("live2-last-cap-player", liveState.lastCap.player || "unknown");
      setText(
        "live2-last-cap-detail",
        `${liveState.lastCap.teamLabel || "Team"} • +${liveState.lastCap.scoreValue || 10} • ${formatAgo(liveState.lastCap.ts)}`
      );
    }

    renderEvents(liveState?.events || []);
  }

async function loadLive2(){
  if(liveRequestInFlight)return;
  liveRequestInFlight=true;

  try{
  const [matches,queue]=await Promise.all([
    fetchJSON("/api/matches?limit=50&includePending=1"),
    fetchJSON("/api/queue")
  ]);

  const dbLiveMatches=(matches.data||[]).filter(m=>m.status==="in_progress");
  const apiLiveStates=Array.isArray(queue.liveMatches)?queue.liveMatches:[];

  renderMatchTabs(apiLiveStates);

	const liveState=apiLiveStates.find(s=>String(s.match_id)===String(selectedMatchId))||apiLiveStates[0]||null;

  const liveMatch=liveState
    ? dbLiveMatches.find(m=>String(m.id)===String(liveState.match_id))||dbLiveMatches[0]||null
    : dbLiveMatches[0]||null;

  const activeIds=new Set();
  dbLiveMatches.forEach(m=>{
    [...(m.blueTeam||[]),...(m.redTeam||[])].forEach(p=>activeIds.add(String(p.id)));
  });

  window.dispatchEvent(new CustomEvent("tfcbot:live-snapshot",{
    detail:{
      queue,
      activePlayerIds:[...activeIds]
    }
  }));

  renderQueue(queue,activeIds);
  renderRosters(liveMatch);
  renderMatch(liveMatch,liveState);
  }finally{
    liveRequestInFlight=false;
  }
}

function scheduleLivePoll(){
  clearTimeout(livePollTimer);
  livePollTimer=setTimeout(async()=>{
    if(!document.hidden)await loadLive2();
    scheduleLivePoll();
  },1000);
}

  document.addEventListener("DOMContentLoaded", () => {
    loadLive2();
    scheduleLivePoll();
    document.addEventListener("visibilitychange",()=>{
      if(!document.hidden)loadLive2();
    });
  });
})();
