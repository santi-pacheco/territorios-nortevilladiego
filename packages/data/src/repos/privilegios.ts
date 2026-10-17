/**
 * Privilegios roster (docs/PRIVILEGIOS.md): one `duty_roster` row per (date, role, slot) and
 * optional `duty_days` marks (asamblea / sin reunión). Read: editors, can_edit_privilegios and
 * members whose linked person has a duty; everyone else gets empty arrays. Write: editors and
 * can_edit_privilegios. Cells are keyed by (date, role, slot), days by date.
 */
import type { TerritoriosClient } from '../client';
import { DutyCellInput, DutyDayInput, DutyDayRow, DutyRosterRow, type DutyRole } from '../schemas';
import { casDelete, casUpdate, from, insertOrConflict, parsePayload, parseRows, run } from './base';

export interface DutyRoster {
  /** Ordered by date, role, slot. */
  rows: DutyRosterRow[];
  /** Marked days only; a date without a row is a normal meeting. */
  days: DutyDayRow[];
}

export interface DutyCellKey {
  date: string;
  role: DutyRole;
  slot: number;
}

/** Roster cells and day marks between two YYYY-MM-DD dates (inclusive). */
export async function fetchDutyRoster(
  sb: TerritoriosClient,
  fromDate: string,
  toDate: string,
): Promise<DutyRoster> {
  const [rows, days] = await Promise.all([
    run(
      from(sb, 'duty_roster')
        .select('*')
        .gte('date', fromDate)
        .lte('date', toDate)
        .order('date')
        .order('role')
        .order('slot'),
    ),
    run(from(sb, 'duty_days').select('*').gte('date', fromDate).lte('date', toDate).order('date')),
  ]);
  return {
    rows: parseRows('duty_roster', DutyRosterRow, rows),
    days: parseRows('duty_days', DutyDayRow, days),
  };
}

const cellKey = (c: DutyCellKey) => ({ date: c.date, role: c.role, slot: c.slot });

/**
 * Fill a cell with a person (`person_id`; the server snapshots their name) or free text
 * (`person_name`, person_id null). Without `expectedVersion` the cell is inserted (someone
 * filled it first ⇒ ConflictError, expectedVersion 0); with it, CAS update on the key.
 */
export async function upsertDutyCell(
  sb: TerritoriosClient,
  cell: DutyCellInput,
  expectedVersion?: number,
): Promise<DutyRosterRow> {
  const body = parsePayload('duty_roster', DutyCellInput, cell);
  const key = cellKey(body);
  if (expectedVersion === undefined) {
    return insertOrConflict(sb, 'duty_roster', DutyRosterRow, key, body);
  }
  const { person_id, person_name, note } = body;
  const patch = note === undefined ? { person_id, person_name } : { person_id, person_name, note };
  return casUpdate(sb, 'duty_roster', DutyRosterRow, key, expectedVersion, patch);
}

/** Empty a cell (delete its row). CAS. */
export async function clearDutyCell(
  sb: TerritoriosClient,
  key: DutyCellKey,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'duty_roster', DutyRosterRow, cellKey(key), expectedVersion);
}

/** Mark a day (asamblea, sin reunión, or back to normal with a note). Insert or CAS update. */
export async function setDutyDay(
  sb: TerritoriosClient,
  day: DutyDayInput,
  expectedVersion?: number,
): Promise<DutyDayRow> {
  const body = parsePayload('duty_days', DutyDayInput, day);
  const key = { date: body.date };
  if (expectedVersion === undefined) {
    return insertOrConflict(sb, 'duty_days', DutyDayRow, key, body);
  }
  const patch =
    body.note === undefined ? { kind: body.kind } : { kind: body.kind, note: body.note };
  return casUpdate(sb, 'duty_days', DutyDayRow, key, expectedVersion, patch);
}

/** Remove a day mark (the date becomes a normal meeting again). CAS. */
export async function clearDutyDay(
  sb: TerritoriosClient,
  date: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'duty_days', DutyDayRow, { date }, expectedVersion);
}
