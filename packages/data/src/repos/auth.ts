import type { Session } from '@supabase/supabase-js';
import type { TerritoriosClient } from '../client';
import { DataError, NetworkError } from '../errors';
import { ProfileRow, ProfileUpdate, type Role } from '../schemas';
import { casUpdate, fetchByKey, parsePayload } from './base';

/** `anon` = not logged in. A logged-in user without a profile row is a `viewer`. */
export type AppRole = 'anon' | Role;

export async function fetchSession(sb: TerritoriosClient): Promise<Session | null> {
  const { data, error } = await sb.auth.getSession();
  if (error) {
    if (error.name === 'AuthRetryableFetchError')
      throw new NetworkError(error.message, { cause: error });
    throw new DataError({
      message: error.message,
      code: error.code ?? 'auth',
      status: error.status ?? 0,
    });
  }
  return data.session;
}

/** Read from the caller's own `profiles` row (RLS: own row only). Never from the JWT. */
export async function fetchRole(sb: TerritoriosClient, userId: string | null): Promise<AppRole> {
  if (!userId) return 'anon';
  const profile = await fetchByKey(sb, 'profiles', ProfileRow, { id: userId });
  return profile?.role ?? 'viewer';
}

export async function fetchProfile(
  sb: TerritoriosClient,
  userId: string,
): Promise<ProfileRow | null> {
  return fetchByKey(sb, 'profiles', ProfileRow, { id: userId });
}

/** Only display_name is writable by the user (column grant). */
export async function updateDisplayName(
  sb: TerritoriosClient,
  userId: string,
  expectedVersion: number,
  patch: ProfileUpdate,
): Promise<ProfileRow> {
  return casUpdate(
    sb,
    'profiles',
    ProfileRow,
    { id: userId },
    expectedVersion,
    parsePayload('profiles', ProfileUpdate, patch),
  );
}

export const isEditorRole = (r: AppRole | undefined): boolean => r === 'editor' || r === 'admin';
