import { describe, expect, it } from 'vitest';
import { displayTime, minutesOf } from './week';

describe('times', () => {
  it('reads common forms', () => {
    expect(minutesOf('9:30')).toBe(570);
    expect(minutesOf('09.30')).toBe(570);
    expect(minutesOf('17 hs')).toBe(1020);
  });
  it('treats a trailing colon as on the hour', () => {
    expect(minutesOf('17:')).toBe(1020);
    expect(displayTime('17:')).toBe('17:00');
  });
  it('pads and keeps unreadable text', () => {
    expect(displayTime('9:30')).toBe('09:30');
    expect(displayTime('A confirmar')).toBe('A confirmar');
  });
});
