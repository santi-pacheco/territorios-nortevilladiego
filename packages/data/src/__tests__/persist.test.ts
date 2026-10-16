import { persistQueryClientSave } from '@tanstack/query-persist-client-core';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import type { KeyValueStorage } from '@territorios/platform';
import { afterEach, describe, expect, it } from 'vitest';
import { setSupabase } from '../client';
import { qk } from '../query/keys';
import { mutationOptionsFor, mutations } from '../query/mutations';
import { createQueryClient } from '../query/policy';
import {
  PERSIST_KEY,
  createPersister,
  shouldPersistMutation,
  shouldPersistQuery,
  startPersistence,
} from '../persist';
import { SCHEMA_VERSION } from '../schemas';
import { MEETING_ID, WEEK_START, fakeSupabase, flush, meetingRow } from './fakeSupabase';

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

afterEach(() => {
  onlineManager.setOnline(true);
  setSupabase(null);
});

describe('persistence filters', () => {
  it('never persists session/role or people (PII), nor unfinished queries', () => {
    const ok = { status: 'success' } as never;
    expect(shouldPersistQuery({ queryKey: qk.territories, state: ok })).toBe(true);
    expect(shouldPersistQuery({ queryKey: qk.session, state: ok })).toBe(false);
    expect(shouldPersistQuery({ queryKey: qk.role('u1'), state: ok })).toBe(false);
    expect(shouldPersistQuery({ queryKey: qk.people, state: ok })).toBe(false);
    expect(
      shouldPersistQuery({ queryKey: qk.territories, state: { status: 'pending' } as never }),
    ).toBe(false);

    const paused = { isPaused: true } as never;
    expect(
      shouldPersistMutation({
        options: { mutationKey: mutations.updateMeeting.key },
        state: paused,
      }),
    ).toBe(true);
    expect(
      shouldPersistMutation({
        options: { mutationKey: mutations.updatePerson.key },
        state: paused,
      }),
    ).toBe(false);
    expect(
      shouldPersistMutation({
        options: { mutationKey: mutations.updateMeeting.key },
        state: { isPaused: false } as never,
      }),
    ).toBe(false);
  });
});

describe('startPersistence', () => {
  it('restores a cache saved with the same buster and resumes a paused offline edit after "reload"', async () => {
    const storage = memoryStorage();

    // Session 1: offline edit → paused mutation + cached data are saved.
    const before = createQueryClient();
    before.setQueryData(qk.territories, [{ id: 1 }]);
    before.setQueryData(qk.people, { people: [{ name: 'Persona Uno' }] });
    onlineManager.setOnline(false);
    void new MutationObserver(before, mutationOptionsFor(before, mutations.updateMeeting))
      .mutate({ weekStart: WEEK_START, id: MEETING_ID, version: 1, patch: { conductor: 'B' } })
      .catch(() => {});
    await flush();
    await persistQueryClientSave({
      queryClient: before,
      persister: createPersister(storage),
      buster: SCHEMA_VERSION,
      dehydrateOptions: {
        shouldDehydrateQuery: shouldPersistQuery,
        shouldDehydrateMutation: shouldPersistMutation,
      },
    });
    const saved = storage.map.get(PERSIST_KEY) ?? '';
    expect(saved).toContain('updateMeeting');
    expect(saved).not.toContain('Persona Uno');
    before.clear();

    // Session 2: back online, fresh client.
    onlineManager.setOnline(true);
    const { client, calls } = fakeSupabase(() => ({
      data: meetingRow({ conductor: 'B', version: 2 }),
    }));
    setSupabase(client);
    const after = createQueryClient();
    after.mount();
    const handle = startPersistence(after, { storage });
    await handle.restored;
    await flush();

    expect(after.getQueryData(qk.territories)).toEqual([{ id: 1 }]);
    expect(after.getQueryData(qk.people)).toBeUndefined();
    expect(calls.filter((c) => c.action === 'update')).toHaveLength(1);
    expect(calls[0]?.values).toEqual({ conductor: 'B' });

    handle.stop();
    after.unmount();
    after.clear();
  });

  it('drops a cache written under another schema version (buster)', async () => {
    const storage = memoryStorage();
    const old = createQueryClient();
    old.setQueryData(qk.territories, [{ id: 1 }]);
    await persistQueryClientSave({
      queryClient: old,
      persister: createPersister(storage),
      buster: 'old-schema',
    });

    const qc = createQueryClient();
    const handle = startPersistence(qc, { storage });
    await handle.restored;
    expect(qc.getQueryData(qk.territories)).toBeUndefined();
    handle.stop();
    qc.clear();
  });
});
