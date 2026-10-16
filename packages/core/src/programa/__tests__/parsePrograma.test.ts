import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMidweekPages } from '../parseMidweek';
import { parseWeekendPages } from '../parseWeekend';
import type { MidweekWeek, PdfItem, WeekendMeeting } from '../types';

// Fixtures saneados de octubre 2026: PdfItem[][] volcados desde los PDF reales con
// nombres ficticios (tarea F3). Hasta que existan, estos tests se omiten.
// Los nombres esperados abajo son inventados; los fixtures deben usar exactamente estos.
const MIDWEEK_FIX = fileURLToPath(new URL('./fixtures/midweek-2026-10.json', import.meta.url));
const WEEKEND_FIX = fileURLToPath(new URL('./fixtures/weekend-2026-10.json', import.meta.url));
const HAS_FIXTURES = existsSync(MIDWEEK_FIX) && existsSync(WEEKEND_FIX);
let midweek: Record<string, MidweekWeek>;
let weekend: Record<string, WeekendMeeting>;

function readPages(file: string): PdfItem[][] {
  return JSON.parse(readFileSync(file, 'utf8')) as PdfItem[][];
}

beforeAll(() => {
  if (!HAS_FIXTURES) return;
  midweek = Object.fromEntries(parseMidweekPages(readPages(MIDWEEK_FIX), 2026).map((w) => [w.date, w]));
  weekend = Object.fromEntries(parseWeekendPages(readPages(WEEKEND_FIX), 2026).map((w) => [w.date, w]));
});

describe.skipIf(!HAS_FIXTURES)('programa entre semana (octubre 2026)', () => {
  it('reconoce las cuatro semanas por fecha ISO', () => {
    expect(Object.keys(midweek).sort()).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  });

  it('6 oct es asamblea sin partes', () => {
    expect(midweek['2026-10-06']!.asamblea).toContain('ASAMBLEA');
    expect(midweek['2026-10-06']!.parts).toEqual([]);
  });

  it('13 oct: presidente Alfa Uno Bis y Estudio con Lector / Conductor', () => {
    const w = midweek['2026-10-13']!;
    const pres = w.parts.find((p) => p.time === '19:05');
    expect(pres?.people).toEqual([{ name: 'Alfa, Uno Bis', role: 'Presidente' }]);

    const estudio = w.parts.find((p) => p.title.startsWith('Estudio bíblico'));
    expect(estudio?.section).toBe('vida');
    expect(estudio?.people).toEqual([
      { name: 'Bravo, Dos', role: 'Lector' },
      { name: 'Alfa, Tres', role: 'Conductor' },
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
      ['Delta, Cuatro', 'Eco Foxtrot, Cinco'],
      ['Gólf, Seis', 'Hotel, Siete'],
      ['India, Ocho', 'Kilo, Nueve'],
    ]);
    expect(w.parts.find((p) => p.title === 'Discurso')?.people).toEqual([{ name: 'Lima, Diez' }]);
  });

  it('20 oct: Estudio con Lector Kilo Once (no el Conductor)', () => {
    const estudio = midweek['2026-10-20']!.parts.find((p) => p.title.startsWith('Estudio bíblico'));
    expect(estudio?.people).toEqual([
      { name: 'Kilo, Once', role: 'Lector' },
      { name: 'Alfa, Doce', role: 'Conductor' },
    ]);
  });

  it('27 oct: Estudio con Lector Mike Trece y Conductor Noviembre Catorce', () => {
    const estudio = midweek['2026-10-27']!.parts.find((p) => p.title.startsWith('Estudio bíblico'));
    expect(estudio?.people).toEqual([
      { name: 'Mike, Trece', role: 'Lector' },
      { name: 'Noviembre, Catorce', role: 'Conductor' },
    ]);
  });
});

describe.skipIf(!HAS_FIXTURES)('programa fin de semana (octubre 2026)', () => {
  it('reconoce las cinco fechas, incluido 31 oct de la página 2', () => {
    expect(Object.keys(weekend).sort()).toEqual([
      '2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31',
    ]);
  });

  it('24 oct (columna derecha): presidente, conductor, lector y discurso especial sin mezclar', () => {
    const w = weekend['2026-10-24']!;
    expect(w.presidente).toBe('Quince P Hotel');
    expect(w.conductor).toBe('Catorce Noviembre');
    expect(w.lector).toBe('Dieciséis India');
    expect(w.cancionInicio).toBe('106');
    expect(w.cancionFin).toBe('154');
    expect(w.oracionFinal).toBe('Uno B Alfa');
    expect(w.discurso).toEqual({
      tipo: 'ESPECIAL',
      titulo: 'Luchemos contra el espíritu del mundo',
      orador: 'Diecisiete Oscar',
      congregacion: 'Andino',
      saliente: null,
    });
  });

  it('3 oct: discurso con discursante saliente', () => {
    const w = weekend['2026-10-03']!;
    expect(w.presidente).toBe('Tres Alfa');
    expect(w.lector).toBe('Dieciocho Papa');
    expect(w.discurso?.titulo).toBe('Imitemos al Padre de tiernas misericordias');
    expect(w.discurso?.orador).toBe('Diecinueve Quebec');
    expect(w.discurso?.saliente).toBe('Veinte Romeo – Arroyo Seco');
  });

  it('10 oct es asamblea regional: sin presidente ni asignaciones', () => {
    const w = weekend['2026-10-10']!;
    expect(w.asamblea).toContain('ASAMBLEA REGIONAL');
    expect(w.presidente).toBeNull();
    expect(w.conductor).toBeNull();
    expect(w.lector).toBeNull();
  });

  it('17 oct: presidente Bravo y lector Mike', () => {
    const w = weekend['2026-10-17']!;
    expect(w.presidente).toBe('Dos Bravo');
    expect(w.conductor).toBe('Catorce Noviembre');
    expect(w.lector).toBe('Trece Mike');
  });

  it('31 oct (página 2): lector Doce Alfa y oración Veintiuno Noviembre', () => {
    const w = weekend['2026-10-31']!;
    expect(w.presidente).toBe('Uno B Alfa');
    expect(w.lector).toBe('Doce Alfa');
    expect(w.oracionFinal).toBe('Veintiuno Noviembre');
    expect(w.discurso?.orador).toBe('Veintidós Sierra');
  });
});
