export * from './schemas';
export * from './errors';
export {
  makeSupabase,
  setSupabase,
  db,
  type TerritoriosClient,
  type MakeSupabaseOptions,
} from './client';

export { addDays, type RowKey } from './repos/base';
export * from './repos/salidas';
export * from './repos/territories';
export * from './repos/carrito';
export * from './repos/people';
export * from './repos/program';
export * from './repos/auth';

export { qk, tableScopes, privateScopes, isPrivateKey } from './query/keys';
export {
  shouldRetry,
  retryDelay,
  MAX_NETWORK_RETRIES,
  queryClientConfig,
  createQueryClient,
} from './query/policy';
export { invalidateScope, invalidateTable } from './query/sync';
export * from './query/queries';
export * from './query/mutations';
export { bindAuth } from './query/auth';

export * from './realtime';
export * from './persist';
