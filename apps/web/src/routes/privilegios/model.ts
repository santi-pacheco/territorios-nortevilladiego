/**
 * Privilegios (docs/PRIVILEGIOS.md): the month's meeting days (Tuesday and Saturday) and the
 * role slots of each day. Shared by the member table and Gestión ▸ Privilegios.
 */
import type { DutyDayKind, DutyDayRow, DutyRole, DutyRosterRow } from '@territorios/data';
import { addDaysIso, fromIso, toIso } from '../../lib/week';

export interface Slot {
  role: DutyRole;
  slot: number;
  label: string;
}

/** Cells of one meeting day, in the order of the printed sheet. */
export const SLOTS: readonly Slot[] = [
  { role: 'computadora', slot: 1, label: 'Computadora' },
  { role: 'sonido', slot: 1, label: 'Sonido' },
  { role: 'microfonista', slot: 1, label: 'Micrófono 1' },
  { role: 'microfonista', slot: 2, label: 'Micrófono 2' },
  { role: 'acomodador', slot: 1, label: 'Acomodador 1' },
  { role: 'acomodador', slot: 2, label: 'Acomodador 2' },
];

export const ROLE_LABEL: Record<DutyRole, string> = {
  computadora: 'Computadora',
  sonido: 'Sonido',
  microfonista: 'Micrófonos',
  acomodador: 'Acomodadores',
};

export const DAY_KIND_LABEL: Record<DutyDayKind, string> = {
  normal: 'Reunión',
  asamblea: 'Asamblea',
  sin_reunion: 'Sin reunión',
};

const MONTHS = [
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
const WEEKDAY = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export interface Month {
  year: number;
  /** 0-based, like Date#getMonth. */
  month: number;
}

export function shiftMonth({ year, month }: Month, delta: number): Month {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function monthLabel({ year, month }: Month): string {
  return `${MONTHS[month] ?? ''} ${year}`;
}

/** First and last ISO date of the month. */
export function monthBounds({ year, month }: Month): { from: string; to: string } {
  return { from: toIso(new Date(year, month, 1)), to: toIso(new Date(year, month + 1, 0)) };
}

/** `?mes=2026-10` → month; anything else → the fallback. */
export function parseMesParam(value: string | null, fallback: Month): Month {
  const m = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!m) return fallback;
  const month = Number(m[2]) - 1;
  return month >= 0 && month <= 11 ? { year: Number(m[1]), month } : fallback;
}

export function mesParam({ year, month }: Month): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Tuesdays and Saturdays of the month, ascending. */
export function meetingDays(m: Month): string[] {
  const { from, to } = monthBounds(m);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const dow = fromIso(d).getDay();
    if (dow === 2 || dow === 6) out.push(d);
  }
  return out;
}

export function weekdayName(iso: string): string {
  return WEEKDAY[fromIso(iso).getDay()] ?? '';
}

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT[fromIso(iso).getDay()] ?? '';
}

export function dayNumber(iso: string): number {
  return fromIso(iso).getDate();
}

/** "Martes 6 de octubre". */
export function longDay(iso: string): string {
  const d = fromIso(iso);
  return `${WEEKDAY[d.getDay()] ?? ''} ${d.getDate()} de ${MONTHS[d.getMonth()] ?? ''}`;
}

export const cellId = (date: string, role: DutyRole, slot: number) => `${date}|${role}|${slot}`;

export interface RosterDay {
  date: string;
  kind: DutyDayKind;
  /** Day mark row (asamblea / sin reunión), when there is one. */
  mark: DutyDayRow | null;
  /** Cells by `cellId`. */
  cells: Map<string, DutyRosterRow>;
}

/**
 * One entry per meeting day of the month, plus any other date that has roster rows or a mark,
 * so nothing loaded is hidden.
 */
export function buildRosterDays(m: Month, rows: DutyRosterRow[], marks: DutyDayRow[]): RosterDay[] {
  const { from, to } = monthBounds(m);
  const dates = new Set(meetingDays(m));
  for (const r of rows) if (r.date >= from && r.date <= to) dates.add(r.date);
  for (const d of marks) if (d.date >= from && d.date <= to) dates.add(d.date);
  const markBy = new Map(marks.map((d) => [d.date, d]));
  return [...dates].sort().map((date) => {
    const mark = markBy.get(date) ?? null;
    const cells = new Map<string, DutyRosterRow>();
    for (const r of rows) if (r.date === date) cells.set(cellId(r.date, r.role, r.slot), r);
    return { date, kind: mark?.kind ?? 'normal', mark, cells };
  });
}

/** Names of a role on a day, by slot, skipping empty slots. */
export function namesFor(day: RosterDay, role: DutyRole): DutyRosterRow[] {
  return [...day.cells.values()]
    .filter((r) => r.role === role && r.person_name)
    .sort((a, b) => a.slot - b.slot);
}

/** The banner text for an asamblea / sin reunión day. */
export function bannerText(day: Pick<RosterDay, 'kind' | 'mark'>): string {
  const note = day.mark?.note?.trim();
  if (note) return note;
  return day.kind === 'asamblea' ? 'Asamblea' : 'Sin reunión';
}

/** First meeting day today or later (the "next" row), or null. */
export function nextDate(days: RosterDay[], today: string): string | null {
  return days.find((d) => d.date >= today)?.date ?? null;
}
