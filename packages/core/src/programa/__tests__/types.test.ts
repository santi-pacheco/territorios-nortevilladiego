import { describe, it, expect } from 'vitest';
import {
  formatSaliente,
  parseSalienteText,
  personLink,
  personName,
  readSaliente,
  readSalientes,
  storePerson,
  storeSaliente,
} from '../types';

const ID = '0f8b3c2a-1d4e-4f6a-8b9c-0123456789ab';

describe('personName', () => {
  it('lee el texto legado', () => {
    expect(personName('  Ana Pérez ')).toBe('Ana Pérez');
  });
  it('lee el objeto vinculado', () => {
    expect(personName({ name: ' Ana Pérez', person_id: ID })).toBe('Ana Pérez');
  });
  it('devuelve vacío para cualquier otra cosa', () => {
    expect(personName(null)).toBe('');
    expect(personName(3)).toBe('');
    expect(personName({ person_id: ID })).toBe('');
    expect(personName(['Ana'])).toBe('');
  });
});

describe('personLink', () => {
  it('devuelve el id de un objeto vinculado', () => {
    expect(personLink({ name: 'Ana', person_id: ID })).toBe(ID);
  });
  it('null para texto legado, sin id o id mal formado', () => {
    expect(personLink('Ana')).toBeNull();
    expect(personLink({ name: 'Ana' })).toBeNull();
    expect(personLink({ name: 'Ana', person_id: 'not-a-uuid' })).toBeNull();
    expect(personLink({ name: 'Ana', person_id: 42 })).toBeNull();
  });
});

describe('storePerson', () => {
  it('guarda {name, person_id} cuando está vinculado', () => {
    expect(storePerson(' Ana ', ID)).toEqual({ name: 'Ana', person_id: ID });
  });
  it('guarda el nombre solo cuando no está vinculado (forma legada)', () => {
    expect(storePerson('Ana', null)).toBe('Ana');
    expect(storePerson('Ana', undefined)).toBe('Ana');
  });
  it('null cuando no hay nombre', () => {
    expect(storePerson('  ', ID)).toBeNull();
  });
});

describe('discursantes salientes', () => {
  it('formatea Nombre - Congregación', () => {
    expect(formatSaliente({ name: 'Ana', congregacion: 'Villa Sur' })).toBe('Ana - Villa Sur');
    expect(formatSaliente({ name: 'Ana', congregacion: null })).toBe('Ana');
  });
  it('lee el texto del PDF', () => {
    expect(parseSalienteText('Ana Pérez – Congre Villa Sur')).toEqual({ name: 'Ana Pérez', congregacion: 'Villa Sur' });
    expect(parseSalienteText('Ana Pérez')).toEqual({ name: 'Ana Pérez', congregacion: null });
    expect(parseSalienteText('  ')).toBeNull();
  });
  it('migra las formas viejas al leer', () => {
    expect(readSaliente('Ana')).toEqual({ name: 'Ana', congregacion: null });
    expect(readSaliente({ name: 'Ana', person_id: ID })).toEqual({ name: 'Ana', congregacion: null, person_id: ID });
    expect(readSaliente({ name: 'Ana', person_id: ID, congregacion: ' Norte ' })).toEqual({
      name: 'Ana',
      congregacion: 'Norte',
      person_id: ID,
    });
    expect(readSaliente({ congregacion: 'Norte' })).toBeNull();
  });
  it('readSalientes: lista actual, lista legada o discurso.saliente', () => {
    expect(readSalientes({ discursantesSalientes: ['Ana', { name: 'Luis', congregacion: 'Sur' }, 3] })).toEqual([
      { name: 'Ana', congregacion: null },
      { name: 'Luis', congregacion: 'Sur' },
    ]);
    expect(readSalientes({ discurso: { saliente: 'Ana – Congre Sur' } })).toEqual([{ name: 'Ana', congregacion: 'Sur' }]);
    expect(readSalientes({ discursantesSalientes: [], discurso: { saliente: 'Ana – Congre Sur' } })).toEqual([
      { name: 'Ana', congregacion: 'Sur' },
    ]);
    expect(readSalientes({ discursantesSalientes: ['Luis'], discurso: { saliente: 'Ana' } })).toEqual([
      { name: 'Luis', congregacion: null },
    ]);
    expect(readSalientes({})).toEqual([]);
  });
  it('storeSaliente guarda congregación libre y el vínculo', () => {
    expect(storeSaliente(' Ana ', ID, ' lo que sea 123 ')).toEqual({ name: 'Ana', congregacion: 'lo que sea 123', person_id: ID });
    expect(storeSaliente('Ana', null, '  ')).toEqual({ name: 'Ana', congregacion: null });
    expect(storeSaliente(' ', ID, 'x')).toBeNull();
  });
});
