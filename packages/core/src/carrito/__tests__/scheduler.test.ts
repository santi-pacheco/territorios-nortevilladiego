import { describe, it, expect } from 'vitest';
import { generateSchedule } from '../scheduler';
import type { Person, TimeSlot } from '../types';

const SLOT: TimeSlot = {
  id: 'slot-1', placeId: 'place-1', dayOfWeek: 2, startTime: '09:00', endTime: '11:00', groupSize: 1,
};

function person(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id, name: id, gender: 'F', availableSlotIds: [SLOT.id],
    mustBeWithIds: [], targetAppearances: 1, ...overrides,
  };
}

describe('generateSchedule — fairness', () => {
  it('gives each of 3 people exactly one appearance in a groupSize-1 slot over 3 weeks', () => {
    const people = [person('a'), person('b'), person('c')];
    const { config, warnings } = generateSchedule(
      people, [SLOT], '2026-09-01', '2026-09-21', 'Test', []
    );
    expect(warnings).toEqual([]);
    expect(config.entries).toHaveLength(3); // Tue 1, 8, 15 Sep fall in range
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (const e of config.entries) for (const id of e.personIds) counts[id] = (counts[id] ?? 0) + 1;
    expect(counts).toEqual({ a: 1, b: 1, c: 1 });
  });
});

describe('generateSchedule — mustBeWith', () => {
  it('drops a person whose required partner is not eligible for the slot, with a warning', () => {
    const withPartner = person('with-partner', { mustBeWithIds: ['missing-partner'] });
    const missing = person('missing-partner', { availableSlotIds: [] }); // not eligible for SLOT
    const filler = person('filler');
    const { config, warnings } = generateSchedule(
      [withPartner, missing, filler], [SLOT], '2026-09-01', '2026-09-07', 'Test', []
    );
    expect(warnings.some((w) => w.includes('with-partner') && w.includes('missing-partner'))).toBe(true);
    for (const e of config.entries) expect(e.personIds).not.toContain('with-partner');
  });

  it('keeps a mustBeWith pair together when both are eligible', () => {
    const a = person('a', { mustBeWithIds: ['b'] });
    const b = person('b', { mustBeWithIds: ['a'] });
    const slot = { ...SLOT, groupSize: 2 };
    const { config } = generateSchedule([a, b], [slot], '2026-09-01', '2026-09-07', 'Test', []);
    expect(config.entries).toHaveLength(1);
    expect(config.entries[0]!.personIds.slice().sort()).toEqual(['a', 'b']);
  });
});

describe('generateSchedule — gender rule', () => {
  it('force-fills a gender-invalid group in fallback and warns about it', () => {
    const slot = { ...SLOT, groupSize: 3 };
    const people = [
      person('f1', { gender: 'F' }),
      person('f2', { gender: 'F' }),
      person('m1', { gender: 'M' }), // minority male, no mustBeWith link to a female
    ];
    const { config, warnings } = generateSchedule(people, [slot], '2026-09-01', '2026-09-07', 'Test', []);
    expect(config.entries[0]!.personIds.slice().sort()).toEqual(['f1', 'f2', 'm1']);
    expect(warnings.some((w) => w.includes('rompiendo regla de género'))).toBe(true);
  });

  it('allows a balanced 1M+1F group without warnings', () => {
    const slot = { ...SLOT, groupSize: 2 };
    const people = [person('f1', { gender: 'F' }), person('m1', { gender: 'M' })];
    const { config, warnings } = generateSchedule(people, [slot], '2026-09-01', '2026-09-07', 'Test', []);
    expect(config.entries[0]!.personIds.slice().sort()).toEqual(['f1', 'm1']);
    expect(warnings).toEqual([]);
  });
});

describe('generateSchedule — blackouts', () => {
  it('skips a slot occurrence blacked out for that specific date', () => {
    const people = [person('a')];
    const { config } = generateSchedule(
      people, [SLOT], '2026-09-01', '2026-09-08', 'Test',
      [{ id: 'bo-1', slotId: SLOT.id, date: '2026-09-01' }]
    );
    expect(config.entries).toHaveLength(1);
    expect(config.entries[0]!.weekDate).toBe('2026-09-07');
  });
});

describe('generateSchedule — date range', () => {
  it('only includes slot dates within [startDate, endDate], clamping the week label to startDate', () => {
    const people = [person('a')];
    // SLOT is Tuesday (dayOfWeek 2). Range covers a single Tuesday: 2026-09-08.
    const { config } = generateSchedule(people, [SLOT], '2026-09-05', '2026-09-11', 'Test', []);
    expect(config.entries).toHaveLength(1);
    expect(config.entries[0]!.weekLabel).toBe('7 de septiembre');
  });
});
