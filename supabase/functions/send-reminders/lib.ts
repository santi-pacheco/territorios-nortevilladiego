/**
 * Pure part of send-reminders: which assignments are due today and the Spanish copy.
 * No Deno or network APIs here, so it runs under `deno test` (and any TS test runner).
 */

export type AssignmentKind = 'carrito' | 'programa' | 'salida';

/** One row of public.reminder_candidates (same columns as public.my_assignments + user_id). */
export interface Candidate {
  user_id: string;
  key: string;
  kind: AssignmentKind;
  /** YYYY-MM-DD */
  date: string;
  start_time: string | null;
  title: string;
  place: string | null;
  role: string | null;
  detail: string | null;
}

/** A public.reminder_log row (only the identifying columns). */
export interface SentKey {
  user_id: string;
  assignment_key: string;
  offset_days: number;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Lets the service worker replace (not stack) a repeat of the same reminder. */
  tag: string;
}

export interface DueReminder {
  user_id: string;
  assignment_key: string;
  offset_days: number;
  message: PushMessage;
}

/** Days before the assignment on which a reminder goes out. */
export const OFFSETS = [7, 1] as const;
export const REMINDER_URL = '/mis-asignaciones';
export const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** YYYY-MM-DD + n days (UTC arithmetic, no DST drift). */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Calendar date (YYYY-MM-DD) of `now` in `timeZone`. */
export function todayIn(timeZone: string = TIME_ZONE, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** "martes 21" */
export function formatDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function label(a: Candidate): string {
  switch (a.kind) {
    case 'carrito':
      return 'Carrito';
    case 'salida':
      return 'Salida (Conductor)';
    case 'programa':
      return a.role ? `${a.title} (${a.role})` : a.title;
  }
}

/**
 * "Carrito en 7 días" / "martes 21 · 09:00 · Plaza"
 * "Mañana: Lectura de la Biblia (Lector)" / "martes 14 · 19:30"
 * Names of the other people (detail) are left out of the payload on purpose.
 */
export function composeMessage(a: Candidate, offsetDays: number): PushMessage {
  const what = label(a);
  const title =
    offsetDays === 1
      ? `Mañana: ${what}`
      : offsetDays === 0
        ? `Hoy: ${what}`
        : `${what} en ${offsetDays} días`;
  const body = [formatDay(a.date), a.start_time, a.place].filter(Boolean).join(' · ');
  return { title, body, url: REMINDER_URL, tag: `${a.key}:${offsetDays}` };
}

/**
 * Candidates dated exactly today + offset for one of `offsets`, minus those already in
 * reminder_log. Duplicate candidate rows (same user + key) collapse to one reminder.
 */
export function selectDue(
  today: string,
  candidates: readonly Candidate[],
  sent: readonly SentKey[],
  offsets: readonly number[] = OFFSETS,
): DueReminder[] {
  const done = new Set(sent.map((s) => `${s.user_id}|${s.assignment_key}|${s.offset_days}`));
  const byDate = new Map(offsets.map((o) => [addDays(today, o), o]));
  const out: DueReminder[] = [];
  for (const c of candidates) {
    const offset = byDate.get(c.date);
    if (offset === undefined) continue;
    const id = `${c.user_id}|${c.key}|${offset}`;
    if (done.has(id)) continue;
    done.add(id);
    out.push({
      user_id: c.user_id,
      assignment_key: c.key,
      offset_days: offset,
      message: composeMessage(c, offset),
    });
  }
  return out;
}

/** Web push endpoints answering 404/410 are gone for good: delete the subscription. */
export const isGoneStatus = (status: number | undefined): boolean =>
  status === 404 || status === 410;
