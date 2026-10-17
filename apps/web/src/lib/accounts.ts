/**
 * Member accounts, "Mis asignaciones" and Web Push subscriptions (docs/ASSIGNMENTS.md).
 * The RPC wrappers and hooks live in @territorios/data; the screens import them from here,
 * next to the one piece that is web-only: the Google sign-in redirect.
 */
import { withDb } from '@territorios/data';

export {
  deleteWebPushSubscription,
  saveWebPushSubscription,
  useAccounts,
  useLinkAccount,
  useMyAssignments,
  useMyLink,
  useSetAccountRole,
  type AccountRole,
  type AccountRow,
  type AssignmentKind,
  type MyAssignment,
  type MyLink,
} from '@territorios/data';

/** Members sign in with Google and land back on their assignments. */
export function signInWithGoogle(): Promise<void> {
  return withDb(async (sb) => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/mis-asignaciones` },
    });
    if (error) throw new Error(error.message);
  });
}
