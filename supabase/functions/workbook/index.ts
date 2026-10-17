/**
 * workbook: the structure of the midweek meeting from the "Guía de actividades para la reunión
 * Vida y Ministerio Cristianos" (JW.org, pub=mwb, Spanish). The editor uses it to prefill a week
 * in Gestión ▸ Programa ▸ Editar; only names are left to assign.
 *
 * Body (JSON), one of:
 *   { "weekStart": "2026-10-12" }   a Monday: that week
 *   { "month": "2026-10" }          every Monday week that overlaps the month
 * Response: { weeks: WorkbookWeek[], missing: string[] } (see lib.ts). Titles, minutes and song
 * numbers only; no paragraph text.
 *
 * Auth: verify_jwt (default) plus the caller's own permissions: `public.my_permissions()`
 * (`can_edit_programa`), falling back to `public.is_editor()` while that RPC does not exist.
 *
 * The EPUB host sends no CORS headers, so the browser cannot read it: this function fetches the
 * issue list from b.jw-cdn.org, downloads the EPUB from *.jw-cdn.org, unzips the week files and
 * caches the parsed issue for the lifetime of the instance.
 */
import { createClient } from '@supabase/supabase-js';
import { unzipSync } from 'fflate';
import {
  type Issue,
  isIsoDate,
  isMonday,
  issueCode,
  issueForWeek,
  isWeekFile,
  parseWeekXhtml,
  shiftIssue,
  type WorkbookWeek,
  weekStartsOfMonth,
} from './lib.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const API = 'https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS';

function allowedHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'jw-cdn.org' || u.hostname.endsWith('.jw-cdn.org'));
  } catch {
    return false;
  }
}

class NotPublished extends Error {}

async function loadIssue(issue: Issue): Promise<Map<string, WorkbookWeek>> {
  const code = issueCode(issue);
  const meta = await fetch(
    `${API}?pub=mwb&langwritten=S&issue=${code}&output=json&fileformat=EPUB`,
  );
  if (meta.status === 404) throw new NotPublished(code);
  if (!meta.ok) throw new Error(`issue list ${code}: HTTP ${meta.status}`);
  const body = await meta.json();
  const url: unknown = body?.files?.S?.EPUB?.[0]?.file?.url;
  if (typeof url !== 'string' || !allowedHost(url)) throw new Error(`issue ${code}: no EPUB url`);

  const epub = await fetch(url);
  if (!epub.ok) throw new Error(`EPUB ${code}: HTTP ${epub.status}`);
  const files = unzipSync(new Uint8Array(await epub.arrayBuffer()), {
    filter: (f) => isWeekFile(f.name),
  });
  const decoder = new TextDecoder();
  const weeks = new Map<string, WorkbookWeek>();
  for (const data of Object.values(files)) {
    const week = parseWeekXhtml(decoder.decode(data), issue);
    if (week) weeks.set(week.weekStart, week);
  }
  return weeks;
}

// Parsed issues for the lifetime of this instance. A failed load is dropped so it is retried.
const cache = new Map<string, Promise<Map<string, WorkbookWeek>>>();

async function issueWeeks(issue: Issue): Promise<Map<string, WorkbookWeek>> {
  const code = issueCode(issue);
  let p = cache.get(code);
  if (!p) {
    p = loadIssue(issue).catch((err) => {
      if (!(err instanceof NotPublished)) cache.delete(code);
      throw err;
    });
    cache.set(code, p);
  }
  try {
    return await p;
  } catch (err) {
    if (err instanceof NotPublished) return new Map();
    throw err;
  }
}

/** The usual issue first; a boundary week may sit in the previous or the next one. */
async function findWeek(monday: string): Promise<WorkbookWeek | null> {
  const home = issueForWeek(monday);
  for (const issue of [home, shiftIssue(home, -1), shiftIssue(home, 1)]) {
    const week = (await issueWeeks(issue)).get(monday);
    if (week) return week;
  }
  return null;
}

async function canEditPrograma(authorization: string): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? publishableKey();
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing');
  const sb = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const perms = await sb.rpc('my_permissions');
  if (!perms.error) {
    const row = Array.isArray(perms.data) ? perms.data[0] : perms.data;
    return Boolean(row?.can_edit_programa);
  }
  // PGRST202: the RPC is not deployed yet → the older editor/admin check.
  if (perms.error.code !== 'PGRST202') throw new Error(`my_permissions: ${perms.error.message}`);
  const editor = await sb.rpc('is_editor');
  if (editor.error) throw new Error(`is_editor: ${editor.error.message}`);
  return editor.data === true;
}

function publishableKey(): string | undefined {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (!keys) return undefined;
  try {
    const parsed = JSON.parse(keys) as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0];
  } catch {
    return undefined;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json(401, { error: 'unauthorized' });

  let body: { weekStart?: unknown; month?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request', message: 'JSON body required' });
  }

  let mondays: string[];
  if (isIsoDate(body.weekStart) && isMonday(body.weekStart)) {
    mondays = [body.weekStart];
  } else if (typeof body.month === 'string' && isIsoDate(`${body.month}-01`)) {
    mondays = weekStartsOfMonth(body.month);
  } else {
    return json(400, {
      error: 'bad_request',
      message: 'Send { weekStart: "YYYY-MM-DD" (a Monday) } or { month: "YYYY-MM" }',
    });
  }

  try {
    if (!(await canEditPrograma(authorization))) return json(403, { error: 'forbidden' });
  } catch (err) {
    console.error('workbook auth', err);
    return json(500, { error: 'auth_check_failed' });
  }

  try {
    const weeks: WorkbookWeek[] = [];
    const missing: string[] = [];
    for (const monday of mondays) {
      const week = await findWeek(monday);
      if (week) weeks.push(week);
      else missing.push(monday);
    }
    return json(200, { weeks, missing });
  } catch (err) {
    console.error('workbook fetch', err);
    return json(502, { error: 'upstream_failed' });
  }
});
