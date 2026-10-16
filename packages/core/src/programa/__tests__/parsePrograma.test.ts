import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMidweekPages } from '../parseMidweek';
import { parseWeekendPages } from '../parseWeekend';
import type { MidweekWeek, PdfItem, WeekendMeeting } from '../types';

// Fixtures saneados de octubre 2026: PdfItem[][] volcados desde los PDF reales con
// tools/fixtures/sanitize-programa.ts. Cada persona es "Persona NN" (numerada por orden de
// aparición) y cada congregación "Congregación Ejemplo"; posiciones y estructura son las reales.
const MIDWEEK_FIX = fileURLToPath(new URL('./fixtures/midweek-2026-10.json', import.meta.url));
const WEEKEND_FIX = fileURLToPath(new URL('./fixtures/weekend-2026-10.json', import.meta.url));
let midweek: Record<string, MidweekWeek>;
let weekend: Record<string, WeekendMeeting>;

function readPages(file: string): PdfItem[][] {
  return JSON.parse(readFileSync(file, 'utf8')) as PdfItem[][];
}

beforeAll(() => {
  midweek = Object.fromEntries(parseMidweekPages(readPages(MIDWEEK_FIX), 2026).map((w) => [w.date, w]));
  weekend = Object.fromEntries(parseWeekendPages(readPages(WEEKEND_FIX), 2026).map((w) => [w.date, w]));
});

describe('programa entre semana (octubre 2026)', () => {
  it('reconoce las cuatro semanas por fecha ISO', () => {
    expect(Object.keys(midweek).sort()).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  });

  it('6 oct es asamblea sin partes', () => {
    expect(midweek['2026-10-06']!.asamblea).toContain('ASAMBLEA');
    expect(midweek['2026-10-06']!.parts).toEqual([]);
  });

  it('13 oct: presidente y Estudio con Lector / Conductor', () => {
    const w = midweek['2026-10-13']!;
    const pres = w.parts.find((p) => p.time === '19:05');
    expect(pres?.people).toEqual([{ name: 'Persona 02', role: 'Presidente' }]);

    const estudio = w.parts.find((p) => p.title.startsWith('Estudio bíblico'));
    expect(estudio?.section).toBe('vida');
    expect(estudio?.people).toEqual([
      { name: 'Persona 11', role: 'Lector' },
      { name: 'Persona 12', role: 'Conductor' },
    ]);
  });

  it('13 oct: secciones y orden de partes', () => {
    const w = midweek['2026-10-13']!;
    expect(w.parts.map((p) => p.section)).toEqual([
      'inicio', 'inicio', 'tesoros', 'tesoros', 'tesoros',
      'maestros', 'maestros', 'maestros',
      'vida', 'vida', 'vida', 'vida', 'vida',
    ]);
  });

  it('20 oct: tres pares de "Empiece conversaciones" y Discurso', () => {
    const w = midweek['2026-10-20']!;
    const conv = w.parts.filter((p) => p.title === 'Empiece conversaciones');
    expect(conv.map((p) => p.people.map((q) => q.name))).toEqual([
      ['Persona 18', 'Persona 19'],
      ['Persona 20', 'Persona 21'],
      ['Persona 22', 'Persona 23'],
    ]);
    expect(w.parts.find((p) => p.title === 'Discurso')?.people).toEqual([{ name: 'Persona 24' }]);
  });

  it('20 oct: Estudio con Lector y Conductor sin cruzarse', () => {
    const estudio = midweek['2026-10-20']!.parts.find((p) => p.title.startsWith('Estudio bíblico'));
    expect(estudio?.people).toEqual([
      { name: 'Persona 25', role: 'Lector' },
      { name: 'Persona 26', role: 'Conductor' },
    ]);
  });

  it('27 oct: Estudio con Lector y Conductor', () => {
    const estudio = midweek['2026-10-27']!.parts.find((p) => p.title.startsWith('Estudio bíblico'));
    expect(estudio?.people).toEqual([
      { name: 'Persona 04', role: 'Lector' },
      { name: 'Persona 13', role: 'Conductor' },
    ]);
  });
});

describe('programa fin de semana (octubre 2026)', () => {
  it('reconoce las cinco fechas, incluido 31 oct de la página 2', () => {
    expect(Object.keys(weekend).sort()).toEqual([
      '2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31',
    ]);
  });

  it('24 oct (columna derecha): presidente, conductor, lector y discurso especial sin mezclar', () => {
    const w = weekend['2026-10-24']!;
    expect(w.presidente).toBe('Persona 43');
    expect(w.conductor).toBe('Persona 37');
    expect(w.lector).toBe('Persona 45');
    expect(w.cancionInicio).toBe('106');
    expect(w.cancionFin).toBe('154');
    expect(w.oracionFinal).toBe('Persona 46');
    expect(w.discurso).toEqual({
      tipo: 'ESPECIAL',
      titulo: 'Luchemos contra el espíritu del mundo',
      orador: 'Persona 47',
      congregacion: 'Congregación Ejemplo',
      saliente: null,
    });
  });

  it('3 oct: discurso con discursante saliente', () => {
    const w = weekend['2026-10-03']!;
    expect(w.presidente).toBe('Persona 36');
    expect(w.lector).toBe('Persona 38');
    expect(w.discurso?.titulo).toBe('Imitemos al Padre de tiernas misericordias');
    expect(w.discurso?.orador).toBe('Persona 40');
    expect(w.discurso?.saliente).toBe('Persona 41 – Congregación Ejemplo');
  });

  it('10 oct es asamblea regional: sin presidente ni asignaciones', () => {
    const w = weekend['2026-10-10']!;
    expect(w.asamblea).toContain('ASAMBLEA REGIONAL');
    expect(w.presidente).toBeNull();
    expect(w.conductor).toBeNull();
    expect(w.lector).toBeNull();
  });

  it('17 oct: presidente, conductor y lector', () => {
    const w = weekend['2026-10-17']!;
    expect(w.presidente).toBe('Persona 39');
    expect(w.conductor).toBe('Persona 37');
    expect(w.lector).toBe('Persona 42');
  });

  it('31 oct (página 2): presidente en la misma línea que su etiqueta, lector y oración', () => {
    const w = weekend['2026-10-31']!;
    expect(w.presidente).toBe('Persona 46');
    expect(w.lector).toBe('Persona 48');
    expect(w.oracionFinal).toBe('Persona 49');
    expect(w.discurso?.orador).toBe('Persona 50');
  });
});
