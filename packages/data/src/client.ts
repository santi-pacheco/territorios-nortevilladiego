import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { KeyValueStorage } from '@territorios/platform';

export type TerritoriosClient = SupabaseClient;

export interface MakeSupabaseOptions {
  /** Capacitor shell: no OAuth/magic-link redirects land in the URL. */
  isNative: boolean;
}

/**
 * Supabase client factory. `storage` holds the auth session: pass `platform().secureStorage`
 * (Keychain/Keystore on native). Only the publishable key may ever reach the client.
 */
export function makeSupabase(
  url: string,
  publishableKey: string,
  storage: KeyValueStorage,
  opts: MakeSupabaseOptions,
): TerritoriosClient {
  return createClient(url, publishableKey, {
    auth: {
      storage: {
        getItem: (k) => storage.getItem(k),
        setItem: (k, v) => storage.setItem(k, v),
        removeItem: (k) => storage.removeItem(k),
      },
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !opts.isNative,
    },
  });
}

let current: TerritoriosClient | null = null;

/** Install the app-wide client at boot (same pattern as `setPlatform`). Hooks read it via `db()`. */
export function setSupabase(client: TerritoriosClient | null): void {
  current = client;
}

export function db(): TerritoriosClient {
  if (!current)
    throw new Error('Supabase not initialised: call setSupabase(makeSupabase(...)) at boot');
  return current;
}
