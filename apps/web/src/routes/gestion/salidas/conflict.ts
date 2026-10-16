/**
 * Conflict-sheet logic for the Salidas editor, kept pure so it is testable without React.
 *
 * The data layer throws `ConflictError` when a compare-and-swap update matches 0 rows
 * (someone else wrote the row first). The editor then shows the `ConflictSheet` with the
 * fields the editor tried to save next to the row as it stands on the server.
 */
import type { GroupTerritories, ServiceMeetingRow, ServiceMeetingUpdate } from '@territorios/data';

/** The fields of a meeting the editor writes (an update patch). */
export type MeetingPatch = ServiceMeetingUpdate;

const FIELD_LABEL: Record<keyof ServiceMeetingUpdate, string> = {
  dow: 'Día',
  position: 'Posición',
  kind: 'Tipo',
  start_time: 'Hora',
  groups: 'Grupos',
  conductor: 'Conductor',
  place: 'Lugar',
  territory_ids: 'Territorios',
  group_territories: 'Territorios por grupo',
};

/** Stable display order, so the sheet always reads top-to-bottom the same way. */
const FIELD_ORDER: (keyof ServiceMeetingUpdate)[] = [
  'start_time',
  'place',
  'conductor',
  'groups',
  'territory_ids',
  'group_territories',
  'dow',
  'position',
  'kind',
];

export function formatTerritoryIds(ids: readonly number[]): string {
  return ids.length ? ids.join(', ') : 'Sin territorios';
}

export function formatGroupTerritories(groups: GroupTerritories): string {
  const keys = (['G1', 'G2', 'G3', 'G4'] as const).filter((k) => (groups[k]?.length ?? 0) > 0);
  if (!keys.length) return 'Sin territorios';
  return keys.map((k) => `${k}: ${groups[k]!.join(', ')}`).join(' · ');
}

/** Human-readable value for one field, for the two-column comparison. */
export function formatField(key: keyof ServiceMeetingUpdate, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (key === 'territory_ids') return formatTerritoryIds(value as number[]);
  if (key === 'group_territories') return formatGroupTerritories(value as GroupTerritories);
  const text = String(value).trim();
  return text || '—';
}

export interface ConflictRow {
  key: keyof ServiceMeetingUpdate;
  label: string;
  /** What this editor tried to write. */
  yours: string;
  /** What the row holds on the server now. */
  theirs: string;
}

/** One row per field in the attempted patch: your value next to the current server value. */
export function conflictRows(
  patch: MeetingPatch,
  current: ServiceMeetingRow | null,
): ConflictRow[] {
  return (Object.keys(patch) as (keyof ServiceMeetingUpdate)[])
    .filter((key) => patch[key] !== undefined)
    .sort((a, b) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b))
    .map((key) => ({
      key,
      label: FIELD_LABEL[key],
      yours: formatField(key, patch[key]),
      theirs: current ? formatField(key, current[key]) : '—',
    }));
}

/** "Guardar lo mío": re-apply our patch on top of their new version. */
export function reapplyVars(
  current: ServiceMeetingRow,
  patch: MeetingPatch,
): { id: string; version: number; patch: MeetingPatch } {
  return { id: current.id, version: current.version, patch };
}
