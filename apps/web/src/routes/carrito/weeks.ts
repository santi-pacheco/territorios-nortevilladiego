import type { CartAssignmentRow, CartBoard } from '@territorios/data';
import { matchesMe } from '../../lib/me';
import { DAY_NAME, addDaysIso, fromIso, longDate, mondayOf } from '../../lib/week';

/** One rendered row of the schedule: a slot on a concrete date. */
export interface Turn {
  date: string;
  dateObj: Date;
  weekday: string;
  timeRange: string;
  label: string | null;
  place: string;
  placeColor: string;
  people: string[];
  note: string | null;
  isBlackout: boolean;
  /** Why the turn is blocked ("Asamblea"); null when none was given. */
  blackoutReason: string | null;
  isMine: boolean;
}

export interface WeekSection {
  weekStart: string;
  heading: string;
  turns: Turn[];
}

/** "HH:MM[:SS]" → "HH:MM"; the whole range in mono-friendly form. */
function timeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

/** What `buildWeeks` reads: a published board, or the editor's unpublished preview. */
export type WeeksSource = Pick<CartBoard, 'places' | 'slots' | 'blackouts'> & {
  schedule: { start_date: string; end_date: string } | null;
  assignments: readonly Pick<
    CartAssignmentRow,
    'week_date' | 'slot_id' | 'person_names' | 'note'
  >[];
};

/** Rows for every slot date inside the schedule range that has an assignment or a blackout. */
export function buildWeeks(board: WeeksSource, me: string): WeekSection[] {
  const { schedule, slots, assignments, blackouts, places } = board;
  if (!schedule) return [];
  const placeById = new Map(places.map((p) => [p.id, p]));
  const sortedSlots = [...slots].sort(
    (a, b) => a.iso_dow - b.iso_dow || a.start_time.localeCompare(b.start_time),
  );
  const assignmentAt = new Map(assignments.map((a) => [`${a.week_date}|${a.slot_id}`, a]));
  const blackedOut = new Map(
    blackouts.map((b) => [`${b.date}|${b.slot_id}`, b.reason?.trim() || null]),
  );

  const sections: WeekSection[] = [];
  for (
    let weekStart = mondayOf(fromIso(schedule.start_date));
    weekStart <= schedule.end_date;
    weekStart = addDaysIso(weekStart, 7)
  ) {
    const turns: Turn[] = [];
    for (const slot of sortedSlots) {
      const date = addDaysIso(weekStart, slot.iso_dow - 1);
      if (date < schedule.start_date || date > schedule.end_date) continue;
      const blackoutKey = `${date}|${slot.id}`;
      const isBlackout = blackedOut.has(blackoutKey);
      const assignment = assignmentAt.get(`${weekStart}|${slot.id}`);
      if (!isBlackout && !assignment) continue;
      const people = isBlackout ? [] : (assignment?.person_names ?? []);
      const place = placeById.get(slot.place_id);
      turns.push({
        date,
        dateObj: fromIso(date),
        weekday: DAY_NAME[slot.iso_dow % 7] ?? '',
        timeRange: timeRange(slot.start_time, slot.end_time),
        label: slot.display_label,
        place: place?.name ?? '',
        placeColor: place?.color ?? '',
        people,
        note: isBlackout ? null : (assignment?.note ?? null),
        isBlackout,
        blackoutReason: blackedOut.get(blackoutKey) ?? null,
        isMine: me !== '' && people.some((name) => matchesMe(me, name)),
      });
    }
    if (turns.length === 0) continue;
    sections.push({
      weekStart,
      heading: `Semana del ${longDate(fromIso(weekStart))}`,
      turns,
    });
  }
  return sections;
}
