/**
 * Query option factories (usable from hooks, router loaders and tests) and the read hooks.
 * Each hook is a thin wrapper so the logic stays testable without React.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { db } from '../client';
import { fetchRole, fetchSession, isEditorRole, type AppRole } from '../repos/auth';
import { fetchCartBoard } from '../repos/carrito';
import { fetchPeople } from '../repos/people';
import { fetchProgramWeek } from '../repos/program';
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
    queryFn: () => fetchServiceWeek(db(), weekStart),
  });

export const territoriesQuery = () =>
  queryOptions({
    queryKey: qk.territories,
    queryFn: () => fetchTerritories(db()),
    staleTime: 60 * 60_000,
  });

export const cartBoardQuery = (scheduleId: string | null = null) =>
  queryOptions({
    queryKey: qk.cartBoard(scheduleId),
    queryFn: () => fetchCartBoard(db(), scheduleId, todayIso()),
  });

export const peopleQuery = () =>
  queryOptions({ queryKey: qk.people, queryFn: () => fetchPeople(db()) });

export const programWeekQuery = (weekStart: string) =>
  queryOptions({
    queryKey: qk.programWeek(weekStart),
    queryFn: () => fetchProgramWeek(db(), weekStart),
  });

/** Kept fresh by `bindAuth` (onAuthStateChange); never refetched on a timer. */
export const sessionQuery = () =>
  queryOptions({ queryKey: qk.session, queryFn: () => fetchSession(db()), staleTime: Infinity });

export const roleQuery = (userId: string | null) =>
  queryOptions({
    queryKey: qk.role(userId),
    queryFn: () => fetchRole(db(), userId),
    staleTime: 5 * 60_000,
  });

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
