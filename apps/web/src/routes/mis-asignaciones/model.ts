import type { AssignmentKind, MyAssignment } from '../../lib/accounts';
import { DAY_NAME, DAY_SHORT, DAY_TOKEN, addDaysIso, fromIso, longDate, minutesOf, mondayOf, toIso } from '../../lib/week';
import { shortRange } from '../programa/model';
import { groupsLabel } from '../salidas/StationLine';

export const KIND_LABEL: Record<AssignmentKind, string> = {
  carrito: 'Carrito',
  programa: 'Reunión',
  salida: 'Salida',
};

/** "HH:MM", or null when the assignment has no time of its own. */
export function hhmm(time: string | null): string | null {
  if (!time) return null;
  return minutesOf(time) === null ? null : time.slice(0, 5);
}

/** Date order, then time; untimed rows (a weekend role) close their day. */
export function sortAssignments(list: MyAssignment[]): MyAssignment[] {
  return [...list].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (minutesOf(a.start_time ?? '') ?? 24 * 60) - (minutesOf(b.start_time ?? '') ?? 24 * 60) ||
      a.title.localeCompare(b.title),
  );
}

/** Today's untimed or not-yet-started assignment, else the first one on a later day. */
export function nextAssignment(sorted: MyAssignment[], now: Date): MyAssignment | null {
  const today = toIso(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  return (
    sorted.find((a) => {
      if (a.date > today) return true;
      if (a.date < today) return false;
      const start = minutesOf(a.start_time ?? '');
      return start === null || start >= mins;
    }) ?? null
  );
}

export interface WeekGroup {
  monday: string;
  heading: string;
  items: MyAssignment[];
}

/** Monday-first weeks, headed "Esta semana", "Semana que viene" or the range. */
export function groupByWeek(sorted: MyAssignment[], now: Date): WeekGroup[] {
  const thisMonday = mondayOf(now);
  const groups: WeekGroup[] = [];
  for (const a of sorted) {
    const monday = mondayOf(fromIso(a.date));
    let group = groups.at(-1);
    if (!group || group.monday !== monday) {
      group = { monday, heading: weekHeading(monday, thisMonday), items: [] };
      groups.push(group);
    }
    group.items.push(a);
  }
  return groups;
}

export function weekHeading(monday: string, thisMonday: string): string {
  if (monday === thisMonday) return 'Esta semana';
  if (monday === addDaysIso(thisMonday, 7)) return 'Semana que viene';
  return `Semana ${shortRange(monday, addDaysIso(monday, 6))}`;
}

/** "hoy", "mañana", "en 5 días". */
export function relativeDay(iso: string, now: Date): string {
  const days = Math.round((fromIso(iso).getTime() - fromIso(toIso(now)).getTime()) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
}

/** "Martes 21 de octubre". */
export const longDay = (iso: string) => {
  const d = fromIso(iso);
  return `${DAY_NAME[d.getDay()]} ${longDate(d)}`;
};
export const shortWeekday = (iso: string) => DAY_SHORT[fromIso(iso).getDay()];
export const dayOfMonth = (iso: string) => fromIso(iso).getDate();
/** Day-accent token slug for a salida's date. */
export const dayToken = (iso: string) => DAY_TOKEN[fromIso(iso).getDay()];

/** The place line, unless it only repeats the title (a salida's title is its place). */
export function placeLine(a: MyAssignment): string | null {
  return a.place && a.place !== a.title ? a.place : null;
}


/** Extra line: a salida's groups ("Grupo 3"), or the server's detail as is. */
export function detailLine(a: MyAssignment): string | null {
  if (!a.detail) return null;
  return a.kind === 'salida' ? groupsLabel(a.detail) : a.detail;
}
