import { describe, it, expect, beforeEach } from 'vitest';
import { defaultData, loadData, saveData, STORAGE_KEY } from '../store';

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  } as unknown as Storage;
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = makeMemoryStorage();
});

describe('defaultData', () => {
  it('ships a non-empty seed of places/slots/people', () => {
    const d = defaultData();
    expect(d.places.length).toBeGreaterThan(0);
    expect(d.slots.length).toBeGreaterThan(0);
    expect(d.people.length).toBeGreaterThan(0);
    expect(d.schedule).toBeNull();
    expect(d.blackouts).toEqual([]);
  });

  it('every seed person only references existing slot ids', () => {
    const d = defaultData();
    const slotIds = new Set(d.slots.map((s) => s.id));
    for (const p of d.people) {
      for (const sid of p.availableSlotIds) expect(slotIds.has(sid)).toBe(true);
    }
  });

  it('every seed slot only references an existing place id', () => {
    const d = defaultData();
    const placeIds = new Set(d.places.map((p) => p.id));
    for (const s of d.slots) expect(placeIds.has(s.placeId)).toBe(true);
  });
});

describe('loadData / saveData', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadData()).toEqual(defaultData());
  });

  it('round-trips a saved value', () => {
    const d = { ...defaultData(), blackouts: [{ id: 'bo-1', slotId: 's1', date: '2026-01-01' }] };
    saveData(d);
    expect(loadData()).toEqual(d);
  });

  it('falls back to defaults on corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadData()).toEqual(defaultData());
  });
});
