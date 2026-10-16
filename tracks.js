// Pulse tracks: how a recording becomes tracks, and how a track fits inside a share link.
// Used by the player (index.html) and free for anyone building on Pulse. No dependencies.
//
// A recording is a list of events [id, epoch-ms, code, tool] (codes: S start, U prompt, T tool start,
// D tool done, A subagent done, E turn end, N waiting for you, C compaction, Q end).
// A track is a stretch of a recording replayed in music time: every event moves the clock on by a
// sixteenth note or more, long waits shrink to a short rest, and every prompt starts a new bar.

/** The Auto rules: what you get with no settings. Seconds, except breakAfter (minutes). */
export const AUTO = Object.freeze({ tempo: 112, shortest: 30, longest: 180, breakAfter: 15 });
export const RULES_VERSION = 1;

/** Length of one sixteenth note in milliseconds. */
export const stepMs = (tempo = AUTO.tempo) => 60000 / tempo / 4;

/** Which lane (instrument) a tool plays on. */
export function laneOf(n) {
  n = String(n || '');
  if (/^mcp__/.test(n)) return 'mcp';
  if (/^(Read|Glob|Grep|LS|NotebookRead)$/.test(n)) return 'read';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) return 'write';
  if (/^(Bash|BashOutput|KillShell|KillBash|PowerShell|Monitor)$/.test(n)) return 'shell';
  if (/^(WebFetch|WebSearch)$/.test(n)) return 'web';
  if (/^(Task|Agent)$/.test(n)) return 'agent';
  return 'other';
}
const LETTER = { read: 'r', write: 'w', shell: 's', web: 'b', agent: 'a', mcp: 'm', other: 'o' };
export const letterOf = n => LETTER[laneOf(n)];
/** One stand-in tool name per lane, used when a track travels without its real tool names. */
export const LANE_TOOL = { r: 'Read', w: 'Edit', s: 'Bash', b: 'WebFetch', a: 'Agent', m: 'mcp__connector', o: 'Tool' };

/** Events in playing order. Every index in this file refers to this order. */
export const sortRows = rows => rows.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);

/** Reads a .pulse file (the plugin's local format): a header line "<date> <project>", then "<epoch-ms> <code> [tool]". */
export function parsePulse(text) {
  const lines = String(text).split(/\r?\n/);
  const head = /^\S+ (.+)$/.exec(lines[0] || '');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const m = /^(\d{10,16}) ([A-Z])(?: (\S{1,120}))?$/.exec(lines[i].trim());
    if (m) rows.push([rows.length + 1, Number(m[1]), m[2], m[3] || '']);
  }
  return { project: head ? head[1].trim() : 'session', rows };
}

/** How many sixteenths a real-time gap becomes: 1 for back-to-back, at most 8 (two beats) for any wait. */
export const stepsFor = gap => Math.max(1, Math.min(8, Math.round(1 + Math.log2(1 + Math.max(0, gap) / 250))));

/** Music-time position (in sixteenths) of every event of a sorted recording or slice. */
export function musicSteps(ev) {
  const out = new Array(ev.length);
  let s = 0;
  for (let i = 0; i < ev.length; i++) {
    if (i) {
      s += stepsFor(ev[i][1] - ev[i - 1][1]);
      if (ev[i][2] === 'U') s = Math.ceil(s / 16) * 16; // a prompt is the kick on the one
    }
    out[i] = s;
  }
  return out;
}

/** A name for a track from what Claude mostly did in it. */
export function kindOf(c) {
  const calls = c.read + c.write + c.shell + c.web + c.agent + c.mcp + c.other || 1;
  const share = k => c[k] / calls;
  if (share('web') >= 0.3) return 'Research run';
  if (c.agent >= 2 && share('agent') >= 0.05) return 'Agent swarm';
  if (share('mcp') >= 0.25) return 'Connector call';
  if (share('shell') >= 0.35) return 'Terminal jam';
  if (share('write') >= 0.3) return 'Edit spree';
  if (share('read') >= 0.5) return 'Deep read';
  return 'Build loop';
}

function stats(ev, i0, i1) {
  const c = { read: 0, write: 0, shell: 0, web: 0, agent: 0, mcp: 0, other: 0 };
  let rhythm = '', prompts = 0, compactions = 0;
  for (let i = i0; i < i1; i++) {
    const k = ev[i][2];
    if (k === 'T') { const l = laneOf(ev[i][3]); c[l]++; if (rhythm.length < 600) rhythm += LETTER[l]; }
    else if (k === 'U') prompts++;
    else if (k === 'C') compactions++;
  }
  return { counts: c, calls: Object.values(c).reduce((a, b) => a + b, 0), rhythm, prompts, compactions };
}

/**
 * Cuts a recording into tracks.
 * Returns { tracks, sketches }. Each has i0..i1 (event range, end exclusive, in sortRows order),
 * t0 (epoch-ms of its first event), len (ms of music time), calls, prompts, rhythm and kind.
 * A sketch is a stretch too thin for a track: it stays in the recording but isn't listed as a track.
 */
export function cut(rows, rules = AUTO) {
  const ev = sortRows(rows), n = ev.length;
  if (!n) return { tracks: [], sketches: [] };
  const r = { ...AUTO, ...rules }, ms = stepMs(r.tempo), st = musicSteps(ev);
  const shortest = r.shortest * 1000, cap = r.longest * 1000 - 16 * ms, target = r.longest * 700;
  const lenOf = (i, j) => (st[j - 1] - st[i]) * ms;

  // Where a track may start: on a prompt (free), between tool calls (cheap), inside a tool or subagent run (dear).
  // Never just before a turn's ending chord, a "waiting for you" bell or a tool finishing.
  const cost = new Float64Array(n).fill(Infinity), open = {};
  let depth = 0;
  for (let i = 0; i < n; i++) {
    const [, t, k, tool] = ev[i], gap = i ? t - ev[i - 1][1] : 0;
    if (k === 'U') cost[i] = 0;
    else if (k === 'T') cost[i] = (depth ? 6 : 2) - Math.min(1, gap / 30000);
    if (k === 'T') { open[tool] = (open[tool] || 0) + 1; depth++; }
    else if (k === 'D' && open[tool] > 0) { open[tool]--; depth--; }
    else if (k === 'U') { for (const x in open) open[x] = 0; depth = 0; }
  }

  // A quiet spell longer than breakAfter ends one stretch of work; tracks never span two stretches.
  const brk = r.breakAfter * 60000, stretches = [];
  let a = 0;
  for (let i = 1; i < n; i++) if (ev[i][1] - ev[i - 1][1] >= brk) { stretches.push([a, i]); a = i; }
  stretches.push([a, n]);

  const pieceCost = L => L > cap ? 100 + (L - cap) / 1000 : L < shortest ? 20 + 10 * (shortest - L) / shortest : 1 + 2 * ((L - target) / target) ** 2;
  const pieces = [];
  for (const [s0, s1] of stretches) {
    // Best way to split this stretch, cheapest total first (dynamic programming over the cut points).
    const cand = [s0];
    for (let i = s0 + 1; i < s1; i++) if (cost[i] < Infinity) cand.push(i);
    cand.push(s1);
    const best = new Float64Array(cand.length).fill(Infinity), from = new Int32Array(cand.length).fill(-1);
    best[0] = 0;
    for (let j = 1; j < cand.length; j++) {
      const cj = cand[j] === s1 ? 0 : cost[cand[j]];
      for (let i = j - 1; i >= 0; i--) {
        const L = lenOf(cand[i], cand[j]);
        if (L > cap && i < j - 1) break; // too long; the nearest cut point is always allowed as a fallback
        const v = best[i] + pieceCost(L) + cj;
        if (v < best[j]) { best[j] = v; from[j] = i; }
      }
    }
    const cuts = [];
    for (let j = cand.length - 1; j > 0; j = from[j]) cuts.push([cand[from[j]], cand[j]]);
    pieces.push(...cuts.reverse());
  }

  const tracks = [], sketches = [];
  for (const [i0, i1] of pieces) {
    const local = musicSteps(ev.slice(i0, i1)), len = Math.round(local[local.length - 1] * ms);
    const s = stats(ev, i0, i1);
    const piece = { i0, i1, t0: ev[i0][1], t1: ev[i1 - 1][1], len, calls: s.calls, prompts: s.prompts, compactions: s.compactions, rhythm: s.rhythm, kind: kindOf(s.counts) };
    (len >= shortest && s.calls > 0 ? tracks : sketches).push(piece);
  }
  return { tracks, sketches };
}

/** A track's events with music-time clocks: [id, ms since the track began, code, tool]. */
export function trackRows(sorted, i0, i1, tempo = AUTO.tempo) {
  const slice = sorted.slice(i0, i1), st = musicSteps(slice), ms = stepMs(tempo);
  return slice.map((e, i) => [e[0], Math.round(st[i] * ms), e[2], e[3]]);
}

/* ---------- share links ----------
   A track fits inside its own link: only the rhythm travels (event codes, lanes and music-time steps).
   No project name, no tool names beyond their lane, no prompts, code or files. */
const b64u = {
  enc: bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; },
};
async function pipe(bytes, stream, limit = 1 << 21) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(), parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { reader.cancel(); throw new Error('Track is too big'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const clean = (s, max) => String(s || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Packs a track (rows from trackRows) into the text after "#t=" in a share link. */
export async function encodeTrack({ title, from = '', tempo = AUTO.tempo, rows }) {
  const ms = stepMs(tempo);
  let prev = 0, body = '';
  for (const [, t, k, tool] of rows) {
    const s = Math.round(t / ms);
    body += Math.max(0, s - prev) + k + (k === 'T' || k === 'D' ? letterOf(tool) : '');
    prev = s;
  }
  const text = ['1', clean(title, 60) || 'Untitled track', clean(from, 40), String(tempo), body].join('\n');
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'function') return '1.' + b64u.enc(await pipe(raw, new CompressionStream('deflate-raw')));
  return '0.' + b64u.enc(raw);
}

/** Unpacks a share link back into { title, from, tempo, rows }. Throws on anything malformed. */
export async function decodeTrack(packed) {
  const m = /^([01])\.([A-Za-z0-9_-]{4,60000})$/.exec(String(packed || ''));
  if (!m) throw new Error('Not a Pulse track link');
  let bytes = b64u.dec(m[2]);
  if (m[1] === '1') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  const [v, title, from, tempoS, body = ''] = new TextDecoder().decode(bytes).split('\n');
  const tempo = Number(tempoS);
  if (v !== '1' || !(tempo >= 40 && tempo <= 240)) throw new Error('Unknown track format');
  const ms = stepMs(tempo), rows = [], re = /(\d{1,3})([SUTDAENCQ])([rwsbamo]?)/y;
  let s = 0;
  while (re.lastIndex < body.length) {
    const x = re.exec(body);
    if (!x || rows.length >= 20000) throw new Error('Damaged track link');
    s += Math.min(64, Number(x[1]));
    const k = x[2], lane = x[3];
    if ((k === 'T' || k === 'D') !== Boolean(lane)) throw new Error('Damaged track link');
    rows.push([rows.length + 1, Math.round(s * ms), k, lane ? LANE_TOOL[lane] : '']);
  }
  if (!rows.length) throw new Error('Empty track');
  return { title: clean(title, 60) || 'Untitled track', from: clean(from, 40), tempo, rows };
}
