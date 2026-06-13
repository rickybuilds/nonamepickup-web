const STORAGE_KEY = "nn_tfc_server_build_v1";
const VAR_KEY = "nn_tfc_server_build_vars_v1";

const steps = [
  { title: "Deploy New Server", body: [p("Deploy Ubuntu 26.04 LTS and login as root."), cmd("ssh root@<IP_ADDRESS>"), cmd("timedatectl set-timezone America/New_York\ntimedatectl")] },
  { title: "Configure Firewall", body: [cmd("ufw allow 22/tcp\nufw allow 21/tcp\n\nufw allow 27015:27020/tcp\nufw allow 27015:27020/udp\n\nufw allow 33434:33534/udp\n\nufw allow 30000:30100/tcp\nufw allow 49000:50000/tcp\n\nufw allow 7010/tcp\n\nufw enable\nufw status numbered")] },
  { title: "Apply UDP Tuning", body: [p("Create /etc/sysctl.d/99-tfc-udp.conf."), cmd("nano /etc/sysctl.d/99-tfc-udp.conf"), cmd("net.core.rmem_max=16777216\nnet.core.rmem_default=1048576\nnet.core.wmem_max=16777216\nnet.core.wmem_default=1048576\nnet.ipv4.udp_rmem_min=8192\nnet.ipv4.udp_wmem_min=8192", "file contents"), cmd("sysctl --system\nsysctl net.core.rmem_max\nsysctl net.core.wmem_max")] },
  { title: "Install Packages", body: [cmd("apt update\n\napt install -y \\\nscreen \\\nhtop \\\ncurl \\\nwget \\\nunzip \\\nnet-tools \\\nnodejs \\\nnpm\n\nnpm install -g pm2\n\nnode -v\nnpm -v\npm2 -v")] },
  { title: "Enable 32-bit Support", body: [cmd("dpkg --add-architecture i386\napt update\n\napt install -y \\\nlib32gcc-s1 \\\nlib32stdc++6 \\\nlibc6-i386 \\\nlib32z1 \\\nlibbz2-1.0:i386\n\ndpkg --print-foreign-architectures")] },
  { title: "Copy Known-Good Server", body: [warn("Always copy /root/steamcmd from the newest known-good server, not an old/busted server."), cmd("rsync -avz --progress \\\nroot@<SOURCE_SERVER_IP>:/root/steamcmd/ \\\n/root/steamcmd/\n\nscp root@<SOURCE_SERVER_IP>:/root/hlds_run.sh /root/\nscp root@<SOURCE_SERVER_IP>:/root/hltv_run.sh /root/\nscp root@<SOURCE_SERVER_IP>:/root/tfc-health.js /root/")] },
  { title: "Fix Permissions", body: [cmd("chmod +x /root/hlds_run.sh\nchmod +x /root/hltv_run.sh\nchmod +x /root/steamcmd/steamcmd.sh\n\nfind /root/steamcmd -type f \\\n\\( -name \"*.so\" -o -name \"hlds_*\" -o -name \"hltv\" -o -name \"*.sh\" \\) \\\n-exec chmod 755 {} \\;")] },
  { title: "Create Steam Library Link", body: [cmd("mkdir -p /root/.steam/sdk32\n\nln -sf \\\n/root/steamcmd/sdk32/libsteam.so \\\n/root/.steam/sdk32/libsteam.so\n\nls -la /root/.steam/sdk32")] },
  { title: "Configure Server IP", body: [p("Edit /root/hlds_run.sh and update the +ip value."), cmd("nano /root/hlds_run.sh"), cmd("+ip <IP_ADDRESS>", "edit this line"), cmd("grep \"+ip\" /root/hlds_run.sh")] },
  { title: "Create LogPull User", body: [cmd("adduser logpull\nusermod -d /root/steamcmd/tfc/tfc logpull\nchmod o+x /root\n\ngrep logpull /etc/passwd\nsu - logpull\npwd"), p("Expected pwd: /root/steamcmd/tfc/tfc"), cmd("exit")] },
  { title: "Create HLTV Directory", body: [cmd("mkdir -p /root/steamcmd/tfc/HLTV<SERVER_NAME>"), p("This must match HL_REMOTE_HLTV_DIR_<SERVER_NAME> in the bot .env.")] },
  { title: "Start Services", body: [cmd("pm2 start /root/hlds_run.sh --name tfcserver\npm2 start /root/hltv_run.sh --name hltv\n\nSERVER_NAME=<SERVER_NAME> HEALTH_PORT=7010 \\\npm2 start /root/tfc-health.js --name tfc-health")] },
  { title: "Verify Server", body: [cmd("pm2 list\nss -ulpn | grep 27015\ncurl http://127.0.0.1:7010/health\nsu - logpull\npwd"), p("Expected logpull pwd: /root/steamcmd/tfc/tfc")] },
  { title: "Save PM2", body: [cmd("pm2 startup"), p("Run the command PM2 prints."), cmd("pm2 save")] },
  { title: "Update Bot .env", body: [p("On the bot server: cd /root/tfcbot and edit .env."), cmd("cd /root/tfcbot\nnano .env"), cmd("# -------- <SERVER_NAME> --------\n\nHL_SSH_HOST_<SERVER_NAME>=<IP_ADDRESS>\nHL_REMOTE_LOG_DIR_<SERVER_NAME>=logs\nHL_REMOTE_HLTV_DIR_<SERVER_NAME>=HLTV<SERVER_NAME>\n\nTFC_RCON_<SERVER_NAME>_HOST=<IP_ADDRESS>\nTFC_RCON_<SERVER_NAME>_PORT=27015\nTFC_RCON_<SERVER_NAME>_PASS=<RCON_PASSWORD>", ".env template")] },
  { title: "Update servers.json", body: [cmd("nano /root/tfcbot/servers.json"), cmd("{\n  \"name\": \"<DISPLAY_NAME>\",\n  \"ip\": \"<IP_ADDRESS>:27015\",\n  \"password\": \"\",\n  \"url\": \"<SERVER_URL>\"\n}", "server entry template")] },
  { title: "Update config/rcon.js", body: [cmd("nano /root/tfcbot/config/rcon.js"), cmd("if (process.env.TFC_RCON_<SERVER_NAME>_HOST) {\n  servers.<server_name_lower> = {\n    name: \"<DISPLAY_NAME>\",\n    host: process.env.TFC_RCON_<SERVER_NAME>_HOST,\n    port: parseInt(process.env.TFC_RCON_<SERVER_NAME>_PORT || \"27015\", 10),\n    password: process.env.TFC_RCON_<SERVER_NAME>_PASS,\n    url: \"<SERVER_URL>\",\n    ssh: {\n      host: process.env.HL_SSH_HOST_<SERVER_NAME> || process.env.HL_SSH_HOST,\n      port: parseInt(process.env.HL_SSH_PORT || \"22\", 10),\n      user: process.env.HL_SSH_USER,\n      pass: process.env.HL_SSH_PASS,\n    },\n    logDir: process.env.HL_REMOTE_LOG_DIR_<SERVER_NAME> || process.env.HL_REMOTE_LOG_DIR,\n    hltvDir: process.env.HL_REMOTE_HLTV_DIR_<SERVER_NAME> || process.env.HL_REMOTE_HLTV_DIR,\n  };\n}", "rcon.js template")] },
  { title: "Restart and Reload Bot", body: [cmd("pm2 restart tfcbot"), p("In Discord:"), cmd("!reloadservers\n!serverhealth\n!timeleft", "Discord commands")] },
  { title: "Final Validation", body: [p("Confirm everything works before sending players to it."), cmd("pm2 list\nss -ulpn | grep 27015\ncurl http://127.0.0.1:7010/health\nufw status numbered"), p("Expected: tfcserver online, hltv online, tfc-health online, logpull works, bot sees it, RCON works, and server can be voted on.")] }
];

function p(text) {
  return { type: "p", text };
}

function warn(text) {
  return { type: "warn", text };
}

function cmd(text, label = "command") {
  return { type: "cmd", text, label };
}

function readStoredObject(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

const state = readStoredObject(STORAGE_KEY);
const vars = readStoredObject(VAR_KEY);
const els = {
  steps: document.getElementById("steps"),
  template: document.getElementById("stepTemplate"),
  progressText: document.getElementById("progressText"),
  progressBar: document.getElementById("progressBar"),
  progressTrack: document.querySelector(".progress-track"),
  stepCount: document.getElementById("stepCount")
};
const varMap = {
  varIp: "<IP_ADDRESS>",
  varServer: "<SERVER_NAME>",
  varDisplay: "<DISPLAY_NAME>",
  varSource: "<SOURCE_SERVER_IP>",
  varRcon: "<RCON_PASSWORD>",
  varUrl: "<SERVER_URL>"
};

Object.keys(varMap).forEach((id) => {
  const input = document.getElementById(id);
  input.value = vars[id] || "";
  input.addEventListener("input", () => {
    vars[id] = input.value.trim();
    localStorage.setItem(VAR_KEY, JSON.stringify(vars));
    render();
  });
});

document.getElementById("resetProgress").addEventListener("click", () => {
  if (!confirm("Reset checklist progress?")) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

document.getElementById("expandAll").addEventListener("click", () => {
  document.querySelectorAll(".step-card:not(.locked)").forEach((card) => {
    card.classList.add("open");
    card.querySelector(".step-header").setAttribute("aria-expanded", "true");
  });
});

function replaceVars(text) {
  let output = text;

  Object.entries(varMap).forEach(([id, token]) => {
    const value = document.getElementById(id).value.trim();
    if (value) output = output.split(token).join(value);
  });

  const serverName = document.getElementById("varServer").value.trim();
  if (serverName) {
    output = output.split("<server_name_lower>").join(serverName.toLowerCase());
  }

  return output;
}

function render() {
  els.steps.replaceChildren();
  let completed = 0;

  steps.forEach((step, index) => {
    if (state[index]) completed += 1;

    const unlocked = index === 0 || state[index - 1] || state[index];
    const node = els.template.content.firstElementChild.cloneNode(true);
    const header = node.querySelector(".step-header");
    const check = node.querySelector(".done-check");
    const content = node.querySelector(".step-content");

    node.classList.toggle("locked", !unlocked);
    node.classList.toggle("done", Boolean(state[index]));
    node.classList.toggle("active", unlocked && !state[index]);

    if (unlocked && !state[index]) {
      node.classList.add("open");
      header.setAttribute("aria-expanded", "true");
    }

    node.querySelector(".step-number").textContent = index + 1;
    node.querySelector(".step-title").textContent = step.title;
    node.querySelector(".step-state").textContent = state[index] ? "Done" : unlocked ? "Open" : "Locked";

    step.body.forEach((item) => {
      if (item.type === "cmd") {
        content.appendChild(codeBlock(replaceVars(item.text), item.label));
        return;
      }

      const paragraph = document.createElement("p");
      paragraph.textContent = replaceVars(item.text);
      if (item.type === "warn") paragraph.className = "inline-warn";
      content.appendChild(paragraph);
    });

    header.addEventListener("click", () => {
      if (!unlocked) return;
      const isOpen = node.classList.toggle("open");
      header.setAttribute("aria-expanded", String(isOpen));
    });

    check.checked = Boolean(state[index]);
    check.disabled = !unlocked;
    check.addEventListener("change", () => {
      state[index] = check.checked;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
    });

    els.steps.appendChild(node);
  });

  const percent = Math.round((completed / steps.length) * 100);
  els.progressText.textContent = `${percent}% complete`;
  els.stepCount.textContent = `${completed} / ${steps.length} steps`;
  els.progressBar.style.width = `${percent}%`;
  els.progressTrack.setAttribute("aria-valuenow", String(percent));
}

function codeBlock(text, label) {
  const wrap = document.createElement("div");
  const top = document.createElement("div");
  const labelEl = document.createElement("span");
  const button = document.createElement("button");
  const pre = document.createElement("pre");
  const code = document.createElement("code");

  wrap.className = "code-wrap";
  top.className = "code-top";
  button.className = "copy-btn";
  button.type = "button";
  button.textContent = "Copy";
  labelEl.textContent = label;
  code.textContent = text;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }

    setTimeout(() => {
      button.textContent = "Copy";
    }, 1200);
  });

  pre.appendChild(code);
  top.append(labelEl, button);
  wrap.append(top, pre);
  return wrap;
}

render();
