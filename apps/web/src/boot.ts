import { platform, setPlatform, type Platform } from '@territorios/platform';
import {
  bindAuth,
  createQueryClient,
  makeSupabase,
  setSupabase,
  startPersistence,
  startRealtime,
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

/** Wires platform → Supabase → Query cache → persistence → realtime, in that order. */
export function boot(native?: Platform): Boot {
  setPlatform(native ?? webPlatform());
  const queryClient = createQueryClient();
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) {
    return { queryClient, realtime: null, clearPersisted: async () => {}, configured: false };
  }
  const sb = makeSupabase(url, key, platform().secureStorage, { isNative: platform().kind !== 'web' });
  setSupabase(sb);
  const persistence = startPersistence(queryClient);
  bindAuth(queryClient, sb);
  const realtime = startRealtime({ supabase: sb, queryClient });
  return { queryClient, realtime, clearPersisted: () => persistence.clear(), configured: true };
}
