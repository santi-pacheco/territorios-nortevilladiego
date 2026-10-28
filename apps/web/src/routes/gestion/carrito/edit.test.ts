import { describe, expect, it } from 'vitest';
import type { ScheduleEntry } from '@territorios/core';
import type { CartAssignmentRow } from '@territorios/data';
import {
  entriesFromAssignments,
  movePerson,
  participation,
  setPersonAt,
  swapPeople,
} from './edit';

const label = (d: string) => `sem ${d}`;

function entry(weekDate: string, slotId: string, personIds: string[], note?: string): ScheduleEntry {
  return { weekDate, weekLabel: weekDate, slotId, personIds, ...(note ? { note } : {}) };
}

const W1 = '2026-10-05';
const W2 = '2026-10-12';

describe('movePerson', () => {
  it('moves a person to another turn without touching the input', () => {
    const before = [entry(W1, 'a', ['p1', 'p2']), entry(W1, 'b', ['p3'])];
    const after = movePerson(before, { weekDate: W1, slotId: 'a', personId: 'p1' }, { weekDate: W1, slotId: 'b' }, label);
    expect(after).toEqual([entry(W1, 'a', ['p2']), entry(W1, 'b', ['p3', 'p1'])]);
    expect(before[0]!.personIds).toEqual(['p1', 'p2']);
  });

  it('creates the target turn and prunes an emptied source (but keeps its note)', () => {
    const moved = movePerson(
      [entry(W1, 'a', ['p1']), entry(W1, 'c', ['p9'], 'trae mesa')],
      { weekDate: W1, slotId: 'a', personId: 'p1' },
      { weekDate: W2, slotId: 'a' },
      label,
    );
    expect(moved).toEqual([entry(W1, 'c', ['p9'], 'trae mesa'), { ...entry(W2, 'a', ['p1']), weekLabel: 'sem 2026-10-12' }]);
    const noted = movePerson(
      [entry(W1, 'a', ['p1'], 'nota')],
      { weekDate: W1, slotId: 'a', personId: 'p1' },
      { weekDate: W2, slotId: 'a' },
      label,
    );
    expect(noted!.find((e) => e.slotId === 'a' && e.weekDate === W1)).toMatchObject({ personIds: [], note: 'nota' });
  });

  it('treats a clipped first week and its Monday as the same turn', () => {
    const entries = [entry('2026-10-07', 'a', ['p1'])];
    expect(
      movePerson(entries, { weekDate: W1, slotId: 'a', personId: 'p1' }, { weekDate: '2026-10-07', slotId: 'a' }, label),
    ).toBe(entries);
  });

  it('refuses a stale source or a duplicate in the target', () => {
    const entries = [entry(W1, 'a', ['p1']), entry(W1, 'b', ['p1'])];
    expect(movePerson(entries, { weekDate: W1, slotId: 'a', personId: 'p1' }, { weekDate: W1, slotId: 'b' }, label)).toBeNull();
    expect(movePerson(entries, { weekDate: W1, slotId: 'a', personId: 'zz' }, { weekDate: W2, slotId: 'a' }, label)).toBeNull();
  });
});

describe('swapPeople', () => {
  it('exchanges two people across turns', () => {
    const out = swapPeople(
      [entry(W1, 'a', ['p1', 'p2']), entry(W2, 'b', ['p3'])],
      { weekDate: W1, slotId: 'a', personId: 'p2' },
      { weekDate: W2, slotId: 'b', personId: 'p3' },
    );
    expect(out).toEqual([entry(W1, 'a', ['p1', 'p3']), entry(W2, 'b', ['p2'])]);
  });

  it('reorders inside one turn', () => {
    const out = swapPeople(
      [entry(W1, 'a', ['p1', 'p2'])],
      { weekDate: W1, slotId: 'a', personId: 'p1' },
      { weekDate: W1, slotId: 'a', personId: 'p2' },
    );
    expect(out).toEqual([entry(W1, 'a', ['p2', 'p1'])]);
  });

  it('refuses when it would duplicate someone in a turn', () => {
    const out = swapPeople(
      [entry(W1, 'a', ['p1', 'p3']), entry(W2, 'b', ['p3'])],
      { weekDate: W1, slotId: 'a', personId: 'p1' },
      { weekDate: W2, slotId: 'b', personId: 'p3' },
    );
    expect(out).toBeNull();
  });
});

describe('setPersonAt', () => {
  it('replaces, appends and removes, never duplicating', () => {
    const base = [entry(W1, 'a', ['p1', 'p2'])];
    const cell = { weekDate: W1, slotId: 'a' };
    expect(setPersonAt(base, cell, 0, 'p3', label)[0]!.personIds).toEqual(['p3', 'p2']);
    expect(setPersonAt(base, cell, -1, 'p3', label)[0]!.personIds).toEqual(['p1', 'p2', 'p3']);
    expect(setPersonAt(base, cell, 0, 'p2', label)[0]!.personIds).toEqual(['p2']);
    expect(setPersonAt(base, cell, 1, null, label)[0]!.personIds).toEqual(['p1']);
    expect(setPersonAt(base, cell, 0, null, label).length).toBe(1);
    expect(setPersonAt([entry(W1, 'a', ['p1'])], cell, 0, null, label)).toEqual([]);
  });
});

describe('entriesFromAssignments', () => {
  it('maps published rows to editable entries', () => {
    const row = {
      week_date: W1,
      slot_id: 'a',
      person_ids: ['p1'],
      note: 'n',
    } as CartAssignmentRow;
    expect(entriesFromAssignments([row], label)).toEqual([
      { weekDate: W1, weekLabel: 'sem 2026-10-05', slotId: 'a', personIds: ['p1'], note: 'n' },
    ]);
  });
});

describe('participation', () => {
  const people = [
    { id: 'p1', name: 'Zulema' },
    { id: 'p2', name: 'Álvaro' },
    { id: 'p3', name: 'Ñandú' },
    { id: 'p4', name: 'Nora' },
    { id: 'p5', name: 'Beto' },
    { id: 'p6', name: 'Carla' },
  ];

  it('counts turns and sorts alphabetically with es-AR collation', () => {
    const { rows } = participation([entry(W1, 'a', ['p1', 'p2']), entry(W2, 'a', ['p1'])], people);
    expect(rows.map((r) => r.name)).toEqual(['Álvaro', 'Beto', 'Carla', 'Nora', 'Ñandú', 'Zulema']);
    expect(rows.find((r) => r.id === 'p1')!.count).toBe(2);
  });

  it('flags people with no turns', () => {
    const { rows } = participation([entry(W1, 'a', ['p1'])], people);
    expect(rows.find((r) => r.id === 'p2')).toMatchObject({ count: 0, flag: 'zero' });
    expect(rows.find((r) => r.id === 'p1')!.flag).toBeNull();
  });

  it('flags clear outliers once enough people have turns, and ignores unknown ids', () => {
    const entries: ScheduleEntry[] = [];
    // p1 x6, p2..p4 x2, p5 x1 -> p1 stands out; ghost is not in the roster.
    for (let i = 0; i < 6; i++) entries.push(entry(`w${i}`, 'a', ['p1', 'ghost']));
    for (const id of ['p2', 'p3', 'p4']) for (let i = 0; i < 2; i++) entries.push(entry(`x${id}${i}`, 'a', [id]));
    entries.push(entry('y', 'a', ['p5']));
    const { rows } = participation(entries, people);
    expect(rows.find((r) => r.id === 'p1')!.flag).toBe('high');
    expect(rows.find((r) => r.id === 'p6')!.flag).toBe('zero');
    expect(rows).toHaveLength(6);
  });

  it('updates live when a person is moved', () => {
    const before = [entry(W1, 'a', ['p1']), entry(W1, 'b', ['p2'])];
    const after = movePerson(before, { weekDate: W1, slotId: 'a', personId: 'p1' }, { weekDate: W1, slotId: 'b' }, label)!;
    const counts = (e: ScheduleEntry[]) => Object.fromEntries(participation(e, people).rows.map((r) => [r.id, r.count]));
    expect(counts(before)).toMatchObject({ p1: 1, p2: 1 });
    expect(counts(after)).toMatchObject({ p1: 1, p2: 1 });
    expect(participation(after, people).rows.reduce((s, r) => s + r.count, 0)).toBe(2);
  });
});
