import { describe, it, expect } from 'vitest';
import { normalizeHeading } from '../heading';

describe('normalizeHeading', () => {
  it('keeps values already in range', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(359.9)).toBeCloseTo(359.9);
  });
  it('wraps 360 to 0 and beyond', () => {
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(450)).toBe(90);
  });
  it('wraps negatives', () => {
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(-360)).toBe(0);
  });
});
