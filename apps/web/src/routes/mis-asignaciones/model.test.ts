import { describe, expect, it } from 'vitest';
import type { MyAssignment } from '../../lib/accounts';
import { detailLine, groupByWeek, hhmm, nextAssignment, placeLine, relativeDay, sortAssignments } from './model';

const a = (p: Partial<MyAssignment> & Pick<MyAssignment, 'key' | 'date'>): MyAssignment => ({
  kind: 'carrito',
  start_time: null,
  title: 'Plaza',
  place: 'Plaza',
  role: null,
  detail: null,
  ...p,
});

// Thursday 16 Oct 2026, 10:30 local.
const NOW = new Date(2026, 9, 16, 10, 30);

describe('mis asignaciones model', () => {
  it('sorts by date, then time, untimed rows last in their day', () => {
    const sorted = sortAssignments([
      a({ key: 'c', date: '2026-10-17' }),
      a({ key: 'b', date: '2026-10-17', start_time: '18:00:00' }),
      a({ key: 'a', date: '2026-10-17', start_time: '09:00' }),
      a({ key: 'z', date: '2026-10-16', start_time: '20:00' }),
    ]);
    expect(sorted.map((x) => x.key)).toEqual(['z', 'a', 'b', 'c']);
  });

  it('skips today\'s assignments that already started when picking the next one', () => {
    const sorted = sortAssignments([
      a({ key: 'early', date: '2026-10-16', start_time: '09:00' }),
      a({ key: 'later', date: '2026-10-16', start_time: '19:00' }),
    ]);
    expect(nextAssignment(sorted, NOW)?.key).toBe('later');
    expect(nextAssignment([sorted[0]!], NOW)).toBeNull();
  });

  it('groups Monday-first weeks with Spanish headings', () => {
    const groups = groupByWeek(
      sortAssignments([
        a({ key: '1', date: '2026-10-18' }), // Sunday: still this week
        a({ key: '2', date: '2026-10-19' }), // next Monday
        a({ key: '3', date: '2026-10-28' }),
      ]),
      NOW,
    );
    expect(groups.map((g) => [g.heading, g.items.map((x) => x.key)])).toEqual([
      ['Esta semana', ['1']],
      ['Semana que viene', ['2']],
      ['Semana 26 oct – 1 nov', ['3']],
    ]);
  });

  it('formats times and relative days', () => {
    expect(hhmm('09:30:00')).toBe('09:30');
    expect(hhmm(null)).toBeNull();
    expect(relativeDay('2026-10-16', NOW)).toBe('hoy');
    expect(relativeDay('2026-10-17', NOW)).toBe('mañana');
    expect(relativeDay('2026-10-23', NOW)).toBe('en 7 días');
  });

  it('hides a place that only repeats the title', () => {
    expect(placeLine(a({ key: 's', date: '2026-10-17', kind: 'salida', title: 'Salón', place: 'Salón' }))).toBeNull();
    expect(placeLine(a({ key: 'p', date: '2026-10-17', kind: 'programa', title: 'Lectura', place: 'Salón' }))).toBe('Salón');
  });
});

describe('detail line', () => {
  it('labels a salida\'s groups', () => {
    expect(detailLine(a({ key: 's', date: '2026-10-17', kind: 'salida', detail: '3' }))).toBe('Grupo 3');
    expect(detailLine(a({ key: 'c', date: '2026-10-17', detail: 'Con Ana · llevar folletos' }))).toBe('Con Ana · llevar folletos');
  });
});
