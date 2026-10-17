/**
 * Member accounts, "Mis asignaciones" and Web Push subscriptions (docs/ASSIGNMENTS.md).
 * Everything except the push subscriptions goes through SECURITY DEFINER RPCs; the
 * permission checks (linked person, editor, admin) live in the database.
 */
import type { TerritoriosClient } from '../client';
import { DataError } from '../errors';
import {
  AccountRow,
  DeviceTokenRow,
  MyAssignment,
  MyLink,
  MyPermissions,
  type AccountRole,
} from '../schemas';
import { callRpc as rpc, from, insertRow, parseRpcRows, run } from './base';

/**
 * Assignments of the caller's linked person between two YYYY-MM-DD dates (inclusive).
 * Omitted dates use the server defaults (today → today + 90, Buenos Aires time).
 * Empty when the account is not linked.
 */
export async function myAssignments(
  sb: TerritoriosClient,
  fromDate?: string,
  toDate?: string,
): Promise<MyAssignment[]> {
  const args = {
    ...(fromDate ? { p_from: fromDate } : {}),
    ...(toDate ? { p_to: toDate } : {}),
  };
  return parseRpcRows('my_assignments', MyAssignment, await rpc(sb, 'my_assignments', args));
}

/** The people row linked to the caller, or null when not linked ("Vinculado como X"). */
export async function myLink(sb: TerritoriosClient): Promise<MyLink | null> {
  const data = await rpc(sb, 'my_link');
  const first = (Array.isArray(data) ? data[0] : data) as
    { person_id?: unknown } | null | undefined;
  if (!first || first.person_id == null) return null;
  return parseRpcRows('my_link', MyLink, first)[0] ?? null;
}

/** Every auth user with role and linked person. Editor/admin only (42501 otherwise). */
export async function listAccounts(sb: TerritoriosClient): Promise<AccountRow[]> {
  return parseRpcRows('list_accounts', AccountRow, await rpc(sb, 'list_accounts'));
}

/** Editor/admin. `personId` null unlinks. 23505 when the person is linked to another account. */
export async function linkAccount(
  sb: TerritoriosClient,
  userId: string,
  personId: string | null,
): Promise<void> {
  await rpc(sb, 'link_account', { p_user: userId, p_person: personId });
}

/** Admin only. The last admin cannot be demoted (42501). */
export async function setAccountRole(
  sb: TerritoriosClient,
  userId: string,
  role: AccountRole,
): Promise<void> {
  await rpc(sb, 'set_account_role', { p_user: userId, p_role: role });
}

/**
 * The caller's role and effective permissions (docs/PRIVILEGIOS.md). Always one row; a
 * signed-in user without a profile is a viewer with every flag false.
 */
export async function myPermissions(sb: TerritoriosClient): Promise<MyPermissions> {
  const [row] = parseRpcRows('my_permissions', MyPermissions, await rpc(sb, 'my_permissions'));
  return (
    row ?? {
      role: 'viewer',
      can_edit_programa: false,
      can_edit_privilegios: false,
      sees_privilegios: false,
    }
  );
}

/**
 * Admin only (42501 otherwise). Grants/revokes "Puede editar programa" and "Puede editar
 * privilegios"; `null` leaves that flag unchanged.
 */
export async function setAccountPermissions(
  sb: TerritoriosClient,
  userId: string,
  programa: boolean | null,
  privilegios: boolean | null,
): Promise<void> {
  await rpc(sb, 'set_account_permissions', {
    p_user: userId,
    p_programa: programa,
    p_privilegios: privilegios,
  });
}

/** Accepts the PushSubscription itself or its JSON string; the stored token is the string. */
export type WebPushToken = string | { toJSON(): unknown } | Record<string, unknown>;

export function webPushToken(sub: WebPushToken): string {
  if (typeof sub === 'string') return sub;
  return JSON.stringify('toJSON' in sub && typeof sub.toJSON === 'function' ? sub.toJSON() : sub);
}

function endpointOf(token: string): string | null {
  try {
    const e = (JSON.parse(token) as { endpoint?: unknown }).endpoint;
    return typeof e === 'string' ? e : null;
  } catch {
    return null;
  }
}

async function ownWebTokens(sb: TerritoriosClient): Promise<DeviceTokenRow[]> {
  const data = await run(from(sb, 'device_tokens').select('*').eq('platform', 'web'));
  return parseRpcRows('device_tokens', DeviceTokenRow, data);
}

/**
 * Store a Web Push subscription for the signed-in user (device_tokens, platform 'web').
 * Saving the same subscription twice returns the existing row. If the token belongs to
 * another account (same browser, other user) the 23505 is rethrown: RLS hides that row.
 */
export async function saveWebPushSubscription(
  sb: TerritoriosClient,
  sub: WebPushToken,
): Promise<DeviceTokenRow> {
  const token = webPushToken(sub);
  try {
    return await insertRow(sb, 'device_tokens', DeviceTokenRow, { token, platform: 'web' });
  } catch (e) {
    if (!(e instanceof DataError) || !e.isUniqueViolation) throw e;
    const mine = (await ownWebTokens(sb)).find((r) => r.token === token);
    if (mine) return mine;
    throw e;
  }
}

/**
 * Remove the user's rows for this subscription. Matches on the push endpoint, so a
 * re-serialised subscription (different key order) still finds its row.
 */
export async function deleteWebPushSubscription(
  sb: TerritoriosClient,
  sub: WebPushToken,
): Promise<void> {
  const token = webPushToken(sub);
  const endpoint = endpointOf(token);
  const rows = (await ownWebTokens(sb)).filter(
    (r) => r.token === token || (endpoint !== null && endpointOf(r.token) === endpoint),
  );
  for (const r of rows) await run(from(sb, 'device_tokens').delete().eq('id', r.id));
}
