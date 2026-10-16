import type { TerritoriosClient } from '../client';
import {
  CartAssignmentInsert,
  CartAssignmentRow,
  CartAssignmentUpdate,
  CartBlackoutInsert,
  CartBlackoutRow,
  CartPlaceInsert,
  CartPlaceRow,
  CartPlaceUpdate,
  CartScheduleInsert,
  CartScheduleRow,
  CartScheduleUpdate,
  CartSlotInsert,
  CartSlotRow,
  CartSlotUpdate,
} from '../schemas';
import { casDelete, casUpdate, from, insertRow, parsePayload, parseRows, run } from './base';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function fetchCartPlaces(sb: TerritoriosClient): Promise<CartPlaceRow[]> {
  return parseRows(
    'cart_places',
    CartPlaceRow,
    await run(from(sb, 'cart_places').select('*').order('name')),
  );
}

/** Ordered by ISO day (1 = Lunes) then start time. */
export async function fetchCartSlots(sb: TerritoriosClient): Promise<CartSlotRow[]> {
  const data = await run(from(sb, 'cart_slots').select('*').order('iso_dow').order('start_time'));
  return parseRows('cart_slots', CartSlotRow, data);
}

/** Newest first. */
export async function fetchCartSchedules(sb: TerritoriosClient): Promise<CartScheduleRow[]> {
  const data = await run(
    from(sb, 'cart_schedules').select('*').order('start_date', { ascending: false }),
  );
  return parseRows('cart_schedules', CartScheduleRow, data);
}

export async function fetchCartAssignments(
  sb: TerritoriosClient,
  scheduleId: string,
): Promise<CartAssignmentRow[]> {
  const data = await run(
    from(sb, 'cart_assignments').select('*').eq('schedule_id', scheduleId).order('week_date'),
  );
  return parseRows('cart_assignments', CartAssignmentRow, data);
}

/** Blackouts with `from <= date <= to`. */
export async function fetchCartBlackouts(
  sb: TerritoriosClient,
  fromDate: string,
  toDate: string,
): Promise<CartBlackoutRow[]> {
  const data = await run(
    from(sb, 'cart_blackouts').select('*').gte('date', fromDate).lte('date', toDate).order('date'),
  );
  return parseRows('cart_blackouts', CartBlackoutRow, data);
}

/** The schedule covering `today`, else the newest one. `schedules` must be newest-first. */
export function pickCurrentSchedule(
  schedules: readonly CartScheduleRow[],
  today: string,
): CartScheduleRow | null {
  const current = schedules.find((s) => s.start_date <= today && today <= s.end_date);
  if (current) return current;
  // Between schedules: the next one to start beats an old one that already ended.
  const upcoming = schedules
    .filter((s) => s.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (upcoming) return upcoming;
  return [...schedules].sort((a, b) => b.end_date.localeCompare(a.end_date))[0] ?? null;
}

export interface CartBoard {
  places: CartPlaceRow[];
  slots: CartSlotRow[];
  schedules: CartScheduleRow[];
  /** The requested schedule, or the current one when none was requested. */
  schedule: CartScheduleRow | null;
  assignments: CartAssignmentRow[];
  blackouts: CartBlackoutRow[];
}

/** Everything the Carrito grid needs for one schedule (public data only; no `people`). */
export async function fetchCartBoard(
  sb: TerritoriosClient,
  scheduleId: string | null,
  today: string,
): Promise<CartBoard> {
  const [places, slots, schedules] = await Promise.all([
    fetchCartPlaces(sb),
    fetchCartSlots(sb),
    fetchCartSchedules(sb),
  ]);
  const schedule =
    scheduleId === null
      ? pickCurrentSchedule(schedules, today)
      : (schedules.find((s) => s.id === scheduleId) ?? null);
  if (!schedule)
    return { places, slots, schedules, schedule: null, assignments: [], blackouts: [] };
  const [assignments, blackouts] = await Promise.all([
    fetchCartAssignments(sb, schedule.id),
    fetchCartBlackouts(sb, schedule.start_date, schedule.end_date),
  ]);
  return { places, slots, schedules, schedule, assignments, blackouts };
}

// ---------------------------------------------------------------------------
// Writes (editor/admin; CAS on every update/delete)
// ---------------------------------------------------------------------------
export async function createCartPlace(
  sb: TerritoriosClient,
  input: CartPlaceInsert,
): Promise<CartPlaceRow> {
  return insertRow(
    sb,
    'cart_places',
    CartPlaceRow,
    parsePayload('cart_places', CartPlaceInsert, input),
  );
}
export async function updateCartPlace(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
  patch: CartPlaceUpdate,
) {
  const body = parsePayload('cart_places', CartPlaceUpdate, patch);
  return casUpdate(sb, 'cart_places', CartPlaceRow, { id }, expectedVersion, body);
}
export async function deleteCartPlace(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'cart_places', CartPlaceRow, { id }, expectedVersion);
}

export async function createCartSlot(
  sb: TerritoriosClient,
  input: CartSlotInsert,
): Promise<CartSlotRow> {
  return insertRow(
    sb,
    'cart_slots',
    CartSlotRow,
    parsePayload('cart_slots', CartSlotInsert, input),
  );
}
export async function updateCartSlot(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
  patch: CartSlotUpdate,
) {
  const body = parsePayload('cart_slots', CartSlotUpdate, patch);
  return casUpdate(sb, 'cart_slots', CartSlotRow, { id }, expectedVersion, body);
}
export async function deleteCartSlot(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'cart_slots', CartSlotRow, { id }, expectedVersion);
}

export async function createCartSchedule(
  sb: TerritoriosClient,
  input: CartScheduleInsert,
): Promise<CartScheduleRow> {
  return insertRow(
    sb,
    'cart_schedules',
    CartScheduleRow,
    parsePayload('cart_schedules', CartScheduleInsert, input),
  );
}
export async function updateCartSchedule(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
  patch: CartScheduleUpdate,
) {
  const body = parsePayload('cart_schedules', CartScheduleUpdate, patch);
  return casUpdate(sb, 'cart_schedules', CartScheduleRow, { id }, expectedVersion, body);
}
export async function deleteCartSchedule(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'cart_schedules', CartScheduleRow, { id }, expectedVersion);
}

/** Races on (schedule_id, week_date, slot_id) surface as DataError with code 23505. */
export async function createCartAssignment(
  sb: TerritoriosClient,
  input: CartAssignmentInsert,
): Promise<CartAssignmentRow> {
  const body = parsePayload('cart_assignments', CartAssignmentInsert, input);
  return insertRow(sb, 'cart_assignments', CartAssignmentRow, body);
}
/** person_names is derived server-side and is never sent. */
export async function updateCartAssignment(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
  patch: CartAssignmentUpdate,
) {
  const body = parsePayload('cart_assignments', CartAssignmentUpdate, patch);
  return casUpdate(sb, 'cart_assignments', CartAssignmentRow, { id }, expectedVersion, body);
}
export async function deleteCartAssignment(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'cart_assignments', CartAssignmentRow, { id }, expectedVersion);
}

/** Races on (slot_id, date) surface as DataError with code 23505. */
export async function createCartBlackout(
  sb: TerritoriosClient,
  input: CartBlackoutInsert,
): Promise<CartBlackoutRow> {
  return insertRow(
    sb,
    'cart_blackouts',
    CartBlackoutRow,
    parsePayload('cart_blackouts', CartBlackoutInsert, input),
  );
}
export async function deleteCartBlackout(
  sb: TerritoriosClient,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return casDelete(sb, 'cart_blackouts', CartBlackoutRow, { id }, expectedVersion);
}
