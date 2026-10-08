// POST from the logger. Body (text/plain):
//   S <session-id> <project>
//   <epoch-ms> <code> [tool]   ...one line per event
// Re-sent lines are ignored, so the logger can retry freely.
import { sql, guard, laneLetter } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!(await guard(req, res))) return;

  const text = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 5001);
  const head = /^S ([A-Za-z0-9_-]{1,64})(?: (.*))?$/.exec(lines.shift() || '');
  if (!head) return res.status(400).json({ error: 'The first line must name the session' });
  const sid = head[1];
  const project = (head[2] || '').replace(/[^\w .-]/g, '').trim().slice(0, 60) || 'session';

  const ts = [], ks = [], tools = [];
  let ended = false;
  for (const l of lines) {
    const m = /^(\d{10,16}) ([A-Z])(?: (\S{1,120}))?$/.exec(l.trim());
    if (!m) continue;
    ts.push(m[1]); ks.push(m[2]); tools.push(m[3] || '');
    if (m[2] === 'Q') ended = true;
  }
  if (!ts.length) return res.json({ ok: true, added: 0 });
  const nums = ts.map(Number);
  const first = Math.min(...nums), last = Math.max(...nums);

  await sql`insert into pulse_session (id, project, started_at, last_at) values (${sid}, ${project}, ${first}, ${last})
    on conflict (id) do update set last_at = greatest(pulse_session.last_at, excluded.last_at),
      started_at = least(pulse_session.started_at, excluded.started_at)`;
  const added = await sql`insert into pulse_event (session_id, t, k, tool)
    select ${sid}::text, x.t, x.k, x.tool from unnest(${ts}::bigint[], ${ks}::text[], ${tools}::text[]) as x(t, k, tool)
    order by x.t on conflict do nothing returning k, tool`;
  let calls = 0, rhythm = '';
  for (const r of added) if (r.k === 'T') { calls++; rhythm += laneLetter(r.tool); }
  await sql`update pulse_session set events = events + ${added.length}, calls = calls + ${calls},
    rhythm = left(rhythm || ${rhythm}, 600), ended = ended or ${ended} where id = ${sid}`;
  res.json({ ok: true, added: added.length });
}
