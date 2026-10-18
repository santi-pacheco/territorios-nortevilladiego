import { describe, expect, it } from 'vitest';
import type { MidweekWeek } from '@territorios/core';
import {
  NO_PERSON,
  addPart,
  addPerson,
  cleanMidweek,
  cleanPeople,
  sanitizeMidweek,
  type WeekendDraft,
  cleanWeekend,
  copyPartsFrom,
  emptyMidweek,
  emptyWeekend,
  hasMidweekContent,
  hasWeekendContent,
  midweekDate,
  monthLabel,
  movePart,
  removePerson,
  removePart,
  sanitizeWeekend,
  setPart,
  setPerson,
  shiftMonth,
  weekLabel,
  weekStartsOfMonth,
  weekendDate,
} from './model';

const P1 = '0f8b3c2a-1d4e-4f6a-8b9c-0123456789ab';

const midweek: MidweekWeek = {
  date: '2026-10-06',
  asamblea: null,
  parts: [
    { time: '19:00', title: 'Palabras de introducción', section: 'inicio', people: [{ name: 'Persona 1', role: 'Presidente' }] },
    { time: '19:05', title: 'Tesoros de la Biblia', section: 'tesoros', people: [] },
  ],
};

describe('editar · semana y mes', () => {
  it('keys the midweek by Tuesday and the weekend by Saturday', () => {
    expect(midweekDate('2026-09-28')).toBe('2026-09-29');
    expect(weekendDate('2026-09-28')).toBe('2026-10-03');
  });

  it('lists every Monday week that overlaps the month', () => {
    expect(weekStartsOfMonth(2026, 9)).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    // February 2027 starts on a Monday and has exactly 28 days: four weeks only.
    expect(weekStartsOfMonth(2027, 1)).toEqual([
      '2027-02-01',
      '2027-02-08',
      '2027-02-15',
      '2027-02-22',
    ]);
  });

  it('moves the month across year boundaries', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(monthLabel(2026, 9)).toBe('octubre 2026');
    expect(weekLabel('2026-10-05')).toBe('5 – 11 oct');
    expect(weekLabel('2026-09-28')).toBe('28 sep – 4 oct');
  });
});

describe('editar · plantillas vacías', () => {
  it('builds an empty week with the right keys', () => {
    expect(emptyMidweek('2026-10-06')).toEqual({ date: '2026-10-06', asamblea: null, parts: [] });
    expect(emptyWeekend('2026-10-10')).toEqual({
      date: '2026-10-10',
      asamblea: null,
      presidente: NO_PERSON,
      cancionInicio: null,
      conductor: NO_PERSON,
      lector: NO_PERSON,
      cancionFin: null,
      oracionFinal: NO_PERSON,
      discurso: null,
    });
  });

  it('reports whether a meeting has anything to save', () => {
    expect(hasMidweekContent(emptyMidweek('2026-10-06'))).toBe(false);
    expect(hasMidweekContent(midweek)).toBe(true);
    expect(hasWeekendContent(emptyWeekend('2026-10-10'))).toBe(false);
    expect(
      hasWeekendContent({ ...emptyWeekend('2026-10-10'), lector: { person_id: null, name: 'Persona 2' } }),
    ).toBe(true);
    expect(
      hasWeekendContent({ ...emptyWeekend('2026-10-10'), discurso: { tipo: '', titulo: '', orador: NO_PERSON, congregacion: null, saliente: null } }),
    ).toBe(false);
  });
});

describe('editar · copiar la semana anterior', () => {
  it('keeps sections, times and titles but drops the people', () => {
    expect(copyPartsFrom(midweek)).toEqual([
      { time: '19:00', title: 'Palabras de introducción', section: 'inicio', people: [] },
      { time: '19:05', title: 'Tesoros de la Biblia', section: 'tesoros', people: [] },
    ]);
    expect(copyPartsFrom(null)).toEqual([]);
  });
});

describe('editar · limpieza antes de guardar', () => {
  it('drops blank parts and people, trims text and clamps the date', () => {
    const messy: MidweekWeek = {
      date: '2026-01-01',
      asamblea: '  ',
      parts: [
        { time: ' 19:00 ', title: '  Introducción ', section: 'inicio', people: [{ name: ' Persona 1 ', role: ' Presidente ' }, { name: '   ', role: 'Lector' }] },
        { time: '19:05', title: '   ', section: 'tesoros', people: [] },
      ],
    };
    expect(cleanMidweek(messy, '2026-10-06')).toEqual({
      date: '2026-10-06',
      asamblea: null,
      parts: [
        { time: '19:00', title: 'Introducción', section: 'inicio', people: [{ name: 'Persona 1', role: 'Presidente' }] },
      ],
    });
  });

  it('drops the parts of an assembly week', () => {
    const assembly: MidweekWeek = { ...midweek, asamblea: 'Asamblea de circuito' };
    expect(cleanMidweek(assembly, '2026-10-06')).toEqual({
      date: '2026-10-06',
      asamblea: 'Asamblea de circuito',
      parts: [],
    });
  });

  it('cleans the weekend and turns an empty discourse into null', () => {
    const messy: WeekendDraft = {
      ...emptyWeekend('2026-01-01'),
      presidente: { person_id: null, name: ' Persona 1 ' },
      discurso: { tipo: 'PÚBLICO', titulo: ' Título ', orador: NO_PERSON, congregacion: null, saliente: ' Persona 3 ' },
    };
    expect(cleanWeekend(messy, '2026-10-10')).toEqual({
      date: '2026-10-10',
      asamblea: null,
      presidente: 'Persona 1',
      cancionInicio: null,
      conductor: null,
      lector: null,
      cancionFin: null,
      oracionFinal: null,
      discurso: { tipo: 'PÚBLICO', titulo: 'Título', orador: null, congregacion: null, saliente: 'Persona 3' },
    });
    const blank: WeekendDraft = {
      ...emptyWeekend('2026-01-01'),
      discurso: { tipo: '', titulo: '', orador: NO_PERSON, congregacion: null, saliente: null },
    };
    expect(cleanWeekend(blank, '2026-10-10').discurso).toBeNull();
  });

  it('stores linked people as {name, person_id} and unlinked ones as plain names', () => {
    const draft: WeekendDraft = {
      ...emptyWeekend('2026-10-10'),
      lector: { person_id: P1, name: ' Persona 3 ' },
      conductor: { person_id: null, name: 'Persona 2' },
      discurso: { tipo: 'PÚBLICO', titulo: 'T', orador: { person_id: null, name: 'Visitante' }, congregacion: null, saliente: null },
    };
    const stored = cleanWeekend(draft, '2026-10-10');
    expect(stored.lector).toEqual({ name: 'Persona 3', person_id: P1 });
    expect(stored.conductor).toBe('Persona 2');
    expect(stored.discurso?.orador).toBe('Visitante');
    // And back: both shapes read into picker values.
    const again = sanitizeWeekend(stored, '2026-10-10');
    expect(again.lector).toEqual({ person_id: P1, name: 'Persona 3' });
    expect(again.conductor).toEqual({ person_id: null, name: 'Persona 2' });
    expect(again.discurso?.orador).toEqual({ person_id: null, name: 'Visitante' });
  });

  it('keeps person_id on midweek people through read and clean', () => {
    const raw = { parts: [{ time: '19:00', title: 'Lectura', section: 'tesoros', people: [{ name: 'Persona 1', role: 'Lector', person_id: P1 }, { name: 'Persona 2', person_id: 'bad' }] }] };
    const week = sanitizeMidweek(raw, '2026-10-06');
    expect(week.parts[0]?.people).toEqual([
      { name: 'Persona 1', role: 'Lector', person_id: P1 },
      { name: 'Persona 2' },
    ]);
    expect(cleanMidweek(week, '2026-10-06').parts[0]?.people[0]).toEqual({ name: 'Persona 1', role: 'Lector', person_id: P1 });
    const unlinked = setPerson(week.parts, 0, 0, { name: 'Otra', person_id: undefined });
    expect(cleanPeople(unlinked[0]!.people)[0]).toEqual({ name: 'Otra', role: 'Lector' });
  });

  it('reads back the fields the weekend editor does not show', () => {
    const stored = {
      date: '2026-10-10',
      asamblea: null,
      presidente: 'Persona 1',
      cancionInicio: '134',
      conductor: 'Persona 2',
      lector: 'Persona 3',
      cancionFin: '45',
      oracionFinal: 'Persona 4',
      discurso: { tipo: 'ESPECIAL', titulo: 'Título', orador: 'Persona 5', congregacion: 'Otra', saliente: 'Persona 6' },
    };
    const parsed = sanitizeWeekend(stored, '2026-10-10');
    expect(parsed.cancionInicio).toBe('134');
    expect(parsed.cancionFin).toBe('45');
    expect(parsed.discurso?.saliente).toBe('Persona 6');
    expect(cleanWeekend(parsed, '2026-10-10')).toEqual(stored);
  });
});

describe('editar · partes y personas', () => {
  it('appends a part continuing the last section', () => {
    const next = addPart([{ time: '19:00', title: 'A', section: 'tesoros', people: [] }]);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ time: '', title: '', section: 'tesoros', people: [] });
    expect(addPart([])[0]?.section).toBe('inicio');
  });

  it('moves parts and ignores out-of-range moves', () => {
    const parts = midweek.parts;
    const moved = movePart(parts, 0, 1);
    expect(moved.map((p) => p.title)).toEqual(['Tesoros de la Biblia', 'Palabras de introducción']);
    expect(movePart(parts, 0, -1)).toEqual(parts);
    expect(movePart(parts, 1, 1)).toEqual(parts);
  });

  it('adds, edits and removes people without touching the other parts', () => {
    const withPerson = addPerson(midweek.parts, 1);
    expect(withPerson[1]?.people).toEqual([{ name: '', role: '' }]);
    const edited = setPerson(withPerson, 1, 0, { name: 'Persona 9' });
    expect(edited[1]?.people[0]?.name).toBe('Persona 9');
    const removed = removePerson(edited, 1, 0);
    expect(removed[1]?.people).toEqual([]);
    expect(removed[0]).toEqual(midweek.parts[0]);
  });

  it('patches and removes parts by index', () => {
    expect(setPart(midweek.parts, 1, { title: 'Nuevo' })[1]?.title).toBe('Nuevo');
    expect(removePart(midweek.parts, 0)).toEqual([midweek.parts[1]]);
  });
});
