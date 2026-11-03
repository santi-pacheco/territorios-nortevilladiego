import { describe, expect, it } from 'vitest';
import { matchPerson, normalizePersonName, type MatchablePerson } from './names';

const people: MatchablePerson[] = [
  { id: '1', name: 'Ana María Pérez García' },
  { id: '2', name: 'José Luis Gómez', aliases: ['Pepe Gómez'] },
  { id: '3', name: 'Ana Pérez' },
  { id: '4', name: 'Carlos Ruiz' },
  { id: '5', name: 'Carla Ruiz' },
  { id: '6', name: 'María de la Cruz' },
];

const id = (raw: string) => {
  const m = matchPerson(raw, people);
  return m.status === 'matched' ? m.person.id : m.status;
};

describe('normalizePersonName', () => {
  it('moves "Surname, Name" to "Name Surname"', () => {
    expect(normalizePersonName('Pérez García, Ana María')).toBe('Ana María Pérez García');
    expect(normalizePersonName('  gómez ,  josé   luis ')).toBe('José Luis Gómez');
  });
  it('rotates a leading CAPS surname', () => {
    expect(normalizePersonName('PÉREZ GARCÍA Ana María')).toBe('Ana María Pérez García');
    expect(normalizePersonName('DE LA CRUZ María')).toBe('María de la Cruz');
  });
  it('title-cases uniform case only, keeping particles lower', () => {
    expect(normalizePersonName('MARÍA DE LA CRUZ')).toBe('María de la Cruz');
    expect(normalizePersonName('carlos ruiz')).toBe('Carlos Ruiz');
    expect(normalizePersonName('Carlos  McAllister')).toBe('Carlos McAllister');
  });
  it('collapses spaces and handles empties', () => {
    expect(normalizePersonName('  Ana   Pérez ')).toBe('Ana Pérez');
    expect(normalizePersonName('   ')).toBe('');
    expect(normalizePersonName(', ')).toBe('');
  });
});

describe('matchPerson', () => {
  it('matches case, accents and spacing', () => {
    expect(id('  ana   maria PEREZ garcia ')).toBe('1');
    expect(id('jose luis gomez')).toBe('2');
  });
  it('matches other word orders', () => {
    expect(id('Pérez García, Ana María')).toBe('1');
    expect(id('GÓMEZ José Luis')).toBe('2');
    expect(id('Gomez Jose Luis')).toBe('2');
  });
  it('matches an alias', () => {
    expect(id('Gómez, Pepe')).toBe('2');
  });
  it('matches initials', () => {
    expect(id('J. Gómez')).toBe('2');
    expect(id('Gómez, J.')).toBe('2');
    expect(id('A. M. Pérez García')).toBe('1');
  });
  it('prefers the exact person over a longer one', () => {
    expect(id('Ana Pérez')).toBe('3');
    expect(id('Pérez, Ana')).toBe('3');
  });
  it('is ambiguous when several people fit', () => {
    const m = matchPerson('C. Ruiz', people);
    expect(m.status).toBe('ambiguous');
    if (m.status === 'ambiguous') expect(m.candidates.map((p) => p.id)).toEqual(['4', '5']);
  });
  it('accepts a shorter form of a longer name when unique', () => {
    expect(id('Jose Gomez')).toBe('2');
    expect(id('María Cruz')).toBe('6');
  });
  it('never matches on a single loose word or an unknown name', () => {
    expect(id('Ana')).toBe('none');
    expect(id('Luis Fernández')).toBe('none');
    expect(id('')).toBe('none');
  });
});
