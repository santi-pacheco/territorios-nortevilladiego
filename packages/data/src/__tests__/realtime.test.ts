import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qk } from '../query/keys';
import { createQueryClient } from '../query/policy';
import {
  EDITOR_REALTIME_TABLES,
  PUBLIC_REALTIME_TABLES,
  startRealtime,
  type AppLifecycle,
} from '../realtime';
import { fakeSupabase } from './fakeSupabase';

function fakeLifecycle(hidden = false) {
  let isHidden = hidden;
  const vis = new Set<() => void>();
  const res = new Set<() => void>();
  const lifecycle: AppLifecycle = {
    isHidden: () => isHidden,
    onVisibilityChange: (cb) => (vis.add(cb), () => vis.delete(cb)),
    onResume: (cb) => (res.add(cb), () => res.delete(cb)),
  };
  return {
    lifecycle,
    setHidden(h: boolean) {
      isHidden = h;
      vis.forEach((cb) => cb());
    },
    resume() {
      isHidden = false;
      res.forEach((cb) => cb());
    },
    listeners: () => vis.size + res.size,
  };
}

let qc: QueryClient;
beforeEach(() => {
  qc = createQueryClient();
  // Seed one entry per scope; no observers, so invalidation only flags them.
  for (const key of [
    qk.serviceWeek('2026-10-12'),
    qk.territories,
    qk.cartBoard(null),
    qk.people,
    qk.programWeek('2026-10-12'),
  ]) {
    qc.setQueryData(key, { seeded: true });
  }
});
afterEach(() => qc.clear());

const invalidated = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated ?? false;
const tablesOf = (ch: { handlers: Array<{ filter: { table: string } }> } | undefined) =>
  (ch?.handlers ?? []).map((h) => h.filter.table).sort();

describe('startRealtime', () => {
  it('subscribes to public tables only, unless editor tables are enabled (separate channel)', () => {
    const viewer = fakeSupabase(() => ({}));
    const rt1 = startRealtime({
      supabase: viewer.client,
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
    });
    expect(viewer.channels).toHaveLength(1);
    expect(viewer.channels[0]?.subscribed).toBe(true);
    expect(tablesOf(viewer.channels[0])).toEqual([...PUBLIC_REALTIME_TABLES].sort());
    rt1.stop();

    const editor = fakeSupabase(() => ({}));
    const rt2 = startRealtime({
      supabase: editor.client,
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
      includeEditorTables: true,
    });
    expect(editor.channels).toHaveLength(2);
    expect(tablesOf(editor.channels[1])).toEqual([...EDITOR_REALTIME_TABLES].sort());
    rt2.stop();
  });

  it('setEditorTables toggles the editor channel on role change', () => {
    const { client, channels, raw } = fakeSupabase(() => ({}));
    const rt = startRealtime({
      supabase: client,
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
    });
    rt.setEditorTables(true);
    const live = channels.filter((c) => c.subscribed);
    expect(live).toHaveLength(2);
    expect(raw.removeChannel).toHaveBeenCalledTimes(1);
    rt.setEditorTables(false);
    expect(channels.filter((c) => c.subscribed)).toHaveLength(1);
    rt.stop();
  });

  it('only invalidates the scope of the changed table and never writes the payload', () => {
    const { client, channels } = fakeSupabase(() => ({}));
    const rt = startRealtime({
      supabase: client,
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
      includeEditorTables: true,
    });

    channels[0]?.emit('cart_assignments', { new: { id: 'x', person_names: ['Intruso'] } });

    expect(invalidated(qk.cartBoard(null))).toBe(true);
    expect(qc.getQueryData(qk.cartBoard(null))).toEqual({ seeded: true });
    expect(invalidated(qk.serviceWeek('2026-10-12'))).toBe(false);
    expect(invalidated(qk.territories)).toBe(false);
    expect(invalidated(qk.people)).toBe(false);

    channels[1]?.emit('person_pairs');
    expect(invalidated(qk.people)).toBe(true);
    rt.stop();
  });

  it('a silent socket rejoin (second SUBSCRIBED) refetches everything; the first does not', () => {
    const { client, channels } = fakeSupabase(() => ({}));
    const rt = startRealtime({
      supabase: client,
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
    });
    channels[0]?.status('SUBSCRIBED');
    expect(invalidated(qk.territories)).toBe(false);
    channels[0]?.status('CHANNEL_ERROR');
    channels[0]?.status('SUBSCRIBED');
    expect(invalidated(qk.territories)).toBe(true);
    expect(invalidated(qk.programWeek('2026-10-12'))).toBe(true);
    rt.stop();
  });

  it('pauses on hidden (channel removed, token refresh stopped) and refetches everything on resume', () => {
    const { client, raw, channels } = fakeSupabase(() => ({}));
    const life = fakeLifecycle();
    const rt = startRealtime({ supabase: client, queryClient: qc, lifecycle: life.lifecycle });

    life.setHidden(true);
    expect(rt.paused).toBe(true);
    expect(raw.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(raw.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);

    life.setHidden(true); // idempotent
    expect(raw.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);

    life.resume(); // platform().onResume
    expect(rt.paused).toBe(false);
    expect(raw.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(2);
    expect(channels[1]?.subscribed).toBe(true);
    // realtime-js reuses channels by topic; a fresh topic avoids re-subscribing a removed one.
    expect(channels[1]?.name).not.toBe(channels[0]?.name);
    expect(invalidated(qk.territories)).toBe(true);
    expect(invalidated(qk.people)).toBe(true);

    // visibilitychange right after onResume must not double-resume.
    life.setHidden(false);
    expect(raw.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(2);
    rt.stop();
  });

  it('starts paused when launched in the background, and stop() releases everything', () => {
    const { client, channels } = fakeSupabase(() => ({}));
    const life = fakeLifecycle(true);
    const rt = startRealtime({ supabase: client, queryClient: qc, lifecycle: life.lifecycle });
    expect(channels).toHaveLength(0);
    life.setHidden(false);
    expect(channels).toHaveLength(1);
    rt.stop();
    expect(life.listeners()).toBe(0);
    life.resume();
    expect(channels).toHaveLength(1);
  });

  it('falls back safely without a DOM or an initialised platform', () => {
    const { client } = fakeSupabase(() => ({}));
    const spy = vi.fn();
    expect(() => {
      const rt = startRealtime({ supabase: client, queryClient: qc });
      spy();
      rt.stop();
    }).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });
});
