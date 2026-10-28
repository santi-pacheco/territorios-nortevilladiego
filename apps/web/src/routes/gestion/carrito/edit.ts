/**
 * Pure editing logic for the Generar preview: move / swap / replace people between turns and
 * count how often each person appears. No React; covered by `edit.test.ts`.
 *
 * Cells are identified by Monday-of-week + slot (`entryKey`), so a clipped first week
 * (anchored on the range start) and a published row (anchored on its Monday) are the same cell.
 */
import type { ScheduleEntry } from '@territorios/core';
import type { CartAssignmentRow } from '@territorios/data';
import { entryKey, findEntry } from './model';

export interface CellRef {
  weekDate: string;
  slotId: string;
}

export interface PersonRef extends CellRef {
  personId: string;
}

type WeekLabelFor = (weekDate: string) => string;

/** Drop entries that carry neither people nor a note (they would publish nothing). */
export function prune(list: ScheduleEntry[]): ScheduleEntry[] {
  return list.filter((e) => e.personIds.length > 0 || (e.note?.trim() ?? '') !== '');
}

function cloneAll(entries: readonly ScheduleEntry[]): ScheduleEntry[] {
  return entries.map((e) => ({ ...e, personIds: [...e.personIds] }));
}

function cellOf(list: ScheduleEntry[], cell: CellRef, weekLabelFor: WeekLabelFor): ScheduleEntry {
  let found = findEntry(list, cell.weekDate, cell.slotId);
  if (!found) {
    found = {
      weekDate: cell.weekDate,
      weekLabel: weekLabelFor(cell.weekDate),
      slotId: cell.slotId,
      personIds: [],
    };
    list.push(found);
  }
  return found;
}

/** The published cells as editable preview entries. */
export function entriesFromAssignments(
  assignments: readonly CartAssignmentRow[],
  weekLabelFor: WeekLabelFor,
): ScheduleEntry[] {
  return assignments.map((a) => ({
    weekDate: a.week_date,
    weekLabel: weekLabelFor(a.week_date),
    slotId: a.slot_id,
    personIds: [...a.person_ids],
    ...(a.note ? { note: a.note } : {}),
  }));
}

/**
 * Replace the person at `index`, remove it (`personId === null`) or append (`index` out of
 * range, e.g. -1). A person never appears twice in the same turn.
 */
export function setPersonAt(
  entries: readonly ScheduleEntry[],
  cell: CellRef,
  index: number,
  personId: string | null,
  weekLabelFor: WeekLabelFor,
): ScheduleEntry[] {
  const list = cloneAll(entries);
  const target = cellOf(list, cell, weekLabelFor);
  if (index >= 0 && index < target.personIds.length) {
    if (personId === null) target.personIds.splice(index, 1);
    else target.personIds[index] = personId;
  } else if (personId !== null) {
    target.personIds.push(personId);
  }
  target.personIds = target.personIds.filter((id, i, arr) => arr.indexOf(id) === i);
  return prune(list);
}

function sameCell(a: CellRef, b: CellRef): boolean {
  return entryKey(a.weekDate, a.slotId) === entryKey(b.weekDate, b.slotId);
}

/**
 * Move `from` to the turn `to`. Returns the same array when it is dropped where it already is,
 * and `null` when the move is refused (the person is no longer in the source turn, or is
 * already in the target).
 */
export function movePerson(
  entries: readonly ScheduleEntry[],
  from: PersonRef,
  to: CellRef,
  weekLabelFor: WeekLabelFor,
): ScheduleEntry[] | null {
  if (sameCell(from, to)) return entries as ScheduleEntry[];
  const source = findEntry(entries, from.weekDate, from.slotId);
  if (!source?.personIds.includes(from.personId)) return null;
  const dest = findEntry(entries, to.weekDate, to.slotId);
  if (dest?.personIds.includes(from.personId)) return null;
  const list = cloneAll(entries);
  const src = findEntry(list, from.weekDate, from.slotId);
  if (src) src.personIds = src.personIds.filter((id) => id !== from.personId);
  cellOf(list, to, weekLabelFor).personIds.push(from.personId);
  return prune(list);
}

/**
 * Exchange two people. In one turn it swaps their order; across turns each takes the other's
 * place. `null` when either is stale or the swap would put someone in a turn twice.
 */
export function swapPeople(
  entries: readonly ScheduleEntry[],
  a: PersonRef,
  b: PersonRef,
): ScheduleEntry[] | null {
  const ea = findEntry(entries, a.weekDate, a.slotId);
  const eb = findEntry(entries, b.weekDate, b.slotId);
  if (!ea?.personIds.includes(a.personId) || !eb?.personIds.includes(b.personId)) return null;
  if (a.personId === b.personId && ea === eb) return entries as ScheduleEntry[];
  const list = cloneAll(entries);
  const la = findEntry(list, a.weekDate, a.slotId);
  const lb = findEntry(list, b.weekDate, b.slotId);
  if (!la || !lb) return null;
  if (la === lb) {
    const i = la.personIds.indexOf(a.personId);
    const j = la.personIds.indexOf(b.personId);
    la.personIds[i] = b.personId;
    la.personIds[j] = a.personId;
    return list;
  }
  if (la.personIds.includes(b.personId) || lb.personIds.includes(a.personId)) return null;
  la.personIds[la.personIds.indexOf(a.personId)] = b.personId;
  lb.personIds[lb.personIds.indexOf(b.personId)] = a.personId;
  return list;
}

// ---------------------------------------------------------------------------
// Participation
// ---------------------------------------------------------------------------
export type ParticipationFlag = 'zero' | 'high' | 'low' | null;

export interface ParticipationRow {
  id: string;
  name: string;
  count: number;
  flag: ParticipationFlag;
}

export interface Participation {
  /** Alphabetical (es-AR), so the list reads as a directory rather than a ranking. */
  rows: ParticipationRow[];
  /** Average turns among the people who have any. */
  mean: number;
}

const collator = new Intl.Collator('es-AR');

/** With fewer people than this holding turns, "outlier" means nothing. */
const MIN_FOR_OUTLIERS = 4;

/**
 * Turns per roster person, live with the preview. Zero is always flagged; among people with
 * turns, anyone more than max(1, one standard deviation) above/below the mean is `high`/`low`.
 */
export function participation(
  entries: readonly ScheduleEntry[],
  people: readonly { id: string; name: string }[],
): Participation {
  const counts = new Map(people.map((p) => [p.id, 0]));
  for (const e of entries) {
    for (const id of e.personIds) {
      const n = counts.get(id);
      if (n !== undefined) counts.set(id, n + 1);
    }
  }
  const active = [...counts.values()].filter((n) => n > 0);
  const mean = active.length > 0 ? active.reduce((s, n) => s + n, 0) / active.length : 0;
  const variance =
    active.length > 0 ? active.reduce((s, n) => s + (n - mean) ** 2, 0) / active.length : 0;
  const spread = Math.max(1, Math.sqrt(variance));
  const rows = people
    .map<ParticipationRow>((p) => {
      const count = counts.get(p.id) ?? 0;
      let flag: ParticipationFlag = null;
      if (count === 0) flag = 'zero';
      else if (active.length >= MIN_FOR_OUTLIERS) {
        if (count - mean > spread) flag = 'high';
        else if (mean - count > spread) flag = 'low';
      }
      return { id: p.id, name: p.name, count, flag };
    })
    .sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  return { rows, mean };
}
