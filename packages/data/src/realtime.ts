/**
 * Realtime → query invalidation. Change events never write their payload into the cache:
 * they only invalidate the affected scope (and hold back the refetch while an optimistic
 * edit in that scope is in flight, see query/sync.ts).
 *
 * Only the public schedule tables are published. The restricted ones (people, availability,
 * pairs, Privilegios) are not: Realtime skips RLS on DELETE events, so publishing them leaked
 * their primary keys to any signed-in subscriber (migration security_hardening). Their screens
 * refetch instead: on window focus (throttled), on resume, and after the user's own mutations
 * (query/mutations.ts invalidates the scope on settle).
 *
 * Lifecycle: when the page is hidden / the app goes to the background, the channels are
 * removed and token auto-refresh stops. On resume both restart and everything refetches.
 * A silent socket rejoin (SUBSCRIBED again on the same channel) also refetches everything,
 * since events missed while disconnected are not replayed.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { platform } from '@territorios/platform';
import type { TerritoriosClient } from './client';
import { qk } from './query/keys';
import { invalidateTable } from './query/sync';
import type { TableName } from './schemas';

/** Public tables in the `supabase_realtime` publication (readable by anon). */
export const PUBLIC_REALTIME_TABLES = [
  'territories',
  'service_weeks',
  'service_meetings',
  'cart_places',
  'cart_slots',
  'cart_schedules',
  'cart_assignments',
  'cart_blackouts',
  'program_weeks',
] as const satisfies readonly TableName[];

/**
 * Restricted tables (no anon grant), deliberately NOT in the publication. Their scopes are
 * refetched on window focus and on resume instead of on change events.
 */
export const REFETCH_ON_FOCUS_TABLES = [
  'people',
  'person_availability',
  'person_pairs',
  'duty_roster',
  'duty_days',
] as const satisfies readonly TableName[];

/** Everything subscribed to. Must match the supabase_realtime publication. */
export const REALTIME_TABLES = PUBLIC_REALTIME_TABLES;

/** Minimum gap between two focus refetches of the restricted scopes. */
export const FOCUS_REFETCH_THROTTLE_MS = 10_000;

export interface AppLifecycle {
  isHidden(): boolean;
  /** Fires on visibility changes; returns unsubscribe. */
  onVisibilityChange(cb: () => void): () => void;
  /** App returned to foreground (native). Returns unsubscribe. */
  onResume(cb: () => void): () => void;
  /** Window regained focus (e.g. back from another desktop window). Returns unsubscribe. */
  onFocus?(cb: () => void): () => void;
}

/** document.visibilityState + platform().onResume, each guarded for non-DOM / uninitialised envs. */
export function defaultLifecycle(): AppLifecycle {
  const doc = typeof document === 'undefined' ? null : document;
  return {
    isHidden: () => doc?.visibilityState === 'hidden',
    onVisibilityChange: (cb) => {
      if (!doc) return () => {};
      doc.addEventListener('visibilitychange', cb);
      return () => doc.removeEventListener('visibilitychange', cb);
    },
    onResume: (cb) => {
      try {
        return platform().onResume(cb);
      } catch {
        return () => {};
      }
    },
    onFocus: (cb) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('focus', cb);
      return () => window.removeEventListener('focus', cb);
    },
  };
}

export interface RealtimeOptions {
  supabase: TerritoriosClient;
  queryClient: QueryClient;
  lifecycle?: AppLifecycle;
  channelName?: string;
  /** Clock for the focus throttle (tests). */
  now?: () => number;
}

export interface RealtimeHandle {
  stop(): void;
  /** For tests / diagnostics. */
  readonly paused: boolean;
}

export function startRealtime(opts: RealtimeOptions): RealtimeHandle {
  const { supabase: sb, queryClient: qc } = opts;
  const lifecycle = opts.lifecycle ?? defaultLifecycle();
  const name = opts.channelName ?? 'tm-db-changes';
  const now = opts.now ?? Date.now;
  let channels: RealtimeChannel[] = [];
  let paused = false;
  let stopped = false;
  // realtime-js returns the *existing* channel for a known topic, and a removed channel may
  // still be listed while it leaves; re-subscribing that instance throws. Fresh topic each time.
  let generation = 0;

  const open = (suffix: string, tables: readonly TableName[]) => {
    let ch = sb.channel(`${name}:${suffix}:${++generation}`);
    for (const table of tables) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        void invalidateTable(qc, table);
      });
    }
    let joins = 0;
    channels.push(
      ch.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        joins += 1;
        // Rejoined after a drop: whatever changed meanwhile was never delivered.
        if (joins > 1) void qc.invalidateQueries({ queryKey: qk.all });
      }),
    );
  };

  const subscribe = () => open('public', PUBLIC_REALTIME_TABLES);

  // Restricted scopes get no change events: refetch whatever of them is on screen on focus.
  let lastFocusRefetch = -Infinity;
  const refetchRestricted = () => {
    if (paused || stopped) return;
    const t = now();
    if (t - lastFocusRefetch < FOCUS_REFETCH_THROTTLE_MS) return;
    lastFocusRefetch = t;
    for (const table of REFETCH_ON_FOCUS_TABLES) void invalidateTable(qc, table);
  };

  const unsubscribe = () => {
    for (const ch of channels) void sb.removeChannel(ch);
    channels = [];
  };

  const pause = () => {
    if (paused || stopped) return;
    paused = true;
    unsubscribe();
    void sb.auth.stopAutoRefresh();
  };

  const resume = () => {
    if (!paused || stopped) return;
    paused = false;
    void sb.auth.startAutoRefresh();
    subscribe();
    // Events missed while away are not replayed: refetch everything that is on screen.
    lastFocusRefetch = now();
    void qc.invalidateQueries({ queryKey: qk.all });
  };

  const offVisibility = lifecycle.onVisibilityChange(() =>
    lifecycle.isHidden() ? pause() : resume(),
  );
  const offResume = lifecycle.onResume(resume);
  const offFocus = lifecycle.onFocus?.(refetchRestricted) ?? (() => {});

  if (lifecycle.isHidden()) paused = true;
  else subscribe();

  return {
    stop() {
      stopped = true;
      offVisibility();
      offResume();
      offFocus();
      unsubscribe();
    },
    get paused() {
      return paused;
    },
  };
}

/**
 * `startRealtime` for a client that is still loading: returns a handle right away and starts
 * once the client resolves. `stop()` before then means it never starts. A client that fails
 * to load leaves the handle inert.
 */
export function startRealtimeWhenReady(
  client: Promise<TerritoriosClient>,
  opts: Omit<RealtimeOptions, 'supabase'>,
): RealtimeHandle {
  let inner: RealtimeHandle | null = null;
  let stopped = false;
  client.then(
    (supabase) => {
      if (!stopped) inner = startRealtime({ ...opts, supabase });
    },
    () => {},
  );
  return {
    stop() {
      stopped = true;
      inner?.stop();
    },
    get paused() {
      return inner ? inner.paused : true;
    },
  };
}
