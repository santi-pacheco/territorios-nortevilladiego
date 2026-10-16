import {
  MutationObserver,
  QueryObserver,
  onlineManager,
  type QueryClient,
} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSupabase } from '../client';
import { ConflictError, DataError, NetworkError } from '../errors';
import type { ServiceWeek } from '../repos/salidas';
import { qk } from '../query/keys';
import { mutationOptionsFor, mutations } from '../query/mutations';
import { createQueryClient, retryDelay, shouldRetry } from '../query/policy';
import { serviceWeekQuery } from '../query/queries';
import { startRealtime, type AppLifecycle } from '../realtime';
import type { ServiceMeetingRow } from '../schemas';
import {
  MEETING_ID,
  WEEK_START,
  deferred,
  fakeSupabase,
  flush,
  meetingRow,
  weekRow,
  type FakeResponse,
} from './fakeSupabase';

const noLifecycle: AppLifecycle = {
  isHidden: () => false,
  onVisibilityChange: () => () => {},
  onResume: () => () => {},
};

let qc: QueryClient;

beforeEach(() => {
  // Tiny delays so retry tests stay fast; the policy itself is asserted separately.
  qc = createQueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.mount();
});

afterEach(() => {
  qc.unmount();
  qc.clear();
  onlineManager.setOnline(true);
  setSupabase(null);
});

const update = (conductor: string, version = 1) => ({
  weekStart: WEEK_START,
  id: MEETING_ID,
  version,
  patch: { conductor },
});

function meetingObserver(hooks = {}, over: Record<string, unknown> = {}) {
  return new MutationObserver(qc, {
    ...mutationOptionsFor(qc, mutations.updateMeeting, hooks),
    retryDelay: 1,
    ...over,
  });
}

const cachedConductor = () =>
  qc.getQueryData<ServiceWeek>(qk.serviceWeek(WEEK_START))?.meetings[0]?.conductor;

describe('retry policy', () => {
  it('retries network errors only, with capped exponential backoff', () => {
    const net = new NetworkError('Failed to fetch');
    expect(shouldRetry(0, net)).toBe(true);
    expect(shouldRetry(3, net)).toBe(true);
    expect(shouldRetry(4, net)).toBe(false);
    expect(
      shouldRetry(0, new ConflictError({ table: 't', id: 1, expectedVersion: 1, current: null })),
    ).toBe(false);
    expect(shouldRetry(0, new DataError({ message: 'dup', code: '23505', status: 409 }))).toBe(
      false,
    );
    expect(shouldRetry(0, new Error('boom'))).toBe(false);
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 30000]);
  });

  it('a mutation is retried after network errors and then succeeds', async () => {
    let n = 0;
    const { client, calls } = fakeSupabase((op): FakeResponse => {
      if (op.action !== 'update') return { data: { ...weekRow(), service_meetings: [] } };
      n += 1;
      return n < 3
        ? { error: { message: 'TypeError: Failed to fetch' }, status: 0 }
        : { data: meetingRow({ conductor: 'B', version: 2 }) };
    });
    setSupabase(client);
    const res = await meetingObserver().mutate(update('B'));
    expect((res as ServiceMeetingRow).version).toBe(2);
    expect(calls.filter((c) => c.action === 'update')).toHaveLength(3);
  });

  it('a CAS conflict is never retried: rollback, then onConflict + error exposed', async () => {
    const { client, calls } = fakeSupabase((op) =>
      op.action === 'update'
        ? { data: null }
        : op.table === 'service_meetings'
          ? { data: meetingRow({ conductor: 'Otro', version: 5 }) }
          : {
              data: {
                ...weekRow(),
                service_meetings: [meetingRow({ conductor: 'Otro', version: 5 })],
              },
            },
    );
    setSupabase(client);
    qc.setQueryData(qk.serviceWeek(WEEK_START), {
      week: weekRow(),
      meetings: [meetingRow({ conductor: 'A' })],
    });
    const onConflict = vi.fn();
    const obs = meetingObserver({ onConflict });

    await expect(obs.mutate(update('B'))).rejects.toBeInstanceOf(ConflictError);

    expect(calls.filter((c) => c.action === 'update')).toHaveLength(1);
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict.mock.calls[0]?.[0]).toBeInstanceOf(ConflictError);
    expect(obs.getCurrentResult().error).toBeInstanceOf(ConflictError);
    // Rolled back to the pre-edit value (no observer is mounted, so no refetch replaced it).
    expect(cachedConductor()).toBe('A');
  });
});

describe('realtime own-echo vs optimistic edit', () => {
  it('an echo during an in-flight edit does not clobber the optimistic value; refetch waits for settle', async () => {
    const gate = deferred<FakeResponse>();
    let server = meetingRow({ conductor: 'A', version: 1 });
    const { client, calls, channels } = fakeSupabase((op) => {
      if (op.action === 'update') {
        return gate.promise.then((r) => {
          server = r.data as typeof server;
          return r;
        });
      }
      return { data: { ...weekRow(), service_meetings: [server] } };
    });
    setSupabase(client);

    // A mounted screen showing the week.
    const view = new QueryObserver(qc, serviceWeekQuery(WEEK_START));
    const unsub = view.subscribe(() => {});
    await vi.waitFor(() => expect(cachedConductor()).toBe('A'));
    const reads = () => calls.filter((c) => c.action === 'select').length;
    const readsBefore = reads();

    const rt = startRealtime({ supabase: client, queryClient: qc, lifecycle: noLifecycle });
    const pending = meetingObserver().mutate(update('B'));
    await flush();
    expect(cachedConductor()).toBe('B'); // optimistic

    // Our own write echoes back (or someone else's unrelated change in the same scope).
    channels[0]?.emit('service_meetings');
    await flush();
    await flush();
    expect(reads()).toBe(readsBefore); // no refetch while the edit is in flight
    expect(cachedConductor()).toBe('B');
    expect(qc.getQueryState(qk.serviceWeek(WEEK_START))?.isInvalidated).toBe(true);

    gate.resolve({ data: meetingRow({ conductor: 'B', version: 2 }) });
    await pending;
    await vi.waitFor(() => expect(reads()).toBe(readsBefore + 1)); // settle ⇒ one refetch
    expect(qc.getQueryData<ServiceWeek>(qk.serviceWeek(WEEK_START))?.meetings[0]?.version).toBe(2);

    // With nothing in flight, an event refetches right away.
    channels[0]?.emit('service_weeks');
    await vi.waitFor(() => expect(reads()).toBe(readsBefore + 2));

    rt.stop();
    unsub();
  });
});

describe('offline', () => {
  it('a mutation is paused while offline (optimistic value shown) and resumes when back online', async () => {
    const { client, calls } = fakeSupabase((op) =>
      op.action === 'update'
        ? { data: meetingRow({ conductor: 'B', version: 2 }) }
        : {
            data: { ...weekRow(), service_meetings: [meetingRow({ conductor: 'B', version: 2 })] },
          },
    );
    setSupabase(client);
    qc.setQueryData(qk.serviceWeek(WEEK_START), {
      week: weekRow(),
      meetings: [meetingRow({ conductor: 'A' })],
    });

    onlineManager.setOnline(false);
    const obs = meetingObserver();
    const pending = obs.mutate(update('B'));
    await flush();

    expect(obs.getCurrentResult().isPaused).toBe(true);
    expect(calls.filter((c) => c.action === 'update')).toHaveLength(0);
    expect(cachedConductor()).toBe('B');

    onlineManager.setOnline(true);
    await expect(pending).resolves.toMatchObject({ version: 2 });
    expect(calls.filter((c) => c.action === 'update')).toHaveLength(1);
    expect(obs.getCurrentResult().isPaused).toBe(false);
  });
});
