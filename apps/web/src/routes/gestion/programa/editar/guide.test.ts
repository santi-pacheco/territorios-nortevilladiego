import { describe, expect, it } from 'vitest';
import { workbookWeekToMidweek, type MidweekWeek, type WorkbookWeek } from '@territorios/core';
import { mergeGuide } from './guide';

const guideWeek: WorkbookWeek = {
  weekStart: '2026-10-19',
  label: '19-25 DE OCTUBRE',
  bibleReading: 'LIBRO 45, 46',
  songs: [21, 117, 87],
  parts: [
    { section: 'inicio', number: null, title: 'Palabras de introducción', minutes: 1, kind: 'intro' },
    { section: 'tesoros', number: 1, title: 'Un título de prueba', minutes: 10, kind: 'tesoros' },
    { section: 'tesoros', number: 2, title: 'Busquemos perlas escondidas', minutes: 10, kind: 'perlas' },
    { section: 'tesoros', number: 3, title: 'Lectura de la Biblia', minutes: 4, kind: 'lectura' },
    { section: 'maestros', number: 4, title: 'Empiece conversaciones', minutes: 3, kind: 'estudiante' },
    { section: 'maestros', number: 5, title: 'Empiece conversaciones', minutes: 2, kind: 'estudiante' },
    { section: 'maestros', number: 6, title: 'Discurso', minutes: 4, kind: 'discurso' },
    { section: 'vida', number: 7, title: 'Necesidades de la congregación', minutes: 15, kind: 'parte' },
    { section: 'vida', number: 8, title: 'Estudio bíblico de la congregación', minutes: 30, kind: 'estudio' },
    { section: 'vida', number: null, title: 'Palabras de conclusión', minutes: 3, kind: 'conclusion' },
  ],
};
const guide = workbookWeekToMidweek(guideWeek, { start: '19:00' });

describe('Traer de la Guía de actividades', () => {
  it('fills a blank week with one summary line', () => {
    const blank: MidweekWeek = { date: '2026-10-20', asamblea: null, parts: [] };
    const p = mergeGuide(blank, guide);
    expect(p.week.parts).toEqual(guide.parts);
    expect(p.week.date).toBe('2026-10-20');
    expect(p.changes).toEqual(['Se cargan 13 partes de la Guía.']);
    expect(p.keptNames).toBe(0);
  });

  it('keeps names on matching parts and reports what changes', () => {
    const current: MidweekWeek = {
      date: '2026-10-20',
      asamblea: null,
      parts: [
        { time: '19:00', title: 'Canción 5 & Oración', section: 'inicio', people: [{ name: 'Persona A' }] },
        {
          time: '19:05',
          title: 'Palabras de introducción',
          section: 'inicio',
          people: [{ name: 'Persona B', role: 'Presidente' }],
        },
        { time: '19:32', title: 'Empiece conversaciones', section: 'maestros', people: [{ name: 'Persona C' }, { name: 'Persona D' }] },
        { time: '19:40', title: 'Empiece conversaciones', section: 'maestros', people: [{ name: 'Persona E' }] },
        { time: '19:45', title: 'Haga revisitas', section: 'maestros', people: [{ name: 'Persona F' }] },
      ],
    };
    const p = mergeGuide(current, guide);
    const byTitle = (t: string) => p.week.parts.filter((x) => x.title === t);

    // Opening song matched by position although its number changed.
    expect(byTitle('Canción 21 & Oración')[0]?.people).toEqual([{ name: 'Persona A' }]);
    expect(byTitle('Palabras de introducción')[0]?.people).toEqual([{ name: 'Persona B', role: 'Presidente' }]);
    // Repeated titles match by occurrence; times come from the Guía.
    expect(byTitle('Empiece conversaciones').map((x) => [x.time, x.people.map((q) => q.name)])).toEqual([
      ['19:32', ['Persona C', 'Persona D']],
      ['19:36', ['Persona E']],
    ]);
    // Parts without a match get empty slots from the Guía.
    expect(byTitle('Discurso')[0]?.people).toEqual([{ name: '' }]);
    expect(p.keptNames).toBe(4);

    expect(p.changes).toContain('Cambia el título: Canción 5 & Oración → Canción 21 & Oración');
    expect(p.changes).toContain('Cambia la hora de Empiece conversaciones: 19:40 → 19:36');
    expect(p.changes).toContain('Se agrega: 19:39 Discurso');
    expect(p.changes).toContain('Se quita: 19:45 Haga revisitas (tenía a Persona F)');
  });

  it('does not touch the original week', () => {
    const current: MidweekWeek = {
      date: '2026-10-20',
      asamblea: null,
      parts: [{ time: '19:05', title: 'Palabras de introducción', section: 'inicio', people: [{ name: 'Persona B' }] }],
    };
    const before = JSON.stringify(current);
    const p = mergeGuide(current, guide);
    p.week.parts[1]!.people[0]!.name = 'cambiado';
    expect(JSON.stringify(current)).toBe(before);
  });

  it('applying merges against the latest form, so names typed after the preview stay', () => {
    const blank: MidweekWeek = { date: '2026-10-20', asamblea: null, parts: [] };
    const preview = mergeGuide(blank, guide);
    // The editor applies the preview, then types a name, then fetches and applies again.
    const edited = structuredClone(preview.week);
    edited.parts.find((x) => x.title === 'Discurso')!.people[0]!.name = 'Persona G';
    const again = mergeGuide(edited, guide);
    expect(again.week.parts.find((x) => x.title === 'Discurso')?.people).toEqual([{ name: 'Persona G' }]);
  });

  it('reports nothing when the week already matches the Guía', () => {
    const p = mergeGuide(guide, guide);
    expect(p.changes).toEqual([]);
  });

  it('keeps the person links of the names it carries over', () => {
    const id = '0f8b3c2a-1d4e-4f6a-8b9c-0123456789ab';
    const current: MidweekWeek = {
      date: '2026-10-20',
      asamblea: null,
      parts: [
        {
          time: '19:20',
          title: 'Lectura de la Biblia',
          section: 'tesoros',
          people: [{ name: 'Persona Vinculada', role: 'Estudiante', person_id: id }],
        },
      ],
    };
    const p = mergeGuide(current, guide);
    const lectura = p.week.parts.find((x) => x.title === 'Lectura de la Biblia');
    expect(lectura?.people).toEqual([{ name: 'Persona Vinculada', role: 'Estudiante', person_id: id }]);
  });
});
