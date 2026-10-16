import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { TableName } from '../schemas';
import { tableScopes } from './keys';

/**
 * Invalidate one scope without clobbering in-flight optimistic edits.
 *
 * While a mutation in this scope is pending, a refetch could land *before* the write commits
 * (or carry our own echo half-applied) and overwrite the optimistic value. So we only mark the
 * queries stale; the last settling mutation of the scope invalidates with a refetch
 * (see `onSettled` in mutations.ts). Never writes payload data into the cache.
 */
export function invalidateScope(qc: QueryClient, scope: QueryKey): Promise<void> {
  if (qc.isMutating({ mutationKey: scope }) > 0) {
    return qc.invalidateQueries({ queryKey: scope, refetchType: 'none' });
  }
  return qc.invalidateQueries({ queryKey: scope });
}

/** Realtime entry point: a row of `table` changed somewhere. */
export async function invalidateTable(qc: QueryClient, table: TableName): Promise<void> {
  await Promise.all(tableScopes[table].map((scope) => invalidateScope(qc, scope)));
}
