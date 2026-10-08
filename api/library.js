// GET / PUT: favourites and playlists, shared by every paired device.
import { sql, guard } from './_db.js';

const ids = a => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string').map(x => x.slice(0, 64)).slice(0, 2000);

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  if (req.method === 'GET') {
    const [r] = await sql`select data::text as data from pulse_library where owner = 'owner'`;
    return res.json({ data: r ? JSON.parse(r.data) : { fav: [], lists: [] } });
  }
  if (req.method === 'PUT') {
    const b = req.body || {};
    const data = {
      fav: ids(b.fav),
      lists: (Array.isArray(b.lists) ? b.lists : []).slice(0, 100).map(l => ({
        id: String(l?.id || '').slice(0, 40), name: String(l?.name || 'Playlist').slice(0, 60), items: ids(l?.items),
      })),
    };
    await sql`insert into pulse_library (owner, data) values ('owner', (${JSON.stringify(data)}::text)::jsonb)
      on conflict (owner) do update set data = excluded.data, updated_at = now()`;
    return res.json({ ok: true });
  }
  res.status(405).json({ error: 'Use GET or PUT' });
}
