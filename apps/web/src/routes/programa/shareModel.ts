/**
 * What the Programa "Compartir / Imprimir" sheet puts on paper or in the image: the choice
 * (a preset or a custom date range) and the pure step that turns program rows into blocks.
 */
import type { MidweekWeek, WeekendMeeting } from '@territorios/core';
import { addDaysIso, fromIso, mondayOf, toIso } from '../../lib/week';
import {
  midweekHasContent,
  sanitizeMidweek,
  sanitizeWeekend,
  weekendHasContent,
} from './model';

export type ShareKind = 'midweek' | 'weekend' | 'both';

export interface ShareRange {
  kind: ShareKind;
  /** Inclusive ISO dates. */
  from: string;
  to: string;
}

export type SharePresetId =
  | 'midweek-1'
  | 'weekend-1'
  | 'week-1'
  | 'midweeks-4'
  | 'weekends-4'
  | 'weeks-4'
  | 'custom';

/** A custom range is clamped to this many weeks so the page and the image stay manageable. */
export const MAX_RANGE_WEEKS = 12;
/** The PNG holds up to this many blocks; longer selections can still be printed. */
export const IMAGE_MAX_BLOCKS = 12;

/** Range for a quick preset, counted from the week shown on screen (`monday`). */
export function presetRange(id: Exclude<SharePresetId, 'custom'>, monday: string): ShareRange {
  const tuesday = addDaysIso(monday, 1);
  const saturday = addDaysIso(monday, 5);
  switch (id) {
    case 'midweek-1':
      return { kind: 'midweek', from: tuesday, to: tuesday };
    case 'weekend-1':
      return { kind: 'weekend', from: saturday, to: saturday };
    case 'week-1':
      return { kind: 'both', from: monday, to: addDaysIso(monday, 6) };
    case 'midweeks-4':
      return { kind: 'midweek', from: tuesday, to: addDaysIso(tuesday, 21) };
    case 'weekends-4':
      return { kind: 'weekend', from: saturday, to: addDaysIso(saturday, 21) };
    case 'weeks-4':
      return { kind: 'both', from: monday, to: addDaysIso(monday, 27) };
  }
}

function isRealIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = fromIso(value);
  return !Number.isNaN(d.getTime()) && toIso(d) === value;
}

/**
 * Sorts swapped dates and caps the span at `MAX_RANGE_WEEKS`; null while a date is missing or
 * invalid (a half-typed custom range).
 */
export function normalizeRange(range: ShareRange): ShareRange | null {
  if (!isRealIso(range.from) || !isRealIso(range.to)) return null;
  const [from, to] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];
  const last = addDaysIso(from, MAX_RANGE_WEEKS * 7 - 1);
  return { kind: range.kind, from, to: to > last ? last : to };
}

export type ShareBlock =
  | { key: string; kind: 'midweek'; date: string; week: MidweekWeek }
  | { key: string; kind: 'weekend'; date: string; meeting: WeekendMeeting }
  | { key: string; kind: 'assembly'; date: string; name: string; monday: string };

interface RowLike {
  kind: string;
  date: string;
  data: unknown;
}

/**
 * Blocks to render for `range`, by date. Rows with nothing to show are dropped, and a week
 * whose meeting is only an assembly note becomes one assembly block, as on the screen.
 */
export function selectBlocks(rows: readonly RowLike[], range: ShareRange): ShareBlock[] {
  const wanted = (kind: string) => range.kind === 'both' || range.kind === kind;
  const sorted = rows
    .filter((r) => wanted(r.kind) && r.date >= range.from && r.date <= range.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  const byWeek = new Map<string, ShareBlock[]>();
  const assembly = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of sorted) {
    const key = `${row.kind}-${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const monday = mondayOf(fromIso(row.date));
    const list = byWeek.get(monday) ?? [];
    byWeek.set(monday, list);
    if (row.kind === 'midweek') {
      const week = sanitizeMidweek(row.data, row.date);
      if (!week) continue;
      if (midweekHasContent(week)) list.push({ key, kind: 'midweek', date: row.date, week });
      else if (week.asamblea && !assembly.has(monday)) assembly.set(monday, week.asamblea);
    } else if (row.kind === 'weekend') {
      const meeting = sanitizeWeekend(row.data, row.date);
      if (!meeting) continue;
      if (weekendHasContent(meeting)) list.push({ key, kind: 'weekend', date: row.date, meeting });
      else if (meeting.asamblea && !assembly.has(monday)) assembly.set(monday, meeting.asamblea);
    }
  }

  const out: ShareBlock[] = [];
  for (const monday of [...byWeek.keys()].sort()) {
    const name = assembly.get(monday);
    // The assembly note leads its week: it explains why the other meeting is missing.
    if (name) out.push({ key: `assembly-${monday}`, kind: 'assembly', date: monday, name, monday });
    out.push(...(byWeek.get(monday) ?? []));
  }
  return out;
}
