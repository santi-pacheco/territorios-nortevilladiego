import { DAY_NAME, addDaysIso, fromIso, longDate, mondayOf } from '../../lib/week';
import type { WeeksSource } from './weeks';

/** Banner text for a blocked turn that has no reason of its own. */
export const DEFAULT_BLOCK_LABEL = 'Sin carrito';

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "Mes de octubre", or "Octubre – noviembre" when the period crosses months. */
export function monthTitle(startDate: string, endDate: string): string {
  const from = MONTH_NAMES[fromIso(startDate).getMonth()] ?? '';
  const to = MONTH_NAMES[fromIso(endDate).getMonth()] ?? '';
  if (!from) return 'Cronograma';
  if (!to || to === from) return `Mes de ${from}`;
  return `${from.charAt(0).toUpperCase()}${from.slice(1)} – ${to}`;
}

export interface MonthColumn {
  slotId: string;
  day: string;
  /** "09:00–11:00" */
  time: string;
  place: string;
}

export type MonthCell =
  | { kind: 'outside' }
  | { kind: 'blocked'; reason: string; span: number }
  | { kind: 'open'; people: string[]; note: string | null };

export interface MonthRow {
  weekStart: string;
  /** "5 de octubre" (a clipped first week is labelled with the range start). */
  label: string;
  /** Blocked runs are merged, so a row can hold fewer cells than there are columns. */
  cells: MonthCell[];
}

export interface MonthTable {
  title: string;
  columns: MonthColumn[];
  rows: MonthRow[];
}

function timeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

/**
 * One table for the whole period: a column per turn (day order), a row per week, names per cell.
 * Blocked turns carry their reason; neighbouring blocked turns with the same reason merge into one
 * banner. A blocked turn hides its people (the public view does the same).
 */
export function buildMonthTable(source: WeeksSource): MonthTable {
  const { schedule, slots, places, assignments, blackouts } = source;
  if (!schedule) return { title: 'Cronograma', columns: [], rows: [] };
  const placeById = new Map(places.map((p) => [p.id, p.name]));
  const sorted = [...slots].sort(
    (a, b) => a.iso_dow - b.iso_dow || a.start_time.localeCompare(b.start_time),
  );
  const assignmentAt = new Map(assignments.map((a) => [`${a.week_date}|${a.slot_id}`, a]));
  const blockedBy = new Map(blackouts.map((b) => [`${b.date}|${b.slot_id}`, b.reason]));

  const columns = sorted.map((slot) => ({
    slotId: slot.id,
    day: DAY_NAME[slot.iso_dow % 7] ?? '',
    time: timeRange(slot.start_time, slot.end_time),
    place: placeById.get(slot.place_id) ?? '',
  }));

  const rows: MonthRow[] = [];
  for (
    let weekStart = mondayOf(fromIso(schedule.start_date));
    weekStart <= schedule.end_date;
    weekStart = addDaysIso(weekStart, 7)
  ) {
    const cells: MonthCell[] = [];
    for (const slot of sorted) {
      const date = addDaysIso(weekStart, slot.iso_dow - 1);
      if (date < schedule.start_date || date > schedule.end_date) {
        cells.push({ kind: 'outside' });
        continue;
      }
      const key = `${date}|${slot.id}`;
      if (blockedBy.has(key)) {
        const reason = blockedBy.get(key)?.trim() || DEFAULT_BLOCK_LABEL;
        const prev = cells[cells.length - 1];
        if (prev?.kind === 'blocked' && prev.reason === reason) prev.span++;
        else cells.push({ kind: 'blocked', reason, span: 1 });
        continue;
      }
      const assignment = assignmentAt.get(`${weekStart}|${slot.id}`);
      cells.push({
        kind: 'open',
        people: assignment?.person_names ?? [],
        note: assignment?.note?.trim() || null,
      });
    }
    const first = weekStart < schedule.start_date ? schedule.start_date : weekStart;
    rows.push({ weekStart, label: longDate(fromIso(first)), cells });
  }
  return { title: monthTitle(schedule.start_date, schedule.end_date), columns, rows };
}
