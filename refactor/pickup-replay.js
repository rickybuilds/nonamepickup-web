const query = new URLSearchParams(location.search);
const matchId = query.get("matchId") || "";
const round = query.get("round") || "";
const replayQuery = new URLSearchParams({ matchId, round, embed2080: "1" });
const target = `../pickup-replay.html?${replayQuery}`;
const frame = document.querySelector("#pickup-replay-frame");
frame.src = target;
document.querySelector("#standalone-replay").href = target.replace("embed2080=1", "");
document.querySelector("#replay-context").innerHTML = matchId && round
  ? `<span>MATCH / ${matchId.replace(/[&<>"']/g, "")}</span><span>ROUND / ${round.replace(/\D/g, "")}</span>`
  : "Replay match or round is missing.";
if (matchId) document.querySelector("#match-return").href = `./?view=match&id=${encodeURIComponent(matchId)}`;
