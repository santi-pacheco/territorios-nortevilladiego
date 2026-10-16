# supabase/ — TerritoriosMap 2.0 database

This folder holds the schema, RLS, fake seed data and pgTAP tests for the **new** 2.0
Supabase project. It never touches the v1 project.

```
supabase/
├─ config.toml                          local stack config (sign-up disabled, analytics off)
├─ migrations/
│  ├─ 20261016185013_schema.sql         tables, constraints, triggers
│  └─ 20261016185225_rls_policies.sql   is_editor()/is_admin(), grants, RLS policies, realtime
├─ seed.sql                             FAKE data for local dev only (never pushed)
└─ tests/
   ├─ 00_schema_test.sql                RLS coverage, version trigger, constraints, derived data
   └─ 01_rls_test.sql                   anon / viewer / no-profile / editor / admin personas
```

## Access model

| Who                                              | Can read                                                                                                                               | Can write                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `anon` (not logged in)                           | territories, service_weeks, service_meetings, cart_places, cart_slots, cart_schedules, cart_assignments, cart_blackouts, program_weeks | nothing (no grants at all)                       |
| `authenticated`, role `viewer` or no profile row | same as anon, plus own `profiles` row and own `device_tokens`                                                                          | own `profiles.display_name`, own `device_tokens` |
| `authenticated`, role `editor` or `admin`        | everything above **plus** `people`, `person_availability`, `person_pairs`                                                              | every app table                                  |
| secret key (server only)                         | everything (bypasses RLS)                                                                                                              | everything                                       |

- The role lives in `public.profiles.role` (`viewer` \| `editor` \| `admin`). Policies call
  `(select public.is_editor())`. This is a `SECURITY INVOKER` SQL function that reads the
  caller's own profile row, so nothing bypasses RLS. Changing a role takes effect on the next
  request. No token refresh is needed because the role is not read from a JWT claim.
- Clients can't insert profiles or update `profiles.role`. Only `display_name` has a column
  grant. Roles are changed by the owner in the SQL editor (see below).
- Grants are explicit. The RLS migration revokes Supabase's default `ALL` from `anon` and
  `authenticated`. It also changes the default privileges in `public` so that **new tables
  and functions created by `postgres` get no access until a migration grants it**. Future
  RPCs therefore need an explicit `grant execute`.
- `admin` has the same data rights as `editor` today. It is reserved for future admin-only
  screens.

### Decisions to review (flagged for the coordinator/owner)

1. **Public cart names.** `people` is editor-only (Q3), but the public Carrito grid must still
   show who is on each shift. `cart_assignments.person_names` holds a trigger-maintained
   snapshot of `people.name` for the people scheduled in that cell. Anyone can read those
   names, the same way v1's shared PNG shows them. Nothing else about a person is public:
   not gender, availability, pairs or target, and not unscheduled people. The client never
   writes `person_names`. The trigger derives it, refreshes it on rename and drops ids
   when a person is deleted.
2. **`service_weeks.week_start` is the Monday** of the Mon–Sun week (CHECK enforced). v1 stored
   a Wednesday reference, so the v1 importer (C3) must convert it as `weekStart - 2 days`.
   Day numbers derive from this Monday exactly as before.
3. Two day-of-week systems are kept on purpose. `service_meetings.dow` uses JS numbering
   (0 = Sunday … 6 = Saturday). `cart_slots.iso_dow` uses ISO numbering (1 = Monday … 7 = Sunday).
4. `program_weeks`: midweek rows must be keyed by a Tuesday and weekend rows by a Saturday
   (CHECK). `data` must be a JSON object of at most 64 KB. The app validates its shape with Zod.
5. `service_meetings.group_territories` (Domingo only) holds the per-group layout
   `{"G1":[ids],…,"G4":[ids]}`. Only the keys G1–G4 are allowed, and the value is at most 4 KB.

### Known caveats (not blocking)

- `device_tokens.token` is unique across all users. If a second account logs in on the same
  device, its insert fails with `23505` on a row it can neither see nor delete. M4 should
  register tokens with a server-side upsert (an Edge Function using the secret key).
- Deleting an auth user sets `updated_by` to null on every row they wrote, which bumps
  `version` on those rows. Open editors then get one spurious CAS conflict.
- Supabase Realtime does not apply RLS to DELETE events. Viewers hold the SELECT grant on
  `people` and `person_pairs`, so they may receive primary-key-only DELETE events for them.
  These contain UUIDs only, never names.
- The CI secret grep (`scripts/check-secrets.mjs`) forbids the literal name of the
  server-only role anywhere under `supabase/`. Refer to it as "the secret key".

## Every row: `version`, `updated_at`, `updated_by`

The trigger `private.bump_version()` runs before every insert and update on every table:

- It sets `version` to `1` on insert and to `old.version + 1` on update. **Values the client
  sends are ignored.**
- It sets `updated_at` to `now()`.
- It sets `updated_by` to `auth.uid()` for logged-in writers, so they can't spoof it. A
  secret-key (server) or import write keeps the value it provided.

## Compare-and-swap (CAS) pattern

Each mutation sends the `version` the user was editing. The server only applies the
update if nobody changed the row in the meantime:

```sql
update public.service_meetings
   set conductor = $1, place = $2
 where id = $3
   and version = $4          -- the version the client read
returning *;                 -- 0 rows  ⇒ conflict
```

In supabase-js (`packages/data`):

```ts
const { data, error } = await supabase
  .from('service_meetings')
  .update({ conductor, place }) // never send version/updated_at/updated_by
  .eq('id', row.id)
  .eq('version', row.version)
  .select()
  .maybeSingle();

if (error) throw error;
if (!data) {
  // Conflict: someone else changed (or deleted) the row.
  // Refetch, then show the "Cambiado por otra persona, revisá" sheet. Never retry blindly.
}
```

- RLS denials on UPDATE also return 0 rows. An editor whose role was revoked therefore looks
  like a conflict. Refetching the row tells the two cases apart, because the row is still there
  and unchanged.
- Delete with the same guard: `.delete().eq('id', id).eq('version', v)`.
- Inserts don't need CAS. Use natural unique keys (for example `(kind, date)` on
  `program_weeks`, or `(schedule_id, week_date, slot_id)` on `cart_assignments`) to detect
  races. A race shows up as a `23505` error.
- `person_pairs` stores each pair once with `person_a < person_b`. A trigger reorders the
  pair on insert, so clients can send either order.

## Local development (Docker required)

```sh
npx supabase start        # first run pulls images (several minutes)
npx supabase db reset     # re-applies migrations + seed.sql
npx supabase test db      # runs supabase/tests/*.sql with pgTAP
npx supabase db advisors --local --type all
npx supabase stop
```

- Local sign-up is disabled (`[auth] enable_signup = false`). To get local logins, open Studio
  (http://localhost:54323) ▸ Authentication ▸ Add user. Then give the user a role as described
  in "Creating editor accounts" below.
- New migrations: run `npx supabase migration new <name>` and never hand-name the file.
  Each new table needs RLS enabled, explicit `grant`s, a policy set, the
  `<table>_bump_version` trigger, and updated counts in `tests/00_schema_test.sql`.
- Advisors currently report only INFO-level performance notes. The `updated_by` foreign keys
  are unindexed on purpose, because the tables are tiny and auth users are rarely deleted.
  There are no security findings.

## Owner setup: creating the hosted 2.0 project

> This is a **new** project. Do not reuse or link the v1 project.

1. **Create the project.** Go to https://supabase.com/dashboard ▸ _New project_.
   - Name: `territorios-v2`. Pick the region closest to the congregation (for example São Paulo).
   - Generate a strong database password and store it in your password manager.
     It is needed for `link` and `db push`.
2. **Lock down Auth** (do this before sharing the URL with anyone).
   - Authentication ▸ Sign In / Providers ▸ turn **off** "Allow new users to sign up".
   - On the same page, keep "Allow anonymous sign-ins" **off**, and keep "Confirm email" on.
   - Authentication ▸ Sessions (if available on your plan): consider a short JWT expiry
     (for example 1 hour), because deleting a user does not revoke tokens already issued.
   - Check it from a terminal. The response must contain `"disable_signup":true`:
     ```sh
     curl "https://<project-ref>.supabase.co/auth/v1/settings" -H "apikey: <publishable key>"
     ```
   - Optional alternative: after linking (step 3), `npx supabase config diff` and
     `npx supabase config push` push the `enable_signup = false` from `config.toml`.
     Review the diff first, because it also pushes the other auth settings in the file.
3. **Link this repo** (run from the repo root):
   ```sh
   npx supabase login                         # or set SUPABASE_ACCESS_TOKEN to a scoped token
   npx supabase link --project-ref <project-ref>
   ```
   The project ref is the `xxxx` in `https://xxxx.supabase.co` (Project Settings ▸ General).
4. **Push the schema:**
   ```sh
   npx supabase db push --dry-run   # review
   npx supabase db push
   ```
   **Never** pass `--include-seed`. `seed.sql` is fake local data.
5. **Data API.** Project Settings ▸ Data API: make sure `public` is an exposed schema.
   The migrations already grant exactly what each role needs.
6. **Run the advisors** against the hosted project and fix any security finding:
   `npx supabase db advisors --linked --type security`.
7. **Keys.** The web/mobile app gets the project URL and the **publishable** key only.
   The secret (server) key is for the import script and Edge Functions only.
   It must never go into the bundle, `.env` files committed to git, or the app.

### Creating editor accounts (one per editor)

1. Dashboard ▸ Authentication ▸ Users ▸ **Add user** ▸ _Create new user_. Enter the editor's
   email and a temporary password, and tick _Auto confirm user_. You can also use
   _Send invitation_, which works even with sign-up disabled.
2. Dashboard ▸ SQL Editor. Give the user a role:
   ```sql
   insert into public.profiles (id, role, display_name)
   select id, 'editor', 'Nombre visible'
     from auth.users
    where email = 'editor@example.com'
   on conflict (id) do update set role = excluded.role;
   ```
   Use `'admin'` for the owner. A user without a profile row is treated as a viewer.
3. To remove access, run `update public.profiles set role = 'viewer' where id = …;`. This
   takes effect on the next request. To fully remove the person, delete the user under
   Authentication ▸ Users. Their profile and device tokens cascade away, but already issued
   access tokens stay valid until they expire.

Members (viewers) don't need accounts. All public data is readable without logging in.
