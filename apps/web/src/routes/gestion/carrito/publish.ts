/**
 * Publish mapping: what the Generar tab turns into database writes.
 *
 * Kept pure so it has a real unit test (`publish.test.ts`): the generated entries
 * become `cart_schedules` + `cart_assignments` rows, and existing notes survive a
 * regeneration keyed by week date + slot id.
 */
import type {
  CartAssignmentInsert,
  CartAssignmentRow,
  CartAssignmentUpdate,
  CartScheduleInsert,
} from '@territorios/data';
import type { ScheduleEntry } from '@territorios/core';
import { addDaysIso, entryKey, mondayOfIso, notesByEntry } from './model';

/** Notes of a published schedule, keyed by `Monday of the week | slot_id`. */
export function collectNotes(assignments: readonly CartAssignmentRow[]): Map<string, string> {
  return notesByEntry(assignments);
}

export interface NoteScope {
  startDate: string;
  endDate: string;
  /** Slots that still exist; notes on deleted slots are dropped. */
  slotIds: ReadonlySet<string>;
}

/**
 * Copy a note map onto entries, keyed by `Monday of the week | slot_id`.
 *
 * With a `scope`, a note on a cell the generator left empty (blackout, nobody eligible) is
 * kept as a note-only entry when its week overlaps the range, so regenerating never loses it.
 */
export function applyNotes(
  entries: readonly ScheduleEntry[],
  notes: ReadonlyMap<string, string>,
  scope?: NoteScope,
): ScheduleEntry[] {
  const used = new Set<string>();
  const out = entries.map((e) => {
    const key = entryKey(e.weekDate, e.slotId);
    const note = notes.get(key);
    if (!note) return { ...e };
    used.add(key);
    return { ...e, note };
  });
  if (!scope) return out;
  for (const [key, note] of notes) {
    if (used.has(key)) continue;
    const [monday = '', slotId = ''] = key.split('|');
    if (!scope.slotIds.has(slotId)) continue;
    // The week [monday, monday + 6] must overlap [startDate, endDate].
    if (monday > scope.endDate || addDaysIso(monday, 6) < scope.startDate) continue;
    out.push({ weekDate: monday, weekLabel: monday, slotId, personIds: [], note });
  }
  return out;
}

/**
 * Copy notes from an existing schedule onto freshly generated entries.
 * Keyed by `Monday of the week | slot_id` so regenerating the same schedule keeps them.
 */
export function mergeNotes(
  entries: readonly ScheduleEntry[],
  existingAssignments: readonly CartAssignmentRow[],
): ScheduleEntry[] {
  return applyNotes(entries, collectNotes(existingAssignments));
}

export function buildScheduleInsert(
  name: string,
  startDate: string,
  endDate: string,
): CartScheduleInsert {
  const trimmed = name.trim();
  return {
    ...(trimmed ? { name: trimmed } : {}),
    start_date: startDate,
    end_date: endDate,
  };
}

/**
 * `cart_assignments.week_date` must be a Monday (schema + the member grid), while the
 * scheduler anchors a clipped first week on the range start. Normalise here.
 */
export function buildAssignments(
  scheduleId: string,
  entries: readonly ScheduleEntry[],
): CartAssignmentInsert[] {
  return entries.map((e) => ({
    schedule_id: scheduleId,
    slot_id: e.slotId,
    week_date: mondayOfIso(e.weekDate),
    person_ids: [...e.personIds],
    note: e.note ?? null,
  }));
}

export interface AssignmentUpdate {
  id: string;
  version: number;
  patch: CartAssignmentUpdate;
}

export interface PublishPlan {
  creates: CartAssignmentInsert[];
  updates: AssignmentUpdate[];
  deletes: { id: string; version: number }[];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Re-publishing over an existing schedule: diff the preview against the published cells,
 * keyed by Monday of the week + slot. Unchanged cells are left alone (no version churn),
 * changed cells are updated with CAS, new cells created and cells no longer in the
 * preview deleted. Notes travel with the entries (see `applyNotes`).
 */
export function planPublish(
  scheduleId: string,
  entries: readonly ScheduleEntry[],
  existing: readonly CartAssignmentRow[],
): PublishPlan {
  const byKey = new Map(existing.map((a) => [entryKey(a.week_date, a.slot_id), a]));
  const plan: PublishPlan = { creates: [], updates: [], deletes: [] };
  const seen = new Set<string>();
  for (const row of buildAssignments(scheduleId, entries)) {
    const key = entryKey(row.week_date, row.slot_id);
    if (seen.has(key)) continue;
    seen.add(key);
    const current = byKey.get(key);
    if (!current) {
      plan.creates.push(row);
      continue;
    }
    const note = row.note ?? null;
    const patch: CartAssignmentUpdate = {};
    if (!sameIds(current.person_ids, row.person_ids ?? [])) patch.person_ids = row.person_ids ?? [];
    if ((current.note ?? null) !== note) patch.note = note;
    if (Object.keys(patch).length > 0) {
      plan.updates.push({ id: current.id, version: current.version, patch });
    }
  }
  for (const [key, row] of byKey) {
    if (!seen.has(key)) plan.deletes.push({ id: row.id, version: row.version });
  }
  return plan;
}
