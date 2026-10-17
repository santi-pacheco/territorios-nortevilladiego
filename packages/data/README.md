# @territorios/data

Supabase client, Zod-validated repositories, TanStack Query (v5) hooks, Realtime → query
invalidation and query-cache persistence. Implements PLAN §3 "Sync model" against
`supabase/migrations/*.sql` (CAS pattern: `supabase/README.md`).

No React import lives here except through `@tanstack/react-query`; every hook is a one-line
wrapper over an exported options factory so the logic is testable without a DOM.

## Boot sequence (apps/web, apps/mobile)

```ts
import { platform } from '@territorios/platform';
import {
  makeSupabase, setSupabase, createQueryClient, startPersistence, startRealtime, bindAuth,
} from '@territorios/data';

const sb = makeSupabase(URL, PUBLISHABLE_KEY, platform().secureStorage, { isNative });
setSupabase(sb);                          // hooks read it via db()
const queryClient = createQueryClient();  // retry/backoff/networkMode/gcTime defaults
const persistence = startPersistence(queryClient); // registers mutation defaults, restores, resumes paused mutations
bindAuth(queryClient, sb);                // session cache + role refetch + drop PII on sign-out
const rt = startRealtime({ supabase: sb, queryClient }); // invalidate-only, pauses when hidden/backgrounded
// When useRole() resolves: rt.setEditorTables(isEditor)
// On sign-out also: await persistence.clear()
```

## Sync rules (what the code guarantees)

- **Reads** are Zod-parsed at the boundary (`SchemaError` on drift).
- **Writes** use CAS: `update … eq(key).eq('version', expected).select().maybeSingle()`.
  0 rows ⇒ the row is refetched and `ConflictError { table, id, expectedVersion, current }`
  is thrown (`current === null` ⇒ deleted / not visible; `likelyPermissionDenied` when the row
  is still at the expected version, i.e. RLS denial). Deletes use the same guard.
  Server-owned columns (`version`, `updated_at`, `updated_by`, `person_names`) are stripped
  from every payload by the Zod update/insert schemas.
- **Mutations** are optimistic (`cancelQueries` → snapshot → `setQueriesData`), roll back on
  error, call `onConflict` for `ConflictError`, and invalidate their scope only when the
  last pending mutation of that scope settles.
- **Retry**: only `NetworkError` (PostgREST `status 0`, aborts excluded), up to 4 times,
  backoff 1 s → 2 s → 4 s → 8 s (cap 30 s). Never `ConflictError`, `DataError` (RLS,
  constraints, `23505`), `SchemaError`.
- **Offline**: mutations use `networkMode: 'online'` ⇒ paused while offline, resumed by
  `onlineManager`. Paused mutations are persisted and resumed after a reload (their
  `mutationFn` comes back via `registerMutationDefaults`).
- **Realtime** never writes payloads into the cache. An event invalidates the table's scope;
  while a mutation in that scope is in flight it only marks queries stale (no refetch), so an
  own-echo cannot clobber the optimistic value. Hidden/background ⇒ channel removed +
  `auth.stopAutoRefresh()`; `platform().onResume`/visible ⇒ restart + invalidate everything.
- **Persistence**: `platform().storage`, key `tm-query-cache`, `maxAge` 7 days, buster
  `SCHEMA_VERSION`. Session/role (`['tm','auth']`) and `people` (PII) are never persisted.

## Exported API

### Client — `client.ts`
| Export | Notes |
|---|---|
| `makeSupabase(url, publishableKey, storage, { isNative })` | `persistSession`, `autoRefreshToken`, `detectSessionInUrl = !isNative` |
| `setSupabase(client \| null)`, `db()` | app-wide client used by hooks |
| `type TerritoriosClient`, `type MakeSupabaseOptions` | |

### Schemas — `schemas.ts`
For every table: `XRow` (+ `XInsert`, `XUpdate` where writable), each also exported as the
inferred type of the same name.
`ProfileRow/ProfileUpdate`, `TerritoryRow/Insert/Update`, `TerritoryGeometry`,
`ServiceWeekRow/Insert/Update`, `ServiceMeetingRow/Insert/Update`, `GroupTerritories`,
`MeetingKind`, `CartPlaceRow/Insert/Update`, `CartSlotRow/Insert/Update`,
`CartScheduleRow/Insert/Update`, `CartAssignmentRow/Insert/Update`, `CartBlackoutRow/Insert`,
`PersonRow/Insert/Update`, `Gender`, `PersonAvailabilityRow/Insert`, `PersonPairRow/Insert`,
`ProgramWeekRow/Insert/Update`, `ProgramKind`, `ProgramData`, `DeviceTokenRow/Insert`,
`DevicePlatform`, `Role`; Privilegios (docs/PRIVILEGIOS.md): `DutyRole`, `DutySlot`,
`DutyRosterRow`, `DutyCellInput`, `DutyDayRow`, `DutyDayInput`, `DutyDayKind`; RPC rows
`MyAssignment` (kinds incl. `privilegio`), `MyLink`, `AccountRow` (+ `can_edit_programa`,
`can_edit_privilegios`), `MyPermissions`, `NameSource`, `NameSourceKind`, `DutyPerson`;
`PersonRow` has `in_carrito` and `duties`; primitives `Uuid`, `IsoDate`, `Timestamp`, `TimeOfDay`, `isoDow()`;
registry `rowSchemas`, `type TableName`, `type RowOf<T>`; `SCHEMA_VERSION`.

### Errors — `errors.ts`
`ConflictError` (`table`, `id`, `expectedVersion`, `current`, `deleted`,
`likelyPermissionDenied`), `NetworkError`, `DataError` (`code`, `status`, `isUniqueViolation`),
`SchemaError`, `isConflictError()`, `isNetworkError()`.

### Repositories — `repos/*.ts` (all take the client first)
| Feature | Reads | Writes (CAS on update/delete) |
|---|---|---|
| Salidas | `fetchServiceWeek(sb, weekStart)` → `ServiceWeek { week, meetings }` | `createServiceWeek`, `updateServiceWeek`, `deleteServiceWeek`, `createMeeting`, `updateMeeting`, `deleteMeeting` |
| Territories | `fetchTerritories` | `updateTerritory` |
| Carrito | `fetchCartPlaces`, `fetchCartSlots`, `fetchCartSchedules`, `fetchCartAssignments(sb, scheduleId)`, `fetchCartBlackouts(sb, from, to)`, `fetchCartBoard(sb, scheduleId \| null, today)` → `CartBoard`, `pickCurrentSchedule` | `create/update/deleteCartPlace`, `create/update/deleteCartSlot`, `create/update/deleteCartSchedule`, `create/update/deleteCartAssignment`, `createCartBlackout`, `deleteCartBlackout` |
| People (editor) | `fetchPeople` → `PeopleRoster { people, availability, pairs }`; `carritoPeople(roster)` → the `in_carrito` part (people + their availability + pairs with both partners in the carrito): **feed this to the scheduler (Generar) and carrito pickers**; `fetchNameSources` → `NameSource[]` (unmatched first); `fetchDutyPeople` → `DutyPerson[]` (editors and `can_edit_privilegios`) | `createPerson`, `updatePerson`, `deletePerson`, `addAvailability`, `removeAvailability`, `addPair`, `removePair`, `createPersonFromName(sb, name, gender, inCarrito = false)` → id (23505 if the name matches someone), `addPersonAlias(sb, personId, alias)` |
| Programa | `fetchProgramWeek(sb, weekStart)` → `ProgramWeek { midweek (Tue), weekend (Sat) }`, `fetchProgramWeeks(sb, from, to)` → rows by date | `createProgramWeek`, `updateProgramWeek`, `deleteProgramWeek(sb, id, version)`, `saveProgramWeek(sb, kind, date, data, version?)` (insert without version, CAS on `(kind, date)` with it) |
| Privilegios | `fetchDutyRoster(sb, from, to)` → `DutyRoster { rows, days }` (empty unless `sees_privilegios`) | `upsertDutyCell(sb, cell, version?)`, `clearDutyCell(sb, { date, role, slot }, version)`, `setDutyDay(sb, day, version?)`, `clearDutyDay(sb, date, version)`. Without a version they insert; a lost insert race throws `ConflictError` with `expectedVersion` 0 and the winning row. `person_name` is the server snapshot of `people.name` when `person_id` is set: always display it, and pass the picked person's name with `person_id` so the optimistic cell shows it |
| Accounts | `myAssignments`, `myLink`, `listAccounts`, `myPermissions` → `MyPermissions` (effective flags: editors/admins get `true`) | `linkAccount`, `setAccountRole`, `setAccountPermissions(sb, userId, programa \| null, privilegios \| null)` (admin; null = unchanged), `saveWebPushSubscription`, `deleteWebPushSubscription` |
| Auth | `fetchSession`, `fetchRole(sb, userId)` → `AppRole`, `fetchProfile` | `updateDisplayName` |

Also: `isEditorRole(role)`, `addDays(isoDate, n)`, `type RowKey`, `type AppRole`.

### Query — `query/*.ts`
| Export | Notes |
|---|---|
| `qk` | key factory: `serviceWeek(ws)`, `territories`, `cartBoard(id\|null)`, `people`, `programWeek(ws)`, `programRange(from, to)`, `nameSources`, `dutyRoster(from, to)`, `dutyPeople`, `myPermissions(uid)`, `session`, `role(uid)`; scopes `salidas`, `cart`, `program`, `directory`, `privilegios`, `auth`, `all` (`people`, `directory`, `privilegios`, `auth` are private: never persisted, dropped on sign-out) |
| `tableScopes`, `privateScopes`, `isPrivateKey` | table → scope map; never-persisted scopes |
| `createQueryClient(config?)`, `queryClientConfig` | defaults: retry policy, `gcTime` 7 d, `networkMode: 'online'` for mutations |
| `shouldRetry`, `retryDelay`, `MAX_NETWORK_RETRIES` | retry policy |
| `serviceWeekQuery`, `territoriesQuery`, `cartBoardQuery`, `peopleQuery`, `programWeekQuery`, `sessionQuery`, `roleQuery`, `todayIso` | `queryOptions` factories (router loaders, prefetch) |
| `useServiceWeek(weekStart)`, `useTerritories()`, `useCartSchedule(scheduleId?)`, `usePeople({ enabled? })` (defaults to `isEditor`), `useProgramWeek(weekStart)`, `useSession()`, `useRole()` → `{ role, isEditor, isLoading }` | read hooks |
| `useMyPermissions()`, `useProgramWeeks(from, to)`, `useNameSources({ enabled? })` (editor), `useDutyRoster(from, to, { enabled? })` (default: `sees_privilegios`), `useDutyPeople({ enabled? })` (default: `can_edit_privilegios`) | read hooks (docs/PRIVILEGIOS.md); factories `myPermissionsQuery`, `programWeeksQuery`, `nameSourcesQuery`, `dutyRosterQuery`, `dutyPeopleQuery` |
| `mutations` (+ `salidasMutations`, `territoryMutations`, `cartMutations`, `peopleMutations`, `programMutations`, `profileMutations`) | mutation specs; vars are `{ id, version, patch }` (+ `weekStart` for Salidas/Programa optimistic targets) |
| `useDataMutation(spec, { onConflict })` | generic mutation hook; `.error` is a `ConflictError` on conflict |
| `useCreateMeeting`, `useUpdateMeeting`, `useDeleteMeeting`, `useUpdateServiceWeek`, `useUpdateCartAssignment`, `useUpdatePerson`, `useUpdateProgramWeek` | named shortcuts |
| `useSaveProgramWeek` (`{ kind, date, data, version? }`), `useCreatePersonFromName` (`{ name, gender, inCarrito? }`), `useAddPersonAlias` (`{ personId, alias }`), `useUpsertDutyCell` (`{ date, role, slot, person_id, person_name, note?, version? }`), `useClearDutyCell` (`{ date, role, slot, version }`), `useSetDutyDay` (`{ date, kind, note?, version? }`), `useClearDutyDay` (`{ date, version }`), `useSetAccountPermissions` (`{ userId, programa, privilegios }`); specs in `privilegiosMutations` and the existing catalogs | Privilegios / directory / permissions shortcuts |
| `mutationOptionsFor(qc, spec, hooks)`, `registerMutationDefaults(qc)`, `type MutationSpec`, `type MutationHooks`, `type MutationContext` | |
| `invalidateScope(qc, scope)`, `invalidateTable(qc, table)` | own-echo-safe invalidation |
| `bindAuth(qc, sb)` | onAuthStateChange → cache |

### Realtime — `realtime.ts`
`startRealtime({ supabase, queryClient, lifecycle?, includeEditorTables?, channelName? })` →
`{ stop(), setEditorTables(enabled), paused }`. Public tables and editor-only tables
(`people`, `person_availability`, `person_pairs`, `duty_roster`, `duty_days`) use separate channels with a fresh topic per
subscribe (realtime-js reuses channels by topic). A second `SUBSCRIBED` on a channel (silent
socket rejoin) invalidates everything. `PUBLIC_REALTIME_TABLES`, `EDITOR_REALTIME_TABLES`,
`REALTIME_TABLES`, `defaultLifecycle()`, `type AppLifecycle`, `type RealtimeOptions`, `type RealtimeHandle`.

### Persistence — `persist.ts`
`startPersistence(qc, { storage?, buster? })` → `{ restored, persister, stop(), clear() }`,
`createPersister(storage?)`, `shouldPersistQuery`, `shouldPersistMutation`, `PERSIST_KEY`,
`PERSIST_MAX_AGE`.

## Tests

`pnpm --filter @territorios/data test` (Vitest, node, fake Supabase in
`src/__tests__/fakeSupabase.ts`): CAS success/conflict/deleted/RLS-denied/composite keys,
error mapping, schema constraints, retry policy (network retried, conflict never),
own-echo realtime vs in-flight optimistic edit, offline pause/resume, realtime
pause/resume lifecycle, persistence filters/buster/resume-after-reload.
