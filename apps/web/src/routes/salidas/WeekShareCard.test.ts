import { describe, expect, it } from 'vitest';
import { weekLabel } from './WeekShareCard';

describe('weekLabel', () => {
  it('names a range inside one month', () => {
    expect(weekLabel('2026-10-12')).toBe('12 al 18 de octubre');
  });

  it('spells out both months when the week crosses one', () => {
    expect(weekLabel('2026-09-28')).toBe('28 de septiembre al 4 de octubre');
  });
});
