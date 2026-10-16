import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';
import { isNetworkError } from '../errors';

export const MAX_NETWORK_RETRIES = 4;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * Retry only when the request never reached the server. ConflictError (CAS), DataError
 * (RLS, constraints, 23505) and SchemaError are deterministic: retrying cannot help.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return isNetworkError(error) && failureCount < MAX_NETWORK_RETRIES;
}

/** Exponential backoff: 1 s, 2 s, 4 s, 8 s … capped at 30 s. `attempt` is 0-based. */
export function retryDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Must be >= the persister maxAge, or restored queries are garbage-collected at once.
      gcTime: 7 * DAY_MS,
      retry: shouldRetry,
      retryDelay,
      // Paint from the persisted cache; Realtime + resume invalidation keep it fresh.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: shouldRetry,
      retryDelay,
      // Offline → the mutation is paused and resumes when onlineManager reports online.
      networkMode: 'online',
    },
  },
};

export function createQueryClient(config: QueryClientConfig = {}): QueryClient {
  return new QueryClient({
    ...config,
    defaultOptions: {
      queries: { ...queryClientConfig.defaultOptions?.queries, ...config.defaultOptions?.queries },
      mutations: {
        ...queryClientConfig.defaultOptions?.mutations,
        ...config.defaultOptions?.mutations,
      },
    },
  });
}
