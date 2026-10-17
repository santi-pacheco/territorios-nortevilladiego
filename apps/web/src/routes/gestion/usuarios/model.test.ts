import { describe, expect, it } from 'vitest';
import type { AccountRow } from '../../../lib/accounts';
import { filterPeople, sortAccounts } from './model';

const people = [{ name: 'Ana Prueba' }, { name: 'José Pérez' }, { name: 'Ana Ejemplo' }];

describe('gestión usuarios model', () => {
  it('filters people by word prefixes, ignoring accents and case', () => {
    expect(filterPeople(people, 'ana pr').map((p) => p.name)).toEqual(['Ana Prueba']);
    expect(filterPeople(people, 'jose PER').map((p) => p.name)).toEqual(['José Pérez']);
    expect(filterPeople(people, '  ')).toHaveLength(3);
  });

  it('lists unlinked accounts first', () => {
    const row = (user_id: string, display_name: string, person_id: string | null): AccountRow => ({
      user_id, display_name, person_id, email: null, avatar_url: null, provider: 'google', role: 'viewer', person_name: null, created_at: '',
      can_edit_programa: false, can_edit_privilegios: false,
    });
    const sorted = sortAccounts([row('1', 'Beto', 'p'), row('2', 'Zoe', null), row('3', 'Abel', null)]);
    expect(sorted.map((r) => r.user_id)).toEqual(['3', '2', '1']);
  });
});
