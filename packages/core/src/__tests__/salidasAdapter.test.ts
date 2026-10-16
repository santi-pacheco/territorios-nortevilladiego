import { describe, it, expect } from 'vitest';
import { salidasToScheduleData } from '../salidasAdapter';
import { makeDay, emptySlot } from '../salidasStore';
import type { SalidasSchedule } from '../types';

function withSlot(dow: number, lugar: string, terr: string): SalidasSchedule['days'][number] {
  const day = makeDay(dow);
  day.slots = [{ ...emptySlot(), hora: '9', lugar, territorio: terr }];
  return day;
}

describe('salidasToScheduleData', () => {
  it('emits one map day per schedule day, in order', () => {
    const schedule: SalidasSchedule = {
      mes: 'JULIO',
      weekStart: '2026-07-15',
      days: [withSlot(1, 'Plaza', '5, 12'), withSlot(3, 'Centro', '8')],
    };
    const out = salidasToScheduleData(schedule);
    expect(out.days.map((d) => d.dow)).toEqual([1, 3]);
    expect(out.days[0]!.label).toBe('Lunes');
    expect(out.days[0]!.date).toBe('13 de Julio');
    expect(out.days[0]!.assignments[0]!.territoryIds).toEqual([5, 12]);
  });

  it('maps domingo grupos label and territorioNumero into territoryIds', () => {
    const dom = makeDay(0);
    dom.domingoSlots = [
      { id: 'x', hora: '10', grupos: '1, 2', conductor: 'A', lugar: 'L', territorioNumero: '7, 12' },
    ];
    const out = salidasToScheduleData({ mes: 'JULIO', weekStart: '2026-07-15', days: [dom] });
    expect(out.days[0]!.assignments[0]!.groups).toBe('1, 2');
    expect(out.days[0]!.assignments[0]!.territoryIds).toEqual([7, 12]);
  });

  it('drops empty slots', () => {
    const out = salidasToScheduleData({ mes: '', weekStart: '', days: [makeDay(2)] });
    expect(out.days[0]!.assignments).toEqual([]);
  });
});
