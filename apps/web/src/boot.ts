import { platform, setPlatform, type Platform } from '@territorios/platform';
import {
  bindAuth,
  createQueryClient,
  makeSupabase,
  setSupabase,
  startPersistence,
  startRealtimeWhenReady,
  type RealtimeHandle,
} from '@territorios/data';
import type { QueryClient } from '@tanstack/react-query';
import { webPlatform } from './platform/web';

export interface Boot {
  queryClient: QueryClient;
  realtime: RealtimeHandle | null;
  clearPersisted: () => Promise<void>;
  configured: boolean;
}

/**
 * Wires platform → Supabase → Query cache → persistence → realtime, in that order.
 * supabase-js is a lazy chunk: its download starts here, before the first render, while the
 * persisted cache paints. Queries wait for it (withDb); auth and realtime bind once it loads.
 */
export function boot(native?: Platform): Boot {
  setPlatform(native ?? webPlatform());
  const queryClient = createQueryClient();
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) {
    return { queryClient, realtime: null, clearPersisted: async () => {}, configured: false };
  }
  const sb = makeSupabase(url, key, platform().secureStorage, {
    isNative: platform().kind !== 'web',
  });
  setSupabase(sb);
  const persistence = startPersistence(queryClient);
  // A failed load surfaces through the queries (withDb rejects); nothing to bind then.
  sb.then(
    (client) => bindAuth(queryClient, client),
    () => {},
  );
  const realtime = startRealtimeWhenReady(sb, { queryClient });
  return { queryClient, realtime, clearPersisted: () => persistence.clear(), configured: true };
}
