import { describe, expect, it } from 'vitest';
import { normalizeReason, scopeTargets, toBlock, toUnblock } from './blackouts';

const slots = [
  { id: 's1', iso_dow: 2 },
  { id: 's2', iso_dow: 4 },
];

describe('normalizeReason', () => {
  it('trims, caps at 60 and maps empty to null', () => {
    expect(normalizeReason('  Asamblea ')).toBe('Asamblea');
    expect(normalizeReason('   ')).toBeNull();
    expect(normalizeReason('x'.repeat(80))).toHaveLength(60);
  });
});

describe('scopeTargets', () => {
  it('covers every turn of a week', () => {
    expect(scopeTargets({ weekDate: '2026-10-12' }, slots, '2026-10-01', '2026-10-31')).toEqual([
      { slot_id: 's1', date: '2026-10-13' },
      { slot_id: 's2', date: '2026-10-15' },
    ]);
  });

  it('covers one turn, found from a clipped week anchor', () => {
    // The first week is anchored on the range start (Thursday 1 Oct), not its Monday.
    expect(
      scopeTargets({ weekDate: '2026-10-01', slotId: 's2' }, slots, '2026-10-01', '2026-10-31'),
    ).toEqual([{ slot_id: 's2', date: '2026-10-01' }]);
  });

  it('drops turns outside the period', () => {
    expect(scopeTargets({ weekDate: '2026-10-01' }, slots, '2026-10-01', '2026-10-31')).toEqual([
      { slot_id: 's2', date: '2026-10-01' },
    ]);
  });
});

describe('toBlock / toUnblock', () => {
  const targets = [
    { slot_id: 's1', date: '2026-10-13' },
    { slot_id: 's2', date: '2026-10-15' },
  ];
  const existing = [{ slot_id: 's1', date: '2026-10-13', id: 'b1' }];

  it('skips turns that are already blocked', () => {
    expect(toBlock(targets, existing)).toEqual([{ slot_id: 's2', date: '2026-10-15' }]);
  });

  it('finds the blackouts to remove', () => {
    expect(toUnblock(targets, existing)).toEqual(existing);
    expect(toUnblock([{ slot_id: 's2', date: '2026-10-15' }], existing)).toEqual([]);
  });
});
