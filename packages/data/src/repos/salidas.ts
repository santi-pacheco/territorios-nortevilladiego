import type { TerritoriosClient } from '../client';
import {
  ServiceMeetingInsert,
  ServiceMeetingRow,
  ServiceMeetingUpdate,
  ServiceWeekInsert,
  ServiceWeekRow,
  ServiceWeekUpdate,
} from '../schemas';
import {
  casDelete,
  casUpdate,
  from,
  insertRow,
  parsePayload,
  parseRow,
  parseRows,
  run,
} from './base';

export interface ServiceWeek {
  week: ServiceWeekRow | null;
  /** Sorted by dow (JS numbering, 0 = Domingo) then position. */
  meetings: ServiceMeetingRow[];
}

/** One Salidas week (keyed by its Monday) with all its meetings, in one round trip. */
export async function fetchServiceWeek(
  sb: TerritoriosClient,
  weekStart: string,
): Promise<ServiceWeek> {
  const data = (await run(
    from(sb, 'service_weeks')
      .select('*, service_meetings(*)')
      .eq('week_start', weekStart)
      .maybeSingle(),
  )) as (Record<string, unknown> & { service_meetings?: unknown }) | null;
  if (!data) return { week: null, meetings: [] };
  const { service_meetings, ...week } = data;
  const meetings = parseRows('service_meetings', ServiceMeetingRow, service_meetings ?? []);
  meetings.sort((a, b) => a.dow - b.dow || a.position - b.position);
  return { week: parseRow('service_weeks', ServiceWeekRow, week), meetings };
}

export async function createServiceWeek(
  sb: TerritoriosClient,
  input: ServiceWeekInsert,
): Promise<ServiceWeekRow> {
  return insertRow(
    sb,
    'service_weeks',
    ServiceWeekRow,
    parsePayload('service_weeks', ServiceWeekInsert, input),
  );
}

export async function updateServiceWeek(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
  patch: ServiceWeekUpdate,
): Promise<ServiceWeekRow> {
  const body = parsePayload('service_weeks', ServiceWeekUpdate, patch);
  return casUpdate(sb, 'service_weeks', ServiceWeekRow, { id }, expectedVersion, body);
}

/** Cascades to the week's meetings. */
export async function deleteServiceWeek(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'service_weeks', ServiceWeekRow, { id }, expectedVersion);
}

export async function createMeeting(
  sb: TerritoriosClient,
  input: ServiceMeetingInsert,
): Promise<ServiceMeetingRow> {
  const body = parsePayload('service_meetings', ServiceMeetingInsert, input);
  return insertRow(sb, 'service_meetings', ServiceMeetingRow, body);
}

export async function updateMeeting(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
  patch: ServiceMeetingUpdate,
): Promise<ServiceMeetingRow> {
  const body = parsePayload('service_meetings', ServiceMeetingUpdate, patch);
  return casUpdate(sb, 'service_meetings', ServiceMeetingRow, { id }, expectedVersion, body);
}

export async function deleteMeeting(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'service_meetings', ServiceMeetingRow, { id }, expectedVersion);
}
