import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PdfItem } from '@territorios/core';
import type { ProgramWeekRow } from '@territorios/data';
import { buildPreview, defaultSelection, detectKind, publishPlan, type StagedFile } from './model';

// The sanitized October 2026 fixtures committed with the core parsers.
const FIXTURES = '../../../../../../packages/core/src/programa/__tests__/fixtures/';

function fixture(name: string): StagedFile {
  const pages = JSON.parse(
    readFileSync(new URL(FIXTURES + name, import.meta.url), 'utf8'),
  ) as PdfItem[][];
  return { name, pages };
}

const midweek = fixture('midweek-2026-10.json');
const weekend = fixture('weekend-2026-10.json');

function row(kind: 'midweek' | 'weekend', date: string): ProgramWeekRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind,
    date,
    data: {},
    version: 3,
    updated_at: '2026-10-01T00:00:00Z',
    updated_by: null,
  } as ProgramWeekRow;
}

describe('gestión programa preview', () => {
  it('detects the kind of each PDF', () => {
    expect(detectKind(midweek.pages)).toBe('midweek');
    expect(detectKind(weekend.pages)).toBe('weekend');
    expect(detectKind([[{ str: 'Otra cosa', x: 0, y: 0, w: 1, font: 'f' }]])).toBeNull();
  });

  it('previews every week of both fixtures, grouped by Mon–Sun week', () => {
    const p = buildPreview([midweek, weekend], 2026, []);
    expect(p.files.map((f) => [f.kind, f.count, f.error])).toEqual([
      ['midweek', 4, null],
      ['weekend', 5, null],
    ]);
    expect(p.entries.filter((e) => e.kind === 'midweek').map((e) => e.date)).toEqual([
      '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27',
    ]);
    expect(p.entries.filter((e) => e.kind === 'weekend').map((e) => e.date)).toEqual([
      '2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31',
    ]);
    expect(p.groups.map((g) => [g.weekStart, g.entries.length])).toEqual([
      ['2026-09-28', 1],
      ['2026-10-05', 2],
      ['2026-10-12', 2],
      ['2026-10-19', 2],
      ['2026-10-26', 2],
    ]);
    expect(p.entries.every((e) => e.blocking === null && e.existing === null)).toBe(true);
    expect(p.entries.flatMap((e) => e.warnings)).toEqual([]);
  });

  it('keeps every part with its people and roles', () => {
    const p = buildPreview([midweek], 2026, []);
    const w = p.entries.find((e) => e.date === '2026-10-13')!.meeting;
    expect(w.kind).toBe('midweek');
    if (w.kind !== 'midweek') return;
    expect(w.week.parts).toHaveLength(13);
    expect(w.week.parts.find((x) => x.title.startsWith('Estudio bíblico'))?.people).toEqual([
      { name: 'Persona 11', role: 'Lector' },
      { name: 'Persona 12', role: 'Conductor' },
    ]);
  });

  it('marks published weeks as replacements and plans create vs update', () => {
    const published = [row('midweek', '2026-10-13'), row('weekend', '2026-10-17')];
    const p = buildPreview([midweek, weekend], 2026, published);
    expect(p.entries.filter((e) => e.existing).map((e) => e.key)).toEqual([
      'midweek:2026-10-13',
      'weekend:2026-10-17',
    ]);
    const selected = defaultSelection(p);
    selected.delete('weekend:2026-10-03');
    const plan = publishPlan(p, selected);
    expect(plan).toHaveLength(8);
    expect(plan.filter((s) => s.op === 'update').map((s) => s.entry.key)).toEqual([
      'midweek:2026-10-13',
      'weekend:2026-10-17',
    ]);
  });

  it('blocks dates that fall on the wrong weekday (wrong year)', () => {
    const p = buildPreview([midweek, weekend], 2025, []);
    expect(p.entries).toHaveLength(9);
    expect(p.entries.every((e) => e.blocking !== null)).toBe(true);
    expect(defaultSelection(p).size).toBe(0);
    expect(publishPlan(p, new Set(p.entries.map((e) => e.key)))).toEqual([]);
  });

  it('flags missing assignments and the same date from two files', () => {
    const p = buildPreview([weekend, { ...weekend, name: 'otra.json' }], 2026, []);
    expect(p.entries).toHaveLength(5);
    expect(p.entries[0]!.warnings[0]).toContain('También está en weekend-2026-10.json');
    const unknown = buildPreview([{ name: 'x.pdf', pages: [[]] }], 2026, []);
    expect(unknown.files[0]!.error).not.toBeNull();
    expect(unknown.entries).toEqual([]);
  });
});
