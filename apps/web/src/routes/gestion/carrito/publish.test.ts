import { describe, expect, it } from 'vitest';
import type { ScheduleEntry } from '@territorios/core';
import type { CartAssignmentRow } from '@territorios/data';
import {
  applyNotes,
  buildAssignments,
  buildScheduleInsert,
  collectNotes,
  mergeNotes,
  planPublish,
} from './publish';

function entry(weekDate: string, slotId: string, personIds: string[], note?: string): ScheduleEntry {
  return { weekLabel: weekDate, weekDate, slotId, personIds, ...(note ? { note } : {}) };
}

function assignment(
  weekDate: string,
  slotId: string,
  personIds: string[],
  note: string | null,
): CartAssignmentRow {
  return {
    id: `${weekDate}-${slotId}`,
    schedule_id: 'sched',
    slot_id: slotId,
    week_date: weekDate,
    person_ids: personIds,
    note,
    person_names: personIds,
    version: 1,
    updated_at: '2026-10-01T00:00:00+00:00',
    updated_by: null,
  };
}

describe('carrito publish mapping', () => {
  it('maps generated entries to assignment rows', () => {
    const rows = buildAssignments('sched-1', [
      entry('2026-10-05', 'slot-a', ['p1', 'p2']),
      entry('2026-10-12', 'slot-b', ['p3']),
    ]);
    expect(rows).toEqual([
      { schedule_id: 'sched-1', slot_id: 'slot-a', week_date: '2026-10-05', person_ids: ['p1', 'p2'], note: null },
      { schedule_id: 'sched-1', slot_id: 'slot-b', week_date: '2026-10-12', person_ids: ['p3'], note: null },
    ]);
  });

  it('normalises a clipped first week (anchored on the range start) to its Monday', () => {
    // The scheduler anchors a clipped first week on the start date, which may not be a Monday.
    const rows = buildAssignments('sched-1', [entry('2026-10-07', 'slot-a', ['p1'])]);
    expect(rows[0]!.week_date).toBe('2026-10-05');
    // …and the Sunday of the previous ISO week maps back to that Monday too.
    expect(buildAssignments('s', [entry('2026-10-04', 'slot-a', ['p1'])])[0]!.week_date).toBe(
      '2026-09-28',
    );
  });

  it('keeps notes across a regeneration, keyed by Monday of the week + slot', () => {
    const existing = [
      assignment('2026-10-05', 'slot-a', ['p1'], 'Llevar llaves'),
      assignment('2026-10-05', 'slot-b', ['p2'], null),
      assignment('2026-10-12', 'slot-a', ['p3'], 'Feriado'),
    ];
    // Regenerated with the first week anchored on a Wednesday (clipped range start).
    const merged = mergeNotes(
      [entry('2026-10-07', 'slot-a', ['p9']), entry('2026-10-05', 'slot-b', ['p8']), entry('2026-10-12', 'slot-b', ['p7'])],
      existing,
    );
    expect(merged.map((e) => e.note)).toEqual(['Llevar llaves', undefined, undefined]);
    expect(merged[0]!.personIds).toEqual(['p9']);
  });

  it('copies a note map onto entries without dropping generated data', () => {
    const notes = collectNotes([assignment('2026-10-05', 'slot-a', ['p1'], 'Nota')]);
    const merged = applyNotes([entry('2026-10-05', 'slot-a', ['p1', 'p2'])], notes);
    expect(merged).toEqual([entry('2026-10-05', 'slot-a', ['p1', 'p2'], 'Nota')]);
  });

  it('keeps a note on a cell the generator left empty, inside the range only', () => {
    const notes = collectNotes([
      assignment('2026-10-05', 'slot-a', ['p1'], 'Feriado: no hay carrito'),
      assignment('2026-11-02', 'slot-a', ['p1'], 'Fuera del rango'),
      assignment('2026-10-12', 'slot-gone', ['p1'], 'Turno borrado'),
    ]);
    const scope = { startDate: '2026-10-07', endDate: '2026-10-31', slotIds: new Set(['slot-a', 'slot-b']) };
    // Week of 5 Oct overlaps a range that starts on Wednesday 7 Oct.
    const merged = applyNotes([entry('2026-10-12', 'slot-b', ['p2'])], notes, scope);
    expect(merged).toEqual([
      entry('2026-10-12', 'slot-b', ['p2']),
      { weekDate: '2026-10-05', weekLabel: '2026-10-05', slotId: 'slot-a', personIds: [], note: 'Feriado: no hay carrito' },
    ]);
    expect(buildAssignments('s', merged)[1]).toEqual({
      schedule_id: 's',
      slot_id: 'slot-a',
      week_date: '2026-10-05',
      person_ids: [],
      note: 'Feriado: no hay carrito',
    });
  });

  it('plans an in-place republish: update changed cells, create new, delete gone, keep notes', () => {
    const existing = [
      { ...assignment('2026-10-05', 'slot-a', ['p1', 'p2'], 'Llevar llaves'), id: 'a1', version: 3 },
      { ...assignment('2026-10-05', 'slot-b', ['p3'], null), id: 'a2', version: 1 },
      { ...assignment('2026-10-12', 'slot-a', ['p4'], null), id: 'a3', version: 2 },
    ];
    // Regenerate the same schedule, notes merged back the way GenerarTab does it.
    const entries = applyNotes(
      [
        entry('2026-10-05', 'slot-a', ['p5', 'p6']), // changed people, note must survive
        entry('2026-10-05', 'slot-b', ['p3']), // unchanged: no write
        entry('2026-10-19', 'slot-a', ['p7']), // new cell
      ],
      collectNotes(existing),
    );
    const plan = planPublish('sched', entries, existing);
    expect(plan.updates).toEqual([{ id: 'a1', version: 3, patch: { person_ids: ['p5', 'p6'] } }]);
    expect(plan.creates).toEqual([
      { schedule_id: 'sched', slot_id: 'slot-a', week_date: '2026-10-19', person_ids: ['p7'], note: null },
    ]);
    expect(plan.deletes).toEqual([{ id: 'a3', version: 2 }]);
  });

  it('plans a note-only change and treats a clipped first week as the same cell', () => {
    const existing = [{ ...assignment('2026-10-05', 'slot-a', ['p1'], 'Vieja'), id: 'a1', version: 4 }];
    const plan = planPublish('sched', [entry('2026-10-07', 'slot-a', ['p1'], 'Nueva')], existing);
    expect(plan).toEqual({
      creates: [],
      updates: [{ id: 'a1', version: 4, patch: { note: 'Nueva' } }],
      deletes: [],
    });
  });

  it('builds the schedule insert, trimming or omitting an empty name', () => {
    expect(buildScheduleInsert('  Octubre  ', '2026-10-01', '2026-10-31')).toEqual({
      name: 'Octubre',
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    });
    expect(buildScheduleInsert('   ', '2026-10-01', '2026-10-31')).toEqual({
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    });
  });
});
