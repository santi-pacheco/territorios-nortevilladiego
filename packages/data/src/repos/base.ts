/**
 * Shared repo plumbing: response unwrapping, Zod parsing at the IO boundary, and the
 * compare-and-swap (CAS) write pattern from supabase/README.md.
 */
import type { z } from 'zod/mini';
import type { TerritoriosClient } from '../client';
import { ConflictError, DataError, NetworkError, SchemaError } from '../errors';
import type { TableName } from '../schemas';

/** Primary key columns of a row: `{ id }`, or composite e.g. `{ person_id, slot_id }`. */
export type RowKey = Readonly<Record<string, string | number>>;

interface PgResponse {
  data: unknown;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  status: number;
}

/** Await a PostgREST builder and turn its `{ data, error, status }` into data or a typed throw. */
export async function run(builder: PromiseLike<PgResponse>): Promise<unknown> {
  let res: PgResponse;
  try {
    res = await builder;
  } catch (e) {
    // fetch itself threw (a custom fetch or runtime that bypasses postgrest-js' own catch).
    if (e instanceof TypeError) throw new NetworkError(e.message, { cause: e });
    throw e;
  }
  if (res.error) {
    // postgrest-js reports a failed fetch as status 0. Aborts are cancellations, not outages.
    if (res.status === 0 && !res.error.message.startsWith('AbortError')) {
      throw new NetworkError(res.error.message, { cause: res.error });
    }
    throw new DataError({
      message: res.error.message,
      code: res.error.code ?? '',
      status: res.status,
      details: res.error.details ?? null,
      hint: res.error.hint ?? null,
    });
  }
  return res.data;
}

export function parseRow<S extends z.ZodMiniType>(
  table: TableName,
  schema: S,
  data: unknown,
): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new SchemaError(table, r.error.message, { cause: r.error });
  return r.data;
}

export function parseRows<S extends z.ZodMiniType>(
  table: TableName,
  schema: S,
  data: unknown,
): z.infer<S>[] {
  if (!Array.isArray(data)) throw new SchemaError(table, 'expected an array');
  return data.map((d) => parseRow(table, schema, d));
}

/** Validate an outgoing payload; Zod strips unknown keys, so version/updated_* never leak out. */
export function parsePayload<S extends z.ZodMiniType>(
  table: TableName,
  schema: S,
  payload: unknown,
): z.infer<S> {
  const r = schema.safeParse(payload);
  if (!r.success) {
    throw new DataError({
      message: `Invalid ${table} payload: ${r.error.message}`,
      code: 'CLIENT_VALIDATION',
      status: 400,
    });
  }
  return r.data;
}

// The repo layer is deliberately untyped against PostgREST: every row is parsed by Zod,
// which is the single source of truth for shapes. This narrow view of the builder keeps
// postgrest-js' deep generics out of the compiler's way.
export interface Query extends PromiseLike<PgResponse> {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  lte(column: string, value: unknown): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  maybeSingle(): PromiseLike<PgResponse>;
  single(): PromiseLike<PgResponse>;
}
export interface Table {
  select(columns: string): Query;
  insert(values: object): Query;
  update(values: object): Query;
  delete(): Query;
}

export function from(sb: TerritoriosClient, name: TableName): Table {
  return sb.from(name) as unknown as Table;
}

function matchKey(q: Query, key: RowKey): Query {
  let out = q;
  for (const [col, val] of Object.entries(key)) out = out.eq(col, val);
  return out;
}

export async function fetchByKey<S extends z.ZodMiniType>(
  sb: TerritoriosClient,
  table: TableName,
  schema: S,
  key: RowKey,
): Promise<z.infer<S> | null> {
  const data = await run(matchKey(from(sb, table).select('*'), key).maybeSingle());
  return data == null ? null : parseRow(table, schema, data);
}

export async function insertRow<S extends z.ZodMiniType>(
  sb: TerritoriosClient,
  table: TableName,
  schema: S,
  payload: object,
): Promise<z.infer<S>> {
  const data = await run(from(sb, table).insert(payload).select('*').single());
  return parseRow(table, schema, data);
}

function keyId(key: RowKey): unknown {
  const entries = Object.entries(key);
  return entries.length === 1 && entries[0] ? entries[0][1] : { ...key };
}

async function conflict<S extends z.ZodMiniType>(
  sb: TerritoriosClient,
  table: TableName,
  schema: S,
  key: RowKey,
  expectedVersion: number,
): Promise<never> {
  const current = await fetchByKey(sb, table, schema, key);
  throw new ConflictError<z.infer<S>>({ table, id: keyId(key), expectedVersion, current });
}

/**
 * `update … where <key> and version = expected returning *`. 0 rows ⇒ refetch the row and
 * throw ConflictError (current = null when it was deleted / is not visible). Never retried.
 */
export async function casUpdate<S extends z.ZodMiniType>(
  sb: TerritoriosClient,
  table: TableName,
  schema: S,
  key: RowKey,
  expectedVersion: number,
  patch: object,
): Promise<z.infer<S>> {
  const q = matchKey(from(sb, table).update(patch), key).eq('version', expectedVersion);
  const data = await run(q.select('*').maybeSingle());
  if (data == null) return conflict(sb, table, schema, key, expectedVersion);
  return parseRow(table, schema, data);
}

/** `delete … where <key> and version = expected returning *`. 0 rows ⇒ ConflictError. */
export async function casDelete<S extends z.ZodMiniType>(
  sb: TerritoriosClient,
  table: TableName,
  schema: S,
  key: RowKey,
  expectedVersion: number,
): Promise<void> {
  const q = matchKey(from(sb, table).delete(), key).eq('version', expectedVersion);
  const data = await run(q.select('*').maybeSingle());
  if (data == null) await conflict(sb, table, schema, key, expectedVersion);
}

/** YYYY-MM-DD + n days (UTC arithmetic, no DST drift). */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
