import type { TerritoriosClient } from '../client';
import {
  ProgramWeekInsert,
  ProgramWeekRow,
  ProgramWeekUpdate,
  type ProgramData,
  type ProgramKind,
} from '../schemas';
import {
  addDays,
  casDelete,
  casUpdate,
  from,
  insertOrConflict,
  insertRow,
  parsePayload,
  parseRows,
  run,
} from './base';

export interface ProgramWeek {
  /** Keyed by the Tuesday of the week. */
  midweek: ProgramWeekRow | null;
  /** Keyed by the Saturday of the week. */
  weekend: ProgramWeekRow | null;
}

/** Both meetings of the Mon–Sun week starting at `weekStart` (a Monday). */
export async function fetchProgramWeek(
  sb: TerritoriosClient,
  weekStart: string,
): Promise<ProgramWeek> {
  const tuesday = addDays(weekStart, 1);
  const saturday = addDays(weekStart, 5);
  const data = await run(
    from(sb, 'program_weeks').select('*').gte('date', tuesday).lte('date', saturday),
  );
  const rows = parseRows('program_weeks', ProgramWeekRow, data);
  return {
    midweek: rows.find((r) => r.kind === 'midweek' && r.date === tuesday) ?? null,
    weekend: rows.find((r) => r.kind === 'weekend' && r.date === saturday) ?? null,
  };
}

/** Every program row (midweek Tuesdays and weekend Saturdays) between two dates, by date. */
export async function fetchProgramWeeks(
  sb: TerritoriosClient,
  fromDate: string,
  toDate: string,
): Promise<ProgramWeekRow[]> {
  const data = await run(
    from(sb, 'program_weeks')
      .select('*')
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('date')
      .order('kind'),
  );
  return parseRows('program_weeks', ProgramWeekRow, data);
}

/**
 * Program editor save. Without `expectedVersion` the row is inserted (a row created by
 * someone else meanwhile ⇒ ConflictError, expectedVersion 0); with it, a CAS update on
 * (kind, date). Editors, or the grant for that meeting's kind (RLS).
 */
export async function saveProgramWeek(
  sb: TerritoriosClient,
  kind: ProgramKind,
  date: string,
  data: ProgramData,
  expectedVersion?: number,
): Promise<ProgramWeekRow> {
  const key = { kind, date };
  if (expectedVersion === undefined) {
    const body = parsePayload('program_weeks', ProgramWeekInsert, { kind, date, data });
    return insertOrConflict(sb, 'program_weeks', ProgramWeekRow, key, body);
  }
  const patch = parsePayload('program_weeks', ProgramWeekUpdate, { data });
  return casUpdate(sb, 'program_weeks', ProgramWeekRow, key, expectedVersion, patch);
}

/** Races on (kind, date) surface as DataError with code 23505. */
export async function createProgramWeek(
  sb: TerritoriosClient,
  input: ProgramWeekInsert,
): Promise<ProgramWeekRow> {
  return insertRow(
    sb,
    'program_weeks',
    ProgramWeekRow,
    parsePayload('program_weeks', ProgramWeekInsert, input),
  );
}

export async function updateProgramWeek(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
  patch: ProgramWeekUpdate,
): Promise<ProgramWeekRow> {
  const body = parsePayload('program_weeks', ProgramWeekUpdate, patch);
  return casUpdate(sb, 'program_weeks', ProgramWeekRow, { id }, expectedVersion, body);
}

export async function deleteProgramWeek(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'program_weeks', ProgramWeekRow, { id }, expectedVersion);
}
