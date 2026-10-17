import { describe, expect, it } from 'vitest';
import type { DutyPerson } from '@territorios/data';
import { normName, parsePaste, parsePasteDate, resolveName } from './paste';

const OCT_2026 = { year: 2026, month: 9 };

// Invented sheet in the shape of the real one: a 4-cell header (MICROFONISTAS spans two
// columns), weekday + d-mmm dates, an assembly week and an accented upper-case name.
const SHEET = [
  'FECHA\tCOMPUTADORA\tSONIDO\tMICROFONISTAS',
  'MARTES 1-sep\tTOMAS\tLEANDRO\tOSVALDO\tRAMIRO',
  'SABADO 5-sep\tLEANDRO\tTOMAS\tRAMIRO\tOSVALDO B.',
  'MARTES 6-oct\tASAMBLEA REGIONAL',
  'SÁBADO 10-oct\tASAMBLEA REGIONAL\t\t',
  'MARTES 13-oct\tTOMAS\tLEANDRO\tÉRICO\tOSVALDO\tFAUSTO\tRAMIRO',
  '',
  'Total del mes\t12',
].join('\r\n');

const person = (id: string, name: string, duties: DutyPerson['duties'], aliases: string[] = []) =>
  ({ id, name, duties, aliases }) satisfies DutyPerson;

const PEOPLE: DutyPerson[] = [
  person('p1', 'Tomás Ejemplo', ['computadora', 'sonido']),
  person('p2', 'Leandro Inventado', ['computadora', 'sonido']),
  person('p3', 'Osvaldo Ficticio', ['microfonista']),
  person('p4', 'Osvaldo Bolaños', ['microfonista']),
  person('p5', 'Ramiro Prueba', ['microfonista', 'acomodador']),
  person('p6', 'Érico Demo', ['microfonista'], ['Riqui']),
  person('p7', 'Fausto Modelo', ['sonido']),
];

describe('parsePasteDate', () => {
  it('reads weekday + d-mmm, with or without accents', () => {
    expect(parsePasteDate('MARTES 1-sep', OCT_2026)).toBe('2026-09-01');
    expect(parsePasteDate('SABADO 3-oct', OCT_2026)).toBe('2026-10-03');
    expect(parsePasteDate('Sábado 3-OCT', OCT_2026)).toBe('2026-10-03');
    expect(parsePasteDate('martes 1 set', OCT_2026)).toBe('2026-09-01');
    expect(parsePasteDate('6 de octubre', OCT_2026)).toBe('2026-10-06');
  });

  it('reads numeric dates, with and without year', () => {
    expect(parsePasteDate('13/10', OCT_2026)).toBe('2026-10-13');
    expect(parsePasteDate('13-10-2026', OCT_2026)).toBe('2026-10-13');
    expect(parsePasteDate('13/10/27', OCT_2026)).toBe('2027-10-13');
  });

  it('rolls to the next year when the month is more than six months before the selected one', () => {
    const dec = { year: 2026, month: 11 };
    expect(parsePasteDate('5/1', dec)).toBe('2027-01-05');
    expect(parsePasteDate('MARTES 5-ene', dec)).toBe('2027-01-05');
    expect(parsePasteDate('15/12', dec)).toBe('2026-12-15');
    expect(parsePasteDate('2/6', dec)).toBe('2026-06-02');
  });

  it('rejects text and impossible dates', () => {
    expect(parsePasteDate('Total del mes', OCT_2026)).toBeNull();
    expect(parsePasteDate('31/9', OCT_2026)).toBeNull();
    expect(parsePasteDate('3-xyz', OCT_2026)).toBeNull();
  });
});

describe('parsePaste', () => {
  const parsed = parsePaste(SHEET, OCT_2026);

  it('skips the header and blank lines, reports lines without a date', () => {
    expect(parsed.rows.map((r) => r.date)).toEqual([
      '2026-09-01',
      '2026-09-05',
      '2026-10-06',
      '2026-10-10',
      '2026-10-13',
    ]);
    expect(parsed.skipped).toEqual([{ line: 8, text: 'Total del mes\t12' }]);
  });

  it('maps columns to computadora, sonido, two mics and two acomodadores', () => {
    const row = parsed.rows.find((r) => r.date === '2026-10-13')!;
    expect(row.kind).toBe('normal');
    expect(row.cells.map((c) => [c.role, c.slot, c.raw])).toEqual([
      ['computadora', 1, 'TOMAS'],
      ['sonido', 1, 'LEANDRO'],
      ['microfonista', 1, 'ÉRICO'],
      ['microfonista', 2, 'OSVALDO'],
      ['acomodador', 1, 'FAUSTO'],
      ['acomodador', 2, 'RAMIRO'],
    ]);
    const short = parsed.rows.find((r) => r.date === '2026-09-01')!;
    expect(short.cells).toHaveLength(4);
  });

  it('marks ASAMBLEA rows as an assembly day with its text as the note', () => {
    const row = parsed.rows.find((r) => r.date === '2026-10-06')!;
    expect(row).toMatchObject({ kind: 'asamblea', note: 'Asamblea regional', cells: [] });
    expect(parsed.rows.find((r) => r.date === '2026-10-10')?.kind).toBe('asamblea');
  });

  it('flags dates that are not Tuesday or Saturday', () => {
    const { rows } = parsePaste('JUEVES 8-oct\tTOMAS', OCT_2026);
    expect(rows[0]?.offDay).toBe(true);
    expect(parsed.rows.every((r) => !r.offDay)).toBe(true);
  });

  it('keeps the later line when a date repeats', () => {
    const { rows } = parsePaste('13/10\tTOMAS\n13/10\tLEANDRO', OCT_2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cells[0]?.raw).toBe('LEANDRO');
  });
});

describe('resolveName', () => {
  it('matches the full name accent- and case-insensitively', () => {
    expect(resolveName('TOMAS EJEMPLO', 'computadora', PEOPLE)).toMatchObject({
      status: 'resolved',
      person: { id: 'p1' },
    });
  });

  it('matches a unique first name among the people with that duty', () => {
    expect(resolveName('TOMAS', 'sonido', PEOPLE)).toMatchObject({ person: { id: 'p1' } });
    expect(resolveName('ÉRICO', 'microfonista', PEOPLE)).toMatchObject({ person: { id: 'p6' } });
    expect(resolveName('erico', 'microfonista', PEOPLE)).toMatchObject({ person: { id: 'p6' } });
  });

  it('matches an alias', () => {
    expect(resolveName('RIQUI', 'microfonista', PEOPLE)).toMatchObject({ person: { id: 'p6' } });
  });

  it('matches "Name X." to the person whose surname starts with X', () => {
    expect(resolveName('OSVALDO B.', 'microfonista', PEOPLE)).toMatchObject({
      status: 'resolved',
      person: { id: 'p4' },
    });
    expect(resolveName('Osvaldo F', 'microfonista', PEOPLE)).toMatchObject({ person: { id: 'p3' } });
  });

  it('is ambiguous when the first name is shared', () => {
    const r = resolveName('OSVALDO', 'microfonista', PEOPLE);
    expect(r.status).toBe('ambiguous');
    expect(r.status === 'ambiguous' && r.candidates.map((p) => p.id).sort()).toEqual(['p3', 'p4']);
  });

  it('only looks at people with the duty', () => {
    expect(resolveName('FAUSTO', 'acomodador', PEOPLE).status).toBe('unknown');
    expect(resolveName('FAUSTO', 'sonido', PEOPLE)).toMatchObject({ person: { id: 'p7' } });
  });

  it('does not match a different name that merely starts the same', () => {
    expect(resolveName('TOM', 'computadora', PEOPLE).status).toBe('unknown');
    expect(resolveName('Nadie Conocido', 'sonido', PEOPLE).status).toBe('unknown');
  });

  it('normalises spacing and accents', () => {
    expect(normName('  Érico   DEMO ')).toBe('erico demo');
  });
});
