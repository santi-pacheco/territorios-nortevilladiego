import { describe, expect, it } from 'vitest';
import {
  SECTION_COLOR,
  SECTION_ORDER,
  groupParts,
  myParts,
  parseSemanaParam,
  sanitizeMidweek,
  sanitizeWeekend,
  shortRange,
  weekendHasContent,
  type MyPart,
} from './model';

describe('programa sanitizers', () => {
  it('keeps a well-formed midweek week and defaults a missing date to the row key', () => {
    const week = sanitizeMidweek(
      {
        asamblea: null,
        parts: [
          {
            time: '19:06',
            title: 'Aplicaciones de nuestra vida cristiana',
            section: 'vida',
            people: [{ name: 'Ana Prueba', role: 'Lector' }],
          },
        ],
      },
      '2026-10-13',
    );
    expect(week?.date).toBe('2026-10-13');
    expect(week?.parts).toHaveLength(1);
    expect(week?.parts[0]?.people[0]).toEqual({ name: 'Ana Prueba', role: 'Lector' });
  });

  it('renders what is present: drops untitled parts, keeps parts with no time or people', () => {
    const week = sanitizeMidweek(
      {
        date: '2026-10-13',
        parts: [{ time: '19:00', title: '   ', section: 'inicio' }, { time: '19:05', title: 'Tesoro' }],
      },
      '2026-10-13',
    );
    expect(week?.parts).toEqual([{ time: '19:05', title: 'Tesoro', section: 'inicio', people: [] }]);
  });

  it('falls back to the inicio section for unknown section labels', () => {
    const week = sanitizeMidweek(
      { parts: [{ time: '19:00', title: 'Parte', section: 'inventado' }] },
      '2026-10-13',
    );
    expect(week?.parts[0]?.section).toBe('inicio');
  });

  it('rejects jsonb that is not an object', () => {
    expect(sanitizeMidweek(null, '2026-10-13')).toBeNull();
    expect(sanitizeMidweek('texto', '2026-10-13')).toBeNull();
    expect(sanitizeWeekend([1, 2], '2026-10-17')).toBeNull();
  });

  it('keeps the weekend rows that exist and ignores empty ones', () => {
    const meeting = sanitizeWeekend(
      {
        date: '2026-10-17',
        presidente: 'Ana Prueba',
        conductor: '   ',
        cancionInicio: '1',
        discurso: { tipo: 'PÚBLICO', titulo: 'Título del discurso', orador: 'Bruno Prueba' },
      },
      '2026-10-17',
    );
    expect(meeting?.presidente).toBe('Ana Prueba');
    expect(meeting?.conductor).toBeNull();
    expect(meeting?.discurso?.orador).toBe('Bruno Prueba');
  });

  it('reads linked people ({name, person_id}) as their names, next to legacy strings', () => {
    const id = '0f8b3c2a-1d4e-4f6a-8b9c-0123456789ab';
    const meeting = sanitizeWeekend(
      {
        presidente: 'Ana Prueba',
        lector: { name: 'Bruno Prueba', person_id: id },
        conductor: { name: '  ' },
        oracionFinal: { name: 'Carla Prueba' },
        discurso: { tipo: 'PÚBLICO', titulo: 'T', orador: { name: 'Dario Prueba', person_id: id } },
      },
      '2026-10-17',
    );
    expect(meeting?.presidente).toBe('Ana Prueba');
    expect(meeting?.lector).toBe('Bruno Prueba');
    expect(meeting?.conductor).toBeNull();
    expect(meeting?.oracionFinal).toBe('Carla Prueba');
    expect(meeting?.discurso?.orador).toBe('Dario Prueba');
    const week = sanitizeMidweek(
      { parts: [{ title: 'Lectura', people: [{ name: 'Ana Prueba', person_id: id }] }] },
      '2026-10-13',
    );
    expect(week?.parts[0]?.people[0]?.name).toBe('Ana Prueba');
  });

  it('treats a discurso with no type and no title as absent', () => {
    expect(sanitizeWeekend({ discurso: { tipo: '  ', titulo: null } }, '2026-10-17')?.discurso).toBeNull();
  });

  it('reads discursantes salientes as names and counts them as content', () => {
    const m = sanitizeWeekend(
      { discursantesSalientes: ['Persona 1', { name: ' Persona 2 ', person_id: 'x' }, '', null] },
      '2026-10-17',
    );
    expect(m?.discursantesSalientes).toEqual(['Persona 1', 'Persona 2']);
    expect(m && weekendHasContent(m)).toBe(true);
    expect(sanitizeWeekend({}, '2026-10-17')?.discursantesSalientes).toEqual([]);
  });

  it('reads hospitalidad as trimmed text and counts it as content', () => {
    const m = sanitizeWeekend({ hospitalidad: '  Grupo 3 ' }, '2026-10-17');
    expect(m?.hospitalidad).toBe('Grupo 3');
    expect(m && weekendHasContent(m)).toBe(true);
    expect(sanitizeWeekend({}, '2026-10-17')?.hospitalidad).toBeNull();
  });
});

describe('programa grouping', () => {
  it('groups parts by section in the programme order, without empty sections', () => {
    const week = sanitizeMidweek(
      {
        parts: [
          { time: '19:40', title: 'Vida 1', section: 'vida' },
          { time: '19:00', title: 'Inicio', section: 'inicio' },
          { time: '19:10', title: 'Tesoro 1', section: 'tesoros' },
          { time: '19:45', title: 'Vida 2', section: 'vida' },
        ],
      },
      '2026-10-13',
    );
    const groups = groupParts(week?.parts ?? []);
    expect(groups.map((g) => g.section)).toEqual(['inicio', 'tesoros', 'vida']);
    expect(groups[2]?.parts.map((p) => p.title)).toEqual(['Vida 1', 'Vida 2']);
  });

  it('gives a colour marker only to the three sections that have one', () => {
    expect(SECTION_ORDER.filter((s) => SECTION_COLOR[s])).toEqual(['tesoros', 'maestros', 'vida']);
    expect(SECTION_COLOR.tesoros).toBe('#626262');
    expect(SECTION_COLOR.maestros).toBe('#C18626');
    expect(SECTION_COLOR.vida).toBe('#961526');
  });
});

describe('mis partes', () => {
  const midweek = sanitizeMidweek(
    {
      date: '2026-10-13',
      parts: [
        {
          time: '19:06',
          title: 'Canción y oración',
          section: 'inicio',
          people: [{ name: 'Hermano Ejemplo', role: 'Presidente' }],
        },
        {
          time: '19:20',
          title: 'Tesoro 1',
          section: 'tesoros',
          people: [{ name: 'Ana Prueba' }],
        },
      ],
    },
    '2026-10-13',
  );
  const weekend = sanitizeWeekend(
    { date: '2026-10-17', conductor: 'Bruno Prueba', presidente: 'Hermano Ejemplo' },
    '2026-10-17',
  );

  it('pins the parts where the chosen name appears, with day and time', () => {
    const parts: MyPart[] = myParts(midweek, weekend, 'ana prueba');
    expect(parts).toEqual([
      {
        key: 'entre-semana-tesoros-19:20-Tesoro 1',
        day: 'Martes 13',
        time: '19:20',
        title: 'Tesoro 1',
        role: null,
      },
    ]);
  });

  it('matches accent- and case-insensitively and includes weekend roles', () => {
    const parts = myParts(midweek, weekend, 'bruno prueba');
    expect(parts).toEqual([
      {
        key: 'fin-de-semana-Conductor',
        day: 'Sábado 17',
        time: null,
        title: 'Reunión del fin de semana',
        role: 'Conductor',
      },
    ]);
    expect(myParts(midweek, weekend, 'hermano ejempl')).toHaveLength(2);
  });

  it('shows nothing while no name is chosen', () => {
    expect(myParts(midweek, weekend, '')).toEqual([]);
    expect(myParts(null, null, 'Ana')).toEqual([]);
  });
});

describe('?semana param', () => {
  it('normalises any date of the week to its Monday', () => {
    expect(parseSemanaParam('2026-10-17', new Date(2026, 0, 1))).toBe('2026-10-12');
    expect(parseSemanaParam('2026-10-12', new Date(2026, 0, 1))).toBe('2026-10-12');
  });

  it('falls back to this week for a missing or malformed value', () => {
    expect(parseSemanaParam(null, new Date(2026, 9, 16))).toBe('2026-10-12');
    expect(parseSemanaParam('hoy', new Date(2026, 9, 16))).toBe('2026-10-12');
    expect(parseSemanaParam('2026-99-99', new Date(2026, 9, 16))).toBe('2026-10-12');
  });
});

describe('shortRange', () => {
  it('names the month once inside one month and twice across months', () => {
    expect(shortRange('2026-10-12', '2026-10-18')).toBe('12–18 oct');
    expect(shortRange('2026-09-28', '2026-10-04')).toBe('28 sep – 4 oct');
    expect(shortRange('2026-12-28', '2027-01-03')).toBe('28 dic – 3 ene');
  });
});
