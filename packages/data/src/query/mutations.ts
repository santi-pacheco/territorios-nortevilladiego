/**
 * Mutations: optimistic update + rollback, CAS conflicts surfaced (never retried), network
 * errors retried with exponential backoff, paused while offline (networkMode 'online').
 *
 * Every mutation has a stable `mutationKey` = [...scope, name] so that
 *  - `isMutating({ mutationKey: scope })` tells realtime to hold back refetches (sync.ts), and
 *  - `registerMutationDefaults` can give persisted, paused mutations their `mutationFn`
 *    back after a reload (functions are not serialisable).
 */
import {
  useMutation,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { withDb, type TerritoriosClient } from '../client';
import { ConflictError } from '../errors';
import * as accountsRepo from '../repos/accounts';
import * as authRepo from '../repos/auth';
import type { CartBoard } from '../repos/carrito';
import * as cartRepo from '../repos/carrito';
import type { PeopleRoster } from '../repos/people';
import * as peopleRepo from '../repos/people';
import type { DutyRoster } from '../repos/privilegios';
import * as privilegiosRepo from '../repos/privilegios';
import type { ProgramWeek } from '../repos/program';
import * as programRepo from '../repos/program';
import type { ServiceWeek } from '../repos/salidas';
import * as salidasRepo from '../repos/salidas';
import * as territoriesRepo from '../repos/territories';
import type {
  AccountRole,
  CartAssignmentInsert,
  CartAssignmentUpdate,
  CartBlackoutInsert,
  CartPlaceInsert,
  CartPlaceUpdate,
  CartScheduleInsert,
  CartScheduleUpdate,
  CartSlotInsert,
  CartSlotUpdate,
  DutyCellInput,
  DutyDayInput,
  DutyRole,
  Gender,
  PersonAvailabilityInsert,
  PersonInsert,
  PersonPairInsert,
  PersonUpdate,
  ProfileUpdate,
  ProgramData,
  ProgramKind,
  ProgramWeekInsert,
  ProgramWeekRow,
  ProgramWeekUpdate,
  ServiceMeetingInsert,
  ServiceMeetingUpdate,
  ServiceWeekInsert,
  ServiceWeekUpdate,
  TerritoryRow,
  TerritoryUpdate,
} from '../schemas';
import { qk } from './keys';
import { retryDelay, shouldRetry } from './policy';

// ---------------------------------------------------------------------------
// Spec + options factory
// ---------------------------------------------------------------------------
export interface MutationSpec<TVars, TResult> {
  /** mutationKey: [...scope, name]. */
  readonly key: QueryKey;
  /** Feature scope invalidated once the last mutation in it settles. */
  readonly scope: QueryKey;
  /** Extra scopes whose data the write changes server-side (e.g. people → cart names). */
  readonly alsoInvalidates: readonly QueryKey[];
  readonly run: (sb: TerritoriosClient, vars: TVars) => Promise<TResult>;
  readonly optimistic?: {
    /** Prefix of the queries to patch. */
    readonly target: (vars: TVars) => QueryKey;
    readonly apply: (old: unknown, vars: TVars) => unknown;
  };
}

function define<TVars, TResult, TData = never>(
  scope: QueryKey,
  name: string,
  run: (sb: TerritoriosClient, vars: TVars) => Promise<TResult>,
  optimistic?: { target: (vars: TVars) => QueryKey; apply: (old: TData, vars: TVars) => TData },
  alsoInvalidates: readonly QueryKey[] = [],
): MutationSpec<TVars, TResult> {
  return {
    key: [...scope, name],
    scope,
    alsoInvalidates,
    run,
    optimistic: optimistic as MutationSpec<TVars, TResult>['optimistic'],
  };
}

export interface MutationContext {
  /** Cache entries replaced by the optimistic update, restored on error. */
  snapshots: Array<[QueryKey, unknown]>;
}

export interface MutationHooks {
  /** Called on a CAS conflict (after rollback): show the "Cambiado por otra persona, revisá" sheet. */
  onConflict?: (error: ConflictError) => void;
}

export function mutationOptionsFor<TVars, TResult>(
  qc: QueryClient,
  spec: MutationSpec<TVars, TResult>,
  hooks: MutationHooks = {},
): MutationOptions<TResult, Error, TVars, MutationContext> {
  return {
    mutationKey: spec.key,
    mutationFn: (vars) => withDb((sb) => spec.run(sb, vars)),
    retry: shouldRetry,
    retryDelay,
    networkMode: 'online',
    onMutate: async (vars) => {
      const opt = spec.optimistic;
      if (!opt) return { snapshots: [] };
      const target = opt.target(vars);
      // Stop in-flight fetches so they cannot land on top of the optimistic value.
      await qc.cancelQueries({ queryKey: target });
      const snapshots = qc.getQueriesData({ queryKey: target });
      qc.setQueriesData({ queryKey: target }, (old: unknown) =>
        old === undefined ? old : opt.apply(old, vars),
      );
      return { snapshots };
    },
    onError: (error, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      if (error instanceof ConflictError) hooks.onConflict?.(error);
    },
    onSettled: async () => {
      // Only the last pending mutation in the scope refetches; earlier ones would overwrite
      // the optimistic state of the ones still in flight. (This one still counts as pending.)
      if (qc.isMutating({ mutationKey: spec.scope }) > 1) return;
      await Promise.all(
        [spec.scope, ...spec.alsoInvalidates].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  };
}

/** Generic hook. The returned `error` is a ConflictError on CAS conflicts (`isConflictError`). */
export function useDataMutation<TVars, TResult>(
  spec: MutationSpec<TVars, TResult>,
  hooks: MutationHooks = {},
) {
  const qc = useQueryClient();
  return useMutation(mutationOptionsFor(qc, spec, hooks), qc);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
interface Cas<P> {
  id: string;
  version: number;
  patch: P;
}
interface CasDel {
  id: string;
  version: number;
}
/** Salidas vars carry the week they belong to, so the optimistic patch hits one cache entry. */
type InWeek<T> = T & { weekStart: string };

const patchById = <T extends { id: unknown }>(rows: T[], id: unknown, patch: object): T[] =>
  rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
const dropById = <T extends { id: unknown }>(rows: T[], id: unknown): T[] =>
  rows.filter((r) => r.id !== id);

export const salidasMutations = {
  createServiceWeek: define(qk.salidas, 'createServiceWeek', (sb, v: ServiceWeekInsert) =>
    salidasRepo.createServiceWeek(sb, v),
  ),
  updateServiceWeek: define<
    InWeek<Cas<ServiceWeekUpdate>>,
    Awaited<ReturnType<typeof salidasRepo.updateServiceWeek>>,
    ServiceWeek
  >(
    qk.salidas,
    'updateServiceWeek',
    (sb, v) => salidasRepo.updateServiceWeek(sb, v.id, v.version, v.patch),
    {
      target: (v) => qk.serviceWeek(v.weekStart),
      apply: (old, v) =>
        old.week?.id === v.id ? { ...old, week: { ...old.week, ...v.patch } } : old,
    },
  ),
  deleteServiceWeek: define<InWeek<CasDel>, void, ServiceWeek>(
    qk.salidas,
    'deleteServiceWeek',
    (sb, v) => salidasRepo.deleteServiceWeek(sb, v.id, v.version),
    { target: (v) => qk.serviceWeek(v.weekStart), apply: () => ({ week: null, meetings: [] }) },
  ),
  createMeeting: define(qk.salidas, 'createMeeting', (sb, v: ServiceMeetingInsert) =>
    salidasRepo.createMeeting(sb, v),
  ),
  updateMeeting: define<
    InWeek<Cas<ServiceMeetingUpdate>>,
    Awaited<ReturnType<typeof salidasRepo.updateMeeting>>,
    ServiceWeek
  >(
    qk.salidas,
    'updateMeeting',
    (sb, v) => salidasRepo.updateMeeting(sb, v.id, v.version, v.patch),
    {
      target: (v) => qk.serviceWeek(v.weekStart),
      apply: (old, v) => ({ ...old, meetings: patchById(old.meetings, v.id, v.patch) }),
    },
  ),
  deleteMeeting: define<InWeek<CasDel>, void, ServiceWeek>(
    qk.salidas,
    'deleteMeeting',
    (sb, v) => salidasRepo.deleteMeeting(sb, v.id, v.version),
    {
      target: (v) => qk.serviceWeek(v.weekStart),
      apply: (old, v) => ({ ...old, meetings: dropById(old.meetings, v.id) }),
    },
  ),
};

export const territoryMutations = {
  updateTerritory: define<
    { id: number; version: number; patch: TerritoryUpdate },
    TerritoryRow,
    TerritoryRow[]
  >(
    qk.territories,
    'updateTerritory',
    (sb, v) => territoriesRepo.updateTerritory(sb, v.id, v.version, v.patch),
    { target: () => qk.territories, apply: (old, v) => patchById(old, v.id, v.patch) },
  ),
};

type AssignmentVars = Cas<CartAssignmentUpdate> & {
  /** Names for the optimistic cell (the server derives the real person_names). */
  personNames?: string[];
};

export const cartMutations = {
  createPlace: define(qk.cart, 'createPlace', (sb, v: CartPlaceInsert) =>
    cartRepo.createCartPlace(sb, v),
  ),
  updatePlace: define(qk.cart, 'updatePlace', (sb, v: Cas<CartPlaceUpdate>) =>
    cartRepo.updateCartPlace(sb, v.id, v.version, v.patch),
  ),
  deletePlace: define(qk.cart, 'deletePlace', (sb, v: CasDel) =>
    cartRepo.deleteCartPlace(sb, v.id, v.version),
  ),
  createSlot: define(qk.cart, 'createSlot', (sb, v: CartSlotInsert) =>
    cartRepo.createCartSlot(sb, v),
  ),
  updateSlot: define(qk.cart, 'updateSlot', (sb, v: Cas<CartSlotUpdate>) =>
    cartRepo.updateCartSlot(sb, v.id, v.version, v.patch),
  ),
  deleteSlot: define(qk.cart, 'deleteSlot', (sb, v: CasDel) =>
    cartRepo.deleteCartSlot(sb, v.id, v.version),
  ),
  createSchedule: define(qk.cart, 'createSchedule', (sb, v: CartScheduleInsert) =>
    cartRepo.createCartSchedule(sb, v),
  ),
  updateSchedule: define(qk.cart, 'updateSchedule', (sb, v: Cas<CartScheduleUpdate>) =>
    cartRepo.updateCartSchedule(sb, v.id, v.version, v.patch),
  ),
  deleteSchedule: define(qk.cart, 'deleteSchedule', (sb, v: CasDel) =>
    cartRepo.deleteCartSchedule(sb, v.id, v.version),
  ),
  createAssignment: define(qk.cart, 'createAssignment', (sb, v: CartAssignmentInsert) =>
    cartRepo.createCartAssignment(sb, v),
  ),
  updateAssignment: define<
    AssignmentVars,
    Awaited<ReturnType<typeof cartRepo.updateCartAssignment>>,
    CartBoard
  >(
    qk.cart,
    'updateAssignment',
    (sb, v) => cartRepo.updateCartAssignment(sb, v.id, v.version, v.patch),
    {
      target: () => qk.cartBoards,
      apply: (old, v) => ({
        ...old,
        assignments: old.assignments.map((a) => {
          if (a.id !== v.id) return a;
          const ids = v.patch.person_ids ?? a.person_ids;
          const names =
            v.personNames ?? ids.map((pid) => a.person_names[a.person_ids.indexOf(pid)] ?? '');
          return { ...a, ...v.patch, person_ids: ids, person_names: names };
        }),
      }),
    },
  ),
  deleteAssignment: define<CasDel, void, CartBoard>(
    qk.cart,
    'deleteAssignment',
    (sb, v) => cartRepo.deleteCartAssignment(sb, v.id, v.version),
    {
      target: () => qk.cartBoards,
      apply: (old, v) => ({ ...old, assignments: dropById(old.assignments, v.id) }),
    },
  ),
  createBlackout: define(qk.cart, 'createBlackout', (sb, v: CartBlackoutInsert) =>
    cartRepo.createCartBlackout(sb, v),
  ),
  deleteBlackout: define<CasDel, void, CartBoard>(
    qk.cart,
    'deleteBlackout',
    (sb, v) => cartRepo.deleteCartBlackout(sb, v.id, v.version),
    {
      target: () => qk.cartBoards,
      apply: (old, v) => ({ ...old, blackouts: dropById(old.blackouts, v.id) }),
    },
  ),
};

/**
 * People writes also change cart_assignments.person_names and duty_roster.person_name
 * server-side, and names/aliases/duties change the directory matches and duty pickers.
 */
const peopleSide = [qk.cart, qk.directory, qk.privilegios] as const;

export const peopleMutations = {
  createPerson: define(qk.people, 'createPerson', (sb, v: PersonInsert) =>
    peopleRepo.createPerson(sb, v),
  ),
  updatePerson: define<
    Cas<PersonUpdate>,
    Awaited<ReturnType<typeof peopleRepo.updatePerson>>,
    PeopleRoster
  >(
    qk.people,
    'updatePerson',
    (sb, v) => peopleRepo.updatePerson(sb, v.id, v.version, v.patch),
    {
      target: () => qk.people,
      apply: (old, v) => ({ ...old, people: patchById(old.people, v.id, v.patch) }),
    },
    peopleSide,
  ),
  deletePerson: define<CasDel, void, PeopleRoster>(
    qk.people,
    'deletePerson',
    (sb, v) => peopleRepo.deletePerson(sb, v.id, v.version),
    {
      target: () => qk.people,
      apply: (old, v) => ({
        people: dropById(old.people, v.id),
        availability: old.availability.filter((a) => a.person_id !== v.id),
        pairs: old.pairs.filter((p) => p.person_a !== v.id && p.person_b !== v.id),
      }),
    },
    peopleSide,
  ),
  addAvailability: define(qk.people, 'addAvailability', (sb, v: PersonAvailabilityInsert) =>
    peopleRepo.addAvailability(sb, v),
  ),
  removeAvailability: define<
    { person_id: string; slot_id: string; version: number },
    void,
    PeopleRoster
  >(
    qk.people,
    'removeAvailability',
    (sb, v) =>
      peopleRepo.removeAvailability(sb, { person_id: v.person_id, slot_id: v.slot_id }, v.version),
    {
      target: () => qk.people,
      apply: (old, v) => ({
        ...old,
        availability: old.availability.filter(
          (a) => !(a.person_id === v.person_id && a.slot_id === v.slot_id),
        ),
      }),
    },
  ),
  addPair: define(qk.people, 'addPair', (sb, v: PersonPairInsert) => peopleRepo.addPair(sb, v)),
  /** "Crear persona" from an unmatched name (docs/PRIVILEGIOS.md). Returns the new id. */
  createPersonFromName: define(
    qk.people,
    'createPersonFromName',
    (sb, v: { name: string; gender: Gender; inCarrito?: boolean }) =>
      peopleRepo.createPersonFromName(sb, v.name, v.gender, v.inCarrito ?? false),
    undefined,
    [qk.directory, qk.privilegios],
  ),
  /** "Es otro nombre de…": the alias also starts matching program/salida assignments. */
  addPersonAlias: define(
    qk.people,
    'addPersonAlias',
    (sb, v: { personId: string; alias: string }) =>
      peopleRepo.addPersonAlias(sb, v.personId, v.alias),
    undefined,
    [qk.directory, qk.privilegios, qk.myAssignmentsAll],
  ),
  removePair: define<{ person_a: string; person_b: string; version: number }, void, PeopleRoster>(
    qk.people,
    'removePair',
    (sb, v) => peopleRepo.removePair(sb, v, v.version),
    {
      target: () => qk.people,
      apply: (old, v) => ({
        ...old,
        pairs: old.pairs.filter(
          (p) =>
            !(
              (p.person_a === v.person_a && p.person_b === v.person_b) ||
              (p.person_a === v.person_b && p.person_b === v.person_a)
            ),
        ),
      }),
    },
  ),
};

export const programMutations = {
  createProgramWeek: define(qk.program, 'createProgramWeek', (sb, v: ProgramWeekInsert) =>
    programRepo.createProgramWeek(sb, v),
  ),
  updateProgramWeek: define<
    InWeek<Cas<ProgramWeekUpdate>>,
    Awaited<ReturnType<typeof programRepo.updateProgramWeek>>,
    ProgramWeek
  >(
    qk.program,
    'updateProgramWeek',
    (sb, v) => programRepo.updateProgramWeek(sb, v.id, v.version, v.patch),
    {
      target: (v) => qk.programWeek(v.weekStart),
      apply: (old, v) => ({
        midweek: old.midweek?.id === v.id ? { ...old.midweek, ...v.patch } : old.midweek,
        weekend: old.weekend?.id === v.id ? { ...old.weekend, ...v.patch } : old.weekend,
      }),
    },
  ),
  deleteProgramWeek: define(qk.program, 'deleteProgramWeek', (sb, v: CasDel) =>
    programRepo.deleteProgramWeek(sb, v.id, v.version),
  ),
  /** Program editor save: insert when `version` is absent, else CAS update on (kind, date). */
  saveProgramWeek: define<SaveProgramVars, ProgramWeekRow, ProgramWeekRow[]>(
    qk.program,
    'saveProgramWeek',
    (sb, v) => programRepo.saveProgramWeek(sb, v.kind, v.date, v.data, v.version),
    {
      target: () => [...qk.program, 'range'],
      apply: (old, v) =>
        old.map((r) => (r.kind === v.kind && r.date === v.date ? { ...r, data: v.data } : r)),
    },
    [qk.directory],
  ),
};

interface SaveProgramVars {
  kind: ProgramKind;
  date: string;
  data: ProgramData;
  /** The row's version when editing an existing week; omit to create it. */
  version?: number;
}

/**
 * Pass the picked person's name in `person_name` too: the optimistic cell shows it until the
 * server's snapshot (people.name) arrives.
 */
type DutyCellVars = DutyCellInput & {
  /** The cell's version when it already has a row; omit to fill an empty cell. */
  version?: number;
};
interface DutyCellKeyVars {
  date: string;
  role: DutyRole;
  slot: number;
  version: number;
}
const sameCell = (
  r: { date: string; role: string; slot: number },
  v: DutyCellKeyVars | DutyCellVars,
) => r.date === v.date && r.role === v.role && r.slot === v.slot;
const rosterTarget = () => [...qk.privilegios, 'roster'];

/** Privilegios writes change "Mis asignaciones" (kind privilegio) server-side. */
export const privilegiosMutations = {
  upsertDutyCell: define<
    DutyCellVars,
    Awaited<ReturnType<typeof privilegiosRepo.upsertDutyCell>>,
    DutyRoster
  >(
    qk.privilegios,
    'upsertDutyCell',
    (sb, { version, ...cell }) => privilegiosRepo.upsertDutyCell(sb, cell, version),
    {
      target: rosterTarget,
      apply: (old, v) => ({
        ...old,
        rows: old.rows.map((r) =>
          sameCell(r, v)
            ? {
                ...r,
                person_id: v.person_id,
                person_name: v.person_name ?? r.person_name,
                note: v.note === undefined ? r.note : v.note,
              }
            : r,
        ),
      }),
    },
    [qk.myAssignmentsAll, qk.directory],
  ),
  clearDutyCell: define<DutyCellKeyVars, void, DutyRoster>(
    qk.privilegios,
    'clearDutyCell',
    (sb, v) => privilegiosRepo.clearDutyCell(sb, v, v.version),
    {
      target: rosterTarget,
      apply: (old, v) => ({ ...old, rows: old.rows.filter((r) => !sameCell(r, v)) }),
    },
    [qk.myAssignmentsAll, qk.directory],
  ),
  setDutyDay: define(
    qk.privilegios,
    'setDutyDay',
    (sb, { version, ...day }: DutyDayInput & { version?: number }) =>
      privilegiosRepo.setDutyDay(sb, day, version),
    undefined,
    [qk.myAssignmentsAll],
  ),
  clearDutyDay: define<{ date: string; version: number }, void, DutyRoster>(
    qk.privilegios,
    'clearDutyDay',
    (sb, v) => privilegiosRepo.clearDutyDay(sb, v.date, v.version),
    {
      target: rosterTarget,
      apply: (old, v) => ({ ...old, days: old.days.filter((d) => d.date !== v.date) }),
    },
    [qk.myAssignmentsAll],
  ),
};

export const profileMutations = {
  updateDisplayName: define(qk.auth, 'updateDisplayName', (sb, v: Cas<ProfileUpdate>) =>
    authRepo.updateDisplayName(sb, v.id, v.version, v.patch),
  ),
};

/** Linking changes what the member sees; role changes what the caller may do. */
export const accountMutations = {
  linkAccount: define(
    qk.accounts,
    'linkAccount',
    (sb, v: { userId: string; personId: string | null }) =>
      accountsRepo.linkAccount(sb, v.userId, v.personId),
    undefined,
    [[...qk.auth, 'my-link'], qk.myAssignmentsAll],
  ),
  setAccountRole: define(
    qk.accounts,
    'setAccountRole',
    (sb, v: { userId: string; role: AccountRole }) =>
      accountsRepo.setAccountRole(sb, v.userId, v.role),
    undefined,
    [
      [...qk.auth, 'role'],
      [...qk.auth, 'permissions'],
    ],
  ),
  /** Admin: "Puede editar programa" / "Puede editar privilegios" (null = unchanged). */
  setAccountPermissions: define(
    qk.accounts,
    'setAccountPermissions',
    (sb, v: { userId: string; programa: boolean | null; privilegios: boolean | null }) =>
      accountsRepo.setAccountPermissions(sb, v.userId, v.programa, v.privilegios),
    undefined,
    [[...qk.auth, 'permissions']],
  ),
  saveWebPushSubscription: define(
    qk.webPush,
    'saveWebPushSubscription',
    (sb, v: { subscription: accountsRepo.WebPushToken }) =>
      accountsRepo.saveWebPushSubscription(sb, v.subscription),
  ),
  deleteWebPushSubscription: define(
    qk.webPush,
    'deleteWebPushSubscription',
    (sb, v: { subscription: accountsRepo.WebPushToken }) =>
      accountsRepo.deleteWebPushSubscription(sb, v.subscription),
  ),
};

export const mutations = {
  ...salidasMutations,
  ...territoryMutations,
  ...cartMutations,
  ...peopleMutations,
  ...programMutations,
  ...privilegiosMutations,
  ...profileMutations,
  ...accountMutations,
};

/**
 * Give every mutation key its defaults (mutationFn, retry, optimistic handlers) so mutations
 * restored from the persisted cache can resume. Call before restoring (persist.ts does).
 */
export function registerMutationDefaults(qc: QueryClient): void {
  for (const spec of Object.values(mutations) as MutationSpec<unknown, unknown>[]) {
    const { mutationKey, ...defaults } = mutationOptionsFor(qc, spec);
    qc.setMutationDefaults(mutationKey ?? spec.key, defaults);
  }
}

// ---------------------------------------------------------------------------
// Named hooks for the common edits
// ---------------------------------------------------------------------------
export const useCreateMeeting = (h?: MutationHooks) => useDataMutation(mutations.createMeeting, h);
export const useUpdateMeeting = (h?: MutationHooks) => useDataMutation(mutations.updateMeeting, h);
export const useDeleteMeeting = (h?: MutationHooks) => useDataMutation(mutations.deleteMeeting, h);
export const useUpdateServiceWeek = (h?: MutationHooks) =>
  useDataMutation(mutations.updateServiceWeek, h);
export const useUpdateCartAssignment = (h?: MutationHooks) =>
  useDataMutation(mutations.updateAssignment, h);
export const useUpdatePerson = (h?: MutationHooks) => useDataMutation(mutations.updatePerson, h);
export const useUpdateProgramWeek = (h?: MutationHooks) =>
  useDataMutation(mutations.updateProgramWeek, h);
export const useSaveProgramWeek = (h?: MutationHooks) =>
  useDataMutation(mutations.saveProgramWeek, h);
export const useCreatePersonFromName = (h?: MutationHooks) =>
  useDataMutation(mutations.createPersonFromName, h);
export const useAddPersonAlias = (h?: MutationHooks) =>
  useDataMutation(mutations.addPersonAlias, h);
export const useUpsertDutyCell = (h?: MutationHooks) =>
  useDataMutation(mutations.upsertDutyCell, h);
export const useClearDutyCell = (h?: MutationHooks) => useDataMutation(mutations.clearDutyCell, h);
export const useSetDutyDay = (h?: MutationHooks) => useDataMutation(mutations.setDutyDay, h);
export const useClearDutyDay = (h?: MutationHooks) => useDataMutation(mutations.clearDutyDay, h);
export const useSetAccountPermissions = (h?: MutationHooks) =>
  useDataMutation(mutations.setAccountPermissions, h);
export const useLinkAccount = (h?: MutationHooks) => useDataMutation(mutations.linkAccount, h);
export const useSetAccountRole = (h?: MutationHooks) =>
  useDataMutation(mutations.setAccountRole, h);
export const useSaveWebPushSubscription = (h?: MutationHooks) =>
  useDataMutation(mutations.saveWebPushSubscription, h);
export const useDeleteWebPushSubscription = (h?: MutationHooks) =>
  useDataMutation(mutations.deleteWebPushSubscription, h);
