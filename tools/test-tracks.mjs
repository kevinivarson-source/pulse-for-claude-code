// Checks for tracks.js. Run: node tools/test-tracks.mjs
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { AUTO, stepMs, stepsFor, musicSteps, parsePulse, sortRows, cut, trackRows, encodeTrack, decodeTrack, letterOf } from '../tracks.js';

const dir = new URL('../starter/', import.meta.url);
const ms = stepMs(AUTO.tempo);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// Music time
ok(stepsFor(0) === 1 && stepsFor(30000) === 8 && stepsFor(3600000) === 8, 'gaps map to 1..8 sixteenths');
const demo = [[1, 0, 'S', ''], [2, 5000, 'U', ''], [3, 5100, 'T', 'Read'], [4, 5300, 'D', 'Read'], [5, 9000, 'U', '']];
const st = musicSteps(demo);
ok(st[1] % 16 === 0 && st[4] % 16 === 0, 'prompts land on the first beat of a bar');

// Every starter recording: tracks are contiguous, within the rules, and never span a long break
for (const f of readdirSync(dir).filter(f => f.endsWith('.pulse'))) {
  const { rows } = parsePulse(readFileSync(new URL(f, dir), 'utf8'));
  const ev = sortRows(rows), { tracks, sketches } = cut(rows);
  const all = [...tracks, ...sketches].sort((a, b) => a.i0 - b.i0);
  ok(all[0].i0 === 0 && all.at(-1).i1 === ev.length, `${f}: pieces cover the whole recording`);
  all.forEach((p, i) => i && ok(p.i0 === all[i - 1].i1, `${f}: pieces follow on without gaps`));
  for (const t of tracks) {
    ok(t.len <= AUTO.longest * 1000 && t.len >= AUTO.shortest * 1000, `${f}: track length ${t.len} within rules`);
    for (let i = t.i0 + 1; i < t.i1; i++) ok(ev[i][1] - ev[i - 1][1] < AUTO.breakAfter * 60000, `${f}: no long break inside a track`);
    ok(!['E', 'N', 'D', 'A'].includes(ev[t.i0][2]), `${f}: a track never starts on a chord, bell or a tool finishing`);
    const tr = trackRows(ev, t.i0, t.i1);
    ok(tr[0][1] === 0 && Math.abs(tr.at(-1)[1] - t.len) <= 1, `${f}: track rows run from 0 to its length`);
  }
  for (const s of sketches) ok(s.len < AUTO.shortest * 1000 || s.calls === 0, `${f}: sketches are the short ones`);
}

// A long, dense day: thousands of events still cut fast, and nothing is longer than three minutes
{
  let t = 1.7e12, id = 0;
  const rows = [], add = (k, tool = '') => rows.push([++id, Math.round(t), k, tool]);
  add('S');
  for (let turn = 0; turn < 120; turn++) {
    t += 30000; add('U');
    for (let c = 0; c < 80; c++) { t += 900 + (c * 7919 % 9000); const tool = ['Read', 'Edit', 'Bash', 'Grep', 'WebFetch'][c % 5]; add('T', tool); t += 200 + (c * 104729 % 20000); add('D', tool); }
    t += 4000; add('E');
  }
  add('Q');
  const t0 = performance.now(), { tracks } = cut(rows), took = performance.now() - t0;
  ok(took < 1500, `cutting ${rows.length} events took ${took.toFixed(0)} ms`);
  ok(tracks.every(x => x.len <= 180000), 'long day: every track at most 3 minutes');
  ok(tracks.length > 30, `long day: ${tracks.length} tracks`);
}

// Share links: the rhythm survives the trip, nothing else does
{
  const { rows } = parsePulse(readFileSync(new URL('refactor.pulse', dir), 'utf8'));
  const ev = sortRows(rows), [t] = cut(rows).tracks, tr = trackRows(ev, t.i0, t.i1);
  const packed = await encodeTrack({ title: 'My\nfirst track', from: 'Kevin', rows: tr });
  ok(packed.length < 4000, `share link payload is ${packed.length} characters`);
  const back = await decodeTrack(packed);
  ok(back.title === 'My first track' && back.from === 'Kevin' && back.tempo === AUTO.tempo, 'title, name and tempo come back');
  ok(back.rows.length === tr.length, 'same number of events');
  back.rows.forEach((r, i) => {
    assert.equal(Math.round(r[1] / ms), Math.round(tr[i][1] / ms)); assert.equal(r[2], tr[i][2]);
    if (r[2] === 'T') assert.equal(letterOf(r[3]), letterOf(tr[i][3]));
  });
  checks++;
  ok(!back.rows.some(r => /^mcp__(?!connector$)/.test(r[3])), 'connector names never travel');
  for (const bad of ['', 'x', '1.!!!!', '0.' + Buffer.from('2\na\nb\n112\n0S').toString('base64url'), '0.' + Buffer.from('1\na\nb\n112\n0T').toString('base64url'), '0.' + Buffer.from('1\na\nb\n999\n0S').toString('base64url')]) {
    await assert.rejects(decodeTrack(bad)); checks++;
  }
}
console.log(`tracks.js: ${checks} checks passed`);
