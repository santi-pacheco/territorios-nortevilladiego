import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMidweekPages } from '../parseMidweek';
import { workbookWeekToMidweek, type WorkbookWeek } from '../workbook';
import type { MidweekWeek, PdfItem } from '../types';

// workbook-2026-10.json: estructura (títulos, minutos, secciones, canciones) de las semanas de
// octubre 2026 sacada de la Guía real (mwb_S_202609) con el parser de la función `workbook`.
// Se compara contra el programa impreso real de ese mes (midweek-2026-10.json, saneado).
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const guide = JSON.parse(readFileSync(fixture('workbook-2026-10.json'), 'utf8')) as { weeks: WorkbookWeek[] };
const printed = Object.fromEntries(
  parseMidweekPages(JSON.parse(readFileSync(fixture('midweek-2026-10.json'), 'utf8')) as PdfItem[][], 2026).map(
    (w) => [w.date, w],
  ),
) as Record<string, MidweekWeek>;

// Única diferencia conocida con el impreso: el PDF real imprime "Estudio bíblico de la
// congregación" a las 19:52, la misma hora que la parte anterior de 15 min (el item "19:52" está
// en la fila del Estudio en el PDF, no es un error del parser). La hora real es 20:07, que es la
// única que cuadra con "Palabras de conclusión" a las 20:37; el conversor calcula 20:07.
const PRINTED_ESTUDIO = '19:52';
const REAL_ESTUDIO = '20:07';

const shape = (w: MidweekWeek) =>
  w.parts.map((p) => ({
    time: p.time,
    title: p.title,
    section: p.section,
    slots: p.people.length,
    roles: p.people.map((q) => q.role ?? null),
  }));

describe('Guía de actividades → programa de entre semana (octubre 2026)', () => {
  it('tiene las tres semanas con partes del impreso', () => {
    expect(guide.weeks.map((w) => w.weekStart)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
  });

  for (const week of guide.weeks) {
    const converted = workbookWeekToMidweek(week, { start: '19:00' });

    it(`${week.weekStart}: se guarda con la fecha del martes`, () => {
      expect(converted.date).toBe(printed[converted.date]?.date);
      expect(converted.asamblea).toBeNull();
    });

    it(`${week.weekStart}: horarios, títulos, secciones, lugares y roles iguales al impreso`, () => {
      const expected = shape(printed[converted.date]!).map((p) =>
        p.title === 'Estudio bíblico de la congregación' && p.time === PRINTED_ESTUDIO
          ? { ...p, time: REAL_ESTUDIO }
          : p,
      );
      expect(shape(converted)).toEqual(expected);
    });

    it(`${week.weekStart}: los lugares de nombres vienen vacíos`, () => {
      expect(converted.parts.flatMap((p) => p.people).every((q) => q.name === '')).toBe(true);
    });
  }

  it('respeta otra hora de inicio', () => {
    const w = workbookWeekToMidweek(guide.weeks[0]!, { start: '18:30' });
    expect(w.parts[0]!.time).toBe('18:30');
    expect(w.parts.at(-1)!.time).toBe('20:10');
  });
});
