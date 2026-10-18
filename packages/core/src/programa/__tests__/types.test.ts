import { describe, it, expect } from 'vitest';
import { personLink, personName, storePerson } from '../types';

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
