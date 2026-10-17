import type { QueryClient } from '@tanstack/react-query';
import type { TerritoriosClient } from '../client';
import { qk } from './keys';

/**
 * Mirror Supabase auth into the query cache: the session query follows onAuthStateChange,
 * the role is refetched from `profiles`, and editor-only data is dropped on sign-out.
 * The callback only touches the cache (awaiting Supabase calls inside it can deadlock).
 */
export function bindAuth(qc: QueryClient, sb: TerritoriosClient): () => void {
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    qc.setQueryData(qk.session, session);
    if (event === 'SIGNED_OUT') {
      qc.removeQueries({ queryKey: qk.people });
      qc.removeQueries({ queryKey: [...qk.auth, 'role'] });
      qc.removeQueries({ queryKey: [...qk.auth, 'my-link'] });
      qc.removeQueries({ queryKey: qk.myAssignmentsAll });
      qc.removeQueries({ queryKey: qk.accounts });
      return;
    }
    if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
      void qc.invalidateQueries({ queryKey: [...qk.auth, 'role'] });
    }
  });
  return () => data.subscription.unsubscribe();
}
