/** Row shapes written to the 2.0 schema (supabase/migrations). Meta columns
 *  (version, updated_at, updated_by) are trigger-owned and never sent. */

export interface TerritoryRow {
  id: number;
  name: string;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  centroid_lng: number;
  centroid_lat: number;
}

export interface ServiceWeekRow {
  id: string;
  week_start: string;
  month_label: string;
}

export interface ServiceMeetingRow {
  id: string;
  week_id: string;
  dow: number;
  position: number;
  kind: 'normal' | 'domingo';
  start_time: string;
  groups: string;
  conductor: string;
  place: string;
  territory_ids: number[];
  group_territories: Partial<Record<'G1' | 'G2' | 'G3' | 'G4', number[]>>;
}

export interface CartPlaceRow {
  id: string;
  name: string;
  color: string;
}

export interface CartSlotRow {
  id: string;
  place_id: string;
  iso_dow: number;
  start_time: string;
  end_time: string;
  group_size: number;
  display_label: string | null;
}

export interface PersonRow {
  id: string;
  name: string;
  gender: 'M' | 'F';
  target_appearances: number;
}

export interface PersonAvailabilityRow {
  person_id: string;
  slot_id: string;
}

export interface PersonPairRow {
  person_a: string;
  person_b: string;
}

export interface CartScheduleRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export interface CartAssignmentRow {
  id: string;
  schedule_id: string;
  slot_id: string;
  week_date: string;
  person_ids: string[];
  note: string | null;
}

export interface CartBlackoutRow {
  id: string;
  slot_id: string;
  date: string;
}

export interface ProgramWeekRow {
  id: string;
  kind: 'midweek' | 'weekend';
  date: string;
  data: Record<string, unknown>;
}

export interface Desired {
  territories: TerritoryRow[];
  service_weeks: ServiceWeekRow[];
  service_meetings: ServiceMeetingRow[];
  cart_places: CartPlaceRow[];
  cart_slots: CartSlotRow[];
  people: PersonRow[];
  person_availability: PersonAvailabilityRow[];
  person_pairs: PersonPairRow[];
  cart_schedules: CartScheduleRow[];
  cart_assignments: CartAssignmentRow[];
  cart_blackouts: CartBlackoutRow[];
  program_weeks: ProgramWeekRow[];
}

export type TableName = keyof Desired;

/** Raw v1 jsonb payloads (the `data` column of salidas/carrito/programa, row id=1). */
export interface V1Snapshot {
  salidas: unknown;
  carrito: unknown;
  programa: unknown;
}

/** Collects every skipped/adjusted item so nothing is dropped silently. */
export class Report {
  readonly warnings = new Map<string, string[]>();

  warn(reason: string, detail: string): void {
    const list = this.warnings.get(reason) ?? [];
    list.push(detail);
    this.warnings.set(reason, list);
  }
}
