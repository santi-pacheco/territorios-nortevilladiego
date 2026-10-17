import type { QueryKey } from '@tanstack/react-query';
import type { TableName } from '../schemas';

/**
 * Query keys. Every key starts with a feature *scope* (e.g. ['tm','salidas']); realtime,
 * mutations and persistence all work at scope granularity.
 */
export const qk = {
  all: ['tm'] as const,

  salidas: ['tm', 'salidas'] as const,
  serviceWeek: (weekStart: string) => ['tm', 'salidas', 'week', weekStart] as const,

  territories: ['tm', 'territories'] as const,

  cart: ['tm', 'cart'] as const,
  cartBoards: ['tm', 'cart', 'board'] as const,
  /** `scheduleId` null = "the schedule covering today". */
  cartBoard: (scheduleId: string | null) =>
    ['tm', 'cart', 'board', scheduleId ?? 'current'] as const,

  /** Editor-only PII. Never persisted, dropped on sign-out. */
  people: ['tm', 'people'] as const,

  program: ['tm', 'program'] as const,
  programWeek: (weekStart: string) => ['tm', 'program', 'week', weekStart] as const,

  /** Session + role. Never persisted (tokens / stale privileges). */
  auth: ['tm', 'auth'] as const,
  session: ['tm', 'auth', 'session'] as const,
  role: (userId: string | null) => ['tm', 'auth', 'role', userId ?? 'anon'] as const,
  // Account data lives under the private auth scope: never persisted, dropped on sign-out.
  myLink: (userId: string | null) => ['tm', 'auth', 'my-link', userId ?? 'anon'] as const,
  myAssignmentsAll: ['tm', 'auth', 'my-assignments'] as const,
  myAssignments: (userId: string | null, from: string, to: string) =>
    ['tm', 'auth', 'my-assignments', userId ?? 'anon', from, to] as const,
  accounts: ['tm', 'auth', 'accounts'] as const,
  webPush: ['tm', 'auth', 'web-push'] as const,
} as const;

/** Which scopes a change to `table` can affect. */
/** "Mis asignaciones" is derived server-side from salidas, carrito and programa rows. */
export const tableScopes: Record<TableName, readonly QueryKey[]> = {
  territories: [qk.territories],
  service_weeks: [qk.salidas, qk.myAssignmentsAll],
  service_meetings: [qk.salidas, qk.myAssignmentsAll],
  cart_places: [qk.cart, qk.myAssignmentsAll],
  cart_slots: [qk.cart, qk.myAssignmentsAll],
  cart_schedules: [qk.cart],
  cart_assignments: [qk.cart, qk.myAssignmentsAll],
  cart_blackouts: [qk.cart, qk.myAssignmentsAll],
  // A rename/delete rewrites cart_assignments.person_names too (that table fires its own event).
  people: [qk.people],
  person_availability: [qk.people],
  person_pairs: [qk.people],
  program_weeks: [qk.program, qk.myAssignmentsAll],
  profiles: [qk.auth],
  device_tokens: [],
};

/** Scopes that must never reach the non-sensitive persisted cache. */
export const privateScopes: readonly QueryKey[] = [qk.auth, qk.people];

export function startsWith(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((p, i) => key[i] === p);
}

export function isPrivateKey(key: QueryKey | undefined): boolean {
  return !!key && privateScopes.some((s) => startsWith(key, s));
}
