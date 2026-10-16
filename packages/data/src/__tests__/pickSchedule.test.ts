import { describe, expect, it } from 'vitest';
import { pickCurrentSchedule } from '../repos/carrito';
import type { CartScheduleRow } from '../schemas';

const row = (id: string, start: string, end: string) =>
  ({ id, name: id, start_date: start, end_date: end }) as unknown as CartScheduleRow;

describe('pickCurrentSchedule', () => {
  const oct = row('oct', '2026-10-01', '2026-10-31');
  const nov = row('nov', '2026-11-01', '2026-11-30');
  const sep = row('sep', '2026-09-01', '2026-09-30');
  it('prefers the schedule covering today', () =>
    expect(pickCurrentSchedule([nov, oct], '2026-10-16')?.id).toBe('oct'));
  it('falls back to the next one to start', () =>
    expect(pickCurrentSchedule([sep, nov], '2026-10-16')?.id).toBe('nov'));
  it('falls back to the most recent past one', () =>
    expect(pickCurrentSchedule([sep, row('aug', '2026-08-01', '2026-08-31')], '2026-10-16')?.id).toBe('sep'));
  it('returns null with no schedules', () => expect(pickCurrentSchedule([], '2026-10-16')).toBeNull());
});
