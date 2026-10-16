import { describe, it, expect } from 'vitest';
import { colorForDow } from '../salidasColors';

describe('colorForDow', () => {
  it('has a color for every weekday 0..6', () => {
    for (let dow = 0; dow < 7; dow++) {
      const c = colorForDow(dow);
      expect(c.label).toMatch(/^[A-ZÁÉÍ]+$/);
      expect(c.header).toMatch(/^#/);
    }
  });
  it('keeps existing Miércoles color', () => {
    expect(colorForDow(3).header).toBe('#b3b3b3');
  });
});
