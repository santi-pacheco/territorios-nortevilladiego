import { describe, expect, it } from 'vitest';
import {
  MAX_RANGE_WEEKS,
  normalizeRange,
  presetRange,
  selectBlocks,
  type ShareRange,
} from './shareModel';

// 2026-10-26 is a Monday.
const MON = '2026-10-26';

const midweekRow = (date: string, asamblea: string | null = null, withParts = true) => ({
  kind: 'midweek',
  date,
  data: {
    date,
    asamblea,
    parts: withParts
      ? [{ time: '19:00', title: 'Palabras de introducción', section: 'inicio', people: [] }]
      : [],
  },
});

const weekendRow = (
  date: string,
  asamblea: string | null = null,
  presidente: string | null = 'Ana',
) => ({
  kind: 'weekend',
  date,
  data: { date, asamblea, presidente },
});

describe('presetRange', () => {
  it('picks the Tuesday and the Saturday of the shown week', () => {
    expect(presetRange('midweek-1', MON)).toEqual({
      kind: 'midweek',
      from: '2026-10-27',
      to: '2026-10-27',
    });
    expect(presetRange('weekend-1', MON)).toEqual({
      kind: 'weekend',
      from: '2026-10-31',
      to: '2026-10-31',
    });
  });

  it('covers four meetings of one kind, or whole weeks', () => {
    expect(presetRange('weekends-4', MON)).toEqual({
      kind: 'weekend',
      from: '2026-10-31',
      to: '2026-11-21',
    });
    expect(presetRange('midweeks-4', MON)).toEqual({
      kind: 'midweek',
      from: '2026-10-27',
      to: '2026-11-17',
    });
    expect(presetRange('weeks-4', MON)).toEqual({ kind: 'both', from: MON, to: '2026-11-22' });
    expect(presetRange('week-1', MON)).toEqual({ kind: 'both', from: MON, to: '2026-11-01' });
  });
});

describe('normalizeRange', () => {
  it('swaps reversed dates', () => {
    const r: ShareRange = { kind: 'both', from: '2026-11-10', to: '2026-11-01' };
    expect(normalizeRange(r)).toEqual({ kind: 'both', from: '2026-11-01', to: '2026-11-10' });
  });

  it('caps the span', () => {
    const r = normalizeRange({ kind: 'both', from: MON, to: '2027-12-31' });
    expect(r?.from).toBe(MON);
    expect(r?.to).toBe('2027-01-17');
    expect(MAX_RANGE_WEEKS).toBe(12);
  });

  it('rejects empty or impossible dates', () => {
    expect(normalizeRange({ kind: 'both', from: '', to: MON })).toBeNull();
    expect(normalizeRange({ kind: 'both', from: '2026-02-31', to: MON })).toBeNull();
  });
});

describe('selectBlocks', () => {
  const rows = [
    weekendRow('2026-10-31'),
    midweekRow('2026-10-27'),
    midweekRow('2026-11-03'),
    weekendRow('2026-11-07'),
  ];

  it('filters by kind and range, ordered by date', () => {
    const both = selectBlocks(rows, presetRange('weeks-4', MON));
    expect(both.map((b) => b.key)).toEqual([
      'midweek-2026-10-27',
      'weekend-2026-10-31',
      'midweek-2026-11-03',
      'weekend-2026-11-07',
    ]);
    const weekends = selectBlocks(rows, presetRange('weekends-4', MON));
    expect(weekends.map((b) => b.kind)).toEqual(['weekend', 'weekend']);
    expect(selectBlocks(rows, presetRange('midweek-1', MON))).toHaveLength(1);
  });

  it('drops empty meetings and rows outside the range', () => {
    const blocks = selectBlocks(
      [
        midweekRow('2026-10-27', null, false),
        weekendRow('2026-11-28'),
        weekendRow('2026-10-31', null, null),
      ],
      presetRange('weeks-4', MON),
    );
    expect(blocks).toEqual([]);
  });

  it('turns an assembly-only week into one banner', () => {
    const blocks = selectBlocks(
      [
        midweekRow('2026-10-27', 'Asamblea regional', false),
        weekendRow('2026-10-31', 'Asamblea regional', null),
      ],
      presetRange('week-1', MON),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'assembly', name: 'Asamblea regional', monday: MON });
  });

  it('keeps a real meeting next to the assembly note of the same week', () => {
    const blocks = selectBlocks(
      [midweekRow('2026-10-27'), weekendRow('2026-10-31', 'Asamblea de circuito', null)],
      presetRange('week-1', MON),
    );
    expect(blocks.map((b) => b.kind)).toEqual(['assembly', 'midweek']);
  });

  it('ignores malformed data and duplicate rows', () => {
    const blocks = selectBlocks(
      [
        { kind: 'midweek', date: '2026-10-27', data: 'x' },
        midweekRow('2026-11-03'),
        midweekRow('2026-11-03'),
      ],
      presetRange('weeks-4', MON),
    );
    expect(blocks.map((b) => b.key)).toEqual(['midweek-2026-11-03']);
  });
});
