/**
 * Query option factories (usable from hooks, router loaders and tests) and the read hooks.
 * Each hook is a thin wrapper so the logic stays testable without React.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { withDb } from '../client';
import { listAccounts, myAssignments, myLink, myPermissions } from '../repos/accounts';
import { fetchRole, fetchSession, isEditorRole, type AppRole } from '../repos/auth';
import { addDays } from '../repos/base';
import { fetchCartBoard } from '../repos/carrito';
import {
  fetchDutyPeople,
  fetchNameSources,
  fetchPeople,
  fetchPeopleDirectory,
} from '../repos/people';
import { fetchDutyRoster } from '../repos/privilegios';
import { fetchProgramWeek, fetchProgramWeeks } from '../repos/program';
import { fetchServiceWeek } from '../repos/salidas';
import { fetchTerritories } from '../repos/territories';
import { qk } from './keys';

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export const serviceWeekQuery = (weekStart: string) =>
  queryOptions({
    queryKey: qk.serviceWeek(weekStart),
    queryFn: () => withDb((sb) => fetchServiceWeek(sb, weekStart)),
  });

export const territoriesQuery = () =>
  queryOptions({
    queryKey: qk.territories,
    queryFn: () => withDb(fetchTerritories),
    staleTime: 60 * 60_000,
  });

export const cartBoardQuery = (scheduleId: string | null = null) =>
  queryOptions({
    queryKey: qk.cartBoard(scheduleId),
    queryFn: () => withDb((sb) => fetchCartBoard(sb, scheduleId, todayIso())),
  });

export const peopleQuery = () =>
  queryOptions({ queryKey: qk.people, queryFn: () => withDb(fetchPeople) });

export const programWeekQuery = (weekStart: string) =>
  queryOptions({
    queryKey: qk.programWeek(weekStart),
    queryFn: () => withDb((sb) => fetchProgramWeek(sb, weekStart)),
  });

/** Kept fresh by `bindAuth` (onAuthStateChange); never refetched on a timer. */
export const sessionQuery = () =>
  queryOptions({ queryKey: qk.session, queryFn: () => withDb(fetchSession), staleTime: Infinity });

export const roleQuery = (userId: string | null) =>
  queryOptions({
    queryKey: qk.role(userId),
    queryFn: () => withDb((sb) => fetchRole(sb, userId)),
    staleTime: 5 * 60_000,
  });

export const myLinkQuery = (userId: string | null) =>
  queryOptions({
    queryKey: qk.myLink(userId),
    queryFn: () => withDb(myLink),
    staleTime: 5 * 60_000,
  });

/** `from`/`to` are YYYY-MM-DD (inclusive). */
export const myAssignmentsQuery = (userId: string | null, from: string, to: string) =>
  queryOptions({
    queryKey: qk.myAssignments(userId, from, to),
    queryFn: () => withDb((sb) => myAssignments(sb, from, to)),
    staleTime: 60_000,
  });

export const accountsQuery = () =>
  queryOptions({ queryKey: qk.accounts, queryFn: () => withDb(listAccounts) });

export const myPermissionsQuery = (userId: string | null) =>
  queryOptions({
    queryKey: qk.myPermissions(userId),
    queryFn: () => withDb(myPermissions),
    staleTime: 5 * 60_000,
  });

/** `from`/`to` are YYYY-MM-DD (inclusive). */
export const programWeeksQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: qk.programRange(from, to),
    queryFn: () => withDb((sb) => fetchProgramWeeks(sb, from, to)),
  });

export const nameSourcesQuery = () =>
  queryOptions({ queryKey: qk.nameSources, queryFn: () => withDb(fetchNameSources) });

/** `from`/`to` are YYYY-MM-DD (inclusive). */
export const dutyRosterQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: qk.dutyRoster(from, to),
    queryFn: () => withDb((sb) => fetchDutyRoster(sb, from, to)),
  });

export const dutyPeopleQuery = () =>
  queryOptions({ queryKey: qk.dutyPeople, queryFn: () => withDb(fetchDutyPeople) });

export const peopleDirectoryQuery = () =>
  queryOptions({ queryKey: qk.peopleDirectory, queryFn: () => withDb(fetchPeopleDirectory) });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
/** `weekStart` is the Monday (YYYY-MM-DD). */
export const useServiceWeek = (weekStart: string) => useQuery(serviceWeekQuery(weekStart));
export const useTerritories = () => useQuery(territoriesQuery());
/** Omit `scheduleId` for the schedule covering today. */
export const useCartSchedule = (scheduleId: string | null = null) =>
  useQuery(cartBoardQuery(scheduleId));
/** Editor-only data: disabled unless the caller's role is editor/admin (override with `enabled`). */
export function usePeople(opts: { enabled?: boolean } = {}) {
  const { isEditor } = useRole();
  return useQuery({ ...peopleQuery(), enabled: opts.enabled ?? isEditor });
}
/** `weekStart` is the Monday; returns the Tuesday (midweek) and Saturday (weekend) rows. */
export const useProgramWeek = (weekStart: string) => useQuery(programWeekQuery(weekStart));
export const useSession = () => useQuery(sessionQuery());

export interface RoleState {
  role: AppRole | undefined;
  isEditor: boolean;
  isLoading: boolean;
}

/** Role from the caller's own profiles row (missing row ⇒ viewer, no session ⇒ anon). */
export function useRole(): RoleState {
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const role = useQuery({ ...roleQuery(userId), enabled: session.isSuccess });
  return {
    role: role.data,
    isEditor: isEditorRole(role.data),
    isLoading: session.isPending || role.isPending,
  };
}

/** The caller's linked person (null = not linked). Disabled without a session. */
export function useMyLink() {
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  return useQuery({ ...myLinkQuery(userId), enabled: userId !== null });
}

/**
 * Assignments of the caller's linked person, today (local) → +90 days by default.
 * Empty array when not linked. Disabled without a session.
 */
export function useMyAssignments(opts: { from?: string; to?: string; enabled?: boolean } = {}) {
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const from = opts.from ?? todayIso();
  const to = opts.to ?? addDays(from, 90);
  return useQuery({
    ...myAssignmentsQuery(userId, from, to),
    enabled: userId !== null && (opts.enabled ?? true),
  });
}

/** Gestión ▸ Usuarios. Editor-only: disabled unless the caller is editor/admin. */
export function useAccounts(opts: { enabled?: boolean } = {}) {
  const { isEditor } = useRole();
  return useQuery({ ...accountsQuery(), enabled: opts.enabled ?? isEditor });
}

/**
 * The caller's role and effective permissions (`can_edit_programa_midweek`,
 * `can_edit_programa_weekend`, `can_edit_privilegios`, `sees_privilegios`). Disabled without a
 * session (data undefined ⇒ treat as all false).
 */
export function useMyPermissions() {
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  return useQuery({ ...myPermissionsQuery(userId), enabled: userId !== null });
}

/** Program editor: rows between two dates (e.g. a month). Public read. */
export const useProgramWeeks = (from: string, to: string) => useQuery(programWeeksQuery(from, to));

/** Gestión ▸ Personas "Nombres sin vincular". Editor-only: disabled unless editor/admin. */
export function useNameSources(opts: { enabled?: boolean } = {}) {
  const { isEditor } = useRole();
  return useQuery({ ...nameSourcesQuery(), enabled: opts.enabled ?? isEditor });
}

/**
 * Privilegios table (`rows` + `days`) between two dates. Enabled when my_permissions says
 * `sees_privilegios` (override with `enabled`).
 */
export function useDutyRoster(from: string, to: string, opts: { enabled?: boolean } = {}) {
  const perms = useMyPermissions();
  return useQuery({
    ...dutyRosterQuery(from, to),
    enabled: opts.enabled ?? perms.data?.sees_privilegios === true,
  });
}

/** Person pickers for Gestión ▸ Privilegios. Enabled when the caller can edit privilegios. */
export function useDutyPeople(opts: { enabled?: boolean } = {}) {
  const perms = useMyPermissions();
  return useQuery({
    ...dutyPeopleQuery(),
    enabled: opts.enabled ?? perms.data?.can_edit_privilegios === true,
  });
}

/**
 * Everyone, for the schedule person pickers (Salidas, Programa, Privilegios). Enabled for
 * editors and for either program grant / can_edit_privilegios (override with `enabled`).
 */
export function usePeopleDirectory(opts: { enabled?: boolean } = {}) {
  const perms = useMyPermissions();
  const allowed =
    perms.data?.can_edit_programa_midweek === true ||
    perms.data?.can_edit_programa_weekend === true ||
    perms.data?.can_edit_privilegios === true;
  return useQuery({ ...peopleDirectoryQuery(), enabled: opts.enabled ?? allowed });
}
