/**
 * Client-side access-control regression check for the 2.0 Supabase backend.
 *
 *   npx tsx tools/security/access-check.ts                 local stack (default)
 *   npx tsx tools/security/access-check.ts --target hosted anon only, read-only
 *   ... --out <file.json>                                  also write the results as JSON
 *
 * Asserts tools/security/matrix.ts from the point of view of the public web client (publishable
 * key only): anon and a signed-in viewer. See tools/security/README.md.
 *
 * Local: the local secret key (from `npx supabase status -o json`, never from a file) seeds
 * marked fixture rows, creates two throwaway viewer users and removes everything in `finally`.
 * Hosted: SELECT counts (limit 0, no row data), non-mutating RPCs, auth settings, storage bucket
 * list, GraphQL probe and Edge Function auth. No writes, no accounts, no realtime.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import {
  EDGE_FUNCTIONS,
  REALTIME_CONTROL,
  REALTIME_RESTRICTED,
  RPCS,
  type Op,
  type Role,
  TABLES,
  type TableAccess,
} from './matrix';

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
type Status = 'pass' | 'fail' | 'warn' | 'info';
interface Result {
  area: string;
  check: string;
  status: Status;
  detail: string;
}
const results: Result[] = [];

function record(area: string, check: string, status: Status, detail = '') {
  results.push({ area, check, status, detail });
  const tag = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', info: 'INFO' }[status];
  console.log(`${tag}  ${area.padEnd(9)} ${check}${detail ? `  (${detail})` : ''}`);
}
const expect = (area: string, check: string, ok: boolean, detail = '') =>
  record(area, check, ok ? 'pass' : 'fail', detail);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  options: {
    target: { type: 'string', default: 'local' },
    out: { type: 'string' },
    'realtime-wait': { type: 'string', default: '4000' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}
const TARGET = args.target === 'hosted' ? 'hosted' : 'local';
const REALTIME_WAIT = Number(args['realtime-wait']);
const RUN = `zz-access-check-${Date.now().toString(36)}`;
const MARK = 'zz-access-check';
const REPO = fileURLToPath(new URL('../../', import.meta.url));

interface Target {
  url: string;
  publishable: string;
  secret?: string;
  legacyAnonJwt?: string;
}

function localTarget(): Target {
  let url = process.env.LOCAL_SUPABASE_URL;
  let publishable = process.env.LOCAL_PUBLISHABLE_KEY;
  let secret = process.env.LOCAL_SECRET_KEY;
  let legacyAnonJwt: string | undefined;
  if (!url || !publishable || !secret) {
    const raw = execSync('npx supabase status -o json', { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const s = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string>;
    url ??= s.API_URL;
    publishable ??= s.PUBLISHABLE_KEY;
    secret ??= s.SECRET_KEY;
    legacyAnonJwt = s.ANON_KEY;
  }
  if (!url || !publishable || !secret) throw new Error('local stack not running: npx supabase start');
  // The secret key is only ever used against a loopback stack.
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`refusing secret key for non-local ${host}`);
  return { url, publishable, secret, legacyAnonJwt };
}

function hostedTarget(): Target {
  const url = process.env.HOSTED_SUPABASE_URL;
  const publishable = process.env.HOSTED_PUBLISHABLE_KEY;
  if (!url || !publishable) throw new Error('set HOSTED_SUPABASE_URL and HOSTED_PUBLISHABLE_KEY');
  if (!publishable.startsWith('sb_publishable_')) throw new Error('HOSTED_PUBLISHABLE_KEY must be a publishable key');
  return { url, publishable };
}

const T = TARGET === 'local' ? localTarget() : hostedTarget();
const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(T.url, T.publishable, clientOpts);
const admin = T.secret ? createClient(T.url, T.secret, clientOpts) : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
interface Outcome {
  code?: string;
  message?: string;
  rows: Row[];
  count: number | null;
}

/** Hosted throttle: one request at a time with a short gap. */
const pause = () => new Promise((r) => setTimeout(r, TARGET === 'hosted' ? 150 : 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(p: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null; count?: number | null }>): Promise<Outcome> {
  await pause();
  const { data, error, count } = await p;
  return {
    code: error?.code,
    message: error?.message,
    rows: Array.isArray(data) ? (data as Row[]) : data == null ? [] : [data as Row],
    count: count ?? null,
  };
}

const describe = (o: Outcome) => (o.code ? `${o.code} ${o.message ?? ''}`.trim() : `${o.rows.length} rows`);
const isDenied = (o: Outcome) => o.code === '42501';

/** First Monday of 2099: far from any real schedule, satisfies every day-of-week check. */
const MONDAY = (() => {
  const d = new Date(Date.UTC(2099, 0, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
})();
const day = (offset: number) => {
  const d = new Date(MONDAY);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// 1. API surface (migrations vs matrix vs OpenAPI)
// ---------------------------------------------------------------------------
function migrationSurface() {
  const dir = `${REPO}supabase/migrations`;
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8').replace(/--.*$/gm, ''))
    .join('\n');
  const tables = new Set([...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1] ?? ''));
  const created = [...sql.matchAll(/create (?:or replace )?function public\.(\w+)/gi)].map((m) => m[1] ?? '');
  const rpcs = new Set(created);
  const realtime = new Set(
    [...sql.matchAll(/alter publication supabase_realtime add table([^;]+);/gi)]
      .flatMap((m) => (m[1] ?? '').split(','))
      .map((t) => t.trim().replace(/^public\./, '')),
  );
  for (const m of sql.matchAll(/alter publication supabase_realtime drop table([^;]+);/gi))
    for (const t of (m[1] ?? '').split(',')) realtime.delete(t.trim().replace(/^public\./, ''));
  return { tables, rpcs, realtime };
}

async function checkSurface() {
  const m = migrationSurface();
  const matrixTables = new Set(Object.keys(TABLES));
  const matrixRpcs = new Set(Object.keys(RPCS));
  const missingT = [...m.tables].filter((t) => !matrixTables.has(t));
  const missingR = [...m.rpcs].filter((r) => !matrixRpcs.has(r));
  expect('surface', 'every migration table has a matrix row', missingT.length === 0, missingT.join(', ') || `${m.tables.size} tables`);
  expect('surface', 'every public function has a matrix row', missingR.length === 0, missingR.join(', ') || `${m.rpcs.size} functions`);
  const realtimeRestricted = [...m.realtime].filter((t) => TABLES[t]?.select.anon !== 'allow');
  record('surface', 'realtime publication', 'info', `${m.realtime.size} tables, not anon-readable: ${realtimeRestricted.join(', ')}`);

  await pause();
  const res = await fetch(`${T.url}/rest/v1/`, { headers: { apikey: T.publishable } });
  if (!res.ok) {
    record('surface', 'OpenAPI as anon', 'info', `HTTP ${res.status}: not readable with the publishable key; matrix from migrations only`);
    return;
  }
  const doc = (await res.json()) as { paths?: Record<string, unknown> };
  const paths = Object.keys(doc.paths ?? {}).filter((p) => p !== '/');
  const exposedTables = paths.filter((p) => !p.startsWith('/rpc/')).map((p) => p.slice(1));
  const exposedRpcs = paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5));
  const anonReadable = Object.entries(TABLES).filter(([, r]) => r.select.anon === 'allow').map(([t]) => t);
  const extraT = exposedTables.filter((t) => !anonReadable.includes(t));
  const absentT = anonReadable.filter((t) => !exposedTables.includes(t));
  expect('surface', 'OpenAPI as anon lists only anon-readable tables', extraT.length === 0, extraT.join(', ') || `${exposedTables.length} tables`);
  if (absentT.length) record('surface', 'OpenAPI as anon is missing expected tables', 'warn', absentT.join(', '));
  const anonRpcs = Object.entries(RPCS).filter(([, s]) => s.allowed.includes('anon')).map(([r]) => r);
  const extraR = exposedRpcs.filter((r) => !anonRpcs.includes(r));
  expect('surface', 'OpenAPI as anon lists no RPC anon cannot run', extraR.length === 0, extraR.join(', ') || `${exposedRpcs.length} RPCs`);
}

// ---------------------------------------------------------------------------
// 2. Fixtures (local only; secret key; every row marked and removed in finally)
// ---------------------------------------------------------------------------
interface Fixture {
  table: string;
  key: Row;
}
const fixtures: Fixture[] = [];
type FixtureName =
  | 'territories' | 'service_weeks' | 'service_meetings' | 'cart_places' | 'cart_slots' | 'cart_schedules'
  | 'people' | 'people2' | 'cart_assignments' | 'cart_blackouts' | 'program_weeks' | 'person_availability'
  | 'person_pairs' | 'duty_days' | 'duty_roster' | 'device_tokens' | 'reminder_log';
const fx = {} as Record<FixtureName, Row>;
let territoryId = 0;

async function seed(table: FixtureName, row: Row, keyCols: string[]): Promise<Row> {
  const { data, error } = await admin!.from(table).insert(row).select().single();
  if (error) throw new Error(`seed ${table}: ${error.message}`);
  const key = Object.fromEntries(keyCols.map((c) => [c, (data as Row)[c]]));
  fixtures.push({ table, key });
  fx[table] = data as Row;
  return data as Row;
}

async function seedAll(otherUser: string) {
  territoryId = 990000 + Math.floor(Math.random() * 9000);
  const square = { type: 'Polygon', coordinates: [[[0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0], [0, 0]]] };
  await seed('territories', { id: territoryId, name: RUN, geometry: square, centroid_lng: 0.0005, centroid_lat: 0.0005 }, ['id']);
  const week = await seed('service_weeks', { week_start: day(0), month_label: MARK }, ['id']);
  await seed('service_meetings', { week_id: week.id, dow: 1, place: RUN }, ['id']);
  const place = await seed('cart_places', { name: RUN }, ['id']);
  const slot = await seed('cart_slots', { place_id: place.id, iso_dow: 1, start_time: '09:00', end_time: '10:00' }, ['id']);
  const sched = await seed('cart_schedules', { name: RUN, start_date: day(0), end_date: day(6) }, ['id']);
  const p1 = await seed('people', { name: `${RUN} uno`, gender: 'M', duties: ['sonido'] }, ['id']);
  const p2 = await admin!.from('people').insert({ name: `${RUN} dos`, gender: 'F' }).select().single();
  if (p2.error) throw new Error(`seed people 2: ${p2.error.message}`);
  fixtures.push({ table: 'people', key: { id: p2.data.id } });
  fx.people2 = p2.data as Row;
  await seed('cart_assignments', { schedule_id: sched.id, slot_id: slot.id, week_date: day(0), person_ids: [p1.id], note: MARK }, ['id']);
  await seed('cart_blackouts', { slot_id: slot.id, date: day(0) }, ['id']);
  await seed('program_weeks', { kind: 'midweek', date: day(1), data: { [MARK]: true } }, ['id']);
  await seed('person_availability', { person_id: p1.id, slot_id: slot.id }, ['person_id', 'slot_id']);
  await seed('person_pairs', { person_a: p1.id, person_b: p2.data.id }, ['person_a', 'person_b']);
  await seed('duty_days', { date: day(1), note: MARK }, ['date']);
  await seed('duty_roster', { date: day(1), role: 'sonido', slot: 1, person_id: p1.id, note: MARK }, ['id']);
  await seed('device_tokens', { user_id: otherUser, token: `${RUN}-other-token`, platform: 'android' }, ['id']);
  const log = await admin!.from('reminder_log').insert({ user_id: otherUser, assignment_key: RUN, offset_days: 1 });
  if (log.error) throw new Error(`seed reminder_log: ${log.error.message}`);
  fx.reminder_log = { user_id: otherUser, assignment_key: RUN, offset_days: 1 };
}

/** Rows a viewer/anon INSERT would create. Distinct unique keys, so only RLS/grants can refuse them. */
function probeRow(table: string, uid?: string): Row {
  const p1 = fx.people?.id;
  switch (table) {
    case 'territories': return { ...fx.territories, id: territoryId + 1, version: undefined, updated_at: undefined };
    case 'service_weeks': return { week_start: day(7), month_label: MARK };
    case 'service_meetings': return { week_id: fx.service_weeks.id, dow: 2, place: RUN };
    case 'cart_places': return { name: RUN };
    case 'cart_slots': return { place_id: fx.cart_places.id, iso_dow: 2, start_time: '09:00', end_time: '10:00' };
    case 'cart_schedules': return { name: RUN, start_date: day(0), end_date: day(6) };
    case 'cart_assignments': return { schedule_id: fx.cart_schedules.id, slot_id: fx.cart_slots.id, week_date: day(7), person_ids: [], note: MARK };
    case 'cart_blackouts': return { slot_id: fx.cart_slots.id, date: day(1) };
    case 'program_weeks': return { kind: 'weekend', date: day(5), data: { [MARK]: true } };
    case 'people': return { name: `${RUN} probe`, gender: 'M' };
    case 'person_availability': return { person_id: fx.people2.id, slot_id: fx.cart_slots.id };
    case 'person_pairs': return { person_a: fx.people2.id, person_b: p1 };
    case 'duty_roster': return { date: day(5), role: 'sonido', slot: 1, person_name: RUN, note: MARK };
    case 'duty_days': return { date: day(5), note: MARK };
    case 'profiles': return { id: uid, role: 'admin' };
    case 'device_tokens': return { user_id: uid, token: `${RUN}-probe-token`, platform: 'android' };
    case 'reminder_log': return { user_id: uid, assignment_key: RUN, offset_days: 7 };
    default: throw new Error(`no probe row for ${table}`);
  }
}

/** A harmless column change for UPDATE probes (version bumps on any successful update). */
const PATCH: Record<string, Row> = {
  territories: { name: `${RUN} changed` },
  service_weeks: { month_label: 'changed' },
  service_meetings: { place: 'changed' },
  cart_places: { name: 'changed' },
  cart_slots: { display_label: 'changed' },
  cart_schedules: { name: 'changed' },
  cart_assignments: { note: 'changed' },
  cart_blackouts: { date: day(2) },
  program_weeks: { data: { changed: true } },
  people: { name: `${RUN} changed` },
  person_availability: { updated_by: null },
  person_pairs: { updated_by: null },
  duty_roster: { note: 'changed' },
  duty_days: { note: 'changed' },
  device_tokens: { platform: 'ios' },
};

function fixtureKey(table: string): Row {
  const f = fixtures.find((x) => x.table === table);
  if (!f) throw new Error(`no fixture for ${table}`);
  return f.key;
}

async function adminRow(table: string, key: Row): Promise<Row | null> {
  const { data, error } = await admin!.from(table).select('*').match(key).maybeSingle();
  if (error) throw new Error(`read ${table}: ${error.message}`);
  return data as Row | null;
}

async function adminCount(table: string): Promise<number> {
  const { count, error } = await admin!.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

/** Removes marked rows, including any a broken policy let a probe insert. */
async function sweep() {
  if (!admin) return;
  const del = async (table: string, f: (q: ReturnType<SupabaseClient['from']>) => PromiseLike<{ error: unknown }>) => {
    const { error } = await f(admin.from(table));
    if (error) console.error(`cleanup ${table}:`, error);
  };
  for (const f of [...fixtures].reverse()) await del(f.table, (q) => q.delete().match(f.key));
  await del('reminder_log', (q) => q.delete().like('assignment_key', `${MARK}%`));
  // Every fixture date is in 2099, which no real schedule uses.
  const from = day(-7);
  const to = day(60);
  await del('duty_roster', (q) => q.delete().gte('date', from).lte('date', to));
  await del('duty_days', (q) => q.delete().gte('date', from).lte('date', to));
  await del('program_weeks', (q) => q.delete().gte('date', from).lte('date', to));
  await del('cart_schedules', (q) => q.delete().gte('start_date', from).lte('start_date', to));
  await del('cart_places', (q) => q.delete().like('name', `${MARK}%`));
  await del('service_weeks', (q) => q.delete().gte('week_start', from).lte('week_start', to));
  await del('territories', (q) => q.delete().gte('id', 990000).lt('id', 1000000));
  await del('people', (q) => q.delete().like('name', `${MARK}%`));
  await del('device_tokens', (q) => q.delete().like('token', `${MARK}%`));
}

// ---------------------------------------------------------------------------
// 3. Table matrix
// ---------------------------------------------------------------------------
async function checkTable(role: Role, sb: SupabaseClient, table: string, op: Op, want: TableAccess, uid?: string) {
  const area = role;
  const name = `${op} ${table} → ${want}`;
  const live = admin != null;

  if (op === 'select') {
    const o = await run(sb.from(table).select('*', { count: 'exact' }).limit(0));
    if (want === 'deny') return expect(area, name, isDenied(o), describe(o));
    if (o.code) return expect(area, name, false, describe(o));
    if (!live) return record(area, name, want === 'allow' ? 'pass' : 'info', `${o.count} rows`);
    const total = await adminCount(table);
    if (want === 'allow') return expect(area, name, o.count === total, `${o.count}/${total} rows`);
    if (want === 'rls') return expect(area, name, o.count === 0 && total > 0, `${o.count}/${total} rows`);
    // own: every visible row is the caller's, and the other user's fixture stays hidden
    const mine = await run(sb.from(table).select('*'));
    const ownerCol = table === 'profiles' ? 'id' : 'user_id';
    const foreign = mine.rows.filter((r) => r[ownerCol] !== uid).length;
    return expect(area, name, !mine.code && foreign === 0 && total > mine.rows.length, `${mine.rows.length} own, ${foreign} foreign, ${total} total`);
  }

  if (!live) return; // hosted: no write probes at all

  if (op === 'insert') {
    const o = await run(sb.from(table).insert(probeRow(table, uid)).select());
    if (want === 'deny' || want === 'rls') return expect(area, name, isDenied(o), describe(o));
    if (want === 'own') {
      const own = o.rows.length === 1 && !o.code;
      if (own) fixtures.push({ table, key: { id: o.rows[0]?.id } });
      expect(area, `${name} (own row)`, own, describe(o));
      const other = await run(sb.from(table).insert({ ...probeRow(table, fx.device_tokens.user_id as string), token: `${RUN}-forged` }).select());
      return expect(area, `${op} ${table} for another user → rls`, isDenied(other), describe(other));
    }
    return expect(area, name, !o.code, describe(o));
  }

  // update / delete
  if (table === 'profiles' || table === 'reminder_log') {
    const filter = table === 'profiles' ? { id: uid ?? fx.reminder_log.user_id } : { user_id: fx.reminder_log.user_id };
    const o = op === 'update'
      ? await run(sb.from(table).update(table === 'profiles' ? { display_name: RUN } : { offset_days: 2 }).match(filter).select())
      : await run(sb.from(table).delete().match(filter).select());
    if (want === 'deny') return expect(area, name, isDenied(o), describe(o));
    return; // profiles update ('cols') is covered by checkProfiles
  }

  const key = table === 'device_tokens' ? { id: fx.device_tokens.id } : fixtureKey(table);
  const before = await adminRow(table, key);
  const o = op === 'update'
    ? await run(sb.from(table).update(PATCH[table] ?? {}).match(key).select())
    : await run(sb.from(table).delete().match(key).select());
  const after = await adminRow(table, key);
  const untouched = after != null && after.version === before?.version;
  if (want === 'deny') return expect(area, name, isDenied(o) && untouched, describe(o));
  if (want === 'rls' || want === 'own') {
    // own: the probe targets the OTHER user's token, so it must behave like rls
    return expect(area, want === 'own' ? `${op} ${table} of another user → 0 rows` : name, !o.code && o.rows.length === 0 && untouched, `${describe(o)}, fixture ${untouched ? 'unchanged' : 'CHANGED'}`);
  }
  return expect(area, name, !o.code && o.rows.length > 0, describe(o));
}

async function checkTables(role: Role, sb: SupabaseClient, uid?: string) {
  for (const [table, row] of Object.entries(TABLES))
    for (const op of ['select', 'insert', 'update', 'delete'] as Op[]) await checkTable(role, sb, table, op, row[op][role], uid);
}

/** Escalation attempts on the caller's own profile and the other user's tokens. */
async function checkProfiles(sb: SupabaseClient, uid: string, other: string) {
  const area = 'viewer';
  const own = await run(sb.from('profiles').update({ display_name: `${MARK} name` }).eq('id', uid).select());
  expect(area, 'update own profiles.display_name → allowed', own.rows.length === 1, describe(own));
  for (const patch of [{ role: 'admin' }, { person_id: fx.people.id }, { can_edit_programa_midweek: true }, { can_edit_programa_weekend: true }, { can_edit_privilegios: true }, { id: other }]) {
    const o = await run(sb.from('profiles').update(patch).eq('id', uid).select());
    expect(area, `update own profiles.${Object.keys(patch)[0]} → 42501`, isDenied(o), describe(o));
  }
  const otherBefore = await adminRow('profiles', { id: other });
  const o = await run(sb.from('profiles').update({ display_name: RUN }).eq('id', other).select());
  const otherAfter = await adminRow('profiles', { id: other });
  expect(area, 'update another user profile → 0 rows', !o.code && o.rows.length === 0 && otherAfter?.version === otherBefore?.version, describe(o));
  const ups = await run(sb.from('profiles').upsert({ id: uid, role: 'admin' }).select());
  expect(area, 'upsert own profile with role admin → 42501', isDenied(ups), describe(ups));
  const mine = await adminRow('profiles', { id: uid });
  expect(area, 'own profile still viewer with no grants', mine?.role === 'viewer' && !mine?.person_id && !mine?.can_edit_programa_midweek && !mine?.can_edit_programa_weekend && !mine?.can_edit_privilegios);
  const tok = await run(sb.from('device_tokens').insert({ ...probeRow('device_tokens', uid), token: `${RUN}-own-2` }).select());
  expect(area, 'insert own device token', tok.rows.length === 1, describe(tok));
  if (tok.rows[0]) {
    fixtures.push({ table: 'device_tokens', key: { id: tok.rows[0].id } });
    const move = await run(sb.from('device_tokens').update({ user_id: other }).eq('id', tok.rows[0].id).select());
    expect(area, 'move own device token to another user → 42501', isDenied(move), describe(move));
    const del = await run(sb.from('device_tokens').delete().eq('id', tok.rows[0].id).select());
    expect(area, 'delete own device token → 1 row', del.rows.length === 1, describe(del));
  }
}

// ---------------------------------------------------------------------------
// 4. RPCs
// ---------------------------------------------------------------------------
function rpcArgs(name: string, uid: string): Row {
  const person = fx.people?.id ?? '00000000-0000-0000-0000-000000000000';
  switch (name) {
    case 'my_assignments': return { p_from: day(0), p_to: day(30) };
    case 'reminder_candidates': return { p_from: day(0), p_to: day(7) };
    case 'link_account': return { p_user: uid, p_person: person };
    case 'add_person_alias': return { p_person: person, p_alias: `${RUN} alias` };
    case 'create_person_from_name': return { p_name: `${RUN} rpc`, p_gender: 'M' };
    case 'set_account_role': return { p_user: uid, p_role: 'admin' };
    case 'set_account_permissions': return { p_user: uid, p_midweek: true, p_weekend: true, p_privilegios: true };
    default: return {};
  }
}

async function checkRpcs(role: Role, sb: SupabaseClient, uid = '00000000-0000-0000-0000-000000000000') {
  for (const [name, spec] of Object.entries(RPCS)) {
    if (!admin && spec.mutating) {
      record(role, `rpc ${name} → ${spec.allowed.includes(role) ? 'allow' : 'deny'}`, 'info', 'mutating: not called on hosted; grant proven by the local run of the same migrations');
      continue;
    }
    const o = await run(sb.rpc(name, rpcArgs(name, uid)));
    const allowed = spec.allowed.includes(role);
    expect(role, `rpc ${name} → ${allowed ? 'allow' : 'deny'}`, allowed ? !o.code : isDenied(o), describe(o));
  }
  if (role === 'viewer') {
    const perms = await run(sb.rpc('my_permissions'));
    const p = perms.rows[0] ?? {};
    expect(role, 'my_permissions is viewer with every flag false', p.role === 'viewer' && !p.can_edit_programa_midweek && !p.can_edit_programa_weekend && !p.can_edit_privilegios && !p.sees_privilegios, JSON.stringify(p));
    const ed = await run(sb.rpc('is_editor'));
    expect(role, 'is_editor() is false', ed.rows[0] === undefined ? false : JSON.stringify(ed.rows[0]) !== 'true', describe(ed));
  }
}

// ---------------------------------------------------------------------------
// 5. Schemas, auth, storage, GraphQL
// ---------------------------------------------------------------------------
async function checkPlatform() {
  for (const schema of ['private', 'auth', 'storage', 'realtime', 'vault', 'net', 'cron']) {
    await pause();
    const r = await fetch(`${T.url}/rest/v1/x?select=*&limit=0`, { headers: { apikey: T.publishable, 'Accept-Profile': schema } });
    const b = (await r.json().catch(() => ({}))) as { code?: string };
    expect('anon', `schema ${schema} not exposed`, b.code === 'PGRST106', `HTTP ${r.status} ${b.code ?? ''}`);
  }

  await pause();
  const s = await fetch(`${T.url}/auth/v1/settings`, { headers: { apikey: T.publishable } });
  const set = (await s.json()) as { disable_signup?: boolean; mailer_autoconfirm?: boolean; external?: Record<string, boolean> };
  const providers = Object.entries(set.external ?? {}).filter(([, on]) => on).map(([p]) => p);
  expect('auth', 'anonymous sign-ins disabled', set.external?.anonymous_users === false);
  record('auth', 'sign-up', set.disable_signup ? 'pass' : 'warn',
    set.disable_signup ? 'disabled' : `open (providers: ${providers.join(', ')}; email autoconfirm ${set.mailer_autoconfirm ? 'on' : 'off'}): any visitor can become "viewer", so viewer must never exceed anon + own rows`);
  if (admin) {
    const email = `${RUN}@example.test`;
    const up = await anon.auth.signUp({ email, password: `${RUN}-Pw1!` });
    if (up.data.user) await admin.auth.admin.deleteUser(up.data.user.id);
    expect('auth', 'email sign-up needs confirmation (no session)', !up.data.session, up.error?.message ?? 'user created, unconfirmed');
  }

  await pause();
  const b = await anon.storage.listBuckets();
  record('storage', 'buckets visible to anon', b.error ? 'info' : (b.data?.length ?? 0) === 0 ? 'pass' : 'warn',
    b.error ? b.error.message : `${b.data?.length ?? 0} buckets${b.data?.length ? `, public: ${b.data.filter((x) => x.public).length}` : ''}`);

  await pause();
  const g = await fetch(`${T.url}/graphql/v1`, {
    method: 'POST',
    headers: { apikey: T.publishable, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __schema { queryType { fields { name } } } }' }),
  });
  const gj = (await g.json().catch(() => ({}))) as { data?: { __schema?: { queryType?: { fields?: { name: string }[] } } }; errors?: { message: string }[] };
  const fields = gj.data?.__schema?.queryType?.fields?.map((f) => f.name) ?? [];
  if (!fields.length) record('graphql', 'pg_graphql as anon', 'info', gj.errors?.[0]?.message ?? `HTTP ${g.status}, no fields`);
  else {
    const hidden = Object.entries(TABLES).filter(([, r]) => r.select.anon !== 'allow').map(([t]) => t.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()));
    const leaked = fields.filter((f) => hidden.some((h) => f.toLowerCase().startsWith(h.toLowerCase())));
    expect('graphql', 'GraphQL schema as anon exposes no restricted table', leaked.length === 0, leaked.join(', ') || `${fields.length} query fields`);
  }
}

// ---------------------------------------------------------------------------
// 6. Realtime (local: secret key generates events on restricted tables)
// ---------------------------------------------------------------------------
interface Seen {
  status: string;
  events: { type: string; newKeys: string[]; oldKeys: string[] }[];
}

async function subscribe(sb: SupabaseClient, label: string, table: string, seen: Record<string, Seen>): Promise<RealtimeChannel> {
  const s: Seen = (seen[`${label}:${table}`] = { status: 'pending', events: [] });
  const ch = sb.channel(`${RUN}-${label}-${table}`).on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
    s.events.push({ type: p.eventType, newKeys: Object.keys(p.new ?? {}), oldKeys: Object.keys(p.old ?? {}) });
    if (process.env.ACCESS_CHECK_DEBUG) console.log('  rt', label, table, p.eventType, Object.keys(p.new ?? {}).join(','), '|', Object.keys(p.old ?? {}).join(','), p.errors ?? '');
  });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { s.status = 'TIMED_OUT'; resolve(); }, 8000);
    ch.subscribe((status, err) => {
      if (s.status !== 'pending') return; // keep the first answer, not the CLOSED from teardown
      s.status = err ? `${status}: ${err.message}` : status;
      if (status !== 'SUBSCRIBED' && status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') return;
      clearTimeout(timer);
      resolve();
    });
  });
  return ch;
}

async function checkRealtime(subscribers: Record<string, SupabaseClient>) {
  const seen: Record<string, Seen> = {};
  const got = (k: string): Seen => seen[k] ?? { status: 'missing', events: [] };
  const channels: [SupabaseClient, RealtimeChannel][] = [];
  for (const [label, sb] of Object.entries(subscribers))
    for (const t of [REALTIME_CONTROL, ...REALTIME_RESTRICTED]) channels.push([sb, await subscribe(sb, label, t, seen)]);
  const a = admin!;
  const must = async (p: PromiseLike<{ error: { message: string } | null }>, what: string) => {
    const { error } = await p;
    if (error) throw new Error(`realtime ${what}: ${error.message}`);
  };
  const controlUpdates = () =>
    Object.keys(subscribers).map((l) => got(`${l}:${REALTIME_CONTROL}`).events.filter((e) => e.type === 'UPDATE').length);

  // Warm-up: SUBSCRIBED comes before the server starts matching changes. Poke the control table
  // until every subscriber sees an UPDATE, so "no events" on the restricted tables means something.
  const place = await a.from('cart_places').insert({ name: `${RUN} rt` }).select().single();
  if (place.error) throw new Error(place.error.message);
  for (let i = 0; i < 20 && controlUpdates().some((n) => n === 0); i++) {
    await must(a.from('cart_places').update({ color: `#0000${String(i).padStart(2, '0')}` }).eq('id', place.data.id), 'warm-up');
    await sleep(500);
  }
  const warm = controlUpdates();
  const slot = await a.from('cart_slots').insert({ place_id: place.data.id, iso_dow: 3, start_time: '11:00', end_time: '12:00' }).select().single();
  if (slot.error) throw new Error(slot.error.message);
  const person = await a.from('people').insert({ name: `${RUN} rt`, gender: 'F' }).select().single();
  if (person.error) throw new Error(person.error.message);
  await must(a.from('people').update({ target_appearances: 3 }).eq('id', person.data.id), 'people update');
  await must(a.from('person_availability').insert({ person_id: person.data.id, slot_id: slot.data.id }), 'availability insert');
  await must(a.from('person_availability').update({ updated_by: null }).match({ person_id: person.data.id, slot_id: slot.data.id }), 'availability update');
  await must(a.from('person_pairs').insert({ person_a: person.data.id, person_b: fx.people.id }), 'pairs insert');
  await must(a.from('person_pairs').update({ updated_by: null }).or(`person_a.eq.${person.data.id},person_b.eq.${person.data.id}`), 'pairs update');
  await must(a.from('duty_days').insert({ date: day(12), note: MARK }), 'duty_days insert');
  await must(a.from('duty_days').update({ kind: 'asamblea' }).eq('date', day(12)), 'duty_days update');
  const cell = await a.from('duty_roster').insert({ date: day(12), role: 'acomodador', slot: 2, person_id: person.data.id, note: MARK }).select().single();
  if (cell.error) throw new Error(cell.error.message);
  await must(a.from('duty_roster').update({ slot: 3 }).eq('id', cell.data.id), 'duty_roster update');
  // Realtime re-reads the row to apply RLS, so a change whose row is already gone is dropped for
  // everyone. Let INSERT/UPDATE events drain (and prove the stream is still live) before deleting.
  await sleep(REALTIME_WAIT);
  await must(a.from('cart_places').update({ color: '#654321' }).eq('id', place.data.id), 'cart_places update');
  await sleep(REALTIME_WAIT);
  await must(a.from('duty_roster').delete().eq('id', cell.data.id), 'duty_roster delete');
  await must(a.from('duty_days').delete().eq('date', day(12)), 'duty_days delete');
  await must(a.from('person_pairs').delete().or(`person_a.eq.${person.data.id},person_b.eq.${person.data.id}`), 'pairs delete');
  await must(a.from('person_availability').delete().eq('person_id', person.data.id), 'availability delete');
  await must(a.from('people').delete().eq('id', person.data.id), 'people delete');
  await must(a.from('cart_places').delete().eq('id', place.data.id), 'cart_places delete');
  await sleep(REALTIME_WAIT);

  for (const [sb, ch] of channels) await sb.removeChannel(ch);

  Object.keys(subscribers).forEach((label, i) => {
    const ctl = got(`${label}:${REALTIME_CONTROL}`);
    const before = warm[i] ?? 0;
    const after = ctl.events.filter((e) => e.type === 'UPDATE').length - before;
    expect('realtime', `${label}: control ${REALTIME_CONTROL} delivers changes before and after`, before > 0 && after > 0,
      `${ctl.status}, ${before} warm-up + ${after} later UPDATEs, ${ctl.events.length} events`);
    for (const t of REALTIME_RESTRICTED) {
      const s = got(`${label}:${t}`);
      const writes = s.events.filter((e) => e.type !== 'DELETE');
      const withData = writes.filter((e) => e.newKeys.length > 0 || e.oldKeys.length > 0);
      expect('realtime', `${label}: ${t} INSERT/UPDATE carry no row data`, withData.length === 0,
        `${s.status}, ${writes.length} events, ${withData.length} with columns`);
      if (writes.length > withData.length)
        record('realtime', `${label}: ${t} empty INSERT/UPDATE events`, 'warn', `${writes.length - withData.length} delivered with empty record + "Unauthorized" error: reveals that and when a write happened`);
      const dels = s.events.filter((e) => e.type === 'DELETE');
      const keys = [...new Set(dels.flatMap((e) => e.oldKeys))];
      if (dels.length === 0) record('realtime', `${label}: ${t} DELETE events`, 'pass', 'none delivered');
      else record('realtime', `${label}: ${t} DELETE events (table must not be published)`, 'fail',
        `${dels.length} delivered, old_record keys: ${keys.join(',') || '(none)'}`);
    }
  });
}


// ---------------------------------------------------------------------------
// 7. Edge Functions
// ---------------------------------------------------------------------------
const LEAK = /\bat .+:\d+:\d+|stack|Deno\.|SUPABASE_|SECRET|VAPID|\/functions\/|file:\/\/|node_modules|password/i;

async function checkFunctions(viewerJwt?: string) {
  const probes: { fn: string; label: string; init: RequestInit; want: number[] }[] = [];
  const json = { 'Content-Type': 'application/json' };
  for (const fn of EDGE_FUNCTIONS) {
    const body = fn === 'workbook' ? JSON.stringify({ weekStart: '2026-10-12' }) : JSON.stringify({ dryRun: true });
    probes.push(
      { fn, label: 'POST, no auth', init: { method: 'POST', headers: json, body }, want: [401] },
      { fn, label: 'POST, publishable key as Bearer', init: { method: 'POST', headers: { ...json, apikey: T.publishable, Authorization: `Bearer ${T.publishable}` }, body }, want: [401, 403] },
      { fn, label: 'POST, garbage Bearer', init: { method: 'POST', headers: { ...json, Authorization: 'Bearer not-a-token' }, body }, want: [401, 403] },
    );
    if (T.legacyAnonJwt)
      probes.push({ fn, label: 'POST, legacy anon JWT', init: { method: 'POST', headers: { ...json, Authorization: `Bearer ${T.legacyAnonJwt}` }, body }, want: [401, 403] });
    if (viewerJwt) {
      probes.push({ fn, label: 'POST, viewer JWT', init: { method: 'POST', headers: { ...json, Authorization: `Bearer ${viewerJwt}` }, body }, want: [401, 403] });
      if (fn === 'workbook')
        probes.push({ fn, label: 'POST, viewer JWT, bad JSON', init: { method: 'POST', headers: { ...json, Authorization: `Bearer ${viewerJwt}` }, body: '{' }, want: [400, 401, 403] });
    }
  }
  probes.push({ fn: 'send-reminders', label: 'GET', init: { method: 'GET' }, want: [401, 405] });

  for (const p of probes) {
    await pause();
    const r = await fetch(`${T.url}/functions/v1/${p.fn}`, p.init);
    const text = await r.text();
    const leak = LEAK.exec(text);
    expect('functions', `${p.fn} ${p.label} → ${p.want.join('/')}`, p.want.includes(r.status) && !leak,
      `HTTP ${r.status}${leak ? `, body leaks "${leak[0]}"` : ''}, ${text.length} B body`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function signedIn(email: string, password: string): Promise<{ sb: SupabaseClient; uid: string; jwt: string }> {
  const sb = createClient(T.url, T.publishable, clientOpts);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message}`);
  return { sb, uid: data.user.id, jwt: data.session.access_token };
}

async function main() {
  console.log(`access-check: target=${TARGET} ${new URL(T.url).host} run=${RUN}\n`);
  await checkSurface();
  await checkPlatform();
  await checkRpcs('anon', anon);

  if (!admin) {
    await checkTables('anon', anon); // SELECT counts only
    record('realtime', 'hosted', 'info', 'skipped: events cannot be generated without writes');
    await checkFunctions();
    return;
  }

  const users: string[] = [];
  try {
    await sweep();
    const password = `${RUN}-Pw1!`;
    const mk = async (tag: string) => {
      const { data, error } = await admin.auth.admin.createUser({ email: `${RUN}-${tag}@example.test`, password, email_confirm: true });
      if (error) throw new Error(`create user: ${error.message}`);
      users.push(data.user.id);
      return data.user.id;
    };
    await mk('viewer');
    const other = await mk('other');
    await seedAll(other);
    await checkTables('anon', anon);
    const v = await signedIn(`${RUN}-viewer@example.test`, password);
    await checkTables('viewer', v.sb, v.uid);
    await checkProfiles(v.sb, v.uid, other);
    await checkRpcs('viewer', v.sb, v.uid);
    const leftovers = await admin.from('people').select('id', { count: 'exact', head: true }).like('name', `${RUN} rpc%`);
    expect('viewer', 'create_person_from_name left no row', (leftovers.count ?? 0) === 0);
    await checkRealtime({ anon, viewer: v.sb });
    await checkFunctions(v.jwt);
  } finally {
    await sweep();
    for (const id of users) await admin.auth.admin.deleteUser(id);
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) if (u.email?.startsWith(MARK)) await admin.auth.admin.deleteUser(u.id);
  }
}

main()
  .catch((err) => {
    record('runner', 'aborted', 'fail', String((err as Error).message ?? err));
  })
  .finally(() => {
    const n = (s: Status) => results.filter((r) => r.status === s).length;
    console.log(`\n${n('pass')} pass, ${n('fail')} fail, ${n('warn')} warn, ${n('info')} info`);
    if (args.out) writeFileSync(args.out, JSON.stringify({ target: TARGET, host: new URL(T.url).host, at: new Date().toISOString(), results }, null, 2));
    process.exit(n('fail') ? 1 : 0);
  });
