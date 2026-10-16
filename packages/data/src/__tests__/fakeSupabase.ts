/** Minimal chainable stand-in for the supabase-js client (PostgREST builder, channels, auth). */
import { vi } from 'vitest';
import type { TerritoriosClient } from '../client';

export interface Op {
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  values?: unknown;
  columns?: string;
  filters: Array<[string, unknown]>;
  single?: 'maybe' | 'single';
}

export interface FakeResponse {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  status?: number;
}

export type Responder = (op: Op) => FakeResponse | Promise<FakeResponse>;

export interface FakeChannel {
  name: string;
  handlers: Array<{ filter: { table: string }; cb: (payload: unknown) => void }>;
  subscribed: boolean;
  /** Simulate a postgres_changes event for `table`. */
  emit(table: string, payload?: unknown): void;
  /** Simulate a subscribe status callback (e.g. 'SUBSCRIBED' after a socket rejoin). */
  status(s: string): void;
}

export function fakeSupabase(responder: Responder) {
  const calls: Op[] = [];
  const channels: FakeChannel[] = [];

  function builder(op: Op) {
    const exec = () => {
      calls.push(op);
      return Promise.resolve(responder(op)).then((r) => ({
        data: r.data ?? null,
        error: r.error ?? null,
        status: r.status ?? (r.error ? 400 : 200),
      }));
    };
    const q = {
      select(columns?: string) {
        if (op.action === 'select') op.columns = columns;
        return q;
      },
      eq(col: string, val: unknown) {
        op.filters.push([col, val]);
        return q;
      },
      gte(col: string, val: unknown) {
        op.filters.push([`${col}>=`, val]);
        return q;
      },
      lte(col: string, val: unknown) {
        op.filters.push([`${col}<=`, val]);
        return q;
      },
      order() {
        return q;
      },
      maybeSingle() {
        op.single = 'maybe';
        return exec();
      },
      single() {
        op.single = 'single';
        return exec();
      },
      then<A, B>(ok: (v: unknown) => A, err?: (e: unknown) => B) {
        return exec().then(ok, err);
      },
    };
    return q;
  }

  const client = {
    from(table: string) {
      return {
        select: (columns: string) => builder({ table, action: 'select', columns, filters: [] }),
        insert: (values: unknown) => builder({ table, action: 'insert', values, filters: [] }),
        update: (values: unknown) => builder({ table, action: 'update', values, filters: [] }),
        delete: () => builder({ table, action: 'delete', filters: [] }),
      };
    },
    channel(name: string) {
      let onStatus: ((s: string) => void) | undefined;
      const ch: FakeChannel & { on: unknown; subscribe: unknown } = {
        name,
        handlers: [],
        subscribed: false,
        emit(table, payload = {}) {
          for (const h of this.handlers) if (h.filter.table === table) h.cb(payload);
        },
        on(_type: string, filter: { table: string }, cb: (p: unknown) => void) {
          ch.handlers.push({ filter, cb });
          return ch;
        },
        status(s: string) {
          onStatus?.(s);
        },
        subscribe(cb?: (s: string) => void) {
          onStatus = cb;
          ch.subscribed = true;
          return ch;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: vi.fn(async (ch: FakeChannel) => {
      ch.subscribed = false;
      return 'ok';
    }),
    auth: {
      stopAutoRefresh: vi.fn(async () => {}),
      startAutoRefresh: vi.fn(async () => {}),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  };

  return { client: client as unknown as TerritoriosClient, raw: client, calls, channels };
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks and zero-delay timers run. */
export const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Fixtures (fake data only)
// ---------------------------------------------------------------------------
export const TS = '2026-10-16T18:50:13.123456+00:00';
export const WEEK_START = '2026-10-12'; // a Monday
export const WEEK_ID = '00000000-0000-4000-8000-000000000001';
export const MEETING_ID = '00000000-0000-4000-8000-000000000002';

export const weekRow = (over: Record<string, unknown> = {}) => ({
  id: WEEK_ID,
  week_start: WEEK_START,
  month_label: 'Octubre',
  updated_at: TS,
  version: 1,
  updated_by: null,
  ...over,
});

export const meetingRow = (over: Record<string, unknown> = {}) => ({
  id: MEETING_ID,
  week_id: WEEK_ID,
  dow: 3,
  position: 0,
  kind: 'normal',
  start_time: '09:30',
  groups: 'Grupo 1',
  conductor: 'Hermano Ejemplo',
  place: 'Salón',
  territory_ids: [5, 12],
  group_territories: {},
  updated_at: TS,
  version: 1,
  updated_by: null,
  ...over,
});
