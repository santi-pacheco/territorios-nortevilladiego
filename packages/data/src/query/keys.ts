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
  /** Program editor: every row between two dates. */
  programRange: (from: string, to: string) => ['tm', 'program', 'range', from, to] as const,

  /**
   * People directory derived data (name_sources). Editor-only, never persisted. Its own scope
   * (not under `people`) so roster optimistic patches never touch it.
   */
  directory: ['tm', 'directory'] as const,
  nameSources: ['tm', 'directory', 'name-sources'] as const,
  /** people_directory(): the schedule person pickers (editors, programa, privilegios). */
  peopleDirectory: ['tm', 'directory', 'people'] as const,

  /** Privilegios roster + its pickers. Restricted (RLS), never persisted, dropped on sign-out. */
  privilegios: ['tm', 'privilegios'] as const,
  dutyRoster: (from: string, to: string) => ['tm', 'privilegios', 'roster', from, to] as const,
  dutyPeople: ['tm', 'privilegios', 'people'] as const,

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
  myPermissions: (userId: string | null) =>
    ['tm', 'auth', 'permissions', userId ?? 'anon'] as const,
  webPush: ['tm', 'auth', 'web-push'] as const,
} as const;

/** Which scopes a change to `table` can affect. */
/** "Mis asignaciones" is derived server-side from salidas, carrito and programa rows. */
export const tableScopes: Record<TableName, readonly QueryKey[]> = {
  territories: [qk.territories],
  service_weeks: [qk.salidas, qk.myAssignmentsAll],
  // Conductor names feed name_sources().
  service_meetings: [qk.salidas, qk.myAssignmentsAll, qk.directory],
  cart_places: [qk.cart, qk.myAssignmentsAll],
  cart_slots: [qk.cart, qk.myAssignmentsAll],
  cart_schedules: [qk.cart],
  cart_assignments: [qk.cart, qk.myAssignmentsAll],
  cart_blackouts: [qk.cart, qk.myAssignmentsAll],
  // A rename/delete rewrites cart_assignments.person_names and duty_roster.person_name too
  // (those tables fire their own events); names/aliases/duties also change the directory
  // matches and the duty pickers.
  people: [qk.people, qk.directory, qk.privilegios],
  person_availability: [qk.people],
  person_pairs: [qk.people],
  program_weeks: [qk.program, qk.myAssignmentsAll, qk.directory],
  profiles: [qk.auth],
  device_tokens: [],
  duty_roster: [qk.privilegios, qk.myAssignmentsAll, qk.directory],
  duty_days: [qk.privilegios, qk.myAssignmentsAll],
};

/** Scopes that must never reach the non-sensitive persisted cache. */
export const privateScopes: readonly QueryKey[] = [
  qk.auth,
  qk.people,
  qk.directory,
  qk.privilegios,
];

export function startsWith(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((p, i) => key[i] === p);
}

export function isPrivateKey(key: QueryKey | undefined): boolean {
  return !!key && privateScopes.some((s) => startsWith(key, s));
}
