import { describe, it, expect } from 'vitest';
import { weekStartFor, addDays, dayLabel, weekRangeLabel } from '../week';
import { yearForMonth } from '../text';

describe('weekStartFor (semana lunes → domingo)', () => {
  it('lunes es inicio de su propia semana', () => {
    expect(weekStartFor(new Date(2026, 9, 5))).toBe('2026-10-05');
  });
  it('sábado queda en la semana del lunes anterior', () => {
    expect(weekStartFor(new Date(2026, 9, 3))).toBe('2026-09-28');
  });
  it('martes 13 y sábado 17 quedan en la misma semana', () => {
    expect(weekStartFor(new Date(2026, 9, 13))).toBe('2026-10-12');
    expect(weekStartFor(new Date(2026, 9, 17))).toBe('2026-10-12');
  });
  it('domingo cierra la semana', () => {
    expect(weekStartFor(new Date(2026, 9, 11))).toBe('2026-10-05');
  });
});

describe('labels', () => {
  it('dayLabel en español', () => {
    expect(dayLabel('2026-10-13')).toBe('Martes 13 oct');
  });
  it('weekRangeLabel lunes → domingo', () => {
    expect(weekRangeLabel('2026-10-12')).toBe('12 oct – 18 oct 2026');
  });
  it('addDays cruza mes', () => {
    expect(addDays('2026-10-31', 7)).toBe('2026-11-07');
  });
});

describe('yearForMonth (cruce de año)', () => {
  it('enero dentro de un PDF de diciembre va al año siguiente', () => {
    expect(yearForMonth(2026, 1, 12)).toBe(2027);
  });
  it('diciembre dentro de un PDF de enero va al año anterior', () => {
    expect(yearForMonth(2027, 12, 1)).toBe(2026);
  });
  it('meses cercanos no cambian el año', () => {
    expect(yearForMonth(2026, 10, 10)).toBe(2026);
  });
});
