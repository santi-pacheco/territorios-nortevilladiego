import { describe, it, expect } from 'vitest';
import { generateSchedule } from '../scheduler';
import type { Person, TimeSlot, Place } from '../types';

const SLOT: TimeSlot = {
  id: 'slot-1', placeId: 'place-1', dayOfWeek: 2, startTime: '09:00', endTime: '11:00', groupSize: 1,
};

const PLACES: Place[] = [{ id: 'place-1', name: 'Lugar Uno', color: '#000' }];

function person(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id, name: id, gender: 'F', availableSlotIds: [SLOT.id],
    mustBeWithIds: [], targetAppearances: 1, ...overrides,
  };
}

function countAppearances(entries: { personIds: string[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) for (const id of e.personIds) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

describe('generateSchedule — fairness', () => {
  it('gives each of 3 people exactly one appearance in a groupSize-1 slot over 3 weeks', () => {
    const people = [person('a'), person('b'), person('c')];
    const { config, warnings } = generateSchedule(
      people, [SLOT], '2026-09-01', '2026-09-21', 'Test', []
    );
    expect(warnings).toEqual([]);
    expect(config.entries).toHaveLength(3); // Tue 1, 8, 15 Sep fall in range
    expect(countAppearances(config.entries)).toEqual({ a: 1, b: 1, c: 1 });
  });
});

describe('scheduler.deterministic-with-seed', () => {
  it('produces byte-identical output for the same numeric seed', () => {
    const people = ['a', 'b', 'c', 'd', 'e'].map((id) => person(id, { targetAppearances: 0 }));
    const slots: TimeSlot[] = [{ ...SLOT, groupSize: 2 }];
    const first = generateSchedule(people, slots, '2026-09-01', '2026-10-05', 'Test', [], 12345);
    const second = generateSchedule(people, slots, '2026-09-01', '2026-10-05', 'Test', [], 12345);
    expect(second.config).toEqual(first.config);
    expect(second.warnings).toEqual(first.warnings);
    expect(first.config.entries.length).toBeGreaterThan(0);
  });

  it('accepts the seed through an options object as well', () => {
    const people = ['a', 'b', 'c', 'd', 'e'].map((id) => person(id, { targetAppearances: 0 }));
    const slots: TimeSlot[] = [{ ...SLOT, groupSize: 2 }];
    const asNumber = generateSchedule(people, slots, '2026-09-01', '2026-10-05', 'Test', [], 7);
    const asOptions = generateSchedule(
      people, slots, '2026-09-01', '2026-10-05', 'Test', [], { seed: 7 }
    );
    expect(asOptions.config).toEqual(asNumber.config);
    expect(asOptions.warnings).toEqual(asNumber.warnings);
  });

  it('is reproducible when no seed is supplied (still returns a schedule)', () => {
    const people = [person('a'), person('b')];
    const { config } = generateSchedule(people, [SLOT], '2026-09-01', '2026-09-14', 'Test', []);
    expect(config.entries).toHaveLength(2);
  });
});

describe('scheduler.pairs-never-split', () => {
  it('keeps an undirected pair together whichever person lists the other', () => {
    for (const order of [['a', 'b'], ['b', 'a']] as const) {
      const byId: Record<string, Person> = {
        a: person('a', { mustBeWithIds: ['b'] }), // only a → b, one-directional
        b: person('b'),
      };
      const slot = { ...SLOT, id: 'slot-1', groupSize: 2 };
      const { config } = generateSchedule(order.map((id) => byId[id]!), [slot], '2026-09-01', '2026-09-07', 'Test', []);
      expect(config.entries).toHaveLength(1);
      expect(config.entries[0]!.personIds.slice().sort()).toEqual(['a', 'b']);
    }
  });

  it('does not send the listed partner alone when the lister is unavailable', () => {
    // a → b only; a is not available for the slot, so b must not go alone either.
    const a = person('a', { mustBeWithIds: ['b'], availableSlotIds: [] });
    const b = person('b');
    const c = person('c');
    const slot = { ...SLOT, groupSize: 1 };
    const { config } = generateSchedule([a, b, c], [slot], '2026-09-01', '2026-09-07', 'Test', [], 7);
    for (const e of config.entries) expect(e.personIds).not.toContain('b');
  });

  it('never splits a pair when a competitor could otherwise take a seat', () => {
    for (const order of [['a', 'b', 'c'], ['c', 'b', 'a']] as const) {
      const byId: Record<string, Person> = {
        a: person('a'),
        b: person('b', { mustBeWithIds: ['a'] }), // only b → a
        c: person('c'),
      };
      const slot = { ...SLOT, groupSize: 2 };
      const { config } = generateSchedule(
        order.map((id) => byId[id]!), [slot], '2026-09-01', '2026-09-07', 'Test', []
      );
      for (const e of config.entries) {
        expect(e.personIds.includes('a')).toBe(e.personIds.includes('b'));
      }
    }
  });

  it('drops the partner too when a must-be-with member becomes ineligible (both directions)', () => {
    for (const order of [['a', 'b', 'filler'], ['filler', 'b', 'a']] as const) {
      const byId: Record<string, Person> = {
        a: person('a', { mustBeWithIds: ['b', 'ghost'] }), // ghost not eligible → a removed
        b: person('b'),                                      // lists nobody, but is a's partner
        filler: person('filler'),
        ghost: person('ghost', { availableSlotIds: [] }),
      };
      const { config } = generateSchedule(
        order.map((id) => byId[id]!), [SLOT], '2026-09-01', '2026-09-07', 'Test', []
      );
      for (const e of config.entries) {
        expect(e.personIds).not.toContain('a');
        expect(e.personIds).not.toContain('b');
      }
    }
  });

  it('warns and keeps the pair out when neither can be assigned', () => {
    const withPartner = person('with-partner', { mustBeWithIds: ['missing-partner'] });
    const missing = person('missing-partner', { availableSlotIds: [] }); // not eligible for SLOT
    const filler = person('filler');
    const { config, warnings } = generateSchedule(
      [withPartner, missing, filler], [SLOT], '2026-09-01', '2026-09-07', 'Test', []
    );
    expect(warnings.some((w) => w.includes('with-partner') && w.includes('missing-partner'))).toBe(true);
    for (const e of config.entries) expect(e.personIds).not.toContain('with-partner');
  });
});

describe('scheduler.no-double-booking', () => {
  it('never assigns the same person to two slots on the same date', () => {
    const slotA: TimeSlot = { id: 'am', placeId: 'place-1', dayOfWeek: 4, startTime: '08:30', endTime: '09:30', groupSize: 1 };
    const slotB: TimeSlot = { id: 'pm', placeId: 'place-1', dayOfWeek: 4, startTime: '09:30', endTime: '11:00', groupSize: 1 };
    const people = ['p1', 'p2', 'p3', 'p4'].map((id) =>
      person(id, { availableSlotIds: ['am', 'pm'], targetAppearances: 0 })
    );
    // 2026-09-07 is a Monday; three Thursdays fall inside the range.
    const { config } = generateSchedule(people, [slotA, slotB], '2026-09-07', '2026-09-28', 'Test', [], 99);
    expect(config.entries).toHaveLength(6);

    const byDate = new Map<string, Set<string>>();
    for (const e of config.entries) {
      const seen = byDate.get(e.weekDate) ?? new Set<string>();
      for (const id of e.personIds) {
        expect(seen.has(id)).toBe(false); // same person twice on one date → double booking
        seen.add(id);
      }
      byDate.set(e.weekDate, seen);
    }
    // Each of the three weeks filled both am and pm with two distinct people.
    expect(byDate.size).toBe(3);
    for (const seen of byDate.values()) expect(seen.size).toBe(2);
  });
});

describe('scheduler.gender-rule', () => {
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

  it('allows an all-same-gender group without warnings', () => {
    const slot = { ...SLOT, groupSize: 2 };
    const people = [person('f1', { gender: 'F' }), person('f2', { gender: 'F' })];
    const { config, warnings } = generateSchedule(people, [slot], '2026-09-01', '2026-09-07', 'Test', []);
    expect(config.entries[0]!.personIds.slice().sort()).toEqual(['f1', 'f2']);
    expect(warnings.some((w) => w.includes('regla de género'))).toBe(false);
  });

  it('accepts a minority member linked (must-be-with) to a majority member', () => {
    const slot = { ...SLOT, groupSize: 3 };
    const people = [
      person('f1', { gender: 'F' }),
      person('f2', { gender: 'F' }),
      person('m1', { gender: 'M', mustBeWithIds: ['f1'] }), // undirected link to a majority female
    ];
    const { config, warnings } = generateSchedule(people, [slot], '2026-09-01', '2026-09-07', 'Test', []);
    expect(config.entries[0]!.personIds.slice().sort()).toEqual(['f1', 'f2', 'm1']);
    expect(warnings.some((w) => w.includes('rompiendo regla de género'))).toBe(false);
  });
});

describe('scheduler.unlimited-target', () => {
  it('treats targetAppearances <= 0 as unlimited (never deprioritised after a normal target)', () => {
    const people = [
      person('limited', { targetAppearances: 1 }),
      person('unlimited', { targetAppearances: 0 }),
    ];
    const { config } = generateSchedule(people, [SLOT], '2026-09-01', '2026-09-28', 'Test', [], 5);
    expect(config.entries).toHaveLength(4);
    expect(countAppearances(config.entries)).toEqual({ limited: 1, unlimited: 3 });
  });

  it('treats a negative target as unlimited too', () => {
    const people = [
      person('limited', { targetAppearances: 1 }),
      person('unlimited', { targetAppearances: -5 }),
    ];
    const { config } = generateSchedule(people, [SLOT], '2026-09-01', '2026-09-28', 'Test', [], 5);
    expect(config.entries).toHaveLength(4);
    expect(countAppearances(config.entries)).toEqual({ limited: 1, unlimited: 3 });
  });
});

describe('scheduler.warnings', () => {
  it('renders readable Spanish warnings with day, time and place', () => {
    const slot: TimeSlot = { id: 'slot-1', placeId: 'place-1', dayOfWeek: 4, startTime: '08:30', endTime: '09:30', groupSize: 3 };
    const people = [person('solo')];
    const { warnings } = generateSchedule(
      people, [slot], '2026-09-01', '2026-09-07', 'Test', [], { seed: 1, places: PLACES }
    );
    expect(warnings).toEqual(['Jueves 08:30, Lugar Uno: faltan 2 publicadores']);
  });

  it('deduplicates the same message across weeks, collapsing to one with a count', () => {
    const slot: TimeSlot = { id: 'slot-1', placeId: 'place-1', dayOfWeek: 4, startTime: '08:30', endTime: '09:30', groupSize: 3 };
    const people = [person('solo')];
    // Three consecutive Thursdays: 2026-09-03, 09-10, 09-17.
    const { warnings } = generateSchedule(
      people, [slot], '2026-09-01', '2026-09-21', 'Test', [], { seed: 1, places: PLACES }
    );
    expect(warnings).toEqual(['Jueves 08:30, Lugar Uno: faltan 2 publicadores (×3)']);
  });

  it('reports a single missing publisher in the singular-of-one style', () => {
    const slot: TimeSlot = { id: 'slot-1', placeId: 'place-1', dayOfWeek: 4, startTime: '08:30', endTime: '09:30', groupSize: 2 };
    const people = [person('solo')];
    const { warnings } = generateSchedule(
      people, [slot], '2026-09-01', '2026-09-07', 'Test', [], { seed: 1, places: PLACES }
    );
    expect(warnings).toEqual(['Jueves 08:30, Lugar Uno: faltan 1 publicadores']);
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
