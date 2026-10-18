import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qk } from '../query/keys';
import { createQueryClient } from '../query/policy';
import {
  FOCUS_REFETCH_THROTTLE_MS,
  PUBLIC_REALTIME_TABLES,
  REALTIME_TABLES,
  REFETCH_ON_FOCUS_TABLES,
  startRealtime,
  startRealtimeWhenReady,
  type AppLifecycle,
} from '../realtime';
import { fakeSupabase } from './fakeSupabase';

function fakeLifecycle(hidden = false) {
  let isHidden = hidden;
  const vis = new Set<() => void>();
  const res = new Set<() => void>();
  const foc = new Set<() => void>();
  const lifecycle: AppLifecycle = {
    isHidden: () => isHidden,
    onVisibilityChange: (cb) => (vis.add(cb), () => vis.delete(cb)),
    onResume: (cb) => (res.add(cb), () => res.delete(cb)),
    onFocus: (cb) => (foc.add(cb), () => foc.delete(cb)),
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
    focus() {
      foc.forEach((cb) => cb());
    },
    listeners: () => vis.size + res.size + foc.size,
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
    qk.peopleDirectory,
    qk.dutyRoster('2026-10-01', '2026-10-31'),
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
  it('subscribes to the public tables only, on one channel, for every role', () => {
    const { client, channels } = fakeSupabase(() => ({}));
    const rt = startRealtime({
      supabase: client,
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
    });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.subscribed).toBe(true);
    expect(tablesOf(channels[0])).toEqual([...PUBLIC_REALTIME_TABLES].sort());
    expect([...REALTIME_TABLES].sort()).toEqual([...PUBLIC_REALTIME_TABLES].sort());
    // The restricted tables are not published (DELETE events skip RLS): never subscribed.
    for (const t of REFETCH_ON_FOCUS_TABLES) expect(tablesOf(channels[0])).not.toContain(t);
    rt.stop();
  });

  it('window focus refetches the restricted scopes only, throttled', () => {
    const { client } = fakeSupabase(() => ({}));
    const life = fakeLifecycle();
    let t = 1_000_000;
    const rt = startRealtime({
      supabase: client,
      queryClient: qc,
      lifecycle: life.lifecycle,
      now: () => t,
    });
    life.focus();
    expect(invalidated(qk.people)).toBe(true);
    expect(invalidated(qk.peopleDirectory)).toBe(true);
    expect(invalidated(qk.dutyRoster('2026-10-01', '2026-10-31'))).toBe(true);
    expect(invalidated(qk.territories)).toBe(false);
    expect(invalidated(qk.cartBoard(null))).toBe(false);

    // A second focus inside the throttle window does nothing.
    qc.setQueryData(qk.people, { seeded: 2 });
    t += FOCUS_REFETCH_THROTTLE_MS - 1;
    life.focus();
    expect(invalidated(qk.people)).toBe(false);
    t += 1;
    life.focus();
    expect(invalidated(qk.people)).toBe(true);
    rt.stop();
  });

  it('focus while paused does nothing; resume counts as the refetch', () => {
    const { client } = fakeSupabase(() => ({}));
    const life = fakeLifecycle(true);
    let t = 5_000_000;
    const rt = startRealtime({
      supabase: client,
      queryClient: qc,
      lifecycle: life.lifecycle,
      now: () => t,
    });
    life.focus();
    expect(invalidated(qk.people)).toBe(false);
    life.setHidden(false); // resume → everything invalidated
    expect(invalidated(qk.people)).toBe(true);
    qc.setQueryData(qk.people, { seeded: 3 });
    t += 1;
    life.focus(); // the focus event that follows the visibility change is throttled away
    expect(invalidated(qk.people)).toBe(false);
    rt.stop();
  });

  it('only invalidates the scope of the changed table and never writes the payload', () => {
    const { client, channels } = fakeSupabase(() => ({}));
    const rt = startRealtime({
      supabase: client,
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
    });

    channels[0]?.emit('cart_assignments', { new: { id: 'x', person_names: ['Intruso'] } });

    expect(invalidated(qk.cartBoard(null))).toBe(true);
    expect(qc.getQueryData(qk.cartBoard(null))).toEqual({ seeded: true });
    expect(invalidated(qk.serviceWeek('2026-10-12'))).toBe(false);
    expect(invalidated(qk.territories)).toBe(false);
    expect(invalidated(qk.people)).toBe(false);
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

describe('startRealtimeWhenReady', () => {
  it('starts once the client loads', async () => {
    const sb = fakeSupabase(() => ({}));
    let resolve!: (c: typeof sb.client) => void;
    const loading = new Promise<typeof sb.client>((r) => (resolve = r));
    const rt = startRealtimeWhenReady(loading, {
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
    });
    expect(rt.paused).toBe(true);
    expect(sb.channels).toHaveLength(0);
    resolve(sb.client);
    await loading;
    await Promise.resolve();
    expect(rt.paused).toBe(false);
    expect(sb.channels.map((c) => tablesOf(c))).toEqual([[...PUBLIC_REALTIME_TABLES].sort()]);
    rt.stop();
  });

  it('never subscribes when stopped before the client loads, and survives a failed load', async () => {
    const sb = fakeSupabase(() => ({}));
    const ready = Promise.resolve(sb.client);
    const rt = startRealtimeWhenReady(ready, {
      queryClient: qc,
      lifecycle: fakeLifecycle().lifecycle,
    });
    rt.stop();
    await ready;
    await Promise.resolve();
    expect(sb.channels).toHaveLength(0);

    const failed = Promise.reject(new Error('chunk load failed'));
    const rt2 = startRealtimeWhenReady(failed, { queryClient: qc });
    await failed.catch(() => {});
    expect(rt2.paused).toBe(true);
    rt2.stop();
  });
});
