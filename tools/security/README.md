# tools/security: client-side access-control check

`access-check.ts` acts as the public web client, which holds only the publishable key. It proves
that each table, RPC, realtime stream and Edge Function answers only the roles that should see
it. The expected matrix lives in `matrix.ts`. It is derived from `supabase/migrations/*.sql`,
`supabase/README.md`, `docs/ASSIGNMENTS.md` and `docs/PRIVILEGIOS.md`.

```sh
# local stack (default). Needs `npx supabase start`; no db reset needed
npx tsx tools/security/access-check.ts

# hosted project, anon only, read-only
HOSTED_SUPABASE_URL=https://<ref>.supabase.co HOSTED_PUBLISHABLE_KEY=sb_publishable_... \
  npx tsx tools/security/access-check.ts --target hosted

# options
#   --out <file.json>      write every result as JSON (keep it outside the repo for hosted runs)
#   --realtime-wait <ms>   how long to wait for realtime events (default 4000)
#   ACCESS_CHECK_DEBUG=1   print every realtime event (event type + column names, no values)

# typecheck
npx tsc -p tools/security/tsconfig.json
```

The exit code is 1 when any check fails. Every line prints as `PASS`, `FAIL`, `WARN` (a known
caveat, measured) or `INFO`.

## What it checks

| Area      | Local (anon + signed-in viewer)                                                                                                                                                                  | Hosted (anon)                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| surface   | every `create table public.*` / `create function public.*` in the migrations has a matrix row; the anon OpenAPI document lists only anon-readable tables and no RPC                               | same (OpenAPI answers 401 to the publishable key on hosted)         |
| tables    | SELECT/INSERT/UPDATE/DELETE on all 17 tables against the matrix. RLS-hidden reads must return 0 rows while the secret key sees ≥ 1; blocked UPDATE/DELETE must leave the fixture's `version` unchanged | SELECT only, with `limit 0` plus an exact count, so no row data is fetched |
| profiles  | the viewer may change its own `display_name` only. `role`, `person_id`, `can_edit_*` and `id` → 42501; another user's row → 0 rows; upsert with role → 42501                                    | n/a                                                                 |
| tokens    | own device_tokens CRUD; insert for another user / move own token to another user → 42501; another user's token is hidden and cannot be changed                                                 | n/a                                                                 |
| RPCs      | all 15 public functions against the matrix, including escalation attempts (`set_account_role(self,'admin')`, `link_account`, `set_account_permissions`, `create_person_from_name`)              | the 10 non-mutating functions only                                  |
| schemas   | `private`, `auth`, `storage`, `realtime`, `vault`, `net`, `cron` are not exposed (PGRST106)                                                                                                         | same                                                                |
| auth      | anonymous sign-ins off; sign-up state; an email sign-up attempt is refused                                                                                                                       | settings only (no sign-up attempt)                                  |
| storage   | buckets visible to anon                                                                                                                                                                          | same                                                                |
| graphql   | pg_graphql introspection exposes no restricted table                                                                                                                                             | same                                                                |
| realtime  | anon and viewer subscribe to `postgres_changes` on the 5 restricted published tables and on a public control table. The secret key inserts, updates and deletes marked rows                       | skipped: events cannot be generated without writes                  |
| functions | `send-reminders` and `workbook`: no auth, publishable key as Bearer, garbage Bearer, legacy anon JWT, viewer JWT, bad JSON, GET → 401/403/400/405, and the body must not leak internals         | no-auth / publishable / garbage probes                              |

## Safety rules (enforced in code)

- **Secret key:** the local secret key comes from `npx supabase status -o json` (or
  `LOCAL_SECRET_KEY`) at run time. It is never stored in a file, and the script refuses to use it
  unless the host is `127.0.0.1` or `localhost`.
- **Hosted mode:** no secret key, so there are no fixtures, no users and no write paths. All
  requests run sequentially with a small gap (about 40 in total). Results show pass/fail and row
  counts only.
- **Local fixtures:** every fixture row is marked (`zz-access-check-*` names, dates in 2099,
  territory ids 990000+). They are deleted by key in `finally`, and a sweep runs before and after
  that also removes anything a broken policy let a probe insert. The two throwaway users
  (`zz-access-check-*@example.test`) are deleted at the end.
- **Shared stack:** the script never resets the database, so other work on the stack keeps its
  data.

## Realtime caveats (measured, reported as WARN)

- **Viewer DELETE events:** Realtime does not apply RLS to DELETE events. A signed-in viewer
  subscribed to a restricted table receives the old record's primary key (`people.id`,
  `person_availability(person_id, slot_id)`, `person_pairs(person_a, person_b)`,
  `duty_roster.id`, `duty_days.date`). The check fails if any non-key column ever shows up, for
  example after `replica identity full`.
- **Anon events:** anon receives INSERT/UPDATE events on restricted tables with an empty record
  and an `Unauthorized` error, plus empty DELETE events. These carry no row data, but they reveal
  that a write happened and when.
- **Dropped events:** Realtime re-reads a changed row to apply RLS, so an INSERT/UPDATE whose row
  is deleted right afterwards is dropped for every subscriber. The check therefore waits between
  the writes and the deletes. It also requires the control table to deliver events both before and
  after the restricted writes, so "no events" cannot pass just because the stream was dead.

## Updating the matrix

A new table or public function makes the `surface` check fail until it has a row in `matrix.ts`.
Add the row, then add a probe row (`probeRow`) and a harmless `PATCH` for new tables.
