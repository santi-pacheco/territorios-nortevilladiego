import type { SupabaseClient } from '@supabase/supabase-js';
import type { KeyValueStorage } from '@territorios/platform';

export type TerritoriosClient = SupabaseClient;

export interface MakeSupabaseOptions {
  /** Capacitor shell: no OAuth/magic-link redirects land in the URL. */
  isNative: boolean;
}

/**
 * Supabase client factory. `storage` holds the auth session: pass `platform().secureStorage`
 * (Keychain/Keystore on native). Only the publishable key may ever reach the client.
 *
 * supabase-js is loaded with a dynamic import so it stays out of the entry chunk: the
 * persisted query cache paints first, and queries wait for the client via `withDb`.
 */
export async function makeSupabase(
  url: string,
  publishableKey: string,
  storage: KeyValueStorage,
  opts: MakeSupabaseOptions,
): Promise<TerritoriosClient> {
  const { createClient } = await import('@supabase/supabase-js');
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
let loading: Promise<TerritoriosClient> | null = null;

const notInitialised = () =>
  new Error('Supabase not initialised: call setSupabase(makeSupabase(...)) at boot');

/**
 * Install the app-wide client at boot (same pattern as `setPlatform`). Hooks read it via
 * `withDb` / `db()`. A promise registers a client that is still loading.
 */
export function setSupabase(client: TerritoriosClient | Promise<TerritoriosClient> | null): void {
  if (client instanceof Promise) {
    current = null;
    const p: Promise<TerritoriosClient> = client.then((c) => {
      if (loading === p) {
        current = c;
        loading = null;
      }
      return c;
    });
    loading = p;
    return;
  }
  current = client;
  loading = null;
}

/** The ready client. Throws while it is still loading: event handlers only, never at render. */
export function db(): TerritoriosClient {
  if (!current) throw notInitialised();
  return current;
}

/**
 * Run `fn` with the client: synchronously when it is ready, after it loads otherwise.
 * Throws (or rejects) when no client was ever registered, e.g. a build without credentials.
 */
export function withDb<T>(fn: (sb: TerritoriosClient) => Promise<T>): Promise<T> {
  if (current) return fn(current);
  if (loading) return loading.then(fn);
  return Promise.reject(notInitialised());
}
