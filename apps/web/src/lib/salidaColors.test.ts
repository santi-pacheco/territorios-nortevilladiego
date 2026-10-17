import { describe, expect, it } from 'vitest';
import type { ServiceMeetingRow } from '@territorios/data';
import { SALIDA_COLORS, dayColors } from './salidaColors';

const meeting = (id: string, time: string, ids: number[], groups = {}): ServiceMeetingRow =>
  ({
    id,
    start_time: time,
    position: 0,
    territory_ids: ids,
    group_territories: groups,
  }) as unknown as ServiceMeetingRow;

describe('dayColors', () => {
  it('gives each salida its own colour in time order', () => {
    const { byKey, byTerritory } = dayColors([
      meeting('late', '17:00', [10]),
      meeting('early', '09:30', [18]),
    ]);
    expect(byKey.get('early')).toBe(SALIDA_COLORS[0]);
    expect(byKey.get('late')).toBe(SALIDA_COLORS[1]);
    expect(byTerritory.get(18)).toBe(SALIDA_COLORS[0]);
    expect(byTerritory.get(10)).toBe(SALIDA_COLORS[1]);
  });

  it('colours each Domingo group separately', () => {
    const { byKey } = dayColors([meeting('dom', '09:45', [], { G1: [1], G2: [2] })]);
    expect(byKey.get('dom:G1')).toBe(SALIDA_COLORS[0]);
    expect(byKey.get('dom:G2')).toBe(SALIDA_COLORS[1]);
  });

  it('keeps the earlier salida colour when two share a territory', () => {
    const { byTerritory } = dayColors([meeting('a', '09:00', [5]), meeting('b', '17:00', [5])]);
    expect(byTerritory.get(5)).toBe(SALIDA_COLORS[0]);
  });
});
