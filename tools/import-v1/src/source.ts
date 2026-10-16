import { readFile } from 'node:fs/promises';
import type { V1Snapshot } from './types';
import { isRecord } from './util';

const TABLES = ['salidas', 'carrito', 'programa'] as const;

/**
 * Reads the three v1 jsonb rows (id=1) over PostgREST with plain GETs. There is no write path to
 * v1 anywhere in this tool: no supabase client is ever created for the v1 URL.
 */
export async function readV1(url: string, key: string): Promise<V1Snapshot> {
  const headers: Record<string, string> = { apikey: key, Accept: 'application/json' };
  // Legacy JWT anon keys also go in Authorization; new publishable keys must not.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  const out: Partial<V1Snapshot> = {};
  for (const table of TABLES) {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${table}?id=eq.1&select=data`, { method: 'GET', headers });
    if (!res.ok) throw new Error(`v1 read ${table}: HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{ data?: unknown }>;
    // PostgREST answers 200 [] for a missing row AND for an RLS-hidden one: never import "nothing".
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`v1 ${table} id=1 not readable (missing row or RLS)`);
    out[table] = rows[0]?.data ?? null;
  }
  return out as V1Snapshot;
}

/** Snapshot file: `{ "salidas": <data>, "carrito": <data>, "programa": <data> }`. */
export async function readSnapshotFile(path: string): Promise<V1Snapshot> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${path}: expected a JSON object`);
  for (const t of TABLES) if (!(t in parsed)) throw new Error(`${path}: missing "${t}" key`);
  return { salidas: parsed.salidas, carrito: parsed.carrito, programa: parsed.programa };
}
