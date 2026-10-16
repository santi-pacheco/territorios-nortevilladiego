/**
 * Realtime → query invalidation. Change events never write their payload into the cache:
 * they only invalidate the affected scope (and hold back the refetch while an optimistic
 * edit in that scope is in flight, see query/sync.ts).
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
 * Editor-only tables (no anon grant). Kept on their own channel so a rejected binding can
 * never take the public channel down, and viewers never get their PK-only DELETE events.
 */
export const EDITOR_REALTIME_TABLES = [
  'people',
  'person_availability',
  'person_pairs',
] as const satisfies readonly TableName[];

export const REALTIME_TABLES = [...PUBLIC_REALTIME_TABLES, ...EDITOR_REALTIME_TABLES] as const;

export interface AppLifecycle {
  isHidden(): boolean;
  /** Fires on visibility changes; returns unsubscribe. */
  onVisibilityChange(cb: () => void): () => void;
  /** App returned to foreground (native). Returns unsubscribe. */
  onResume(cb: () => void): () => void;
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
  };
}

export interface RealtimeOptions {
  supabase: TerritoriosClient;
  queryClient: QueryClient;
  lifecycle?: AppLifecycle;
  /** Also listen to people/person_availability/person_pairs. Enable only for editors. */
  includeEditorTables?: boolean;
  channelName?: string;
}

export interface RealtimeHandle {
  stop(): void;
  /** Turn the editor channel on/off when the role changes (e.g. after sign-in). */
  setEditorTables(enabled: boolean): void;
  /** For tests / diagnostics. */
  readonly paused: boolean;
}

export function startRealtime(opts: RealtimeOptions): RealtimeHandle {
  const { supabase: sb, queryClient: qc } = opts;
  const lifecycle = opts.lifecycle ?? defaultLifecycle();
  const name = opts.channelName ?? 'tm-db-changes';
  let editor = opts.includeEditorTables ?? false;
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

  const subscribe = () => {
    open('public', PUBLIC_REALTIME_TABLES);
    if (editor) open('editor', EDITOR_REALTIME_TABLES);
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
    void qc.invalidateQueries({ queryKey: qk.all });
  };

  const offVisibility = lifecycle.onVisibilityChange(() =>
    lifecycle.isHidden() ? pause() : resume(),
  );
  const offResume = lifecycle.onResume(resume);

  if (lifecycle.isHidden()) paused = true;
  else subscribe();

  return {
    stop() {
      stopped = true;
      offVisibility();
      offResume();
      unsubscribe();
    },
    setEditorTables(enabled) {
      if (enabled === editor) return;
      editor = enabled;
      if (paused || stopped) return;
      unsubscribe();
      subscribe();
    },
    get paused() {
      return paused;
    },
  };
}

/**
 * `startRealtime` for a client that is still loading: returns a handle right away and starts
 * once the client resolves. Calls made before then are applied on start; `stop()` before
 * then means it never starts. A client that fails to load leaves the handle inert.
 */
export function startRealtimeWhenReady(
  client: Promise<TerritoriosClient>,
  opts: Omit<RealtimeOptions, 'supabase'>,
): RealtimeHandle {
  let inner: RealtimeHandle | null = null;
  let editor = opts.includeEditorTables ?? false;
  let stopped = false;
  client.then(
    (supabase) => {
      if (!stopped) inner = startRealtime({ ...opts, supabase, includeEditorTables: editor });
    },
    () => {},
  );
  return {
    stop() {
      stopped = true;
      inner?.stop();
    },
    setEditorTables(enabled) {
      editor = enabled;
      inner?.setEditorTables(enabled);
    },
    get paused() {
      return inner ? inner.paused : true;
    },
  };
}
