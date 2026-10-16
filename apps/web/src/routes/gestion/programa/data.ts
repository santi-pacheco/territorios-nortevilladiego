/**
 * Every published program_weeks row. The data layer only reads one week at a time, so this
 * screen keeps its own list query. The key sits under `qk.program`: the program mutations
 * and the program_weeks realtime events invalidate that scope, so the list refreshes itself.
 */
import { useQuery } from '@tanstack/react-query';
import { ProgramWeekRow, qk, withDb } from '@territorios/data';

export const programListKey = [...qk.program, 'all'] as const;

export async function fetchAllProgramWeeks(): Promise<ProgramWeekRow[]> {
  return withDb(async (sb) => {
    const { data, error } = await sb
      .from('program_weeks')
      .select('*')
      .order('date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: unknown) => ProgramWeekRow.parse(row));
  });
}

export const useProgramWeekList = () =>
  useQuery({ queryKey: programListKey, queryFn: fetchAllProgramWeeks });
