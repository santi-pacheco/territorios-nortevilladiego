import { describe, expect, it } from 'vitest';
import {
  CartAssignmentRow,
  CartBlackoutInsert,
  CartBlackoutRow,
  CartSlotInsert,
  ProgramWeekInsert,
  ServiceMeetingRow,
  ServiceWeekInsert,
  TerritoryRow,
} from '../schemas';
import { TS, meetingRow } from './fakeSupabase';

describe('schemas mirror the SQL check constraints', () => {
  it('accepts PostgREST timestamps with microseconds and offset', () => {
    expect(ServiceMeetingRow.safeParse(meetingRow({ updated_at: TS })).success).toBe(true);
  });

  it('service_weeks.week_start must be a Monday', () => {
    expect(ServiceWeekInsert.safeParse({ week_start: '2026-10-12' }).success).toBe(true);
    expect(ServiceWeekInsert.safeParse({ week_start: '2026-10-14' }).success).toBe(false);
  });

  it('domingo ⇔ dow 0, and group_territories only G1..G4 on Domingo', () => {
    expect(ServiceMeetingRow.safeParse(meetingRow({ dow: 0, kind: 'normal' })).success).toBe(false);
    expect(
      ServiceMeetingRow.safeParse(
        meetingRow({ dow: 0, kind: 'domingo', group_territories: { G1: [1] } }),
      ).success,
    ).toBe(true);
    expect(
      ServiceMeetingRow.safeParse(
        meetingRow({ dow: 0, kind: 'domingo', group_territories: { G5: [1] } }),
      ).success,
    ).toBe(false);
    expect(
      ServiceMeetingRow.safeParse(meetingRow({ group_territories: { G1: [1] } })).success,
    ).toBe(false);
  });

  it('program_weeks keyed by Tuesday (midweek) / Saturday (weekend)', () => {
    expect(ProgramWeekInsert.safeParse({ kind: 'midweek', date: '2026-10-13' }).success).toBe(true);
    expect(ProgramWeekInsert.safeParse({ kind: 'weekend', date: '2026-10-17' }).success).toBe(true);
    expect(ProgramWeekInsert.safeParse({ kind: 'midweek', date: '2026-10-17' }).success).toBe(
      false,
    );
  });

  it('cart_slots end after start; time comes back as HH:MM:SS', () => {
    const base = { place_id: '00000000-0000-4000-8000-000000000003', iso_dow: 1 };
    expect(
      CartSlotInsert.safeParse({ ...base, start_time: '09:00:00', end_time: '11:00:00' }).success,
    ).toBe(true);
    expect(
      CartSlotInsert.safeParse({ ...base, start_time: '11:00', end_time: '09:00' }).success,
    ).toBe(false);
  });

  it('cart_assignments: names match ids, no duplicate people, Monday week_date', () => {
    const p = '00000000-0000-4000-8000-000000000004';
    const row = {
      id: '00000000-0000-4000-8000-000000000005',
      schedule_id: '00000000-0000-4000-8000-000000000006',
      slot_id: '00000000-0000-4000-8000-000000000007',
      week_date: '2026-10-12',
      person_ids: [p],
      person_names: ['Persona Uno'],
      note: null,
      updated_at: TS,
      version: 1,
      updated_by: null,
    };
    expect(CartAssignmentRow.safeParse(row).success).toBe(true);
    expect(CartAssignmentRow.safeParse({ ...row, person_names: [] }).success).toBe(false);
    expect(
      CartAssignmentRow.safeParse({ ...row, person_ids: [p, p], person_names: ['a', 'a'] }).success,
    ).toBe(false);
    expect(CartAssignmentRow.safeParse({ ...row, week_date: '2026-10-13' }).success).toBe(false);
  });

  it('cart_blackouts: reason is optional, nullable and at most 60 characters', () => {
    const base = { slot_id: '00000000-0000-4000-8000-000000000007', date: '2026-10-24' };
    expect(CartBlackoutInsert.safeParse(base).success).toBe(true);
    expect(CartBlackoutInsert.safeParse({ ...base, reason: 'Asamblea' }).success).toBe(true);
    expect(CartBlackoutInsert.safeParse({ ...base, reason: null }).success).toBe(true);
    expect(CartBlackoutInsert.safeParse({ ...base, reason: 'x'.repeat(61) }).success).toBe(false);
    const row = {
      ...base,
      id: '00000000-0000-4000-8000-000000000008',
      reason: 'Asamblea',
      updated_at: TS,
      version: 1,
      updated_by: null,
    };
    expect(CartBlackoutRow.safeParse(row).success).toBe(true);
    expect(CartBlackoutRow.safeParse({ ...row, reason: null }).success).toBe(true);
    // The column is always selected: a row without it is not a valid row.
    expect(CartBlackoutRow.safeParse({ ...row, reason: undefined }).success).toBe(false);
  });

  it('territory geometry must be Polygon/MultiPolygon', () => {
    const t = {
      id: 5,
      name: '5',
      centroid_lng: -58,
      centroid_lat: -34,
      updated_at: TS,
      version: 1,
      updated_by: null,
    };
    expect(
      TerritoryRow.safeParse({
        ...t,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      TerritoryRow.safeParse({ ...t, geometry: { type: 'Point', coordinates: [0, 0] } }).success,
    ).toBe(false);
  });
});
