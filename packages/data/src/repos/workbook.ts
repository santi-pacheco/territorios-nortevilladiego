/**
 * Guía de actividades (meeting workbook) structure from the `workbook` Edge Function
 * (supabase/functions/workbook). Editors only; the function checks the caller's permissions.
 * Nothing is stored: the editor converts a week with `workbookWeekToMidweek` (@territorios/core)
 * and the result is saved, like any manual edit, with "Guardar semana".
 */
import type { WorkbookWeek } from '@territorios/core';
import type { TerritoriosClient } from '../client';
import { withDb } from '../client';

export type WorkbookRequest = { weekStart: string } | { month: string };

export interface WorkbookResult {
  weeks: WorkbookWeek[];
  /** Mondays the workbook does not have (not published yet, or no such week). */
  missing: string[];
}

export class WorkbookError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkbookError';
    this.status = status;
  }
}

const SECTIONS = new Set(['inicio', 'tesoros', 'maestros', 'vida']);

function isWeek(v: unknown): v is WorkbookWeek {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w.weekStart === 'string' &&
    Array.isArray(w.songs) &&
    Array.isArray(w.parts) &&
    w.parts.every(
      (p: unknown) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Record<string, unknown>).title === 'string' &&
        typeof (p as Record<string, unknown>).minutes === 'number' &&
        SECTIONS.has((p as Record<string, unknown>).section as string),
    )
  );
}

export async function fetchWorkbook(sb: TerritoriosClient, req: WorkbookRequest): Promise<WorkbookResult> {
  const { data, error } = await sb.functions.invoke('workbook', { body: req });
  if (error) {
    const status = (error as { context?: { status?: unknown } }).context?.status;
    throw new WorkbookError(error.message, typeof status === 'number' ? status : null, { cause: error });
  }
  const body = data as { weeks?: unknown; missing?: unknown } | null;
  if (!body || !Array.isArray(body.weeks) || !body.weeks.every(isWeek)) {
    throw new WorkbookError('workbook: unexpected response', null);
  }
  const missing = Array.isArray(body.missing) ? body.missing.filter((m): m is string => typeof m === 'string') : [];
  return { weeks: body.weeks, missing };
}

/** `fetchWorkbook` with the app's client. */
export function loadWorkbook(req: WorkbookRequest): Promise<WorkbookResult> {
  return withDb((sb) => fetchWorkbook(sb, req));
}
