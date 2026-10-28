import { describe, expect, it } from 'vitest';
import { buildMonthTable, monthTitle } from './monthTable';
import type { WeeksSource } from './weeks';

const place = { id: 'p1', name: 'Romar', color: '#fff' };
const slot = (id: string, dow: number, start: string, end: string) => ({
  id,
  place_id: 'p1',
  iso_dow: dow,
  start_time: start,
  end_time: end,
});

function source(overrides: Partial<Record<string, unknown>> = {}): WeeksSource {
  return {
    places: [place],
    slots: [slot('s2', 3, '17:00:00', '18:30:00'), slot('s1', 2, '09:00:00', '11:00:00')],
    blackouts: [],
    schedule: { start_date: '2026-10-01', end_date: '2026-10-31' },
    assignments: [],
    ...overrides,
  } as unknown as WeeksSource;
}

describe('monthTitle', () => {
  it('names one month, or the span', () => {
    expect(monthTitle('2026-10-01', '2026-10-31')).toBe('Mes de octubre');
    expect(monthTitle('2026-10-20', '2026-11-10')).toBe('Octubre – noviembre');
  });
});

describe('buildMonthTable', () => {
  it('orders columns by day and time and has a row per week', () => {
    const table = buildMonthTable(source());
    expect(table.columns.map((c) => [c.day, c.time])).toEqual([
      ['Martes', '09:00–11:00'],
      ['Miércoles', '17:00–18:30'],
    ]);
    expect(table.rows.map((r) => r.label)).toEqual([
      '1 de octubre',
      '5 de octubre',
      '12 de octubre',
      '19 de octubre',
      '26 de octubre',
    ]);
  });

  it('marks cells outside the period', () => {
    const [first] = buildMonthTable(source()).rows;
    // 1 Oct 2026 is a Thursday: that week's Tuesday and Wednesday fall before the range.
    expect(first?.cells.map((c) => c.kind)).toEqual(['outside', 'outside']);
  });

  it('merges blocked runs with the same reason and keeps different ones apart', () => {
    const merged = buildMonthTable(
      source({
        blackouts: [
          { slot_id: 's1', date: '2026-10-06', reason: 'Asamblea' },
          { slot_id: 's2', date: '2026-10-07', reason: 'Asamblea' },
        ],
      }),
    );
    expect(merged.rows[1]?.cells).toEqual([{ kind: 'blocked', reason: 'Asamblea', span: 2 }]);
    const apart = buildMonthTable(
      source({
        blackouts: [
          { slot_id: 's1', date: '2026-10-06', reason: 'Asamblea' },
          { slot_id: 's2', date: '2026-10-07', reason: null },
        ],
      }),
    );
    expect(apart.rows[1]?.cells).toEqual([
      { kind: 'blocked', reason: 'Asamblea', span: 1 },
      { kind: 'blocked', reason: 'Sin carrito', span: 1 },
    ]);
  });

  it('puts names and notes in open cells and hides people on blocked ones', () => {
    const table = buildMonthTable(
      source({
        blackouts: [{ slot_id: 's2', date: '2026-10-14', reason: 'Asamblea' }],
        assignments: [
          { week_date: '2026-10-12', slot_id: 's1', person_names: ['Ana', 'Beto'], note: ' ojo ' },
          { week_date: '2026-10-12', slot_id: 's2', person_names: ['Cora'], note: null },
        ],
      }),
    );
    expect(table.rows[2]?.cells).toEqual([
      { kind: 'open', people: ['Ana', 'Beto'], note: 'ojo' },
      { kind: 'blocked', reason: 'Asamblea', span: 1 },
    ]);
  });
});
