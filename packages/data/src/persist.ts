/**
 * Query cache persistence over `platform().storage` (IndexedDB/localStorage on web,
 * Preferences on native). Lets the UI paint instantly from the last known data.
 *
 * Never persisted: session/role (tokens, stale privileges) and `people` (PII); paused
 * mutations touching those scopes are kept in memory only.
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClient, type Persister } from '@tanstack/query-persist-client-core';
import type { Mutation, Query, QueryClient } from '@tanstack/react-query';
import { platform, type KeyValueStorage } from '@territorios/platform';
import { isPrivateKey } from './query/keys';
import { registerMutationDefaults } from './query/mutations';
import { DAY_MS } from './query/policy';
import { SCHEMA_VERSION } from './schemas';

export const PERSIST_KEY = 'tm-query-cache';
export const PERSIST_MAX_AGE = 7 * DAY_MS;

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  return query.state.status === 'success' && !isPrivateKey(query.queryKey);
}

export function shouldPersistMutation(mutation: Pick<Mutation, 'options' | 'state'>): boolean {
  return mutation.state.isPaused && !isPrivateKey(mutation.options.mutationKey);
}

export function createPersister(storage: KeyValueStorage = platform().storage): Persister {
  return createAsyncStoragePersister({ storage, key: PERSIST_KEY, throttleTime: 1_000 });
}

export interface PersistenceHandle {
  /** Resolves once the cache is restored and paused mutations have been resumed. */
  restored: Promise<void>;
  persister: Persister;
  stop(): void;
  /** Wipe the persisted cache (e.g. on sign-out). */
  clear(): Promise<void>;
}

export function startPersistence(
  queryClient: QueryClient,
  opts: { storage?: KeyValueStorage; buster?: string } = {},
): PersistenceHandle {
  // Defaults first: restored paused mutations need their mutationFn back.
  registerMutationDefaults(queryClient);
  const persister = createPersister(opts.storage);
  const [stop, restore] = persistQueryClient({
    queryClient,
    persister,
    maxAge: PERSIST_MAX_AGE,
    buster: opts.buster ?? SCHEMA_VERSION,
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersistQuery,
      shouldDehydrateMutation: shouldPersistMutation,
    },
  });
  const restored = restore.then(async () => {
    await queryClient.resumePausedMutations();
  });
  return {
    restored,
    persister,
    stop,
    clear: async () => {
      await persister.removeClient();
    },
  };
}
