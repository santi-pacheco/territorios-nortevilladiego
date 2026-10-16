# 01 — TerritoriosMap v1 audit (input for 2.0)

Date: 2026-10-16 · Branch `santi-pacheco/OrcaTerritoriosAppTest` @ `4c30149` · 69 commits · ~6.2k LOC TS/TSX (`src/`).

Scope: read-only audit. No source changes. Supabase facts below come from **read-only** SQL (`pg_policies`, `pg_publication_tables`, `pg_column_size`, `count(*)` on `auth.users`) run 2026-10-16 against the project the Supabase MCP is connected to (tables `salidas`/`carrito`/`programa` match this repo).

---

## 0. How the numbers were obtained (and why not `npm run build`)

`npm run build` was **not** run as-is, because it mutates tracked files:
- `prebuild` → `scripts/sync-kml.mjs:7-24` downloads Google My Maps KML and **overwrites tracked `public/territorios.kml`**; `process.exit(1)` on any fetch failure.
- `tsc -b` writes the **tracked** `tsconfig.app.tsbuildinfo` / `tsconfig.node.tsbuildinfo`.

Ran instead: `npm ci` (lockfile untouched) → `npx vitest run` → `npx tsc -p tsconfig.app.json --noEmit` (exit 0) → `npx vite build --outDir <scratchpad>`. `git status` clean afterwards.

Both side effects are findings in their own right: every Vercel deploy depends on a live Google fetch, and build artifacts are committed (see §3.5).

---

## 1. Feature inventory

### 1.1 Shell (`src/App.tsx`)
- Hash routing: `#` (Mapa), `#salidas`, `#carrito`, `#programa` (`App.tsx:62-66`, `hashchange` listener `:100-104`). No router lib.
- Header: logo, 4-tab toggle (`ViewToggle :68-89`), week label + live `SyncDot` (only visible on Mapa; `invisible` elsewhere, `:163`).
- **All four data hooks are called at the top level** regardless of view (`App.tsx:90-93`): `useTerritories`, `useSalidas`, `useCarrito`, `usePrograma`.
- Views are conditionally rendered → switching tab **unmounts/remounts** the view (incl. MapView, §3.3).

### 1.2 Mapa (territories map)
- **KML pipeline**: Google My Maps (`mid` hardcoded `sync-kml.mjs:6`) → build-time download to `public/territorios.kml` (84 KB) → runtime `fetch('/territorios.kml')` (`useTerritories.ts:16`) → `DOMParser` + `@tmcw/togeojson` (`kml.ts:29-33`) → keep only Polygon/MultiPolygon whose name contains a number; **territory id = first integer in Placemark name** (`kml.ts:5-9`) → sorted by id.
- Centroid = vertex average of first ring (`kml.ts:11-26`) — not area centroid; MultiPolygon uses only first polygon.
- Map: MapLibre GL, CARTO Positron style (`MapView.tsx:22`), center hardcoded (`:20`). Layers `territories-fill` + `territories-inner` (white inner border) placed below first symbol layer so street labels stay on top (`:110-151`). Styling via `feature-state` (selected/hovered/highlighted/muted/anySelection, `:197-213`), colors from 8-hue hashed palette `colors.ts:22-25`.
- Day context: selected day = today's dow if present else first day (`App.tsx:111-117`). Territories of that day highlighted.
- Click polygon → popup (`setHTML`) + select first assignment containing that territory (`MapView.tsx:163-172`). Selecting an assignment flies/fits to its territories (`:278-296`).
- Desktop: left sidebar (DaySwitcher + ScheduleList) + selection chip + legend. Mobile: draggable bottom sheet (`MobileSheet.tsx`, PEEK 168px / FULL 72vh), selection pill, `bottomInset` padding logic (`App.tsx:150-154`).
- **Geolocation/heading**: locate button cycles off → follow → compass (`locateMode.ts`). `useGeolocation` = `watchPosition` high accuracy (`useGeolocation.ts:28-40`); blue dot marker + accuracy circle in px recomputed on zoom (`MapView.tsx:226-265, 315-322`). `useDeviceHeading`: iOS `webkitCompassHeading` with `requestPermission`, else `deviceorientationabsolute` alpha (`useDeviceHeading.ts:20-51`). Follow/compass camera via `easeTo` (`MapView.tsx:325-335`); manual drag/rotate cancels follow (`:102-106`).

### 1.3 Salidas (field-service weekly schedule card)
- Data: one JSON doc `{mes, weekStart, days[]}`; `days[]` = `{dow 0..6, kind 'normal'|'domingo', slots[], domingoSlots[]}` (`types.ts:41-74`).
- Public: read-only printable card colored per day (`salidasColors.ts`), day numbers derived from `weekStart` (Wednesday reference), month label auto-switches when week crosses months (`salidasStore.ts:96-102`).
- Admin: inline edit of all fields, add/remove slot, add/remove day (any dow, Mon→Sun ordering), set `mes` + `weekStart` (`SalidasView.tsx:71-95, 146-198`).
- Export: "Descargar PNG" / "Copiar imagen" via `html-to-image`, elements with `data-export-hide` filtered (`exportImage.ts`). Public users can export too.
- Feeds the Mapa: `salidasToScheduleData` (`salidasAdapter.ts`) converts days → `Assignment{time, corner, groups, leader, territoryIds}`.
- Legacy migration from per-day keys (`miercoles…domingo`) and Domingo `g1..g4` → `grupos` (`salidasStore.ts:19-33, 133-172`).

### 1.4 Carrito (cart-witnessing scheduler)
- Data: `{places[], slots[], people[], schedule|null, blackouts[]}` (`carrito/types.ts`).
- Public: only Cronograma (read-only grid). Admin: Cronograma + Personas + Lugares + Turnos tabs (`CarritoView.tsx:43`).
- Personas: name, gender (auto-inferred from first name, overridable), available slots, must-be-with partners, target appearances (`PersonModal.tsx`).
- Lugares (name + color), Turnos (place, ISO dow, start/end, groupSize, optional `displayLabel`).
- Cronograma: pick title/range → **Generar** (scheduler §5.1) → grid weeks × slots (desktop table, mobile cards) → manual edit via person picker (available people first, "no disp." marker), per-cell notes, editable column labels, blackouts ("excepciones") list, per-person participation counter with highlight (`ScheduleTab.tsx`).
- Cascading deletes (place→slots→availability/blackouts/entries; person→mustBeWith/entries) (`useCarrito.ts:107-180`). Notes preserved across regeneration (`useCarrito.ts:189-197`).
- PNG export same as Salidas.
- Seed data: default places/slots/~40 people hardcoded (`carrito/store.ts:15-85`) used when nothing stored.

### 1.5 Programa (weekly meeting program)
- Admin uploads monthly PDFs (one or both): midweek ("ENTRE SEMANA") and weekend ("fin de semana|ATALAYA") detected by text regex (`UploadPanel.tsx:37-58`). Year entered manually (PDFs lack it).
- PDF read in browser via **lazy** `pdfjs-dist` + worker (`pdfItems.ts:6-11`) → positioned text items → coordinate parsers (§5.3) → preview shows only counts + warnings → "Guardar" merges by ISO date (`merge.ts`) and pushes.
- View: week navigator (Mon–Sun), midweek card keyed by **Tuesday** and weekend card keyed by **Saturday** of that week (`ProgramaView.tsx:41-42`), section headers with colors, assembly banner / assembly-only week (`:45-53`).
- No manual editing, no deletion of weeks, no realtime.

### 1.6 Auth / admin flow
- `useAdminAuth` instantiated separately in each of Salidas/Carrito/Programa views (3 independent instances).
- Supabase mode: username `admin` → `VITE_ADMIN_EMAIL` (default `admin@territorios.app`), or a typed email; `signInWithPassword` (`useAdminAuth.ts:38-44`). `isAdmin = !!session` — **any authenticated session is admin**.
- Fallback (no Supabase env): hardcoded username/password literal compared client-side, flag in `sessionStorage` (`useAdminAuth.ts:8-11, 45-56`).
- Live DB: `auth.users` count = **1** (single shared admin account; password shared among editors).

### 1.7 Realtime / sync / offline
| Store | Local cache key | Initial fetch | Realtime channel | Poll | Push |
|---|---|---|---|---|---|
| salidas | `salidas-v1` | yes | `salidas-row` (`salidasApi.ts:36-53`) | 60 s (`useSalidas.ts:8`) | debounced 1.5 s, whole doc upsert |
| carrito | `carrito-data` | yes | `carrito-row` (`carrito/api.ts:35-52`) | 60 s | debounced 1.5 s, whole doc |
| programa | `programa-data` | yes (once) | **none** (table *is* in publication) | **none** | immediate on Guardar, whole doc |
- "Offline" = localStorage gives instant paint of last known doc; status badge `offline` on fetch/push error. **No service worker, no manifest** → a reload with no network fails (no app shell, KML, tiles, fonts).
- `dirty` ref blocks remote overwrite while local edits pending.

---

## 2. Data model & Supabase

### 2.1 Tables (from `docs/*.sql`, confirmed live)
All three identical shape: `id int pk, data jsonb not null default '{}', updated_at timestamptz default now()`; single row `id=1` holds the entire feature state.

| Table | Rows (live) | `pg_column_size(data)` | In `supabase_realtime` | Replica identity |
|---|---|---|---|---|
| `salidas` | 1 | 1,668 B | yes | default |
| `carrito` | **2** (id 1 + **orphan id 2**) | 3,214 / 2,916 B | yes | default |
| `programa` | 1 | 2,916 B | yes | default |

`carrito` id=2 is the old Programa location; `programa-supabase.sql:10-14` copied it but left it in place ("non-destructive"). It is still anon-readable.

### 2.2 RLS (live `pg_policies`, matches SQL files)
| Policy | Roles | Cmd | USING | WITH CHECK |
|---|---|---|---|---|
| `<t> read` | anon, authenticated | SELECT | `true` | — |
| `<t> write` | authenticated | **ALL** | `true` | `true` |

Implications:
- Any authenticated user can INSERT/UPDATE/DELETE **any row, any id, any jsonb payload/size**. No schema validation, no row-id constraint, no role/claim check.
- Anon can SELECT everything, including full Carrito people list (names, gender, availability, must-be-with links) even though the UI hides the Personas tab from non-admins.
- **Signup setting UNVERIFIED** (no `.env` in worktree; not readable via SQL). If Dashboard ▸ Authentication ▸ Sign In / Providers ▸ "Allow new users to sign up" is on (Supabase default), anyone with the public publishable key can `auth.signUp` and gets full write on all three tables. Verify with `curl "$VITE_SUPABASE_URL/auth/v1/settings" -H "apikey: $KEY"` → `disable_signup`, `mailer_autoconfirm`.

### 2.3 Client API layer
- `src/lib/supabase.ts`: single client, publishable key (legacy anon accepted).
- `salidasApi.ts`, `carrito/api.ts`, `programa/api.ts`: `select('data').eq('id',1).maybeSingle()`, `upsert({id:1,data,updated_at: client clock})`, `postgres_changes` filter `id=eq.1`. Validation only by shape sniffing (`looksLike*`).
- No versioning / optimistic concurrency (`updated_at` written but never compared).

---

## 3. Bugs, races, performance, security

### 3.1 Data-loss races (high)
1. **Own echo clobbers newer edit** (`useSalidas.ts:70-87` + `:55-61`; identical `useCarrito.ts:75-92` + `:44-73`). Trace: edit s1 → timer fires `pushRemote(s1)` (in flight) → user edits to s2 (dirty=true, effect cleanup clears *pending* timer, schedules timer2) → push(s1) resolves → `dirty=false` → realtime echo of s1 (or poll) accepted → `setSchedule(s1)` → effect re-runs with `dirty=false` → cleanup clears timer2, **no re-push**. s2 lost locally and remotely; controlled inputs visibly jump back while typing.
2. **Offline edit + reload loses edits**: localStorage has unsynced edits, but on mount `dirty=false`, so `fetchRemote` overwrites them (`useSalidas.ts:39-50`). Failed push sets `offline` and is only retried on the *next* edit (no retry/backoff); polls are skipped while dirty, so the device stays stale.
3. **Multi-admin last-write-wins on whole document**: remote updates are ignored while dirty, then our push overwrites them. With one shared account, two editors on two phones silently clobber each other.
4. **Programa stale merge** (`usePrograma.ts:40-57`): merges upload onto `latest.current`; if the initial fetch failed or hasn't returned, it pushes *local cache + new month* over remote (can drop months uploaded from another device). No realtime/poll → viewers stale until reload.
5. **Impure scheduler inside state updater** (`useCarrito.ts:183-201`): `runGenerateSchedule` (uses `Math.random`) runs inside `setData(updater)` and `warnings` is read back synchronously. Works only when React computes the updater eagerly; with a pending update (e.g. note `onBlur` fired just before clicking Generar) warnings come back `[]`; StrictMode double-invokes updaters.
6. **Stale uncontrolled inputs** in `ScheduleTab.tsx`: notes/labels/title use `defaultValue` (`:222, :378, :398`) and form state is initialized once from props (`:46-48`) → remote changes not reflected; `scheduleName` stays default if remote schedule arrives after mount. `renderSlotBody` is rendered twice (desktop table + mobile cards, both in DOM, CSS-hidden) → duplicated pickers/inputs with `autoFocus`.

### 3.2 Logic bugs
- **must-be-with is directional** (`PersonModal.tsx:60-62` sets only A→B). Scheduler BFS follows only outgoing edges and skips visited nodes (`scheduler.ts:96-116`): if B (no edge) is iterated before A (A→B), B becomes a solo unit, then A's BFS finds B visited → A also solo → pair split. Removal pass (`:77-91`) is also one-directional.
- No same-day double-booking guard: a person available for two slots on the same day (e.g. adjacent Thursday shifts) can be assigned to both.
- Warnings render raw ISO dow number ("4 08:30", `scheduler.ts:177`) and repeat per week per slot (spam).
- Weeks with all slots blacked out disappear from the grid (rows derived only from existing entries, `ScheduleTab.tsx:65-70`).
- Salidas: **remove day = one tap, no confirm, no undo**, propagated to everyone in 1.5 s (`SalidaDayBlock.tsx:21-24`, `DomingoBlock.tsx:62`). Carrito deletes use blocking `window.confirm`.
- Map popup/selection picks only the first assignment for a territory (`MapView.tsx:167`) — if a territory appears in 2 salidas the same day, the second is unreachable from the map.
- Geolocation never stops: tapping back to `off` doesn't call `geo.stop()` (`MapView.tsx:81-86`) → GPS watch keeps running (battery).
- Heading not compensated for screen orientation (landscape) and not smoothed.
- `bottomInset` computed from `window.innerHeight` during render, not on resize (`App.tsx:150-154`).
- KML: duplicate numbers in Placemark names → duplicate ids under `promoteId` (silent mis-highlight). Build fails if Google is down.
- Programa: `<input type=file>` not reset → re-selecting the same file does nothing; preview shows counts only, so parse errors are invisible until published; no way to edit/delete a week.

### 3.3 Performance
Build (Vite 7.3.3, 140 modules, 3.65 s):

| Asset | Raw | Gzip | Load |
|---|---|---|---|
| `index-*.js` | **1,400.50 kB** | **388.79 kB** | eager (React, maplibre-gl, supabase-js, togeojson, html-to-image, all views) |
| `index-*.css` | 120.70 kB | 18.98 kB | eager (Tailwind + global `maplibre-gl.css` import, `index.css:2`) |
| `pdf-*.js` | 495.58 kB | 151.29 kB | **lazy** (dynamic import on upload) ✅ |
| `pdf.worker.min-*.mjs` | 1,321.31 kB | — | lazy ✅ |
| `territorios.kml` | 84 KB | — | runtime fetch, no explicit cache headers |

- **maplibre is eager**: `App.tsx:2` imports `MapView` statically → Salidas/Carrito/Programa-only users pay ~1 MB of map code. No `React.lazy` anywhere.
- All hooks run on every view (`App.tsx:90-93`): 3 realtime channels + 2×60 s pollers (full-document fetch even when realtime works, even in background tabs).
- MapView remount per tab switch → new WebGL context, style + tiles refetch.
- Compass mode: every `deviceorientation` event (~60 Hz) → `setHeading` → MapView re-render + `easeTo` (`useDeviceHeading.ts:24-31`, `MapView.tsx:325-335`).
- `hoveredIds` lives in App → hover re-renders the whole App tree incl. MobileSheet.
- Dead weight: `papaparse` + `@types/papaparse` (no import anywhere), `src/data/geocodeCorner.ts` (Nominatim, unused).
- Google Fonts stylesheet is render-blocking (`index.html:10`); no font self-hosting.
- No PWA: no service worker, manifest, or offline tile/KML caching.

### 3.4 Security
- **P0 (conditional)**: RLS write = any authenticated user, `ALL`, `true/true` (§2.2). Exploitable if signups enabled — UNVERIFIED.
- **Hardcoded fallback admin password** in client code (`useAdminAuth.ts:9-10`) — confirmed present in prod bundle (`grep -c` = 1 hit in `index-*.js`). Also appears in `.env.example:2` and `docs/SALIDAS-SETUP.md:24` suggests using the same string as the *real* Supabase password. Treat it as compromised; rotate.
- **Single shared admin account** — no per-editor identity, audit trail, or revocation.
- **Stored XSS**: `popupHtml` interpolates admin-entered `corner`, `groups`, `leader`, `time` into `Popup.setHTML` unescaped (`MapView.tsx:25-34, 170`). Any authenticated writer (or anyone, if signups are on) can inject script that runs for every map viewer.
- **PII**: ~40 real full names + inferred gender + availability hardcoded in the public JS bundle (`carrito/store.ts:34-85`); the full Carrito people model is anon-readable via REST; orphan `carrito` id=2 also anon-readable.
- No security headers/CSP in `vercel.json` (only SPA rewrite).
- No input size limits on jsonb writes (any writer can push MBs; realtime fans it out).
- No lint: `// eslint-disable-next-line` comments exist (`MapView.tsx:186` etc.) but ESLint is not installed/configured.

### 3.5 Repo / delivery hygiene
- `tsconfig.*.tsbuildinfo` and `ModeloNuevo.jpeg` committed at root.
- No CI; tests never run on deploy (Vercel runs `npm run build` only).
- Deploy = `npx vercel --prod` from a local CLI link (no git remote integration).
- Build depends on network to Google (`sync-kml.mjs`), non-reproducible.

---

## 4. Tests

`npx vitest run` (vitest 2.1.9, `environment: node`, includes only `src/**/*.test.ts`):

```
Test Files  11 passed | 1 skipped (12)
     Tests  59 passed | 13 skipped (72)
  Duration  704ms
```

| File | Tests |
|---|---|
| carrito/scheduler | 7 |
| salidasStore | 15 |
| carrito/gender | 4 |
| carrito/store | 6 |
| heading | 3 |
| locateMode | 5 |
| territoriesGeoJson | 3 |
| salidasAdapter | 3 |
| programa/week | 10 |
| salidasColors | 2 |
| smoke | 1 |
| **programa/parsePrograma** | **13 skipped** |

- The 13 skipped are **every PDF-parser test**: they need real PDFs in `fixtures/`, which is gitignored (`.gitignore:17`) → **zero effective parser coverage on a clean clone/CI**. Fix for 2.0: commit sanitized `PdfItem[][]` JSON snapshots (positions + fake names) and test parsers against those.
- Untested: all hooks/sync logic (`useSalidas`, `useCarrito`, `usePrograma`, `useAdminAuth`), `kml.ts`, `merge.ts`, `exportImage`, every component. No DOM env, no e2e. Scheduler tests can't assert exact output (unseeded `Math.random`).
- `tsc --noEmit`: clean.

---

## 5. Must preserve in 2.0 (business rules)

### 5.1 Carrito scheduler (`src/lib/carrito/scheduler.ts`)
- Weeks = every Monday-anchored week overlapping [start,end]; slot dates outside range skipped; week label/ISO = `max(monday, start)` (`:28-37, :151-154`).
- Slots ordered by ISO dow then `startTime` (`:133-136`).
- Blackout = (slotId, exact date) skip (`:162`).
- Eligibility = `availableSlotIds` includes slot (`:164`).
- must-be-with: transitively remove anyone whose partner isn't eligible (warn), then group partners into units (`:74-119`). *(Fix directionality, §3.2.)*
- Shuffle units, then stable-sort by: (1) any member under target first, (2) lowest per-slot count, (3) lowest total count (`:181-198`). `targetAppearances <= 0` ⇒ unlimited (999) (`:145-146`).
- Fill up to `groupSize`; units too big for the slot → warning.
- **Gender rule** (`isGroupGenderValid :58-72`): all-same-gender OK; equal M/F OK; otherwise every member of the minority gender must be must-be-with-linked to someone of the majority (e.g. married couple). Checked **only when the group reaches full size**; if filling fails, fall back to gender-skipped people and **warn** "completado rompiendo regla de género" (`:226-239`). Underfilled slot → warning.
- On regenerate, keep notes keyed by `weekDate|slotId` (`useCarrito.ts:189-197`).
- Gender inference: explicit M/F first-name sets, else ends-with `a` → F, `o` → M, else unknown; accent-insensitive (`gender.ts`).
- Manual edits: picker sorts available people first; dedupe person within a cell (`ScheduleTab.tsx:128-147`).
- Cascading deletes (`useCarrito.ts:107-180`).

### 5.2 Salidas / Mapa
- Two dow systems: Carrito ISO 1=Lun…7=Dom (`carrito/days.ts`) vs Salidas/Mapa JS 0=Dom…6=Sáb (`days.ts`). Keep or unify deliberately.
- Day ordering Mon→Sun (`dayOrder`), one entry per dow, Domingo uses distinct slot shape (`territorioNumero`).
- `weekStart` = Wednesday reference; day numbers and cross-month labels derived (`salidasStore.ts:76-102`).
- `parseTerritoryIds` (`salidasAdapter.ts:6-13`): splits on `- , /`, " y ", " & ", whitespace → **"5-12" means {5,12}, not a range**.
- Empty slots hidden from map (`salidasAdapter.ts:19-42`); group label "Grupo N" when it starts with a digit.
- Default template Mié×3, Jue×3, Vie×3, Sáb×2, Dom×1 (`salidasStore.ts:105-124`) and legacy migration (`:133-172`) — needed to read existing rows.
- Territory id = first integer in KML Placemark name; palette hash `colors.ts:22-25` (users recognize colors).
- Locate-mode cycle off→follow→compass, gesture cancels follow.
- PNG export with `data-export-hide` (shared to WhatsApp — core workflow).

### 5.3 Programa parsers (`src/lib/programa/*`)
- Storage keyed by ISO date; merge by date, newest upload wins per date (`merge.ts`).
- Midweek keyed by Tuesday, weekend by Saturday of the Mon–Sun week (`ProgramaView.tsx:41-42`, `week.ts`).
- Year rollover: ±6-month distance from the file's first month (`text.ts:66-70`).
- Type detection regex: "ENTRE SEMANA" → midweek, else "fin de semana|ATALAYA" → weekend (`UploadPanel.tsx:37-48`).
- Midweek layout constants: date `dd.mm.` at x<60; `MAR_OFFSET=15.8`; times at 60≤x<80; sections at 100≤x<140; titles 100≤x<370; people x≥370; roles Presidente/Lector/Conductor paired L→R under name rows (≤14 pt) (`parseMidweek.ts`).
- Weekend: 2×2 grid split at `COLUMN_SPLIT_X=297`; headers "N DE MES" with split two-digit days ("1"+"7 DE…"); Conductor/Lector values 10–19 pt below labels; speaker line `Name – Congre X`; "Discursante saliente" block (`parseWeekend.ts`).
- Line joining with gap ≥1pt heuristic (`text.ts:11-24`); asamblea-only week banner logic (`ProgramaView.tsx:45-53`).

### 5.4 Web-only APIs the native apps must replace
`html-to-image` (PNG export/clipboard), `DeviceOrientationEvent`/`webkitCompassHeading`, `navigator.geolocation`, `pdfjs-dist` + web worker, `maplibre-gl` (→ MapLibre Native / RN binding), `localStorage`/`sessionStorage`, `DOMParser` (KML), `navigator.clipboard`/`ClipboardItem`, `window.confirm`.

---

## 6. Prioritized pain points

| # | Pri | Pain point | Evidence |
|---|---|---|---|
| 1 | P0* | Any authenticated user has full write on all tables; signup state unverified | §2.2, live `pg_policies` |
| 2 | P0 | Admin password literal shipped in bundle + docs; single shared account | `useAdminAuth.ts:9-10`, bundle grep, `SALIDAS-SETUP.md:24` |
| 3 | P0 | Stored XSS in map popup | `MapView.tsx:25-34,170` |
| 4 | P1 | Edits lost: own-echo clobber, offline-reload overwrite, no retry, multi-admin LWW, Programa stale merge | §3.1 #1–4 |
| 5 | P1 | Real names/availability public (bundle seed + anon REST); orphan `carrito` id=2 | `carrito/store.ts:34-85`, §2.1 |
| 6 | P1 | must-be-with directional → couples split by scheduler | `PersonModal.tsx:60-62`, `scheduler.ts:96-116` |
| 7 | P1 | 1.4 MB / 389 KB-gz eager JS; maplibre for every view; all hooks/pollers always on; map remount per tab | §3.3 |
| 8 | P1 | Parser tests 100% skipped on clean clone; no CI; hooks untested | §4 |
| 9 | P2 | Fragile deploy: build fetches Google KML, `exit(1)` on failure; committed tsbuildinfo | `sync-kml.mjs`, §3.5 |
| 10 | P2 | No PWA/offline shell; reload offline = blank | §1.7 |
| 11 | P2 | Destructive one-tap "remove day" (no confirm/undo) | `SalidaDayBlock.tsx:21-24` |
| 12 | P2 | Programa: no preview of parsed content, no edit/delete, no realtime, file input not reset | §1.5, §3.2 |
| 13 | P2 | Compass mode re-render + easeTo at sensor rate; GPS never stopped | `MapView.tsx:81-86,325-335` |
| 14 | P3 | Impure scheduler-in-updater; uncontrolled inputs go stale; duplicated DOM in ScheduleTab | §3.1 #5–6 |
| 15 | P3 | Map shows only first assignment per territory; vertex-average centroid; duplicate-id risk | §3.2 |
| 16 | P3 | Dead deps/code (papaparse, geocodeCorner), no ESLint, render-blocking fonts, no CSP | §3.3–3.4 |

\*P0 conditional on signups being enabled; even if disabled, the policy has no role/claim check and no payload validation, so it stays P1.

### Direction implied for 2.0 (not a design, just what the audit forces)
- Real roles (per-editor accounts + `app_metadata.role` or an `editors` table) in RLS; disable signups; drop the client fallback gate.
- Replace whole-document LWW with row-level tables or versioned writes (`updated_at`/`version` compare-and-swap) + server-side validation.
- Move scheduler to a pure, seeded, tested module (maybe server-side) with symmetric must-be-with.
- Code-split per view, lazy map, single shared auth/sync provider, pause pollers when hidden or rely on realtime only.
- Commit parser fixtures as sanitized JSON; add CI running `tsc` + tests before deploy; make KML sync a manual/scheduled step, not part of build.
