/* ═══════════════════════════════════════════════════════════════
   NNP.JS — NoNamePUGs Application Core
   Boot → Login → OS Shell → Page Router
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const API = '../api';

/* ── Helpers ───────────────────────────────────────────────────── */
async function apiFetch(path) {
  try {
    const r = await fetch(API + path, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toLocaleString();
}

function ago(ts) {
  if (!ts) return '—';
  const s = Math.floor(Date.now()/1000) - Number(ts);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function h(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += esc(vals[i]); });
  return out;
}

function resultTag(winner) {
  const w = (winner||'').toUpperCase();
  if (w === 'BLUE') return `<span class="tag blue">BLUE</span>`;
  if (w === 'RED')  return `<span class="tag red">RED</span>`;
  if (w === 'TIE')  return `<span class="tag tie">TIE</span>`;
  return `<span class="tag">—</span>`;
}

/* ══════════════════════════════════════════════════════════════
   BOOT SEQUENCE
═══════════════════════════════════════════════════════════════ */
const BOOT_LINES = [
  { t: 0,    cls: '',     text: 'NNP-OS v1.9.9 [Team Fortress Classic Pickup Network]' },
  { t: 80,   cls: '',     text: 'Copyright (C) 1999-2026 NoNamePUGs Alliance. All rights reserved.' },
  { t: 160,  cls: '',     text: '' },
  { t: 240,  cls: '',     text: 'Initializing memory... 640K' },
  { t: 380,  cls: 'ok',   text: '  [OK]  Extended memory detected: 65536K' },
  { t: 460,  cls: '',     text: 'Loading VESA display adapter...' },
  { t: 600,  cls: 'ok',   text: '  [OK]  Display: 1024x768 256-color phosphor' },
  { t: 680,  cls: '',     text: 'Initializing network stack...' },
  { t: 850,  cls: 'ok',   text: '  [OK]  IPX/SPX bound to LAN adapter' },
  { t: 950,  cls: '',     text: 'Mounting /dev/tfc0 (Team Fortress Classic game server)...' },
  { t: 1150, cls: 'ok',   text: '  [OK]  2FORT.BSP loaded, 64MB map cache' },
  { t: 1250, cls: '',     text: 'Starting pickup queue daemon...' },
  { t: 1420, cls: 'ok',   text: '  [OK]  nnp-queued running on port 6789' },
  { t: 1520, cls: '',     text: 'Loading statistics database...' },
  { t: 1700, cls: 'ok',   text: '  [OK]  SQLite v3 attached: nnp_stats.db' },
  { t: 1800, cls: '',     text: 'Checking leaderboard integrity...' },
  { t: 2000, cls: 'ok',   text: '  [OK]  Leaderboard verified: no corruption detected' },
  { t: 2100, cls: '',     text: '' },
  { t: 2200, cls: 'warn', text: '  [!!]  Server notice: You are accessing a private pickup system.' },
  { t: 2320, cls: 'warn', text: '        Unauthorized access will result in PERMABAN and rocket spam.' },
  { t: 2440, cls: '',     text: '' },
  { t: 2600, cls: 'ok',   text: 'NNP-OS boot complete. Starting login manager...' },
];

function runBoot() {
  return new Promise(resolve => {
    const screen      = document.getElementById('boot-screen');
    const container   = document.getElementById('boot-lines');
    const progressBar = document.getElementById('boot-progress-bar');
    const progressLbl = document.getElementById('boot-progress-label');

    let i = 0;
    function next() {
      if (i >= BOOT_LINES.length) {
        if (progressBar) progressBar.style.width = '100%';
        if (progressLbl) progressLbl.textContent  = 'BOOT COMPLETE';
        setTimeout(() => {
          screen.classList.add('done');
          setTimeout(resolve, 420);
        }, 350);
        return;
      }
      const line = BOOT_LINES[i++];
      const el   = document.createElement('div');
      el.className = 'boot-line ' + (line.cls || '');
      el.textContent = line.text;
      container.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      container.scrollTop = container.scrollHeight;

      // Progress bar
      const pct = Math.round((i / BOOT_LINES.length) * 100);
      if (progressBar) progressBar.style.width = pct + '%';
      if (progressLbl && line.text.trim()) progressLbl.textContent = line.text.replace(/^\s*\[..\]\s*/, '').trim().substring(0, 60) || 'LOADING...';

      const nextLine = BOOT_LINES[i];
      const delay    = nextLine ? Math.max(nextLine.t - line.t, 18) : 350;
      setTimeout(next, delay);
    }
    setTimeout(next, BOOT_LINES[0].t || 0);
  });
}

/* ══════════════════════════════════════════════════════════════
   LOGIN
═══════════════════════════════════════════════════════════════ */
function showLogin() {
  return new Promise(resolve => {
    const screen = document.getElementById('login-screen');
    screen.classList.add('active');

    const form   = document.getElementById('login-form');
    const status = document.getElementById('login-status');
    const input  = document.getElementById('login-handle');
    const btn    = document.getElementById('login-submit');
    setTimeout(() => input?.focus(), 150);

    form.addEventListener('submit', e => {
      e.preventDefault();
      const val = (input.value || '').trim();

      if (!val) {
        status.textContent = '> ERROR: Callsign required.';
        status.className = 'err';
        input.focus();
        return;
      }

      // Typing feedback
      btn.disabled    = true;
      btn.textContent = '▶   AUTHENTICATING…';
      status.textContent = `> Checking credentials for "${val.toUpperCase()}"…`;
      status.className = '';

      setTimeout(() => {
        status.textContent = '> Verifying pickup privileges…';
      }, 380);

      setTimeout(() => {
        status.textContent = `> Access granted. Welcome back, ${val.toUpperCase()}.`;
        status.className = 'ok';
        sessionStorage.setItem('nnp_handle', val);

        setTimeout(() => {
          screen.style.transition = 'opacity .45s';
          screen.style.opacity    = '0';
          screen.style.pointerEvents = 'none';
          setTimeout(() => { screen.style.display = 'none'; resolve(val); }, 460);
        }, 700);
      }, 900);
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   OS SHELL CHROME
═══════════════════════════════════════════════════════════════ */
function startClock() {
  const el = document.getElementById('topbar-clock');
  function tick() {
    const now = new Date();
    const d = now.toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'});
    const t = now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    el.textContent = `${d} ${t}`;
  }
  tick();
  setInterval(tick, 1000);
}

function updateTaskbar(path, msg) {
  document.getElementById('taskbar-path').textContent = path || '';
  document.getElementById('taskbar-msg').textContent  = msg  || '';
}

async function pollStatus() {
  const data = await apiFetch('/health');
  const dot  = document.getElementById('status-dot');
  const txt  = document.getElementById('status-text');
  if (data?.ok) {
    dot.className = 'dot on';
    txt.textContent = 'ONLINE';
  } else {
    dot.className = 'dot';
    txt.textContent = 'OFFLINE';
  }
}

async function pollQueue() {
  const data = await apiFetch('/queue');
  if (!data) return;

  const count = data.count || 0;
  const badge = document.getElementById('nav-queue-badge');
  if (badge) {
    badge.textContent = `${count}/8`;
    badge.className = count > 0 ? 'badge queue' : 'badge';
  }

  const liveBadge = document.getElementById('nav-live-badge');
  const lives = data.liveMatches || [];
  if (liveBadge) {
    liveBadge.textContent = lives.length;
    liveBadge.className = lives.length > 0 ? 'badge live' : 'badge';
  }

  // Update server widget
  updateServerWidget(count, data.max || 8, lives.length);
}

function updateServerWidget(q, max, live) {
  const el = document.getElementById('server-widget-body');
  if (!el) return;
  el.innerHTML = `
    <div class="server-widget-row"><span>Queue:</span><span>${q}/${max}</span></div>
    <div class="server-widget-row"><span>Live:</span><span>${live > 0 ? `<span style="color:var(--red)">${live} match${live>1?'es':''}</span>` : '—'}</span></div>
  `;
}

/* ══════════════════════════════════════════════════════════════
   ROUTER — single-page app
═══════════════════════════════════════════════════════════════ */
const ROUTES = {
  'home':        renderHome,
  'queue':       renderQueue,
  'matches':     renderMatches,
  'match':       renderMatchDetail,
  'leaderboard': renderLeaderboard,
  'analytics':   renderAnalytics,
  'compare':     renderCompare,
  'maps':        renderMaps,
  'vegas':       renderVegas,
  'about':       renderAbout,
};

let currentRoute = null;

function navigate(route, param) {
  currentRoute = { route, param };
  window._currentRoute = { route, param };

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });

  // Render
  const content = document.getElementById('content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--g1);font-family:var(--font-mono)">Loading...</div>';

  const fn = ROUTES[route];
  if (fn) {
    fn(content, param).catch(err => {
      content.innerHTML = `<div style="padding:20px;color:var(--red);font-family:var(--font-mono)">ERROR: ${esc(err.message)}</div>`;
    });
  } else {
    content.innerHTML = `<div style="padding:20px;color:var(--amb);font-family:var(--font-mono)">404: Route not found — ${esc(route)}</div>`;
  }

  // Scroll top
  content.scrollTop = 0;
}

/* ══════════════════════════════════════════════════════════════
   PAGE: HOME
═══════════════════════════════════════════════════════════════ */
async function renderHome(el) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title glitch" data-text="NONAMEPUGS">NONAMEPUGS</div>
        <div class="page-subtitle">TEAM FORTRESS CLASSIC PICKUP NETWORK // EST. 1999</div>
      </div>
      <div class="page-actions">
        <a href="https://discord.gg/nonamepickups" target="_blank" class="btn btn-primary btn-lg">► JOIN DISCORD</a>
      </div>
    </div>

    <div style="padding:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:4px" id="home-stats">
      <div class="stat-box"><div class="stat-box-val" id="hs-matches">…</div><div class="stat-box-label">Total Matches</div></div>
      <div class="stat-box amber"><div class="stat-box-val" id="hs-players">…</div><div class="stat-box-label">Players</div></div>
      <div class="stat-box"><div class="stat-box-val" id="hs-today">…</div><div class="stat-box-label">Games Today</div></div>
      <div class="stat-box red"><div class="stat-box-val" id="hs-streak">…</div><div class="stat-box-label">Win Streak</div></div>
    </div>

    <div class="grid-2" style="gap:0;border-top:1px solid var(--g1)">
      <!-- Queue -->
      <div style="border-right:1px solid var(--g1)">
        <div class="panel-header" style="margin:0">
          <span class="panel-header-title">▶ LIVE QUEUE</span>
          <span id="home-queue-count" style="color:var(--amb)">—/8</span>
        </div>
        <div class="queue-grid" id="home-queue-slots">
          ${Array(8).fill(0).map((_,i)=>`<div class="queue-slot empty"><span class="slot-num">${String(i+1).padStart(2,'0')}</span><span>EMPTY</span></div>`).join('')}
        </div>
        <div style="padding:8px 10px;border-top:1px solid var(--dim)">
          <a href="https://discord.gg/nonamepickups" target="_blank" class="btn btn-primary w-full" style="display:block;text-align:center">JOIN VIA DISCORD</a>
        </div>
      </div>

      <!-- Recent matches -->
      <div>
        <div class="panel-header" style="margin:0">
          <span class="panel-header-title">▶ RECENT MATCHES</span>
          <button class="btn btn-sm" onclick="navigate('matches')">VIEW ALL</button>
        </div>
        <div id="home-matches">
          <div style="padding:20px;color:var(--g1);font-family:var(--font-mono);font-size:.8rem">Loading…</div>
        </div>
      </div>
    </div>

    <!-- Analytics highlight bar -->
    <div style="border-top:1px solid var(--g1)">
      <div class="panel-header" style="margin:0">
        <span class="panel-header-title">▶ ALL-TIME LEADERS</span>
        <button class="btn btn-sm" onclick="navigate('analytics')">FULL ANALYTICS</button>
      </div>
      <div id="home-leaders" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0;border-top:1px solid var(--dim)">
        <div style="padding:16px;color:var(--g1);font-size:.8rem">Loading…</div>
      </div>
    </div>

    <!-- Live matches -->
    <div style="border-top:1px solid var(--g1)">
      <div class="panel-header" style="margin:0">
        <span class="panel-header-title" style="color:var(--red)">◉ LIVE MATCHES</span>
        <span id="home-live-count" class="text-xs text-dim">—</span>
      </div>
      <div id="home-live" style="padding:10px">
        <div style="color:var(--g1);font-size:.8rem;font-family:var(--font-mono)">No live matches right now.</div>
      </div>
    </div>
  `;

  updateTaskbar('/home', 'Home screen loaded');

  // Load all in parallel
  const [summary, queue, matches, analytics, streaks] = await Promise.all([
    apiFetch('/stats/summary'),
    apiFetch('/queue'),
    apiFetch('/matches?limit=8'),
    apiFetch('/analytics?limit=5'),
    apiFetch('/stats/streaks'),
  ]);

  // Stats
  if (summary?.data) {
    document.getElementById('hs-matches').textContent = fmt(summary.data.totalMatches);
    document.getElementById('hs-today').textContent   = fmt(summary.data.matches1d);
  }
  if (analytics?.data?.summary) {
    document.getElementById('hs-players').textContent = fmt(analytics.data.summary.players);
  }
  if (streaks?.data?.currentStreak) {
    document.getElementById('hs-streak').textContent = `${streaks.data.currentStreak.wins}W`;
  } else {
    document.getElementById('hs-streak').textContent = '—';
  }

  // Queue
  if (queue) renderHomeQueue(queue);

  // Matches
  if (matches?.data) renderHomeMatches(matches.data);

  // Analytics leaders
  if (analytics?.data) renderHomeLeaders(analytics.data);

  // Start polling
  window._homeQueueInterval = setInterval(async () => {
    const q = await apiFetch('/queue');
    if (q) renderHomeQueue(q);
  }, 8000);
}

function renderHomeQueue(data) {
  const slots = document.getElementById('home-queue-slots');
  const count = document.getElementById('home-queue-count');
  if (!slots) return;

  const players = data.players || [];
  const max = data.max || 8;
  count.textContent = `${players.length}/${max}`;

  slots.innerHTML = Array(max).fill(0).map((_, i) => {
    const p = players[i];
    if (p) return `<div class="queue-slot filled">
      <span class="slot-num">${String(i+1).padStart(2,'0')}</span>
      <span class="truncate">${esc(p.name || p.id)}</span>
    </div>`;
    return `<div class="queue-slot empty">
      <span class="slot-num">${String(i+1).padStart(2,'0')}</span>
      <span>EMPTY</span>
    </div>`;
  }).join('');

  // Live matches
  const lives = data.liveMatches || [];
  const liveEl = document.getElementById('home-live');
  const liveCnt = document.getElementById('home-live-count');
  if (!liveEl) return;
  liveCnt.textContent = lives.length ? `${lives.length} ACTIVE` : 'NONE';
  if (lives.length) {
    liveEl.innerHTML = lives.map(m => `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 9px;border:1px solid var(--red);background:rgba(220,38,38,.05);margin-bottom:4px">
        <span class="dot live"></span>
        <span class="text-term text-lg" style="color:#f87171">${esc(m.map_name || m.serverKey || 'UNKNOWN')}</span>
        <span class="text-xs text-dim" style="margin-left:auto">${esc(m.serverKey || '')}</span>
        <span class="tag live">LIVE</span>
      </div>
    `).join('');
  } else {
    liveEl.innerHTML = `<div style="color:var(--g1);font-size:.8rem;font-family:var(--font-mono)">No live matches right now.</div>`;
  }
}

function renderHomeMatches(matches) {
  const el = document.getElementById('home-matches');
  if (!el) return;
  if (!matches.length) { el.innerHTML = `<div style="padding:16px;color:var(--g1);font-size:.8rem">No matches found.</div>`; return; }

  el.innerHTML = `<table class="term-table">
    <thead><tr>
      <th>#</th><th>Map</th><th>Score</th><th>Winner</th><th class="right">When</th>
    </tr></thead>
    <tbody>
    ${matches.map((m, i) => `<tr style="cursor:pointer" onclick="navigate('match','${esc(m.id)}')">
      <td class="text-dim text-xs">${String(i+1).padStart(2,'0')}</td>
      <td><span style="color:var(--g3)">${esc(m.map_name || '—')}</span></td>
      <td>${m.score_blue != null ? `<span style="color:var(--blu2)">${m.score_blue}</span><span class="text-dim">–</span><span style="color:#f87171">${m.score_red}</span>` : '—'}</td>
      <td>${resultTag(m.winner)}</td>
      <td class="right text-dim text-xs">${ago(m.created_at)}</td>
    </tr>`).join('')}
    </tbody>
  </table>`;
}

function renderHomeLeaders(data) {
  const el = document.getElementById('home-leaders');
  if (!el) return;

  const sections = [
    { label: '★ MVP KING',      players: data.mvps,              val: p => `${p.value} mvp games`,     color: 'var(--amb)' },
    { label: '☠ TOP FRAGGER',   players: data.combat?.kills,     val: p => `${fmt(p.value)} kills`,    color: 'var(--red)' },
    { label: '⚑ FLAG LEGEND',   players: data.flags?.caps,       val: p => `${p.value} caps`,          color: 'var(--g3)' },
    { label: '⚡ TOP DAMAGE',    players: data.combat?.enemy_damage, val: p => `${fmt(p.value)} dmg`,  color: 'var(--blu2)' },
  ];

  el.innerHTML = sections.map(s => {
    const top = (s.players || [])[0];
    return `<div style="border-right:1px solid var(--dim);padding:12px 14px">
      <div style="font-size:.62rem;color:var(--g1);letter-spacing:.15em;text-transform:uppercase;margin-bottom:6px">${s.label}</div>
      ${top ? `
        <div style="font-family:var(--font-term);font-size:1.3rem;color:${s.color};text-shadow:0 0 8px ${s.color}">${esc(top.player)}</div>
        <div style="font-size:.7rem;color:var(--g1);margin-top:2px">${s.val(top)}</div>
        <div style="margin-top:8px">
          ${(s.players||[]).slice(1,4).map(p=>`<div style="font-size:.75rem;color:var(--g1);padding:2px 0;border-bottom:1px solid var(--dim);display:flex;justify-content:space-between">
            <span>${esc(p.player)}</span><span style="color:var(--g2)">${s.val(p)}</span>
          </div>`).join('')}
        </div>
      ` : `<div style="color:var(--g1);font-size:.8rem">No data</div>`}
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   PAGE: QUEUE / LOBBY
═══════════════════════════════════════════════════════════════ */
async function renderQueue(el) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">PICKUP LOBBY</div>
        <div class="page-subtitle">REAL-TIME QUEUE STATUS // AUTO-REFRESHES EVERY 5s</div>
      </div>
      <div class="page-actions">
        <a href="https://discord.gg/nonamepickups" target="_blank" class="btn btn-primary btn-lg">► JOIN VIA DISCORD</a>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid var(--g1)">
      <div style="border-right:1px solid var(--g1)">
        <div class="panel-header" style="margin:0">
          <span class="panel-header-title">▶ CURRENT QUEUE</span>
          <span id="q-count" style="color:var(--amb);font-family:var(--font-mono);font-size:.75rem">—/8</span>
        </div>

        <!-- Progress bar -->
        <div style="padding:10px;border-bottom:1px solid var(--dim)">
          <div class="bar-wrap">
            <div class="bar-fill amb" id="q-bar" style="width:0%"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:.65rem;color:var(--g1)">
            <span>0 players</span><span>8 players (match starts)</span>
          </div>
        </div>

        <div class="queue-grid" id="q-slots"></div>

        <div style="padding:8px 10px 10px;border-top:1px solid var(--dim)">
          <div style="font-size:.7rem;color:var(--g1);font-family:var(--font-mono);margin-bottom:6px">Queue fills at 8 → match auto-starts. Join via Discord bot.</div>
          <a href="https://discord.gg/nonamepickups" target="_blank" class="btn btn-primary" style="display:block;text-align:center">JOIN QUEUE ON DISCORD</a>
        </div>
      </div>

      <div>
        <div class="panel-header" style="margin:0">
          <span class="panel-header-title" style="color:var(--red)">◉ LIVE MATCHES</span>
          <span id="q-live-count" class="text-xs text-dim">NONE</span>
        </div>
        <div id="q-live" style="padding:10px;min-height:120px">
          <div style="color:var(--g1);font-size:.8rem">No live matches.</div>
        </div>
      </div>
    </div>

    <!-- How it works -->
    <div style="padding:14px 16px;border-top:1px solid var(--dim)">
      <div class="panel-header" style="margin:0 0 10px"><span class="panel-header-title">▶ HOW PICKUPS WORK</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;font-family:var(--font-mono);font-size:.8rem;color:var(--g2)">
        <div><div style="color:var(--amb);margin-bottom:3px">01 JOIN DISCORD</div>Find #pickups channel. Type !add to queue.</div>
        <div><div style="color:var(--amb);margin-bottom:3px">02 WAIT FOR 8</div>Queue fills to 8 players. Captains picked randomly.</div>
        <div><div style="color:var(--amb);margin-bottom:3px">03 DRAFT TEAMS</div>Captains alternate picks. Classic 4v4 TFC format.</div>
        <div><div style="color:var(--amb);margin-bottom:3px">04 PLAY &amp; WIN</div>Match runs on dedicated server. Stats recorded auto.</div>
      </div>
    </div>

    <div style="padding:4px 12px 12px;font-size:.65rem;color:var(--g1);font-family:var(--font-mono);text-align:right">
      Last updated: <span id="q-updated">—</span>
    </div>
  `;

  updateTaskbar('/queue', 'Pickup lobby');

  async function refresh() {
    const data = await apiFetch('/queue');
    if (!data) return;

    const players = data.players || [];
    const max = data.max || 8;
    const lives = data.liveMatches || [];

    // Count / bar
    document.getElementById('q-count').textContent = `${players.length}/${max}`;
    document.getElementById('q-bar').style.width = `${(players.length/max)*100}%`;
    document.getElementById('q-updated').textContent = new Date().toLocaleTimeString();

    // Slots
    const slots = document.getElementById('q-slots');
    slots.innerHTML = Array(max).fill(0).map((_, i) => {
      const p = players[i];
      if (p) return `<div class="queue-slot filled">
        <span class="slot-num">${String(i+1).padStart(2,'0')}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name || p.id)}</span>
        ${p.lastSeenAt ? `<span style="margin-left:auto;font-size:.62rem;color:var(--g1)">${ago(Math.floor(p.lastSeenAt/1000))}</span>` : ''}
      </div>`;
      return `<div class="queue-slot empty">
        <span class="slot-num">${String(i+1).padStart(2,'0')}</span>
        <span>EMPTY SLOT</span>
      </div>`;
    }).join('');

    // Live
    const liveEl  = document.getElementById('q-live');
    const liveCnt = document.getElementById('q-live-count');
    liveCnt.textContent = lives.length ? `${lives.length} ACTIVE` : 'NONE';
    liveEl.innerHTML = lives.length ? lives.map(m => `
      <div style="border:1px solid rgba(220,38,38,.4);background:rgba(220,38,38,.04);padding:10px 12px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span class="dot live"></span>
          <span class="text-term" style="font-size:1.4rem;color:#f87171">${esc(m.map_name || 'UNKNOWN MAP')}</span>
          <span class="tag live" style="margin-left:auto">LIVE</span>
        </div>
        <div style="font-size:.7rem;color:var(--g1);font-family:var(--font-mono)">
          SERVER: ${esc(m.serverKey || '—')} //
          STARTED: ${m.updated_at ? ago(m.updated_at) : '—'}
        </div>
      </div>
    `).join('') : `<div style="color:var(--g1);font-size:.8rem;font-family:var(--font-mono);padding:12px 0">No live matches right now.</div>`;
  }

  await refresh();
  window._queueInterval = setInterval(refresh, 5000);
}

/* ══════════════════════════════════════════════════════════════
   PAGE: MATCHES
═══════════════════════════════════════════════════════════════ */
async function renderMatches(el) {
  let offset = 0;
  const limit = 30;
  let total   = 0;
  let loading = false;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">MATCH HISTORY</div>
        <div class="page-subtitle">ALL RECORDED PICKUP GAMES // CLICK ROW FOR DETAILS</div>
      </div>
    </div>

    <div style="padding:8px 12px;border-bottom:1px solid var(--g1);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="text-xs text-dim">FILTER:</span>
      <button class="btn btn-sm active-filter" data-map="" style="border-color:var(--g2)" id="filter-all">ALL MAPS</button>
      <span id="map-filters" style="display:contents"></span>
      <span style="margin-left:auto;font-size:.72rem;color:var(--g1)" id="match-count-label">Loading…</span>
    </div>

    <div id="matches-body">
      <table class="term-table" style="position:relative">
        <thead style="position:sticky;top:0;z-index:10">
          <tr>
            <th style="width:30px">#</th>
            <th>Map</th>
            <th>Blue Team</th>
            <th>Red Team</th>
            <th class="right">Score</th>
            <th class="right">Result</th>
            <th class="right">When</th>
          </tr>
        </thead>
        <tbody id="matches-tbody">
          <tr><td colspan="7" style="padding:30px;text-align:center;color:var(--g1)">Loading…</td></tr>
        </tbody>
      </table>
    </div>

    <div style="padding:10px;text-align:center;border-top:1px solid var(--dim)" id="matches-pager">
      <button class="btn" id="load-more-btn">LOAD MORE MATCHES</button>
    </div>
  `;

  updateTaskbar('/matches', 'Match history');

  let mapFilter = '';

  async function load(reset) {
    if (loading) return;
    loading = true;
    if (reset) { offset = 0; document.getElementById('matches-tbody').innerHTML = `<tr><td colspan="7" style="padding:30px;text-align:center;color:var(--g1)">Loading…</td></tr>`; }

    const data = await apiFetch(`/matches?limit=${limit}&offset=${offset}`);
    loading = false;
    if (!data?.data) return;

    total = data.total || 0;
    const matches = mapFilter ? data.data.filter(m => m.map_name === mapFilter) : data.data;

    document.getElementById('match-count-label').textContent = `${total.toLocaleString()} total matches`;

    const tbody = document.getElementById('matches-tbody');
    if (reset) tbody.innerHTML = '';

    const rows = matches.map((m, i) => {
      const blueNames = (m.blueTeam||[]).map(p=>p.name).join(', ') || '—';
      const redNames  = (m.redTeam||[]).map(p=>p.name).join(', ')  || '—';
      const num = offset + i + 1;
      return `<tr style="cursor:pointer" onclick="navigate('match','${esc(m.id)}')">
        <td class="text-dim text-xs">${String(num).padStart(3,'0')}</td>
        <td><span style="color:var(--g3)">${esc(m.map_name||'—')}</span></td>
        <td><span style="color:var(--blu2);font-size:.75rem" class="truncate">${esc(blueNames)}</span></td>
        <td><span style="color:#f87171;font-size:.75rem" class="truncate">${esc(redNames)}</span></td>
        <td class="right">${m.score_blue!=null ? `<span style="color:var(--blu2)">${m.score_blue}</span><span class="text-dim">–</span><span style="color:#f87171">${m.score_red}</span>` : '—'}</td>
        <td class="right">${resultTag(m.winner)}</td>
        <td class="right text-dim text-xs">${ago(m.created_at)}</td>
      </tr>`;
    }).join('');
    tbody.insertAdjacentHTML('beforeend', rows);

    offset += limit;
    const btn = document.getElementById('load-more-btn');
    if (btn) btn.style.display = offset >= total ? 'none' : '';

    // Build map filter buttons from unique maps in results
    if (reset) {
      const maps = [...new Set(data.data.map(m=>m.map_name).filter(Boolean))];
      const mf = document.getElementById('map-filters');
      mf.innerHTML = maps.slice(0,8).map(map => `<button class="btn btn-sm" data-map="${esc(map)}" onclick="setMapFilter('${esc(map)}')">${esc(map.toUpperCase())}</button>`).join('');
    }
  }

  window.setMapFilter = (map) => {
    mapFilter = map === mapFilter ? '' : map;
    load(true);
  };

  document.getElementById('load-more-btn')?.addEventListener('click', () => load(false));
  document.getElementById('filter-all')?.addEventListener('click', () => { mapFilter=''; load(true); });

  await load(true);
}

/* ══════════════════════════════════════════════════════════════
   PAGE: MATCH DETAIL
═══════════════════════════════════════════════════════════════ */
async function renderMatchDetail(el, matchId) {
  if (!matchId) { el.innerHTML = '<div style="padding:20px;color:var(--red)">No match ID specified.</div>'; return; }

  el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--g1);font-family:var(--font-mono)">Loading match ${esc(matchId)}…</div>`;

  const data = await apiFetch(`/match/${matchId}`);
  if (!data?.match) {
    el.innerHTML = `<div style="padding:20px;color:var(--red);font-family:var(--font-mono)">Match not found: ${esc(matchId)}</div>`;
    return;
  }

  const m = data.match;
  const blueTeam = m.player_stats?.filter(p => p.team === 'BLUE') || [];
  const redTeam  = m.player_stats?.filter(p => p.team === 'RED')  || [];

  updateTaskbar(`/match/${matchId}`, `${m.map_name || 'Unknown'} — ${m.score_blue??'?'}:${m.score_red??'?'}`);

  const mvpLine = m.match_mvps?.length
    ? m.match_mvps.map(mvp => `★ ${esc(mvp.mvp_display_name)} (rds ${mvp.rounds?.join(',')||'?'})`).join('  ·  ')
    : null;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${esc((m.map_name||'UNKNOWN').toUpperCase())}</div>
        <div class="page-subtitle">MATCH #${esc(matchId)} // ${m.created_at ? new Date(m.created_at*1000).toLocaleString() : '—'}</div>
      </div>
      <div class="page-actions">
        ${m.hampalyzer_url ? `<a href="${esc(m.hampalyzer_url)}" target="_blank" class="btn">VIEW HAMPALYZER ↗</a>` : ''}
        <button class="btn" onclick="navigate('matches')">← BACK</button>
      </div>
    </div>

    <!-- Scoreboard -->
    <div class="match-scoreboard">
      <div class="team-block blue">
        <div class="team-name-label">BLUE TEAM</div>
        ${blueTeam.map(p=>`<div style="font-size:.8rem;color:var(--g2)">${esc(p.display_name||'—')}</div>`).join('')}
      </div>
      <div class="score-center">
        <div class="score-display">
          <span style="color:var(--blu2)">${m.score_blue??'?'}</span>
          <span class="score-sep">:</span>
          <span style="color:#f87171">${m.score_red??'?'}</span>
        </div>
        <div class="score-map">${resultTag(m.winner)}</div>
        ${mvpLine ? `<div style="margin-top:8px;font-size:.65rem;color:var(--amb)">${mvpLine}</div>` : ''}
      </div>
      <div class="team-block red" style="text-align:right">
        <div class="team-name-label">RED TEAM</div>
        ${redTeam.map(p=>`<div style="font-size:.8rem;color:var(--g2)">${esc(p.display_name||'—')}</div>`).join('')}
      </div>
    </div>

    <!-- Player stats table -->
    <div style="margin:12px;border:1px solid var(--g1)">
      <div class="panel-header" style="margin:0">
        <span class="panel-header-title">▶ PLAYER STATISTICS</span>
      </div>
      <div style="overflow-x:auto">
        <table class="term-table">
          <thead><tr>
            <th>Player</th><th>Team</th><th>Class</th>
            <th class="right">K</th><th class="right">D</th><th class="right">KDR</th>
            <th class="right">DMG</th><th class="right">CAPS</th><th class="right">TOUCHES</th>
          </tr></thead>
          <tbody>
            ${(m.player_stats||[]).sort((a,b)=>b.kills-a.kills).map(p => {
              const kdr = p.deaths ? (p.kills/p.deaths).toFixed(2) : p.kills.toFixed(2);
              const teamColor = p.team === 'BLUE' ? 'var(--blu2)' : p.team === 'RED' ? '#f87171' : 'var(--g2)';
              return `<tr>
                <td style="color:var(--g3)">${esc(p.display_name||'—')}</td>
                <td><span style="color:${teamColor}">${esc(p.team||'?')}</span></td>
                <td class="text-xs text-dim">${esc(p.main_class||'—')}</td>
                <td class="right" style="color:var(--g3)">${p.kills}</td>
                <td class="right text-dim">${p.deaths}</td>
                <td class="right" style="color:${parseFloat(kdr)>=1?'var(--g3)':'#f87171'}">${kdr}</td>
                <td class="right text-dim">${fmt(p.damage)}</td>
                <td class="right" style="color:var(--amb)">${p.caps}</td>
                <td class="right text-dim">${p.touches}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Rounds if available -->
    ${m.rounds?.length ? `
    <div style="margin:12px;border:1px solid var(--g1)">
      <div class="panel-header" style="margin:0"><span class="panel-header-title">▶ ROUNDS</span></div>
      <table class="term-table">
        <thead><tr>
          <th>Rnd</th><th>Map</th><th>Offense</th><th>Defense</th>
          <th class="right">Score</th><th class="right">Duration</th>
        </tr></thead>
        <tbody>
          ${m.rounds.map(r=>`<tr>
            <td class="text-dim">${r.round_num}</td>
            <td style="color:var(--g3)">${esc(r.map_name||'—')}</td>
            <td class="text-dim">${esc(r.offense_team||'—')}</td>
            <td class="text-dim">${esc(r.defense_team||'—')}</td>
            <td class="right">${r.team1_score}–${r.team2_score}</td>
            <td class="right text-xs text-dim">${r.duration_seconds ? Math.floor(r.duration_seconds/60)+'m' : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
  `;
}

/* ══════════════════════════════════════════════════════════════
   PAGE: LEADERBOARD
═══════════════════════════════════════════════════════════════ */
async function renderLeaderboard(el) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">LEADERBOARD</div>
        <div class="page-subtitle">ELO RANKINGS // LIVE RATINGS</div>
      </div>
    </div>
    <div id="lb-body" style="padding:12px">
      <div style="color:var(--g1);font-family:var(--font-mono)">Loading…</div>
    </div>
  `;

  updateTaskbar('/leaderboard', 'ELO rankings');

  const data = await apiFetch('/leaderboard');
  const players = data?.data || data?.players || (Array.isArray(data) ? data : []);
  const lbEl = document.getElementById('lb-body');

  if (!players.length) {
    lbEl.innerHTML = '<div style="color:var(--g1);font-family:var(--font-mono)">No leaderboard data.</div>';
    return;
  }

  // Determine max elo for bar
  const maxElo = Math.max(...players.map(p => p.rating || p.elo || p.score || 0));

  lbEl.innerHTML = `
    <table class="term-table">
      <thead><tr>
        <th style="width:40px">RANK</th>
        <th>PLAYER</th>
        <th class="right">ELO</th>
        <th style="width:140px"></th>
        <th class="right">W</th>
        <th class="right">L</th>
        <th class="right">GP</th>
        <th class="right">WIN%</th>
      </tr></thead>
      <tbody>
        ${players.slice(0,50).map((p, i) => {
          const rank = i + 1;
          const elo  = Math.round(p.rating || p.elo || p.score || 0);
          const w    = p.wins   || p.w   || 0;
          const l    = p.losses || p.l   || 0;
          const gp   = p.games  || (w+l) || 0;
          const pct  = gp ? Math.round(w/gp*100) : 0;
          const name = p.display_name || p.name || p.player || String(p.player_id || p.id || '?');
          const rankClass = rank===1?'rank-1':rank===2?'rank-2':rank===3?'rank-3':'';
          const barW = maxElo ? Math.round((elo/maxElo)*100) : 0;
          const medal = rank===1?'🥇 ':rank===2?'🥈 ':rank===3?'🥉 ':'';
          return `<tr class="${rankClass}" style="cursor:pointer" onclick="navigate('compare')">
            <td style="color:var(--g1);text-align:center">${rank}</td>
            <td>
              <span style="font-family:var(--font-term);font-size:1.05rem">${medal}${esc(name)}</span>
            </td>
            <td class="right" style="font-family:var(--font-term);font-size:1.1rem">${elo || '—'}</td>
            <td>
              <div class="bar-wrap" style="height:4px">
                <div class="bar-fill ${rank<=3?'amb':''}" style="width:${barW}%"></div>
              </div>
            </td>
            <td class="right text-xs" style="color:var(--g3)">${w}</td>
            <td class="right text-xs" style="color:#f87171">${l}</td>
            <td class="right text-xs text-dim">${gp}</td>
            <td class="right text-xs" style="color:${pct>=50?'var(--g3)':'#f87171'}">${pct}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

/* ══════════════════════════════════════════════════════════════
   PAGE: ANALYTICS
═══════════════════════════════════════════════════════════════ */
async function renderAnalytics(el) {
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ANALYTICS</div><div class="page-subtitle">ALL-TIME STATISTICS // TOP 10 EACH CATEGORY</div></div>
    </div>
    <div style="padding:20px;text-align:center;color:var(--g1);font-family:var(--font-mono)">Loading analytics…</div>
  `;

  updateTaskbar('/analytics', 'All-time stats');

  const data = await apiFetch('/analytics?limit=10');
  if (!data?.data) {
    el.innerHTML += `<div style="padding:20px;color:var(--red)">Failed to load analytics.</div>`;
    return;
  }
  const d = data.data;

  function leaderTable(players, valueLabel, format) {
    if (!players?.length) return '<div style="color:var(--g1);font-size:.8rem;padding:8px">No data</div>';
    return `<table class="term-table">
      <thead><tr><th>#</th><th>Player</th><th class="right">${esc(valueLabel)}</th><th class="right">GP</th></tr></thead>
      <tbody>${players.map((p,i)=>`<tr class="${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':''}">
        <td class="text-dim text-xs">${i+1}</td>
        <td style="${i===0?'color:var(--amb)':''}">${esc(p.player)}</td>
        <td class="right" style="font-family:var(--font-term);font-size:1rem">${format ? format(p.value) : fmt(p.value)}</td>
        <td class="right text-xs text-dim">${p.matches??'—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  const sections = [
    { title: '★ MVP LEADERS',         data: d.mvps,                      val: 'MVP Games', fmt: null },
    { title: '☠ TOTAL KILLS',         data: d.combat?.kills,             val: 'Kills',     fmt: fmt },
    { title: '💥 ENEMY DAMAGE',       data: d.combat?.enemy_damage,      val: 'Damage',    fmt: fmt },
    { title: '⚡ KILL:DEATH RATIO',   data: d.combat?.kdr,               val: 'KDR',       fmt: v=>`${v}` },
    { title: '⚑ FLAG CAPTURES',       data: d.flags?.caps,               val: 'Caps',      fmt: null },
    { title: '✋ FLAG TOUCHES',        data: d.flags?.touches,            val: 'Touches',   fmt: null },
    { title: '🕒 FLAG TIME (s)',       data: d.flags?.flag_time,          val: 'Seconds',   fmt: fmt },
    { title: '% CAP CONVERSION',      data: d.flags?.conversion,         val: '%',         fmt: v=>`${v}%` },
    { title: '🛡 TOP DEFENSE DMG',     data: d.roles?.defense,            val: 'Damage',    fmt: fmt },
    { title: '⚔ TOP OFFENSE DMG',     data: d.roles?.offense,            val: 'Damage',    fmt: fmt },
    { title: '💀 SOLDIER KILLS',      data: d.roles?.soldier_kills,      val: 'Kills',     fmt: null },
    { title: '💣 DEMOMAN DMG',        data: d.roles?.demoman_damage,     val: 'Damage',    fmt: fmt },
    { title: '🔫 HWGUY DAMAGE',       data: d.roles?.hwguy_damage,       val: 'Damage',    fmt: fmt },
    { title: '⚙ SENTRY KILLS',        data: d.roles?.engineer_sentry_kills, val: 'Kills',  fmt: null },
    { title: '⚕ MEDIC CAPS',         data: d.roles?.medic_caps,         val: 'Caps',      fmt: null },
    { title: '🏃 SCOUT CAPS',         data: d.roles?.scout_caps,         val: 'Caps',      fmt: null },
    { title: '💀 SUICIDES',           data: d.chaos?.suicides,           val: 'Suicides',  fmt: null },
    { title: '🤝 TEAMKILLS',          data: d.chaos?.team_kills,         val: 'TKs',       fmt: null },
  ];

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ANALYTICS</div><div class="page-subtitle">ALL-TIME STATISTICS // TOP 10 EACH CATEGORY</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:0;border-top:1px solid var(--g1)">
      ${sections.map(s => `
        <div style="border-right:1px solid var(--g1);border-bottom:1px solid var(--g1)">
          <div class="panel-header" style="margin:0"><span class="panel-header-title">${s.title}</span></div>
          ${leaderTable(s.data, s.val, s.fmt)}
        </div>
      `).join('')}
    </div>
  `;
}

/* ══════════════════════════════════════════════════════════════
   PAGE: COMPARE
═══════════════════════════════════════════════════════════════ */
async function renderCompare(el) {
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">PLAYER COMPARE</div><div class="page-subtitle">HEAD-TO-HEAD RECORD // ENTER TWO PLAYER IDs OR NAMES</div></div>
    </div>
    <div style="padding:16px;border-bottom:1px solid var(--g1)">
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div>
          <div class="term-label" style="color:var(--blu2)">PLAYER 1 (BLUE)</div>
          <input class="term-input" id="cmp-p1" placeholder="Discord ID or name…" style="width:220px;margin:0">
        </div>
        <div style="font-family:var(--font-term);font-size:2rem;color:var(--g1);padding-bottom:4px">VS</div>
        <div>
          <div class="term-label" style="color:#f87171">PLAYER 2 (RED)</div>
          <input class="term-input" id="cmp-p2" placeholder="Discord ID or name…" style="width:220px;margin:0">
        </div>
        <button class="btn btn-primary" id="cmp-go">COMPARE →</button>
      </div>
    </div>
    <div id="cmp-result" style="padding:16px">
      <div style="color:var(--g1);font-family:var(--font-mono);font-size:.8rem">Enter two player identifiers above to see head-to-head record.</div>
    </div>
  `;

  updateTaskbar('/compare', 'Player comparison');

  document.getElementById('cmp-go').addEventListener('click', async () => {
    const p1 = document.getElementById('cmp-p1').value.trim();
    const p2 = document.getElementById('cmp-p2').value.trim();
    const result = document.getElementById('cmp-result');

    if (!p1 || !p2) { result.innerHTML = '<div style="color:var(--red);font-size:.8rem">Enter both player identifiers.</div>'; return; }

    result.innerHTML = '<div style="color:var(--g1);font-family:var(--font-mono)">Loading comparison…</div>';

    const data = await apiFetch(`/compare?p1=${encodeURIComponent(p1)}&p2=${encodeURIComponent(p2)}`);
    if (!data?.ok) {
      result.innerHTML = `<div style="color:var(--red);font-family:var(--font-mono);font-size:.8rem">Error: ${esc(data?.error || 'Not found. Try Discord ID or exact display name.')}</div>`;
      return;
    }

    const d = data.data;
    const p1name = d.players.p1.name;
    const p2name = d.players.p2.name;
    const tm = d.stats.teammate;
    const op = d.stats.opponent;

    result.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--g1);margin-bottom:12px">
        <div style="padding:14px;border-right:1px solid var(--g1)">
          <div style="color:var(--blu2);font-family:var(--font-term);font-size:1.4rem">${esc(p1name)}</div>
          ${d.players.p1.elo != null ? `<div style="color:var(--g1);font-size:.72rem">ELO: ${d.players.p1.elo}</div>` : ''}
        </div>
        <div style="padding:14px">
          <div style="color:#f87171;font-family:var(--font-term);font-size:1.4rem">${esc(p2name)}</div>
          ${d.players.p2.elo != null ? `<div style="color:var(--g1);font-size:.72rem">ELO: ${d.players.p2.elo}</div>` : ''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--g1);margin-bottom:12px">
        <div style="padding:14px;border-right:1px solid var(--g1)">
          <div style="color:var(--g2);font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px">AS TEAMMATES</div>
          <div style="font-family:var(--font-term);font-size:2rem;color:var(--g4)">${tm.gp} <span style="font-size:1rem;color:var(--g1)">games</span></div>
          <div style="font-size:.8rem;color:var(--g2);margin-top:4px">${tm.w}W / ${tm.l}L / ${tm.t}T &nbsp; <span style="color:var(--g3)">${tm.win_pct}% win</span></div>
        </div>
        <div style="padding:14px">
          <div style="color:var(--g2);font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px">AS OPPONENTS</div>
          <div style="font-family:var(--font-term);font-size:2rem;color:var(--g4)">${op.gp} <span style="font-size:1rem;color:var(--g1)">games</span></div>
          <div style="font-size:.8rem;color:var(--g2);margin-top:4px">
            <span style="color:var(--blu2)">${esc(p1name)} ${op.p1_win_pct}%</span> vs <span style="color:#f87171">${esc(p2name)} ${op.p2_win_pct}%</span>
          </div>
        </div>
      </div>

      ${d.matches.length ? `
      <div style="border:1px solid var(--g1)">
        <div class="panel-header" style="margin:0"><span class="panel-header-title">RECENT SHARED MATCHES (last ${d.matches.length})</span></div>
        <table class="term-table">
          <thead><tr><th>Map</th><th>Relation</th><th>Result</th><th class="right">Score</th><th class="right">When</th></tr></thead>
          <tbody>
            ${d.matches.map(mx=>`<tr style="cursor:pointer" onclick="navigate('match','${esc(mx.id)}')">
              <td style="color:var(--g3)">${esc(mx.map_name||'—')}</td>
              <td class="text-xs" style="color:${mx.relation==='teammate'?'var(--g2)':'var(--amb)'}">${mx.relation}</td>
              <td class="text-xs text-dim">${esc(mx.result)}</td>
              <td class="right">${mx.score_blue!=null?`${mx.score_blue}–${mx.score_red}`:'—'}</td>
              <td class="right text-xs text-dim">${ago(mx.created_at)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}
    `;
  });

  // Enter key
  ['cmp-p1','cmp-p2'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('cmp-go').click();
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   PAGE: MAPS
═══════════════════════════════════════════════════════════════ */
async function renderMaps(el) {
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">MAPS</div><div class="page-subtitle">MAP STATISTICS &amp; PLAYER RECORDS</div></div>
    </div>
    <div style="padding:20px;color:var(--g1);font-family:var(--font-mono)">Loading…</div>
  `;

  updateTaskbar('/maps', 'Map statistics');

  const data = await apiFetch('/mapaverages');
  const maps = data?.data || [];

  if (!maps.length) {
    el.innerHTML += '<div style="padding:20px;color:var(--g1)">No map data.</div>';
    return;
  }

  const maxGames = Math.max(...maps.map(m=>m.games));

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">MAPS</div><div class="page-subtitle">MAP STATISTICS &amp; PLAYER RECORDS</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0;border-top:1px solid var(--g1)">
      ${maps.map(m=>`
        <div style="border-right:1px solid var(--g1);border-bottom:1px solid var(--g1);padding:14px;cursor:pointer;transition:background .15s"
          onmouseenter="this.style.background='var(--dim2)'" onmouseleave="this.style.background=''"
          onclick="loadMapDetail('${esc(m.map)}')">
          <div style="font-family:var(--font-term);font-size:1.4rem;color:var(--g4);margin-bottom:4px">${esc(m.map?.toUpperCase()||'—')}</div>
          <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--g1);margin-bottom:8px">
            <span>${m.games} games</span>
            <span>avg score: ${m.avgScorePerTeam||'—'}/team</span>
          </div>
          <div class="bar-wrap"><div class="bar-fill" style="width:${Math.round((m.games/maxGames)*100)}%"></div></div>
        </div>
      `).join('')}
    </div>
    <div id="map-detail"></div>
  `;

  window.loadMapDetail = async (mapName) => {
    const detailEl = document.getElementById('map-detail');
    detailEl.innerHTML = `<div style="padding:16px;color:var(--g1);font-family:var(--font-mono)">Loading ${mapName} data…</div>`;

    const [playerData, matchData] = await Promise.all([
      apiFetch(`/map/${encodeURIComponent(mapName)}/players`),
      apiFetch(`/map/${encodeURIComponent(mapName)}/matches?limit=10`),
    ]);

    const players = playerData?.data || [];
    const matches = matchData?.data || [];

    detailEl.innerHTML = `
      <div style="border-top:2px solid var(--g2);margin:12px">
        <div class="panel-header" style="margin:0">
          <span class="panel-header-title">${esc(mapName.toUpperCase())} — DETAILED STATS</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
          <div style="border-right:1px solid var(--g1)">
            <div class="panel-header" style="margin:0;font-size:.65rem">TOP PLAYERS ON THIS MAP</div>
            <table class="term-table">
              <thead><tr><th>Player</th><th class="right">W</th><th class="right">L</th><th class="right">Win%</th></tr></thead>
              <tbody>
                ${players.slice(0,10).map((p,i)=>`<tr class="${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':''}">
                  <td>${esc(p.player)}</td>
                  <td class="right" style="color:var(--g3)">${p.w}</td>
                  <td class="right" style="color:#f87171">${p.l}</td>
                  <td class="right">${p.winRate}%</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div>
            <div class="panel-header" style="margin:0;font-size:.65rem">RECENT MATCHES</div>
            <table class="term-table">
              <thead><tr><th>Score</th><th>Result</th><th class="right">When</th></tr></thead>
              <tbody>
                ${matches.map(m=>`<tr style="cursor:pointer" onclick="navigate('match','${esc(m.id)}')">
                  <td>${m.score_blue!=null?`<span style="color:var(--blu2)">${m.score_blue}</span>–<span style="color:#f87171">${m.score_red}</span>`:'—'}</td>
                  <td>${resultTag(m.winner)}</td>
                  <td class="right text-xs text-dim">${ago(m.created_at)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  };
}

/* ══════════════════════════════════════════════════════════════
   PAGE: VEGAS ODDS
═══════════════════════════════════════════════════════════════ */
async function renderVegas(el) {
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">VEGAS ODDS</div><div class="page-subtitle">PLAYER RETURN PROBABILITY ENGINE // HIGHLY SCIENTIFIC</div></div>
    </div>
    <div style="padding:20px;max-width:600px">
      <div style="font-family:var(--font-mono);font-size:.78rem;color:var(--g1);margin-bottom:16px;line-height:1.7">
        Our proprietary algorithm analyzes player attendance patterns and returns a <span style="color:var(--amb)">HIGHLY SCIENTIFIC</span> prediction of when they'll show up next. Accuracy not guaranteed. We've lost money on this before.
      </div>
      <div style="margin-bottom:12px">
        <div class="term-label">PLAYER NAME OR DISCORD ID</div>
        <div style="display:flex;gap:8px">
          <input class="term-input" id="v-input" placeholder="Type name then press ENTER…" style="flex:1;margin:0">
          <button class="btn btn-primary" id="v-go">CHECK ODDS</button>
        </div>
      </div>
      <div id="v-result"></div>
    </div>
  `;

  updateTaskbar('/vegas', 'Vegas odds calculator');

  async function doLookup() {
    const q = document.getElementById('v-input').value.trim();
    const result = document.getElementById('v-result');
    if (!q) return;

    result.innerHTML = `<div style="color:var(--g1);font-family:var(--font-mono)">Consulting the oracle…</div>`;

    const data = await apiFetch(`/vegasodds/${encodeURIComponent(q)}`);
    if (!data?.ok) {
      result.innerHTML = `<div style="color:var(--red);font-family:var(--font-mono)">Player not found. Try their exact display name or Discord ID.</div>`;
      return;
    }
    if (!data.enough_data) {
      result.innerHTML = `<div style="color:var(--amb);font-family:var(--font-mono)">Not enough data yet for <strong>${esc(data.player?.display_name||q)}</strong>. Play more games.</div>`;
      return;
    }

    const statusColor = {
      'HE IS HERE RIGHT NOW': 'var(--g3)',
      'HE HAS AWAKENED':      'var(--g3)',
      'DUE ANY MINUTE':       'var(--amb)',
      'WARMING UP':           'var(--amb)',
      'Still vanished':       'var(--red)',
    }[data.status] || 'var(--g2)';

    result.innerHTML = `
      <div style="border:1px solid var(--g1);background:var(--p0);padding:16px">
        <div style="font-family:var(--font-mono);font-size:.65rem;letter-spacing:.15em;color:var(--g1);text-transform:uppercase;margin-bottom:10px">ANALYSIS COMPLETE</div>
        <div style="font-family:var(--font-term);font-size:1.5rem;color:var(--g4);margin-bottom:4px">${esc(data.player?.display_name || q)}</div>
        <div style="font-family:var(--font-term);font-size:2rem;color:${statusColor};text-shadow:0 0 14px ${statusColor};margin-bottom:14px">${esc(data.status)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px">
          ${[
            ['Last seen',        data.last_played],
            ['Days since',       data.days_since_last_played],
            ['Active days',      data.active_days],
            ['Avg gap (days)',   data.avg_gap_days],
            ['Longest gap',      `${data.longest_gap_days}d`],
            ['Vegas line',       data.vegas_line != null ? `${data.vegas_line}d` : '—'],
            ['Games last day',   data.games_last_active_day],
          ].map(([k,v]) => `
            <div style="padding:5px 8px;background:var(--p1);border:1px solid var(--dim);display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:.75rem">
              <span style="color:var(--g1)">${k}</span>
              <span style="color:var(--g3)">${esc(String(v??'—'))}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  document.getElementById('v-go').addEventListener('click', doLookup);
  document.getElementById('v-input').addEventListener('keydown', e => { if (e.key==='Enter') doLookup(); });
}

/* ══════════════════════════════════════════════════════════════
   PAGE: ABOUT / HALL OF FAME
═══════════════════════════════════════════════════════════════ */
async function renderAbout(el) {
  updateTaskbar('/about', 'About NoNamePUGs');

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ABOUT</div><div class="page-subtitle">THE CREW // EST. 1999 // STILL STANDING</div></div>
    </div>

    <div style="padding:20px;max-width:720px">
      <div style="font-family:var(--font-body);font-size:.95rem;color:var(--g2);line-height:2;margin-bottom:24px">
        <p style="margin-bottom:12px">
          NoNamePUGs — <span style="color:var(--g3)">NNP</span> — is a tight-knit community of pickup game veterans who have
          been fragging each other on <span style="color:var(--g3)">Team Fortress Classic</span> since the late 1990s.
          While every other game has come and gone, we keep coming back to 2Fort, Well, and Avanti.
        </p>
        <p style="margin-bottom:12px">
          The average player here has been gaming together for <span style="color:var(--amb)">20+ years</span>.
          We know each other's playstyles, tendencies, favorite classes, and which maps each person will
          inevitably complain about. It's not just a pickup system — it's a reunion every session.
        </p>
        <p>
          This system tracks every match, records every frag, and — most importantly — provides
          definitive proof of who actually wins more arguments: <span style="color:#f87171">RED</span> or <span style="color:var(--blu2)">BLUE</span>.
        </p>
      </div>

      <div style="border:1px solid var(--g1);background:var(--p0);padding:14px;margin-bottom:16px">
        <div style="font-family:var(--font-mono);font-size:.65rem;letter-spacing:.2em;color:var(--g1);text-transform:uppercase;margin-bottom:10px">// SERVER INFO</div>
        <div style="font-family:var(--font-mono);font-size:.82rem;color:var(--g2);line-height:2">
          <div style="display:flex;gap:12px"><span style="color:var(--g1);width:120px">Game</span><span style="color:var(--g3)">Team Fortress Classic (1999)</span></div>
          <div style="display:flex;gap:12px"><span style="color:var(--g1);width:120px">Engine</span><span>GoldSrc (Half-Life)</span></div>
          <div style="display:flex;gap:12px"><span style="color:var(--g1);width:120px">Format</span><span>4v4 Pickup Games</span></div>
          <div style="display:flex;gap:12px"><span style="color:var(--g1);width:120px">Queue</span><span>Discord bot (8 players → auto-start)</span></div>
          <div style="display:flex;gap:12px"><span style="color:var(--g1);width:120px">ELO System</span><span>Tracked per match, live leaderboard</span></div>
          <div style="display:flex;gap:12px"><span style="color:var(--g1);width:120px">Stats</span><span>Hampalyzer integration</span></div>
        </div>
      </div>

      <div style="border:1px solid var(--g1);background:var(--p0);padding:14px">
        <div style="font-family:var(--font-mono);font-size:.65rem;letter-spacing:.2em;color:var(--g1);text-transform:uppercase;margin-bottom:10px">// SYSTEM INFO</div>
        <div style="font-family:var(--font-mono);font-size:.78rem;color:var(--g2);line-height:2">
          <div>NNP-OS v1.9.9 &nbsp;·&nbsp; Build 1999-2026 &nbsp;·&nbsp; All rights reserved</div>
          <div>Backend: Node.js + Express + SQLite &nbsp;·&nbsp; Frontend: Pure terminal nostalgia</div>
          <div style="color:var(--g1);margin-top:6px;font-size:.68rem">
            Powered by ✦ Grok &nbsp;·&nbsp; 
            <a href="https://discord.gg/nonamepickups" target="_blank">Join Discord</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════════════════
   MAIN INIT
═══════════════════════════════════════════════════════════════ */
window.navigate = navigate;

window.addEventListener('DOMContentLoaded', async () => {
  // Check if already "logged in" this session
  const handle = sessionStorage.getItem('nnp_handle');

  if (!handle) {
    await runBoot();
    const user = await showLogin();
    // fall through
  } else {
    // Skip boot/login on reload
    document.getElementById('boot-screen')?.remove();
    document.getElementById('login-screen')?.remove();
  }

  // Activate OS shell
  const shell = document.getElementById('os-shell');
  shell.classList.add('active');

  // Start chrome
  startClock();
  await pollStatus();
  await pollQueue();
  setInterval(pollStatus, 30000);
  setInterval(pollQueue, 8000);

  // Update handle in topbar
  const handleEl = document.getElementById('topbar-handle');
  if (handleEl) handleEl.textContent = (sessionStorage.getItem('nnp_handle') || 'GUEST').toUpperCase();

  // Route to home
  navigate('home');

  // Clear page-specific intervals on navigate
  const origNavigate = window.navigate;
  window.navigate = (route, param) => {
    clearInterval(window._homeQueueInterval);
    clearInterval(window._queueInterval);
    origNavigate(route, param);
  };
});
