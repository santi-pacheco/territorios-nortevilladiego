import { describe, expect, it } from 'vitest';
import type { NameSource } from '@territorios/data';
import { describeSource, filterPeople, mergeAlias, removeAlias, toggleDuty, unmatchedNames } from './model';

function source(name: string, uses: number, personId: string | null = null): NameSource {
  return {
    name,
    norm: name.toLowerCase(),
    sources: ['programa'],
    uses,
    first_date: '2026-09-01',
    last_date: '2026-10-27',
    person_id: personId,
    person_name: personId ? 'Ana Prueba' : null,
  };
}

describe('unmatchedNames', () => {
  it('drops matched names and puts the most used first, then A–Z', () => {
    const list = [
      source('Zoe Ejemplo', 2),
      source('Ana Prueba', 9, '00000000-0000-4000-8000-000000000001'),
      source('Beto Ficticio', 5),
      source('Álvaro Demo', 2),
    ];
    expect(unmatchedNames(list).map((s) => s.name)).toEqual(['Beto Ficticio', 'Álvaro Demo', 'Zoe Ejemplo']);
  });
});

describe('mergeAlias', () => {
  it('appends a new trimmed spelling', () => {
    expect(mergeAlias('Ana Prueba', ['A. Prueba'], '  Anita   Prueba ')).toEqual(['A. Prueba', 'Anita Prueba']);
  });
  it('ignores empty input, the own name and repeats (accents and case ignored)', () => {
    expect(mergeAlias('Ana Prueba', [], '   ')).toBeNull();
    expect(mergeAlias('Ana Prueba', [], 'ana prueba')).toBeNull();
    expect(mergeAlias('Ana Prueba', ['Anita Pérez'], 'ANITA PEREZ')).toBeNull();
  });
  it('removeAlias drops exactly that spelling', () => {
    expect(removeAlias(['A. Prueba', 'Anita'], 'Anita')).toEqual(['A. Prueba']);
  });
});

describe('toggleDuty', () => {
  it('adds in column order and removes', () => {
    expect(toggleDuty(['acomodador'], 'computadora')).toEqual(['computadora', 'acomodador']);
    expect(toggleDuty(['computadora', 'sonido'], 'computadora')).toEqual(['sonido']);
  });
});

describe('filterPeople', () => {
  const people = [
    { name: 'Ana Prueba', aliases: [] },
    { name: 'Beto Ficticio', aliases: ['B. Ficticio'] },
  ];
  it('matches word prefixes of the name or an alias', () => {
    expect(filterPeople(people, 'an pru')).toEqual([people[0]]);
    expect(filterPeople(people, 'b. fic')).toEqual([people[1]]);
    expect(filterPeople(people, '')).toEqual(people);
  });
});

describe('describeSource', () => {
  it('summarises where, how often and when', () => {
    expect(describeSource({ ...source('X', 3), sources: ['programa', 'salida'] })).toEqual({
      where: 'Programa · Salidas',
      uses: '3 veces',
      when: 'del 1 sep al 27 oct',
    });
    expect(describeSource({ ...source('X', 1), last_date: '2026-09-01' }).when).toBe('el 1 sep');
  });
});
