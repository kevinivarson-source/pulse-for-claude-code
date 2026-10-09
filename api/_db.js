// Shared database + auth helpers. Works with any Postgres: Neon, Supabase, or your own.
// Tables are created on first use, so there is no migration step.
import postgres from 'postgres';
import { createHash, timingSafeEqual } from 'node:crypto';

const rawUrl = process.env.DATABASE_URL || process.env.STORAGE_URL || process.env.POSTGRES_URL || '';
// Hosting integrations add extras to the link that aren't Postgres settings (Supabase adds supa=,
// Prisma-style links add pgbouncer=). Left in, they'd be sent to the server and could be refused.
function cleanUrl(u) {
  try {
    const x = new URL(u);
    for (const k of ['supa', 'pgbouncer', 'channel_binding', 'connection_limit', 'pool_timeout', 'schema']) x.searchParams.delete(k);
    return x.toString();
  } catch { return u; }
}
const url = rawUrl && cleanUrl(rawUrl);
const KEY = process.env.PULSE_KEY || '';
// Optional: instead of the key itself, store only its fingerprint (SHA-256, 64 hex characters) as PULSE_KEY_SHA256.
const KEY_SHA = /^[0-9a-f]{64}$/i.test(process.env.PULSE_KEY_SHA256 || '') ? Buffer.from(process.env.PULSE_KEY_SHA256, 'hex') : null;
const hasKey = KEY.length >= 12 || KEY_SHA !== null;
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);

export const sql = globalThis.__pulseTestSql || postgres(url || 'postgres://unset@localhost/unset', {
  max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10, ssl: local ? false : 'require', onnotice: () => {},
});

let ready = null;
export function ensure() {
  return ready ||= (async () => {
    await sql`create table if not exists pulse_session (
      id text primary key, owner text not null default 'owner', project text not null default 'session',
      started_at bigint not null, last_at bigint not null, ended boolean not null default false,
      events int not null default 0, calls int not null default 0, rhythm text not null default '')`;
    await sql`create table if not exists pulse_event (
      id bigserial primary key, session_id text not null references pulse_session(id) on delete cascade,
      t bigint not null, k text not null, tool text not null default '')`;
    await sql`create unique index if not exists pulse_event_once on pulse_event (session_id, t, k, tool)`;
    await sql`create table if not exists pulse_library (
      owner text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now())`;
  })().catch(e => { ready = null; throw e; });
}

const digest = s => createHash('sha256').update(String(s ?? '')).digest();
export function authed(req) {
  const m = /^Bearer (\S{12,})$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const d = digest(m[1]);
  return (KEY.length >= 12 && timingSafeEqual(d, digest(KEY))) || (KEY_SHA !== null && timingSafeEqual(d, KEY_SHA));
}

// One letter per lane, used for each session's rhythm fingerprint (its cover art).
export const laneLetter = n =>
  /^mcp__/.test(n) ? 'm' :
  /^(Read|Glob|Grep|LS|NotebookRead)$/.test(n) ? 'r' :
  /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n) ? 'w' :
  /^(Bash|BashOutput|KillShell|KillBash|PowerShell|Monitor)$/.test(n) ? 's' :
  /^(WebFetch|WebSearch)$/.test(n) ? 'b' :
  /^(Task|Agent)$/.test(n) ? 'a' : 'o';

export async function guard(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!globalThis.__pulseTestSql && !url) { res.status(503).json({ error: 'Pulse has no database yet. Connect Neon, Supabase or any Postgres to this project in Vercel, then redeploy.' }); return false; }
  if (/\s/.test(KEY)) { res.status(503).json({ error: 'Your PULSE_KEY contains a space. Pick a key without spaces in your Vercel project settings, then redeploy.' }); return false; }
  if (!hasKey) { res.status(503).json({ error: 'Pulse has no key yet. Add PULSE_KEY (12 or more characters) in your Vercel project settings, then redeploy.' }); return false; }
  if (!authed(req)) { res.status(401).json({ error: 'This device is not paired. Open your pairing link to connect it.' }); return false; }
  await ensure();
  return true;
}
