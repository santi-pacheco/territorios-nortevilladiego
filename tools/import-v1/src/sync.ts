/**
 * Diff desired rows against the target and write only what changed.
 *
 * - Rows are matched by natural key where the schema has one (week_start, (kind,date), …) and the
 *   existing id is reused, so app-created rows are updated in place instead of duplicated.
 * - Unchanged rows are never sent: bump_version fires on every UPDATE, so re-sending an identical
 *   row would still bump `version` and break open editors' CAS. A second apply writes nothing.
 * - Pruning is scoped to children of imported parents (meetings of imported weeks, availability
 *   and pairs of imported people, cells of the imported schedule, blackouts of imported slots).
 *   Top-level rows that exist only in the target are reported, never deleted.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Desired, TableName } from './types';
import { canonical, normalizeTime, uuidV5 } from './util';

type Row = Record<string, unknown>;

interface Spec {
  table: TableName;
  pk: string[];
  /** Natural key used to adopt an existing row's id. */
  natural?: string[];
  /** Compared (and written) non-pk columns. */
  cols: string[];
  times?: string[];
  /** Existing rows inside this scope that are not desired get deleted. Omit = top-level (never deleted). */
  pruneScope?: (row: Row, d: Desired) => boolean;
}

const idSet = <T extends { id: string }>(rows: T[]) => new Set(rows.map((r) => r.id));

// FK order: parents before children. Deletes run in reverse.
export const SPECS: Spec[] = [
  { table: 'territories', pk: ['id'], cols: ['name', 'geometry', 'centroid_lng', 'centroid_lat'] },
  { table: 'service_weeks', pk: ['id'], natural: ['week_start'], cols: ['week_start', 'month_label'] },
  {
    table: 'service_meetings',
    pk: ['id'],
    natural: ['week_id', 'dow', 'position'],
    cols: ['week_id', 'dow', 'position', 'kind', 'start_time', 'groups', 'conductor', 'place', 'territory_ids', 'group_territories'],
    pruneScope: (r, d) => idSet(d.service_weeks).has(r.week_id as string),
  },
  { table: 'cart_places', pk: ['id'], cols: ['name', 'color'] },
  {
    table: 'cart_slots',
    pk: ['id'],
    cols: ['place_id', 'iso_dow', 'start_time', 'end_time', 'group_size', 'display_label'],
    times: ['start_time', 'end_time'],
  },
  { table: 'people', pk: ['id'], cols: ['name', 'gender', 'target_appearances'] },
  {
    table: 'person_availability',
    pk: ['person_id', 'slot_id'],
    cols: [],
    pruneScope: (r, d) => idSet(d.people).has(r.person_id as string),
  },
  {
    table: 'person_pairs',
    pk: ['person_a', 'person_b'],
    cols: [],
    pruneScope: (r, d) => {
      const ids = idSet(d.people);
      return ids.has(r.person_a as string) || ids.has(r.person_b as string);
    },
  },
  { table: 'cart_schedules', pk: ['id'], cols: ['name', 'start_date', 'end_date'] },
  {
    table: 'cart_assignments',
    pk: ['id'],
    natural: ['schedule_id', 'week_date', 'slot_id'],
    cols: ['schedule_id', 'slot_id', 'week_date', 'person_ids', 'note'],
    pruneScope: (r, d) => idSet(d.cart_schedules).has(r.schedule_id as string),
  },
  {
    table: 'cart_blackouts',
    pk: ['id'],
    natural: ['slot_id', 'date'],
    cols: ['slot_id', 'date'],
    pruneScope: (r, d) => idSet(d.cart_slots).has(r.slot_id as string),
  },
  { table: 'program_weeks', pk: ['id'], natural: ['kind', 'date'], cols: ['kind', 'date', 'data'] },
];

export interface TablePlan {
  table: TableName;
  desired: number;
  existing: number;
  inserts: Row[];
  updates: Row[];
  unchanged: number;
  prunes: Row[];
  targetOnly: number;
  /** column → number of updated rows where it changed */
  changedCols: Record<string, number>;
}

const PAGE = 1000;

async function loadAll(db: SupabaseClient, spec: Spec): Promise<Row[]> {
  const cols = [...new Set([...spec.pk, ...(spec.natural ?? []), ...spec.cols])];
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(spec.table).select(cols.join(','));
    for (const k of spec.pk) q = q.order(k, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`read ${spec.table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) return rows;
  }
}

function keyOf(row: Row, cols: string[], spec: Spec): string {
  return canonical(cols.map((c) => norm(spec, c, row[c])));
}

function norm(spec: Spec, col: string, v: unknown): unknown {
  if (spec.times?.includes(col)) return normalizeTime(v) ?? v;
  return v ?? null;
}

// Floats (centroids) compare with a tolerance far below the KML's 1e-7° precision.
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return canonical(a) === canonical(b);
}

/** Reads the target and builds the per-table plan. Mutates desired ids to adopt existing rows. */
export async function plan(db: SupabaseClient, desired: Desired): Promise<TablePlan[]> {
  const plans: TablePlan[] = [];
  for (const spec of SPECS) {
    const existing = await loadAll(db, spec);
    const rows = desired[spec.table] as unknown as Row[];

    if (spec.natural) adoptIds(spec, rows, existing, desired);

    const byPk = new Map(existing.map((r) => [keyOf(r, spec.pk, spec), r]));
    const desiredPks = new Set<string>();
    const p: TablePlan = {
      table: spec.table,
      desired: rows.length,
      existing: existing.length,
      inserts: [],
      updates: [],
      unchanged: 0,
      prunes: [],
      targetOnly: 0,
      changedCols: {},
    };
    for (const row of rows) {
      const pk = keyOf(row, spec.pk, spec);
      if (desiredPks.has(pk)) throw new Error(`${spec.table}: two desired rows share key ${pk}`);
      desiredPks.add(pk);
      const ex = byPk.get(pk);
      if (!ex) {
        p.inserts.push(row);
        continue;
      }
      const changed = spec.cols.filter((c) => !same(norm(spec, c, row[c]), norm(spec, c, ex[c])));
      if (!changed.length) {
        p.unchanged++;
        continue;
      }
      p.updates.push(row);
      for (const c of changed) p.changedCols[c] = (p.changedCols[c] ?? 0) + 1;
    }
    for (const ex of existing) {
      if (desiredPks.has(keyOf(ex, spec.pk, spec))) continue;
      if (spec.pruneScope?.(ex, desired)) p.prunes.push(ex);
      else p.targetOnly++;
    }
    plans.push(p);
  }
  return plans;
}

function adoptIds(spec: Spec, rows: Row[], existing: Row[], desired: Desired): void {
  const natural = spec.natural!;
  const byNatural = new Map(existing.map((r) => [keyOf(r, natural, spec), r]));
  const claimed = new Set<string>();
  const remap = new Map<string, string>();
  for (const row of rows) {
    const ex = byNatural.get(keyOf(row, natural, spec));
    if (ex && ex.id !== row.id) {
      remap.set(row.id as string, ex.id as string);
      row.id = ex.id;
    }
    if (ex) claimed.add(row.id as string);
  }
  // A row without a natural match must not take an id another desired row just adopted.
  for (const row of rows) {
    if (claimed.has(row.id as string) && !byNatural.has(keyOf(row, natural, spec))) row.id = uuidV5(`${String(row.id)}:alt`);
  }
  // Children carry the parent's id: follow adopted week ids.
  if (spec.table === 'service_weeks') {
    for (const m of desired.service_meetings) m.week_id = remap.get(m.week_id) ?? m.week_id;
  }
}

const BATCH = 200;

export async function apply(db: SupabaseClient, plans: TablePlan[]): Promise<void> {
  for (const p of plans) {
    const spec = SPECS.find((s) => s.table === p.table)!;
    const rows = [...p.inserts, ...p.updates].map((r) => pick(r, [...spec.pk, ...spec.cols]));
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await db.from(p.table).upsert(rows.slice(i, i + BATCH), { onConflict: spec.pk.join(',') });
      if (error) throw new Error(`write ${p.table}: ${error.message}`);
    }
  }
  for (const p of [...plans].reverse()) {
    const spec = SPECS.find((s) => s.table === p.table)!;
    for (const r of p.prunes) {
      const { error } = await db.from(p.table).delete().match(pick(r, spec.pk));
      if (error) throw new Error(`delete ${p.table}: ${error.message}`);
    }
  }
}

function pick(row: Row, cols: string[]): Record<string, string> {
  return Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]])) as Record<string, string>;
}
