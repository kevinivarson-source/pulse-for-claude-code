// GET: every session as a "track" (newest first) plus the server clock for live detection.
import { sql, guard } from './_db.js';

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  const rows = await sql`select id, project, started_at, last_at, ended, events, calls, rhythm
    from pulse_session order by last_at desc limit 500`;
  res.json({
    now: Date.now(),
    sessions: rows.map(r => ({ ...r, started_at: Number(r.started_at), last_at: Number(r.last_at) })),
  });
}
