/**
 * send-reminders: daily Web Push reminders 7 days and 1 day before each assignment
 * (docs/ASSIGNMENTS.md). Called by pg_cron (see migration member_accounts) with
 * `Authorization: Bearer <REMINDER_SECRET>`; deployed with verify_jwt = false.
 *
 * Body (optional JSON):
 *   { "dryRun": true }                       return what would be sent, send/log nothing
 *   { "dryRun": true, "today": "2026-10-16" } dry run as if today were that date
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…), REMINDER_SECRET.
 * Database access uses the project's secret key (SUPABASE_SECRET_KEYS, injected by the
 * platform; or SB_SECRET_KEY set as a function secret).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  addDays,
  type Candidate,
  type DueReminder,
  isGoneStatus,
  isIsoDate,
  OFFSETS,
  type SentKey,
  selectDue,
  todayIn,
} from './lib.ts';

interface Subscription {
  id: string;
  user_id: string;
  token: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    const k = parsed.default ?? Object.values(parsed)[0];
    if (k) return k;
  }
  const k = Deno.env.get('SB_SECRET_KEY');
  if (!k) throw new Error('No secret key: set SB_SECRET_KEY or enable SUPABASE_SECRET_KEYS');
  return k;
}

async function loadData(sb: SupabaseClient, today: string) {
  const offsets = [...OFFSETS];
  const { data: cand, error: e1 } = await sb.rpc('reminder_candidates', {
    p_from: addDays(today, Math.min(...offsets)),
    p_to: addDays(today, Math.max(...offsets)),
  });
  if (e1) throw new Error(`reminder_candidates: ${e1.message}`);
  const candidates = (cand ?? []) as Candidate[];
  const userIds = [...new Set(candidates.map((c) => c.user_id))];
  if (userIds.length === 0)
    return { candidates, sent: [] as SentKey[], subs: [] as Subscription[] };

  const [log, tokens] = await Promise.all([
    sb
      .from('reminder_log')
      .select('user_id, assignment_key, offset_days')
      .in('user_id', userIds)
      .in('assignment_key', [...new Set(candidates.map((c) => c.key))]),
    sb
      .from('device_tokens')
      .select('id, user_id, token')
      .eq('platform', 'web')
      .in('user_id', userIds),
  ]);
  if (log.error) throw new Error(`reminder_log: ${log.error.message}`);
  if (tokens.error) throw new Error(`device_tokens: ${tokens.error.message}`);
  return {
    candidates,
    sent: (log.data ?? []) as SentKey[],
    subs: (tokens.data ?? []) as Subscription[],
  };
}

async function send(sb: SupabaseClient, due: DueReminder[], subs: Subscription[]) {
  const webpush = (await import('web-push')).default;
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!pub || !priv || !subject)
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not set');
  webpush.setVapidDetails(subject, pub, priv);

  const gone = new Set<string>();
  const delivered: DueReminder[] = [];
  const failures: Array<{ assignment_key: string; status?: number; error: string }> = [];

  for (const d of due) {
    let ok = false;
    for (const s of subs) {
      if (s.user_id !== d.user_id || gone.has(s.id)) continue;
      let subscription: unknown;
      try {
        subscription = JSON.parse(s.token);
      } catch {
        gone.add(s.id); // not a PushSubscription JSON: can never be delivered
        continue;
      }
      try {
        await webpush.sendNotification(subscription as never, JSON.stringify(d.message), {
          TTL: 24 * 60 * 60,
          urgency: 'normal',
        });
        ok = true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (isGoneStatus(status)) gone.add(s.id);
        else
          failures.push({
            assignment_key: d.assignment_key,
            status,
            error: String((err as Error).message ?? err),
          });
      }
    }
    if (ok) delivered.push(d);
  }

  if (delivered.length) {
    const { error } = await sb.from('reminder_log').upsert(
      delivered.map((d) => ({
        user_id: d.user_id,
        assignment_key: d.assignment_key,
        offset_days: d.offset_days,
      })),
      { onConflict: 'user_id,assignment_key,offset_days', ignoreDuplicates: true },
    );
    if (error) throw new Error(`reminder_log insert: ${error.message}`);
  }
  if (gone.size) {
    const { error } = await sb
      .from('device_tokens')
      .delete()
      .in('id', [...gone]);
    if (error) throw new Error(`device_tokens delete: ${error.message}`);
  }
  return { sent: delivered.length, removedSubscriptions: gone.size, failures };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const expected = Deno.env.get('REMINDER_SECRET');
  const given = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || !timingSafeEqual(given, expected)) return json(401, { error: 'unauthorized' });

  let body: { dryRun?: unknown; today?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // empty body = real run for today
  }
  const dryRun = body.dryRun === true;
  // The date override exists only for dry runs, so a real run can never re-send old days.
  const today = dryRun && isIsoDate(body.today) ? body.today : todayIn();

  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { candidates, sent, subs } = await loadData(sb, today);
    const due = selectDue(today, candidates, sent);

    if (dryRun) {
      return json(200, {
        dryRun: true,
        today,
        candidates: candidates.length,
        alreadySent: sent.length,
        due: due.map((d) => ({
          ...d,
          subscriptions: subs.filter((s) => s.user_id === d.user_id).length,
        })),
      });
    }

    const result = await send(sb, due, subs);
    console.log(JSON.stringify({ today, due: due.length, ...result }));
    return json(200, { dryRun: false, today, due: due.length, ...result });
  } catch (err) {
    console.error(err);
    return json(500, { error: String((err as Error).message ?? err) });
  }
});
