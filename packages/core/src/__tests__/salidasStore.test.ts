import { describe, it, expect } from 'vitest';
import {
  dayNumberForDow,
  monthLabelForDow,
  kindForDow,
  migrateSchedule,
  defaultSchedule,
  sortDays,
  makeDay,
} from '../salidasStore';

describe('dayNumberForDow', () => {
  // Miércoles 2026-07-15 → semana Lun 13 … Dom 19
  it('numbers the reference Wednesday itself', () => {
    expect(dayNumberForDow('2026-07-15', 3)).toBe(15);
  });
  it('numbers Monday of that week', () => {
    expect(dayNumberForDow('2026-07-15', 1)).toBe(13);
  });
  it('numbers Sunday as end of the Mon–Sun week', () => {
    expect(dayNumberForDow('2026-07-15', 0)).toBe(19);
  });
  it('matches legacy consecutive offsets (Jue/Vie/Sáb)', () => {
    expect(dayNumberForDow('2026-07-15', 4)).toBe(16);
    expect(dayNumberForDow('2026-07-15', 5)).toBe(17);
    expect(dayNumberForDow('2026-07-15', 6)).toBe(18);
  });
  it('returns null without weekStart', () => {
    expect(dayNumberForDow(undefined, 3)).toBeNull();
    expect(dayNumberForDow('', 3)).toBeNull();
  });
});

describe('monthLabelForDow', () => {
  // Miércoles 2026-07-29 → semana Lun 27/07 … Dom 02/08
  it('keeps the manual label for days in the weekStart month', () => {
    expect(monthLabelForDow('2026-07-29', 3, 'JULIO')).toBe('JULIO');
    expect(monthLabelForDow('2026-07-29', 5, 'JULIO')).toBe('JULIO');
  });
  it('derives the real month for days that spill into the next month', () => {
    expect(monthLabelForDow('2026-07-29', 6, 'JULIO')).toBe('AGOSTO'); // sábado 1
    expect(monthLabelForDow('2026-07-29', 0, 'JULIO')).toBe('AGOSTO'); // domingo 2
  });
  it('derives the real month for days that spill into the previous month', () => {
    // Miércoles 2026-04-01 → semana Lun 30/03 … Dom 05/04
    expect(monthLabelForDow('2026-04-01', 1, 'ABRIL')).toBe('MARZO');
    expect(monthLabelForDow('2026-04-01', 3, 'ABRIL')).toBe('ABRIL');
  });
  it('falls back to the manual label without weekStart', () => {
    expect(monthLabelForDow(undefined, 3, 'JULIO')).toBe('JULIO');
    expect(monthLabelForDow('', 3, 'JULIO')).toBe('JULIO');
  });
});

describe('kindForDow', () => {
  it('is domingo only for dow 0', () => {
    expect(kindForDow(0)).toBe('domingo');
    expect(kindForDow(3)).toBe('normal');
  });
});

describe('sortDays', () => {
  it('orders Mon→Sun with Sunday last', () => {
    const dows = sortDays([makeDay(0), makeDay(3), makeDay(1)]).map((d) => d.dow);
    expect(dows).toEqual([1, 3, 0]);
  });
});

describe('migrateSchedule', () => {
  it('converts legacy shape to days[] preserving slots', () => {
    const legacy = {
      mes: 'JULIO',
      weekStart: '2026-07-15',
      miercoles: [{ id: 'a', hora: '9', grupos: '', conductor: '', lugar: 'x', territorio: '5' }],
      jueves: [],
      viernes: [],
      sabado: [],
      domingo: [{ id: 'd', hora: '10', conductor: '', lugar: '', territorioNumero: '7', g1: '1', g2: '2', g3: '', g4: '' }],
    };
    const s = migrateSchedule(legacy);
    expect(s.days.map((d) => d.dow)).toEqual([3, 4, 5, 6, 0]);
    const mie = s.days.find((d) => d.dow === 3)!;
    expect(mie.kind).toBe('normal');
    expect(mie.slots[0]!.lugar).toBe('x');
    const dom = s.days.find((d) => d.dow === 0)!;
    expect(dom.kind).toBe('domingo');
    expect(dom.domingoSlots[0]!.territorioNumero).toBe('7');
    // Formato viejo g1..g4 se junta en `grupos`.
    expect(dom.domingoSlots[0]!.grupos).toBe('1, 2');
  });

  it('passes through new-format schedules untouched', () => {
    const modern = defaultSchedule();
    expect(migrateSchedule(modern).days.length).toBe(modern.days.length);
  });

  it('falls back to default on garbage', () => {
    expect(migrateSchedule(null).days.length).toBeGreaterThan(0);
    expect(migrateSchedule(42).days.length).toBeGreaterThan(0);
  });

  it('falls back to default for an object with no recognized keys', () => {
    expect(migrateSchedule({ foo: 1 }).days.map((d) => d.dow)).toEqual([3, 4, 5, 6, 0]);
  });
});
