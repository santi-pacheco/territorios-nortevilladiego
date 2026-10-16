import { describe, it, expect } from 'vitest';
import { inferGender } from '../gender';

describe('inferGender', () => {
  it('recognizes names from the explicit male/female lists', () => {
    expect(inferGender('Daniel Ficticio')).toBe('M');
    expect(inferGender('Rocio Ficticia')).toBe('F');
  });
  it('falls back to trailing -a / -o when the name is not listed', () => {
    expect(inferGender('Graciela Ficticia')).toBe('F');
    expect(inferGender('Gustavo Ficticio')).toBe('M');
  });
  it('returns null for ambiguous names', () => {
    expect(inferGender('Noel Sur')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(inferGender('')).toBeNull();
    expect(inferGender('   ')).toBeNull();
  });
});
