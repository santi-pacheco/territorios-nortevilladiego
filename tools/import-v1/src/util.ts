import { createHash } from 'node:crypto';

// Fixed namespace so every run maps the same v1 key to the same v2 uuid.
const NAMESPACE = 'b6f1c2d4-3a5e-4f7a-9c1d-2e8f0a4b6c3d';

/** RFC 4122 v5 uuid (SHA-1, name-based). Deterministic → idempotent re-imports. */
export function uuidV5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// --- Dates: pure UTC string math (core's parseIso/toIso use local time). ---

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcDate(iso: string): Date | null {
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === iso ? d : null;
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && utcDate(v) !== null;
}

/** ISO day of week, 1 = Monday … 7 = Sunday. */
export function isoDow(iso: string): number {
  const d = utcDate(iso);
  if (!d) throw new Error(`invalid ISO date ${iso}`);
  return ((d.getUTCDay() + 6) % 7) + 1;
}

export function addDaysIso(iso: string, n: number): string {
  const d = utcDate(iso);
  if (!d) throw new Error(`invalid ISO date ${iso}`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((utcDate(b)!.getTime() - utcDate(a)!.getTime()) / 86_400_000);
}

/** "9:00" / "09:00" / "09:00:00" → "09:00:00" (Postgres `time` text form), else null. */
export function normalizeTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] ?? 0);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Key-order-independent JSON, for comparing jsonb values. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
