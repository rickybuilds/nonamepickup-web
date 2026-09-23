const query = new URLSearchParams(location.search);
const server = query.get("server") || "";
const targetQuery = new URLSearchParams({ embed2080: "1" });
if (server) targetQuery.set("server", server);
const target = `../pickup-live.html?${targetQuery}`;
document.querySelector("#pickup-live-frame").src = target;
document.querySelector("#standalone-live").href = target.replace("embed2080=1", "");
document.querySelector("#live-context").textContent = server
  ? `SERVER / ${server.replace(/[&<>"']/g, "")}`
  : "Choose an active match from the Live queue to open its server viewer.";
