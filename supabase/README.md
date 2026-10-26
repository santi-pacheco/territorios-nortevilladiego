# supabase/ — TerritoriosMap 2.0 database

This folder holds the schema, RLS, fake seed data and pgTAP tests for the **new** 2.0
Supabase project. It never touches the v1 project.

```
supabase/
├─ config.toml                          local stack config (sign-up disabled, analytics off)
├─ migrations/
│  ├─ 20261016185013_schema.sql         tables, constraints, triggers
│  ├─ 20261016185225_rls_policies.sql   is_editor()/is_admin(), grants, RLS policies, realtime
│  ├─ 20261017024539_member_accounts.sql member accounts, assignment feed, reminders + cron
│  └─ 20261017152708_people_directory_privilegios.sql people directory, permissions, Privilegios roster
├─ functions/
│  └─ send-reminders/                   daily Web Push reminders (Deno; lib.ts is the pure part)
├─ seed.sql                             FAKE data for local dev only (never pushed)
└─ tests/
   ├─ 00_schema_test.sql                RLS coverage, version trigger, constraints, derived data
   ├─ 01_rls_test.sql                   anon / viewer / no-profile / editor / admin personas
   ├─ 02_accounts_test.sql              new-user trigger, name matching, each kind, account RPCs
   └─ 03_privilegios_test.sql           name_sources, directory/permission RPCs, program + roster RLS
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
- Every new auth user gets a `viewer` profile from the `on_auth_user_created` trigger
  (display_name = Google `full_name`). Clients still can't insert profiles or update
  `profiles.role` / `profiles.person_id`. Only `display_name` has a column grant. Roles and
  links change through the account RPCs below (or the SQL editor).
- Grants are explicit. The RLS migration revokes Supabase's default `ALL` from `anon` and
  `authenticated`. It also changes the default privileges in `public` so that **new tables
  and functions created by `postgres` get no access until a migration grants it**. Future
  RPCs therefore need an explicit `grant execute`.
- `admin` has the same data rights as `editor`, plus `set_account_role`.

### Member accounts and "Mis asignaciones" (docs/ASSIGNMENTS.md)

| RPC (all `SECURITY DEFINER`, `search_path = ''`) | Who             | What                                                                                                         |
| ------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------ |
| `my_assignments(p_from, p_to)`                   | authenticated   | carrito turns, program parts and salidas conducted by the caller's linked person. Empty when not linked       |
| `my_link()`                                      | authenticated   | `(person_id, person_name)` of the caller. Zero rows when not linked                                           |
| `list_accounts()`                                | editor/admin    | every auth user with email, provider, role and linked person                                                 |
| `link_account(p_user, p_person)`                 | editor/admin    | link, or unlink with null. A person links to one account only (23505)                                        |
| `set_account_role(p_user, p_role)`               | admin           | change a role. The last admin cannot be demoted                                                              |
| `reminder_candidates(p_from, p_to)`              | secret key only | feed for the send-reminders function                                                                         |

- Matching: carrito by `person_ids`. Program and salida by name: `private.norm_name` =
  lower(unaccent(trim)) with spaces collapsed, compared with `people.name` and every entry of
  `people.aliases` (e.g. "D. Perez"). Editors add an alias when a PDF spells a name differently.
- Permission failures raise `42501` (PostgREST answers 403).
- `reminder_log` has RLS on and no grants. Only the secret key (the function) touches it.

### People directory, permissions and Privilegios (docs/PRIVILEGIOS.md)

| Who                                                     | duty_roster / duty_days | program_weeks write (by row kind) |
| ------------------------------------------------------- | ----------------------- | --------------------------------- |
| anon                                                    | nothing (no grant)      | no                                |
| viewer                                                  | nothing (0 rows)        | no                                |
| viewer whose linked person has any `people.duties` tag  | read                    | no                                |
| `profiles.can_edit_programa_midweek`                     | nothing                 | midweek rows                      |
| `profiles.can_edit_programa_weekend`                     | nothing                 | weekend rows                      |
| `profiles.can_edit_privilegios`                         | read + write            | no                                |
| editor / admin                                          | read + write            | both                              |

- Policies use `private.can_edit_programa_midweek()` / `private.can_edit_programa_weekend()`
  (invoker, own profile row; the row's `kind` picks one), `private.can_edit_privilegios()` and
  `private.sees_privilegios()` (DEFINER: it reads the linked person's duties).
  `private.can_edit_programa()` remains as the either-grant helper for the person pickers and
  `people_directory()`. `authenticated` has USAGE on `private` and EXECUTE on those helpers only;
  `private` is not an exposed API schema.
- On UPDATE, `USING` checks the old row's kind and `WITH CHECK` the new one, so moving a row from
  one meeting to the other needs both grants.
- `people.in_carrito` (default true): the scheduler and carrito pickers use only these
  (`carritoPeople()` in packages/data). `people.duties` ⊆ computadora, sonido, microfonista, acomodador.
- `duty_roster.person_name` is a trigger snapshot of `people.name` when `person_id` is set
  (refreshed on rename; kept as free text when the person is deleted), otherwise free text.
  Non-editors cannot read `people`, so the roster always shows `person_name`.
- `my_assignments` kind `privilegio`: by `person_id`, or by name/alias for free-text cells;
  key `privilegio:<date>:<role>:<slot>`, no start time; `duty_days` asamblea / sin_reunion
  dates are skipped.

| RPC                                                         | Who                              | What                                                                                       |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `name_sources()`                                            | editor/admin                     | distinct names in program, salida conductors and free-text roster cells, matched person or null (unmatched first) |
| `create_person_from_name(p_name, p_gender, p_in_carrito)`   | editor/admin                     | new person (in_carrito default false); 23505 if the name/alias already matches someone     |
| `add_person_alias(p_person, p_alias)`                       | editor/admin                     | append alias; no-op if it already matches the person, 23505 if it matches someone else     |
| `set_account_permissions(p_user, p_midweek, p_weekend, p_privilegios)` | admin                | set the three grants (null = unchanged)                                                    |
| `my_permissions()`                                          | authenticated                    | `(role, can_edit_programa_midweek, can_edit_programa_weekend, can_edit_privilegios, sees_privilegios)`, effective (editors: true) |
| `duty_people()`                                             | editor/admin, can_edit_privilegios | `(id, name, duties, aliases)` of people with any duty (roster pickers)                    |
| `list_accounts()`                                           | editor/admin                     | now also returns the stored `can_edit_programa_midweek`, `can_edit_programa_weekend`, `can_edit_privilegios` |

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
- `reminder_log` is the one public table without `version`/`updated_*`/`bump_version`
  (append-only log). `tests/00_schema_test.sql` excludes it from those checks.
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
   email and a temporary password, and tick _Auto confirm user_. No email is sent.
   Do **not** use _Send invitation_ or password-reset emails until the app is deployed and
   Authentication ▸ URL Configuration ▸ **Site URL** points at it: the default Site URL is
   `http://localhost:3000`, so those email links fail.
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

Members don't need an account to read schedules. To see "Mis asignaciones" and get reminders
they sign in with Google (next section). An editor then links the account to their `people`
row in Gestión ▸ Usuarios.

### Google sign-in for members (owner decision needed)

`[auth] enable_signup = false` (config.toml, and step 2 above) also blocks **Google** sign-ups:
a member's first Google login creates their auth user, so with sign-ups off it fails. To let
members in while keeping email sign-up closed:

1. Authentication ▸ Sign In / Providers ▸ **Google**: enable it with a Google Cloud OAuth
   client (type Web application, authorised redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`).
2. Turn **on** "Allow new users to sign up", and under **Email** turn sign-ups **off**.
   Editors keep signing in with their existing email + password accounts.
3. Authentication ▸ URL Configuration: Site URL = the deployed app. Add
   `https://<app-domain>/mis-asignaciones` to the redirect allow-list.

Anyone with a Google account can then create a `viewer` account. That grants nothing beyond
anonymous access until an editor links it to a person. Locally the same change is
`[auth] enable_signup = true`, `[auth.email] enable_signup = false` and an
`[auth.external.google]` block with `env(...)` credentials. config.toml is left unchanged
until the owner decides.

## Reminders (send-reminders Edge Function)

Every day at 12:00 UTC (09:00 Buenos Aires) `pg_cron` runs `private.invoke_send_reminders()`,
which POSTs (`pg_net`) to the function with `Authorization: Bearer <reminders_secret>`. The
function pushes "en 7 días" and "Mañana" reminders to every linked user with a Web Push
subscription (`device_tokens.platform = 'web'`), logs each send in `reminder_log` so a
reminder never repeats, and deletes subscriptions that answer 404/410. Until the Vault secrets
exist the cron job does nothing (it raises a notice).

### Owner setup (once, hosted project)

1. **VAPID keys** (identify this server to the browsers' push services):
   ```sh
   npx web-push generate-vapid-keys
   ```
   The public key also goes to the web app as `VITE_VAPID_PUBLIC_KEY`. The private key never
   leaves the function secrets.
2. **Function secrets.** `REMINDER_SECRET` is any long random string (`openssl rand -hex 32`):
   ```sh
   npx supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> \
     VAPID_SUBJECT=mailto:<owner email> REMINDER_SECRET=<random>
   ```
   The function reads the project's secret API key from the platform-provided
   `SUPABASE_SECRET_KEYS`. If the project has no secret API key yet, create one under
   Project Settings ▸ API Keys, or set one as the `SB_SECRET_KEY` function secret.
3. **Deploy.** `verify_jwt = false` comes from config.toml because the cron call carries the
   shared secret, not a user JWT. The function answers 401 to any other caller.
   ```sh
   npx supabase functions deploy send-reminders
   ```
4. **Vault secrets** for the cron job (SQL editor):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-reminders', 'reminders_url');
   select vault.create_secret('<same REMINDER_SECRET>', 'reminders_secret');
   ```
   To rotate: `select vault.update_secret(id, '<new>') from vault.secrets where name = 'reminders_secret';`
   and `npx supabase secrets set REMINDER_SECRET=<new>`.
5. **Dry run.** Sends nothing, logs nothing, returns what would be sent. `today` is optional
   and honoured only in dry runs:
   ```sh
   curl -X POST https://<project-ref>.supabase.co/functions/v1/send-reminders \
     -H "Authorization: Bearer <REMINDER_SECRET>" -H "Content-Type: application/json" \
     -d '{"dryRun":true}'
   ```
6. **Check the job:** `select * from cron.job_run_details order by start_time desc limit 5;`
   and the HTTP result: `select status_code, content from net._http_response order by id desc limit 5;`

### Local

```sh
# env file in a scratch dir outside the repo (never commit it):
#   VAPID_PUBLIC_KEY=…  VAPID_PRIVATE_KEY=…  VAPID_SUBJECT=mailto:you@example.com  REMINDER_SECRET=local-test-secret
npx supabase functions serve send-reminders --no-verify-jwt --env-file <scratch>/reminders.env
curl -X POST http://127.0.0.1:54321/functions/v1/send-reminders \
  -H "Authorization: Bearer local-test-secret" -d '{"dryRun":true,"today":"2026-10-12"}'
deno test supabase/functions/send-reminders     # unit tests for lib.ts
```

The seed gives the fake person "Ana Prueba" one assignment of each kind: carrito and a midweek
part on 2026-10-13, the weekend discourse (through the alias "A. Prueba") and a salida on
2026-10-17. To see reminders locally, add a user in Studio, link it to
`00000000-0000-4000-8000-000000000401`, and insert a fake `device_tokens` row with
`platform = 'web'` and a PushSubscription-shaped JSON token. Dry runs with
`"today":"2026-10-12"` (Mañana) and `"today":"2026-10-10"` (en 7 días) then list them.
To exercise the cron path locally, create the Vault secrets with the URL
`http://kong:8000/functions/v1/send-reminders` and run `select private.invoke_send_reminders();`.
