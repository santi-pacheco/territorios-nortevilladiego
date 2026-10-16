/**
 * Pure helpers for the Gestión ▸ Carrito screen.
 *
 * No React and no Supabase here: the DB rows are mapped to the core scheduler types
 * (and back) so the logic is unit-testable without a DOM.
 */
import {
  CARRITO_DAY_NAMES,
  type Person as CorePerson,
  type Place as CorePlace,
  type ScheduleEntry,
  type SlotBlackout,
  type TimeSlot,
} from '@territorios/core';
import type {
  CartAssignmentRow,
  CartBlackoutRow,
  CartPlaceRow,
  CartSlotRow,
  PersonAvailabilityRow,
  PersonPairRow,
  PersonRow,
} from '@territorios/data';

// ---------------------------------------------------------------------------
// Local dates (all ISO yyyy-mm-dd, parsed as local calendar days)
// ---------------------------------------------------------------------------
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

function parseLocalDate(iso: string): Date {
  const [y = NaN, m = NaN, d = NaN] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `iso` shifted by `days` calendar days. */
export function addDaysIso(iso: string, days: number): string {
  const date = parseLocalDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoLocal(date);
}

/** Monday of the ISO week that contains `iso`. */
export function mondayOfIso(iso: string): string {
  const date = parseLocalDate(iso);
  const offset = date.getDay() === 0 ? -6 : 1 - date.getDay();
  date.setDate(date.getDate() + offset);
  return toIsoLocal(date);
}

/** Stable key for a cell: the Monday of the week plus the slot. */
export function entryKey(weekDate: string, slotId: string): string {
  return `${mondayOfIso(weekDate)}|${slotId}`;
}

export interface WeekRef {
  /** Week anchor used by the scheduler (may be the range start, not the Monday). */
  weekDate: string;
  weekLabel: string;
}

/**
 * The weeks the scheduler touches for a range: from the Monday of the first week
 * through the last week that starts on or before `endDate`. Mirrors `generateSchedule`
 * so the grid can show empty cells too.
 */
export function weekRefsInRange(startDate: string, endDate: string): WeekRef[] {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const firstMonday = parseLocalDate(mondayOfIso(startDate));
  const out: WeekRef[] = [];
  const cur = new Date(firstMonday);
  while (cur <= end) {
    const ref = cur < start ? start : cur;
    out.push({
      weekDate: toIsoLocal(ref),
      weekLabel: `${ref.getDate()} de ${MONTH_NAMES[ref.getMonth()] ?? ''}`,
    });
    cur.setDate(cur.getDate() + 7);
  }
  return out;
}

/** "4 de mayo de 2026" for the schedule caption. */
export function longDate(iso: string): string {
  const d = parseLocalDate(iso);
  return `${d.getDate()} de ${MONTH_NAMES[d.getMonth()] ?? ''} de ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// DB rows → core scheduler types
// ---------------------------------------------------------------------------
export function toCorePlaces(places: readonly CartPlaceRow[]): CorePlace[] {
  return places.map((p) => ({ id: p.id, name: p.name, color: p.color }));
}

export function toCoreSlots(slots: readonly CartSlotRow[]): TimeSlot[] {
  return slots.map((s) => ({
    id: s.id,
    placeId: s.place_id,
    dayOfWeek: s.iso_dow,
    startTime: s.start_time,
    endTime: s.end_time,
    groupSize: s.group_size,
    ...(s.display_label ? { displayLabel: s.display_label } : {}),
  }));
}

export function toBlackouts(rows: readonly CartBlackoutRow[]): SlotBlackout[] {
  return rows.map((b) => ({ id: b.id, slotId: b.slot_id, date: b.date }));
}

export interface RosterPerson extends CorePerson {
  version: number;
}

/** `people` + availability + symmetric pairs joined into scheduler-ready people. */
export function buildRoster(
  people: readonly PersonRow[],
  availability: readonly PersonAvailabilityRow[],
  pairs: readonly PersonPairRow[],
): RosterPerson[] {
  const slotsByPerson = new Map<string, string[]>();
  for (const a of availability) {
    const list = slotsByPerson.get(a.person_id);
    if (list) list.push(a.slot_id);
    else slotsByPerson.set(a.person_id, [a.slot_id]);
  }
  // person_pairs is stored once with person_a < person_b; both directions are a tie.
  const pairsByPerson = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = pairsByPerson.get(a);
    if (list) list.push(b);
    else pairsByPerson.set(a, [b]);
  };
  for (const p of pairs) {
    link(p.person_a, p.person_b);
    link(p.person_b, p.person_a);
  }
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    gender: p.gender,
    targetAppearances: p.target_appearances,
    availableSlotIds: slotsByPerson.get(p.id) ?? [],
    mustBeWithIds: pairsByPerson.get(p.id) ?? [],
    version: p.version,
  }));
}

/** True when the roster has a symmetric tie between two people. */
export function arePaired(pairs: readonly PersonPairRow[], a: string, b: string): boolean {
  return pairs.some(
    (p) => (p.person_a === a && p.person_b === b) || (p.person_a === b && p.person_b === a),
  );
}

// ---------------------------------------------------------------------------
// Slot helpers
// ---------------------------------------------------------------------------
export function sortSlots<T extends { iso_dow: number; start_time: string }>(slots: readonly T[]): T[] {
  return [...slots].sort(
    (a, b) => a.iso_dow - b.iso_dow || a.start_time.localeCompare(b.start_time),
  );
}

export function dayName(isoDow: number): string {
  return CARRITO_DAY_NAMES[isoDow] ?? `Día ${isoDow}`;
}

/** "08:30–10:30". */
export function timeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

export interface DayGroup<T> {
  isoDow: number;
  label: string;
  slots: T[];
}

/** Slots grouped Monday→Sunday, with a label per day, for the availability checklist. */
export function groupByDay<T extends { iso_dow: number; start_time: string }>(
  slots: readonly T[],
): DayGroup<T>[] {
  const sorted = sortSlots(slots);
  const groups: DayGroup<T>[] = [];
  for (const slot of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.isoDow === slot.iso_dow) last.slots.push(slot);
    else groups.push({ isoDow: slot.iso_dow, label: dayName(slot.iso_dow), slots: [slot] });
  }
  return groups;
}

/** Notes of a schedule keyed by `entryKey` (Monday + slot), for note preservation. */
export function notesByEntry(assignments: readonly CartAssignmentRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of assignments) {
    if (a.note) map.set(entryKey(a.week_date, a.slot_id), a.note);
  }
  return map;
}

/** The entry for a cell, or undefined. */
export function findEntry(
  entries: readonly ScheduleEntry[],
  weekDate: string,
  slotId: string,
): ScheduleEntry | undefined {
  const key = entryKey(weekDate, slotId);
  return entries.find((e) => entryKey(e.weekDate, e.slotId) === key);
}
