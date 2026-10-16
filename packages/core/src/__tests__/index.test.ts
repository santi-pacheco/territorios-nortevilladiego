import { describe, it, expect } from 'vitest';

describe('public API', () => {
  it('imports without a DOM (kml defers DOMParser to call time)', async () => {
    const core = await import('../index');
    expect(typeof core.loadTerritories).toBe('function');
    expect(typeof core.generateSchedule).toBe('function');
    expect(typeof core.parseMidweekPages).toBe('function');
    expect(typeof core.defaultData).toBe('function');
  });
});
