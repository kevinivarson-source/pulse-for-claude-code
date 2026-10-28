// The disc: the playing track as a ring of notes, turning in time, with Pulse's own sound.
// Same look as the puck in the web player (design B). Plays the starter pack on a loop.
import { AUTO, parsePulse, sortRows, cut, trackRows, laneOf } from './tracks.js';

const $ = s => document.querySelector(s);
const host = window.disc || null; // the desktop app; absent when the page is opened in a plain browser
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const C = { surface: '#121823', line: '#253042', prompt: '#ff8a4c', read: '#5aa2ff', write: '#5fd07a', shell: '#d27cf0', web: '#3cc6d8', agent: '#ff6b9a', mcp: '#ffb43d', other: '#98a3b6', turn: '#e8ebf1' };
const LANES = ['read', 'write', 'shell', 'web', 'agent', 'mcp', 'other'];
const PLAY_D = 'M7 4.5v15l13-7.5z', PAUSE_D = 'M6 4h4v16H6zM14 4h4v16h-4z';

/* ---------- sound (the same instruments as the player) ---------- */
const NOTE_LANES = ['prompt', 'read', 'write', 'shell', 'web', 'agent', 'mcp', 'other', 'turn'], SCALE = [0, 0, 2, 4, 7, 9, 12, 14, 0];
const freq = l => 220 * Math.pow(2, SCALE[NOTE_LANES.indexOf(l)] / 12);
let ac = null, master = null, noiseBuf = null, lead = 0, muted = false;
function audio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC();
    const comp = ac.createDynamicsCompressor(); master = ac.createGain(); master.gain.value = 0.55; master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function env(t, a, p, d) { const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); g.connect(master); return g; }
function tone(type, f, p, d, a = 0.005, f2 = 0, at = 0) { const t = ac.currentTime + lead + at, o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d); o.connect(env(t, a, p, d)); o.start(t); o.stop(t + a + d + 0.05); }
function noise(p, d, ft, f, f2 = 0, a = 0.002) { const t = ac.currentTime + lead, s = ac.createBufferSource(), fl = ac.createBiquadFilter(); s.buffer = noiseBuf; fl.type = ft; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d); s.connect(fl); fl.connect(env(t, a, p, d)); s.start(t); s.stop(t + a + d + 0.05); }
const SND = {
  U: () => { tone('sine', 160, 0.9, 0.38, 0.002, 42); noise(0.15, 0.05, 'lowpass', 900); },
  T: l => { const f = freq(l); tone('triangle', f, 0.32, 0.24); tone('sine', f * 2, 0.07, 0.14); },
  D: () => noise(0.09, 0.03, 'highpass', 6500),
  A: () => { const f = freq('agent'); tone('triangle', f, 0.22, 0.18); tone('triangle', f * 1.5, 0.2, 0.3, 0.005, 0, 0.09); },
  E: () => [12, 16, 19].forEach((s, i) => tone('sine', 220 * Math.pow(2, s / 12), 0.11, 1.2, 0.03, 0, i * 0.04)),
  N: () => { tone('sine', 1320, 0.16, 0.9); tone('sine', 1980, 0.05, 0.5); },
  C: () => noise(0.28, 1.3, 'bandpass', 260, 3200, 0.45), S: () => tone('sine', 330, 0.14, 0.7, 0.06), Q: () => tone('sine', 165, 0.16, 0.9, 0.06),
};

/* ---------- the starter pack, cut into tracks ---------- */
const ROMAN = ['', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
let tracks = [], ti = 0, M = null, pos = -400, idx = 0, playing = false;
async function loadTracks() {
  const index = await (await fetch('starter/index.json')).json();
  for (const r of index.recordings) {
    const { rows } = parsePulse(await (await fetch('starter/' + encodeURIComponent(r.file))).text());
    const ev = sortRows(rows), seen = {};
    for (const t of cut(rows).tracks) {
      seen[t.kind] = (seen[t.kind] || 0) + 1;
      tracks.push({ title: t.kind + (ROMAN[seen[t.kind]] ?? ' ' + seen[t.kind]), album: r.title, rows: trackRows(ev, t.i0, t.i1, AUTO.tempo) });
    }
  }
}
function build(rows) {
  const ev = rows.map(r => ({ id: r[0], x: r[1], k: r[2], lane: r[2] === 'U' ? 'prompt' : (r[2] === 'T' || r[2] === 'D') ? laneOf(r[3]) : 'turn', n: null }));
  const notes = [];
  ev.forEach(e => { if (e.k === 'T') { e.n = notes.length; notes.push({ lane: e.lane, x: e.x }); } });
  return { ev, notes, total: ev.length ? ev[ev.length - 1].x : 0 };
}
function load(i) {
  ti = (i + tracks.length) % tracks.length; M = build(tracks[ti].rows); pos = -400; idx = 0; hotAt.clear();
  $('#title').textContent = `${tracks[ti].title} · ${tracks[ti].album}`;
}

/* ---------- playing ---------- */
let kickAt = -1e9, noteAt = -1e9;
const hotAt = new Map();
function fire(e, delay) {
  const at = performance.now() + delay * 1000;
  if (e.k === 'U') kickAt = at; else if (e.k === 'T') { noteAt = at; hotAt.set(e.n, at); }
  if (!muted && ac && SND[e.k]) { lead = delay; try { SND[e.k](e.lane); } finally { lead = 0; } }
}
function setPlaying(on) {
  if (on) { audio(); if (ac && ac.state !== 'running') ac.resume().catch(() => {}); }
  playing = on; $('#playIcon').setAttribute('d', on ? PAUSE_D : PLAY_D); $('#play').setAttribute('aria-label', on ? 'Pause' : 'Play');
}
const toggle = () => setPlaying(!playing);
const next = () => { load(ti + 1); };

/* ---------- drawing ---------- */
const cv = $('#disc'), g = cv.getContext('2d');
let rot = 0, last = 0;
const fade = (age, len) => age >= 0 && age < len ? 1 - age / len : 0;
const R = () => Math.min(cv.clientWidth, cv.clientHeight) / 2 - 16;
function draw(now, dt) {
  const W = cv.clientWidth, H = cv.clientHeight, d = Math.min(devicePixelRatio || 1, 3);
  if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
  const cx = W / 2, cy = H / 2, r = R(), k = r / 138, r0 = 44 * k, r1 = 128 * k, step = (r1 - r0) / LANES.length;
  g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
  // the disc, with a soft shadow so it sits above whatever is behind it
  g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 14; g.shadowOffsetY = 3;
  g.fillStyle = C.surface; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.restore();
  g.strokeStyle = C.line; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.globalAlpha = 0.55; g.lineWidth = 1; for (let i = 0; i <= LANES.length; i++) { g.beginPath(); g.arc(cx, cy, r0 + i * step, 0, 7); g.stroke(); }
  if (playing && !reduce) rot = (rot + dt * 16 / 1000 * Math.PI / 180) % (Math.PI * 2);
  if (M && M.notes.length) {
    const n = M.notes.length, w = Math.min(0.22, Math.PI * 2 / n * 0.8); g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const note = M.notes[i], rr = r0 + (LANES.indexOf(note.lane) + 0.5) * step, a = rot - Math.PI / 2 + i / n * Math.PI * 2,
        on = note.x <= pos, hot = on && fade(now - (hotAt.get(i) ?? -1e9), 420) > 0;
      g.globalAlpha = on ? (playing ? 1 : 0.7) : 0.16; g.lineWidth = step * (hot ? 0.95 : 0.7); g.strokeStyle = C[note.lane];
      g.beginPath(); g.arc(cx, cy, rr, a, a + w); g.stroke();
    }
  }
  const core = 20 * k, kick = fade(now - kickAt, 520) ** 2, bump = 0.35 * fade(now - noteAt, 180), rip = fade(now - kickAt, 700),
    idle = playing || reduce ? 0 : 0.06 * Math.max(0, Math.sin(now % 1600 / 1600 * Math.PI * 2));
  if (rip > 0 && !reduce) { g.globalAlpha = 0.7 * rip; g.strokeStyle = C.prompt; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, core + (132 * k - core) * (1 - rip), 0, 7); g.stroke(); }
  g.globalAlpha = 1; g.fillStyle = C.prompt; g.beginPath(); g.arc(cx, cy, core * (1 + 0.24 * Math.max(kick, bump) + idle), 0, 7); g.fill();
}
const AHEAD = 80;
function frame() {
  const now = performance.now(), dt = last ? Math.min(now - last, 100) : 0; last = now;
  if (playing && M) {
    pos += dt; let fired = 0;
    while (idx < M.ev.length && M.ev[idx].x <= pos + AHEAD) { const e = M.ev[idx]; if (fired < 8) fire(e, Math.max(0, (e.x - pos) / 1000)); fired++; idx++; }
    if (pos >= M.total + 1200) next();
  }
  draw(now, dt);
  requestAnimationFrame(frame);
}

/* ---------- pointer: hover shows the controls, drag moves the disc, click plays or pauses ---------- */
let inside = false, down = null, dragging = false;
function onDisc(e) { const r = R(), dx = e.clientX - cv.clientWidth / 2, dy = e.clientY - cv.clientHeight / 2; return dx * dx + dy * dy <= (r + 2) * (r + 2); }
function setInside(v) { if (v === inside) return; inside = v; document.body.classList.toggle('hover', v); if (host) host.hit(v); }
addEventListener('mousemove', e => {
  if (!dragging) setInside(onDisc(e));
  if (down && !dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 3) { dragging = true; if (host) host.drag('start'); }
});
document.addEventListener('mouseleave', () => { if (!dragging) setInside(false); });
cv.addEventListener('mousedown', e => { if (e.button === 0 && onDisc(e)) down = { x: e.screenX, y: e.screenY }; });
addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  if (dragging) { dragging = false; if (host) host.drag('end'); setInside(onDisc(e)); }
  else if (down && e.target === cv) toggle();
  down = null;
});
addEventListener('blur', () => { if (dragging) { dragging = false; down = null; if (host) host.drag('end'); } });
addEventListener('contextmenu', e => { e.preventDefault(); if (host) host.menu({ title: tracks[ti] ? `${tracks[ti].title} · ${tracks[ti].album}` : 'Pulse', playing, muted }); });
$('#play').addEventListener('click', toggle);
$('#next').addEventListener('click', next);
addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); toggle(); } else if (e.key === 'n') next(); });
if (host) host.on(cmd => { if (cmd === 'toggle') toggle(); else if (cmd === 'next') next(); else if (cmd === 'mute') muted = !muted; });

/* ---------- start: pick a track at random and play ---------- */
requestAnimationFrame(frame);
loadTracks().then(() => {
  load(Math.floor(Math.random() * tracks.length));
  setPlaying(true);
  // If the system won't let sound start on its own, wait for the first click.
  setTimeout(() => { if (ac && ac.state !== 'running') setPlaying(false); }, 600);
}).catch(() => { $('#title').textContent = 'Couldn’t load the starter pack'; document.body.classList.add('hover'); });
