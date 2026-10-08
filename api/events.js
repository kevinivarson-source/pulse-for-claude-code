// GET ?s=<session>&after=<id>: a session's events as [id, t, code, tool], for playback and live follow.
import { sql, guard } from './_db.js';

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  const s = String(req.query.s || '').slice(0, 64);
  const after = Number(req.query.after) || 0;
  const rows = await sql`select id, t, k, tool from pulse_event where session_id = ${s} and id > ${after} order by id limit 5000`;
  const [meta] = await sql`select ended, last_at from pulse_session where id = ${s}`;
  res.json({
    rows: rows.map(r => [Number(r.id), Number(r.t), r.k, r.tool]),
    ended: Boolean(meta?.ended),
    last_at: Number(meta?.last_at || 0),
  });
}
