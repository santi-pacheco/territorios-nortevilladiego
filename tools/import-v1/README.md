# tools/import-v1: one-way import from v1 into the 2.0 schema

This tool reads the three v1 jsonb rows (`salidas`, `carrito` and `programa`, all `id = 1`) and the
territories KML. It converts them with `@territorios/core` and writes them into the 2.0 tables
(`supabase/migrations/*.sql`).

- **v1 is read-only.** The tool reads it with plain HTTP `GET`s and never creates a write client
  for the v1 URL. It also refuses to run when `TARGET_SUPABASE_URL` equals `V1_SUPABASE_URL`.
- **It does a dry run by default.** It prints the converted counts, every skipped or adjusted item,
  and a per-table diff. Nothing is written unless you pass `--apply`.
- **It is idempotent.** Rows are matched by natural key, and unchanged rows are never sent. Sending
  them would bump `version` and cause spurious CAS conflicts for open editors. A second
  `--apply` prints "No-op (nothing written)".
- **Keys come from env only.** They are never logged and never written to disk.

## Owner commands (PowerShell, from the repo root)

### 1. Rehearse offline against the local stack (fake fixture)

```powershell
npx supabase start
# Load the local URL and secret key into this shell without printing them:
npx supabase status -o env | ForEach-Object {
  if ($_ -match '^(API_URL|SECRET_KEY)="?([^"]*)"?$') { Set-Item "env:LOCAL_$($Matches[1])" $Matches[2] }
}
$env:TARGET_SUPABASE_URL = $env:LOCAL_API_URL
$env:TARGET_SERVICE_KEY  = $env:LOCAL_SECRET_KEY

npx tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts --from-file tools/import-v1/fixtures/v1-snapshot.fake.json
npx tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts --from-file tools/import-v1/fixtures/v1-snapshot.fake.json --apply
npx tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts --from-file tools/import-v1/fixtures/v1-snapshot.fake.json --apply   # → No-op
```

### 2. Real import: v1 → hosted 2.0 project

```powershell
# Source: v1 project URL + its PUBLISHABLE key (Project Settings ▸ API Keys of the v1 project).
$env:V1_SUPABASE_URL = "https://<v1-ref>.supabase.co"
$env:V1_SUPABASE_KEY = Read-Host "v1 publishable key"
# Target: the NEW 2.0 project URL + its secret key (Project Settings ▸ API Keys ▸ Secret keys).
$env:TARGET_SUPABASE_URL = "https://<v2-ref>.supabase.co"
$env:TARGET_SERVICE_KEY  = Read-Host "v2 secret key"

# a) Freeze v1 to a local file first (contains REAL names; tools/import-v1/snapshots/ is git-ignored):
New-Item -ItemType Directory -Force tools/import-v1/snapshots | Out-Null
npx tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts --save-snapshot tools/import-v1/snapshots/v1.real.json

# b) Review the diff, then apply from the frozen snapshot:
npx tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts --from-file tools/import-v1/snapshots/v1.real.json
npx tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts --from-file tools/import-v1/snapshots/v1.real.json --apply

# c) Optional check: a second apply must print "No-op (nothing written)".
npx tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts --from-file tools/import-v1/snapshots/v1.real.json --apply

Remove-Item env:V1_SUPABASE_KEY, env:TARGET_SERVICE_KEY
```

At cutover (PLAN §Phase 4), freeze v1 edits first. Then run steps a–b again. Re-running is safe.

Typecheck: `npx tsc -p tools/import-v1/tsconfig.json`.

## Options

| Flag                     | Meaning                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `--from-file <path>`     | Offline snapshot `{ "salidas": …, "carrito": …, "programa": … }` (v1 `data` columns) |
| `--save-snapshot <path>` | Also write the v1 rows that were read to `<path>`                               |
| `--kml <path>`           | Territories KML (default `apps/web/public/territorios.kml`)                    |
| `--dry-run` / `--apply`  | Default is dry run                                                             |

Without `TARGET_*` env vars, a dry run converts only and shows no diff.

## Mapping

| v1                                                  | 2.0                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `salidas.weekStart` (a Wednesday)                    | `service_weeks.week_start` = Monday = weekStart − 2 days (UTC date math); `mes` → `month_label` |
| `days[].slots[]` / `domingoSlots[]`                  | `service_meetings` (one per slot, empty template slots included), `position` = index within the dow |
| `territorio` / `territorioNumero`                    | `territory_ids`, parsed by core's `salidasToScheduleData`                              |
| legacy Domingo `g1..g4`                              | `group_territories.G1..G4` (numeric ids); `groups` text is what core `migrateSchedule` folds them into |
| `carrito.places/slots/people`                        | `cart_places` / `cart_slots` (times → `HH:MM:SS`) / `people`, ids = uuid v5 of the v1 id |
| `targetAppearances`                                  | clamped to 0..999                                                                      |
| `availableSlotIds` / `mustBeWithIds`                 | `person_availability` / `person_pairs` (one row per unordered pair, `person_a < person_b`) |
| `schedule` + `entries[]`                             | one `cart_schedules` row + `cart_assignments` (`person_names` filled by the DB trigger) |
| `blackouts[]`                                        | `cart_blackouts`                                                                       |
| `programa.midweek[date]` / `weekend[date]`           | `program_weeks` (`kind`, `date`, `data` = the v1 object as is)                         |
| `territorios.kml`                                    | `territories` via core `loadTerritories` (xmldom `DOMParser` shim)                     |

**Matching keys.** Rows are matched on these keys:

- `service_weeks.week_start`
- `service_meetings (week, dow, position)`
- `program_weeks (kind, date)`
- `cart_assignments (schedule, week_date, slot)`
- `cart_blackouts (slot, date)`

Matched rows keep their existing id. Other rows get a deterministic uuid v5 of their v1 key.

**Deletes.** Deletes are scoped to children of imported parents:

- meetings of imported weeks
- availability and pairs of imported people
- cells of the imported schedule
- blackouts of imported slots

Top-level rows that exist only in 2.0 are counted as `kept-extra` and never deleted. This covers
weeks, people, places, programs and territories.

**Nothing is dropped silently.** Every skip or adjustment is listed under `warnings` with a count
and v1 ids. Examples: unknown slot/person references, self-pairs, an invalid colour (replaced
with `#888888`), a programa key that isn't on a Tuesday/Saturday, a territory id missing from
the KML.

There is no transaction across tables, because the import goes over the REST API. If a run fails
halfway, re-run it. The diff picks up where it stopped.

## Verified locally (fake fixture, local stack on top of `seed.sql`)

- Dry run: 89 row changes (46 + 3 territories, 1 week, 8 meetings, 2 places, 3 slots, 5 people,
  8 availability, 2 pairs, 1 schedule, 5 assignments, 1 blackout, 4 programs).
- Apply 1: wrote 89, and the re-diff showed 0 pending.
- Apply 2: "No-op (nothing written)". Per-table `count(*)`, `sum(version)` and `max(updated_at)`
  were identical before and after it.
- Natural-key adoption: a pre-existing `service_weeks` row (2026-10-19) and a `program_weeks` row
  (midweek 2026-10-20), both with random ids, kept their ids and went to version 2. An
  app-made meeting at (dow 3, pos 0) was updated in place, and a stray meeting at pos 5 was
  deleted. No 23505 errors. The next apply was a no-op.
- v1 REST path, tested against a local mock: only `GET`s were sent, with an `apikey` header and no
  `Authorization` for `sb_publishable_` keys. The `--save-snapshot` → `--from-file` counts were
  identical. A table answering `[]` (missing row or RLS) exits 1.

## Decisions to review

1. **Domingo display gap (outside this tool).** Current v1 Domingo slots use `grupos` +
   `territorioNumero`. They import as `territory_ids` with empty `group_territories`.
   `apps/web/src/routes/salidas/StationLine.tsx` renders only `GroupRows` for Domingo, so these
   territories won't show on the Salidas tab. Mapa does show them, because it unions both.
2. Legacy `g1..g4` cells go into `group_territories.G1..G4` (numeric ids). They also appear in
   the `groups` text, because core `migrateSchedule` folds them there, as the brief requested.
3. Top-level rows removed in v1 (a week, a person, a program date) are kept in 2.0 (`kept-extra`).
4. There is no cross-table transaction (REST). If a run fails, re-run it.
5. `tools/import-v1` is not a workspace package, so `pnpm typecheck` doesn't cover it. Run
   `npx tsc -p tools/import-v1/tsconfig.json` (it's in this README).
