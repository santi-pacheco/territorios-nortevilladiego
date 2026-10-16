import type { TerritoriosClient } from '../client';
import { ProgramWeekInsert, ProgramWeekRow, ProgramWeekUpdate } from '../schemas';
import {
  addDays,
  casDelete,
  casUpdate,
  from,
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
