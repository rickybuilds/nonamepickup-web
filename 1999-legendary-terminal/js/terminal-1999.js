// 1999 LEGENDARY TERMINAL - Pure 1999 only
// DOS / BBS / Old TFC console feel. No modern particles, no 3D, no 2050 polish.
// Simple beeps, text typing, command line, ASCII, CRT.

const API_BASE = 'https://nonamepickup.servehalflife.com';

let audioCtx = null;
let soundEnabled = true;

function initAudio() {
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
}

function playBeep(freq=900, ms=60, vol=0.35) {
  if (!soundEnabled || !audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.value = vol;
  o.connect(g); g.connect(audioCtx.destination);
  o.start();
  setTimeout(() => {
    try { g.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.03); o.stop(); } catch(e){}
  }, ms);
}

function playModem() {
  playBeep(1100, 90);
  setTimeout(()=>playBeep(650, 140), 100);
}

function playRocket() { playBeep(280, 180, 0.25); }
function playExplosion() { playBeep(120, 220, 0.4); }

async function fetchAPI(ep) {
  try {
    const r = await fetch(API_BASE + ep, {cache:'no-store'});
    return await r.json();
  } catch(e) { return {ok:false}; }
}

function type(el, str, spd=32) {
  el.textContent='';
  let i=0;
  const t=setInterval(()=>{ el.textContent += str[i++] || ''; if(i>str.length) clearInterval(t); }, spd);
}

async function boot(el) {
  const txt = [
    "NONAME PUGS TERMINAL v1.9.99",
    "1999",
    "",
    "INITIALIZING TFC...",
    "LOADING MAPS...",
    "CONNECTING TO MAINFRAME...",
    "",
    "BOOT COMPLETE."
  ];
  el.innerHTML = '';
  for (let line of txt) {
    const d = document.createElement('div');
    el.appendChild(d);
    await new Promise(r=>setTimeout(r,40));
    type(d, line, 16);
    playBeep(650 + Math.random()*180, 18);
    await new Promise(r=>setTimeout(r,110));
  }
}

async function initShell() {
  document.getElementById('login-screen').style.display = 'none';
  const sh = document.getElementById('terminal-shell');
  sh.style.display = 'block';
  playModem();

  // Pull real data, show as plain 1999 text
  const q = await fetchAPI('/api/queue');
  const lw = document.getElementById('live-window');
  if (lw && q.ok) {
    let s = `QUEUE: ${q.count}/${q.max}\n`;
    (q.players||[]).slice(0,6).forEach(p => s += `  ${p.name}\n`);
    lw.textContent = s;
  }

  const lb = await fetchAPI('/api/leaderboard?limit=5');
  const rw = document.getElementById('ranks-window');
  if (rw && lb.ok) {
    rw.textContent = (lb.data||[]).slice(0,5).map((p,i)=>`${i+1}. ${p.player} ${p.record}`).join('\n');
  }

  const mw = document.getElementById('maps-window');
  const ma = await fetchAPI('/api/mapaverages');
  if (mw && ma.ok) mw.textContent = (ma.data||[]).slice(0,4).map(m=>`${m.map} ${m.games}g`).join('\n');

  // Command line - 1999 pure
  const inp = document.getElementById('command-input');
  const out = document.getElementById('command-output');
  if (inp && out) {
    inp.addEventListener('keydown', async (e)=>{
      if (e.key !== 'Enter') return;
      const c = inp.value.trim().toLowerCase();
      inp.value='';
      playBeep(750,25);
      out.textContent += `\n> ${c}`;
      if (c==='help') out.textContent += '\n live | ranks | maps | join | stats | disconnect';
      else if (c==='live') location='live.html';
      else if (c==='ranks') location='leaderboard.html';
      else if (c==='maps') location='maps.html';
      else if (c==='join') { playRocket(); out.textContent+='\nDEPLOY...'; setTimeout(()=>location='live.html',500); }
      else if (c==='stats') {
        const s=await fetchAPI('/api/stats/summary');
        out.textContent += `\nMATCHES: ${s.data?s.data.totalMatches:'?'}`;
      }
      else if (c==='disconnect') { out.textContent+='\nBYE.'; setTimeout(()=>location.reload(),250); }
      else out.textContent += '\n?';
      out.scrollTop = 99999;
    });
  }

  const jb=document.getElementById('join-btn');
  if(jb) jb.onclick=()=>{playRocket(); location='live.html';};

  const st=document.getElementById('sound-toggle');
  if(st) st.onclick=()=>{soundEnabled=!soundEnabled; st.textContent='SOUND:'+(soundEnabled?'ON':'OFF'); if(soundEnabled)playBeep();};
  const ct=document.getElementById('crt-toggle');
  if(ct) ct.onclick=()=>document.body.classList.toggle('crt');

  // live refresh
  setInterval(async()=>{
    const fresh = await fetchAPI('/api/queue');
    if(fresh.ok && lw) {
      let s=`QUEUE: ${fresh.count}/${fresh.max}\n`;
      (fresh.players||[]).slice(0,6).forEach(p=>s+=`  ${p.name}\n`);
      lw.textContent = s;
    }
  },9000);
}

async function initLogin() {
  const bootEl = document.getElementById('boot-lines');
  const formArea = document.getElementById('login-form-area');
  await boot(bootEl);

  // After boot, show the login form inside the terminal window
  setTimeout(()=>{
    if (formArea) {
      formArea.style.display = 'block';
      const handle = document.getElementById('handle');
      if (handle) handle.focus();
    }
  }, 200);

  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    connectBtn.onclick = () => {
      const n = (document.getElementById('handle')?.value || 'VETERAN').toUpperCase();
      playModem();
      connectBtn.textContent = 'CONNECTING...';

      setTimeout(() => {
        // Replace login content with access message (title stays for 1999 authenticity)
        const loginWin = document.getElementById('login-screen');
        if (loginWin) {
          loginWin.innerHTML = `
            <div class="terminal-titlebar">
              <div class="title">NONAME PUGS TERMINAL v1.9.99</div>
            </div>
            <div class="terminal-body" style="min-height:120px;">
ACCESS GRANTED<br>
USER: ${n}<br>
<br>
LOADING MAIN TERMINAL SHELL...<br>
<span style="color:#ffcc00;">[ PRESS ANY KEY OR WAIT ]</span>
            </div>
          `;
        }

        // Listen for any key to speed up transition
        const keyHandler = (ev) => {
          document.removeEventListener('keydown', keyHandler);
          if (loginWin) loginWin.style.display = 'none';
          initShell();
          const st = document.getElementById('live-status');
          if (st) st.textContent = `LOGGED IN: ${n}`;
        };
        document.addEventListener('keydown', keyHandler, { once: true });

        setTimeout(() => {
          if (loginWin && loginWin.style.display !== 'none') {
            loginWin.style.display = 'none';
            initShell();
            const st = document.getElementById('live-status');
            if (st) st.textContent = `LOGGED IN: ${n}`;
          }
        }, 1100);
      }, 450);
    };
  }

  // Global enter for the form when visible
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && formArea && formArea.style.display !== 'none') {
      const btn = document.getElementById('connect-btn');
      if (btn) btn.click();
    }
  });
}

document.addEventListener('DOMContentLoaded',()=>{
  initAudio();
  document.body.classList.add('crt');
  console.log('[1999 Terminal] DOM ready, starting init');
  if(document.getElementById('login-screen')) {
    initLogin().catch(e => console.error('initLogin error:', e));
  } else {
    initShell();
  }
});

window.NN1999={playBeep,fetchAPI};