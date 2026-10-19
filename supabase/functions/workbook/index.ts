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
 * Auth: verify_jwt (default) lets any JWT-shaped bearer through (even the publishable key), so
 * the function checks it itself: no valid session → 401; signed in without
 * `public.my_permissions().can_edit_programa` (falling back to `public.is_editor()` while that
 * RPC does not exist) → 403. Auth failures are never a 500.
 *
 * The EPUB host sends no CORS headers, so the browser cannot read it: this function fetches the
 * issue list from b.jw-cdn.org, downloads the EPUB from *.jw-cdn.org, unzips the week files and
 * caches the parsed issue for the lifetime of the instance. Upstream fetches have a timeout,
 * follow redirects only to *.jw-cdn.org and stop reading past a size cap (guard.ts).
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
import {
  allowedHost,
  bearerToken,
  guardedFetch,
  inWorkbookRange,
  MAX_ENTRY_BYTES,
  MAX_EPUB_BYTES,
  MAX_META_BYTES,
  rpcErrorStatus,
  userErrorStatus,
} from './guard.ts';

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

class NotPublished extends Error {}

async function loadIssue(issue: Issue): Promise<Map<string, WorkbookWeek>> {
  const code = issueCode(issue);
  let meta: Uint8Array;
  try {
    ({ body: meta } = await guardedFetch(
      `${API}?pub=mwb&langwritten=S&issue=${code}&output=json&fileformat=EPUB`,
      { maxBytes: MAX_META_BYTES },
    ));
  } catch (err) {
    if ((err as { status?: number }).status === 404) throw new NotPublished(code);
    throw new Error(`issue list ${code}: ${(err as Error).message}`, { cause: err });
  }
  const body = JSON.parse(new TextDecoder().decode(meta));
  const url: unknown = body?.files?.S?.EPUB?.[0]?.file?.url;
  if (typeof url !== 'string' || !allowedHost(url)) throw new Error(`issue ${code}: no EPUB url`);

  const { body: epub } = await guardedFetch(url, { maxBytes: MAX_EPUB_BYTES });
  const files = unzipSync(epub, {
    filter: (f) => {
      if (!isWeekFile(f.name)) return false;
      if (f.originalSize > MAX_ENTRY_BYTES) throw new Error(`EPUB ${code}: ${f.name} too large`);
      return true;
    },
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

/** 200 when the caller may use the function, 401 without a valid session, 403 otherwise. */
async function permission(token: string): Promise<200 | 401 | 403> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? publishableKey();
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing');
  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const user = await sb.auth.getUser(token);
  if (user.error || !user.data.user) {
    const status = user.error ? userErrorStatus(user.error) : 401;
    if (status) return status;
    throw new Error(`getUser: ${user.error?.message}`);
  }

  const perms = await sb.rpc('my_permissions');
  if (!perms.error) {
    const row = Array.isArray(perms.data) ? perms.data[0] : perms.data;
    return row?.can_edit_programa ? 200 : 403;
  }
  const denied = rpcErrorStatus(perms.error);
  if (denied) return denied;
  // PGRST202: the RPC is not deployed yet → the older editor/admin check.
  if (perms.error.code !== 'PGRST202') throw new Error(`my_permissions: ${perms.error.message}`);
  const editor = await sb.rpc('is_editor');
  if (editor.error) {
    const status = rpcErrorStatus(editor.error);
    if (status) return status;
    throw new Error(`is_editor: ${editor.error.message}`);
  }
  return editor.data === true ? 200 : 403;
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

  const token = bearerToken(req.headers.get('Authorization'));
  if (!token) return json(401, { error: 'unauthorized' });

  try {
    const status = await permission(token);
    if (status === 401) return json(401, { error: 'unauthorized' });
    if (status === 403) return json(403, { error: 'forbidden' });
  } catch (err) {
    console.error('workbook auth', err);
    return json(500, { error: 'auth_check_failed' });
  }

  let body: { weekStart?: unknown; month?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request', message: 'JSON body required' });
  }

  let mondays: string[];
  if (isIsoDate(body.weekStart) && isMonday(body.weekStart) && inWorkbookRange(body.weekStart)) {
    mondays = [body.weekStart];
  } else if (
    typeof body.month === 'string' &&
    isIsoDate(`${body.month}-01`) &&
    inWorkbookRange(body.month)
  ) {
    mondays = weekStartsOfMonth(body.month);
  } else {
    return json(400, {
      error: 'bad_request',
      message: 'Send { weekStart: "YYYY-MM-DD" (a Monday) } or { month: "YYYY-MM" }, years 2020-2100',
    });
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
