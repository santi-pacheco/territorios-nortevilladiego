import { describe, expect, it } from 'vitest';
import { groupsLabel } from './StationLine';

describe('groupsLabel', () => {
  it('uses the singular for one group', () => expect(groupsLabel('2')).toBe('Grupo 2'));
  it('uses the plural for several groups', () => expect(groupsLabel('1 y 2')).toBe('Grupos 1 y 2'));
  it('keeps free text', () => expect(groupsLabel('Todos')).toBe('Todos'));
});
