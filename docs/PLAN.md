# TerritoriosMap 2.0 — Master Plan

Date: 2026-10-16 · Status: **APPROVED 2026-10-16. Building Phase 0** · Coordinator: Claude (Orca run `run_4e04576b781d`)

Inputs (all in `docs/research/`):
- `01-app-audit.md`: v1 features, data model, bugs, security, must-preserve rules
- `02-mobile-stack.md`: Capacitor vs Expo vs Tauri vs PWA, security checklist
- `03-design-skills.md`: installed design/platform skills and how to drive them
- `04-ux-direction.md`: IA, per-screen redesign, tokens, anti-slop rules, perf UI rules

---

## 0. Goals and non-goals

**Goals**
- Rebuild the UI from scratch: members first, today first, readable in sunlight, no AI slop.
- Fast: first paint under 1 s on a mid-range Android over 4G, and an eager JS bundle under 150 KB gz. v1 is 389 KB gz.
- Not buggy: no lost edits, real roles, every business rule covered by tests in CI.
- Ship Android and iOS apps from the same codebase. They must be lightweight (~5–8 MB APK) and secure (Keychain/Keystore session, strict CSP, RLS roles).

**Non-goals**
- v1 is not modified in any way: not its code, its Vercel project or its Supabase tables (see §2).
- No marketing site and no public sign-up.

---

## 1. Key decisions (made, with reasons)

| # | Decision | Why | Revisit if |
|---|---|---|---|
| D1 | **Capacitor 8** wraps the same Vite + React web app. **PWA ships first.** | About 100% code reuse. MapLibre, pdf.js and the PNG share card run unchanged in the WebView. The map is small (49 polygons). Expo would mean building and maintaining a second UI. | Spike on a low-end Android shows <30 fps map pan, or >3 s cold start. Or the app needs offline vector packs or background location. Or Apple rejects it under 4.2 twice. **Any of these → Expo.** `packages/core`, `data` and `platform` are already RN-reusable. |
| D2 | **pnpm monorepo**: `apps/web`, `apps/mobile`, `packages/{core,data,platform,ui-tokens}`, `supabase/` | Pure logic is isolated and testable. The UI never imports `@capacitor/*`; it goes through `platform`. | – |
| D3 | **Stack**: React 19, Vite 7, Tailwind 4 (CSS variables from tokens), React Router (data router, lazy routes), TanStack Query for server state, Zod at every IO boundary, MapLibre GL 6, Lucide icons, Vitest + Playwright | Small, boring, fast. Query gives caching, retry and refetch-on-focus for free, which removes most of v1's hand-rolled sync bugs. | – |
| D4 | **Data model**: replace v1's single-JSON-row last-write-wins with **row-level tables plus a `version` column** (compare-and-swap) and Zod validation. Writes go through RPCs or RLS gated on an `editor`/`admin` role claim. | Fixes audit §3.1 (own-echo clobber, offline overwrite, multi-admin LWW). | – |
| D5 | **Font**: Atkinson Hyperlegible Next, self-hosted, plus Mono for times and numbers. Inter is not used. | It reads well outdoors for older members. 02's mention of Inter is overridden. | Licence or size check fails → system UI font, same scale. |
| D6 | **IA**: 4 bottom tabs (Salidas default, Mapa, Carrito, Programa) plus an avatar sheet ("Soy…", theme incl. **Sol** high-contrast, text size, login). **Gestión** is a stack pushed over the tabs. Desktop gets a left rail and a Salidas+Mapa split. Path routes double as native deep links. | 04 §2 | – |
| D7 | **No cert pinning, no root/jailbreak detection.** RLS is the security boundary. | 02 §8: pinning breaks against CDN cert rotation, and the client holds no secrets. | Secrets ever land on the device. |
| D8 | **Distribution**: Apple Unlisted App Distribution + Google Play closed→production. OTA via Capgo (signed bundles). iOS builds on a GitHub Actions macOS runner or Codemagic, since the dev machine is Windows. | 02 §2, §4 | – |

Under Capacitor, only these web APIs need native replacements: PNG export download (→ `@capacitor/share` + Filesystem), session storage (→ secure storage), geolocation (→ `@capacitor/geolocation`) and possibly compass heading (a small native plugin if `deviceorientation` fails in WKWebView). Audit §5.4's longer list applies only to an Expo pivot.

---

## 2. Isolation from v1 (hard rule)

- **Code**: new sibling repo `C:\Users\Santiago\Documents\ClaudeTests\TerritoriosMap2`. This is the same pattern as TerritoriosMapEditor. No 2.0 code goes in this worktree; these planning docs get copied over.
- **Hosting**: new Vercel project (`territorios-v2`). The v1 project and domain are untouched until cutover.
- **Database**: v1 and 2.0 must not share writable tables. Pick one option (**decision Q1**):
  - **(A) Recommended**: a separate Supabase project for 2.0. It gives full isolation, a clean auth user set and clean RLS. A one-way import script reads the v1 rows (read-only, via the publishable key) and writes them into the v2 tables.
  - (B) The same project with a `v2` Postgres schema. This is cheaper, but it shares auth users and the risk of mistakes is higher.
- **Cutover** (Phase 4): freeze v1 edits (announce it), run the final import, point the domain at the v2 project, and keep v1 deployed read-only for 2 weeks, then retire it.

---

## 3. Architecture

```
TerritoriosMap2/
├─ apps/
│  ├─ web/            Vite app: routes, screens, components (only UI)
│  │                  builds dist/ (PWA, Vercel) and dist-mobile/ (--mode capacitor, base './', no SW)
│  └─ mobile/         Capacitor 8 shell: capacitor.config.ts, android/, ios/ (SPM), src/native/* adapters
├─ packages/
│  ├─ core/           pure TS, no DOM: scheduler (seeded RNG), gender, salidas adapters, programa parsers, kml→geojson, week math, Zod schemas
│  ├─ data/           supabase client factory, repositories, TanStack Query hooks, realtime→query invalidation
│  ├─ platform/       interface Platform { storage, secureStorage, geolocation, heading, share, haptics, appState, push }
│  │                  + web impl; native impl injected from apps/mobile at boot
│  └─ ui-tokens/      tokens.json → CSS vars (web) + TS theme (future RN)
├─ supabase/          migrations/, seed (sanitized, NO real names), functions/ (push sender, import-v1)
└─ .github/workflows  ci.yml (typecheck, lint, test, build, bundle-size budget, secret grep), ios.yml, android.yml
```

**Sync model.** The UI reads from TanStack Query and paints instantly from a persisted cache (IndexedDB on web, Preferences/SQLite on native). A Realtime event only *invalidates* the affected query; it never overwrites edits in progress. Mutations are optimistic, use a CAS on `version`, and on conflict show a "Changed by someone else, review" sheet instead of silently clobbering. When the app goes to the background, realtime and token refresh pause, and everything refetches on resume.

**Data tables (v2)**, all with `updated_at`, `version`, `updated_by`:
`territories` (from KML import), `service_weeks`, `service_meetings` (day, time, place, conductor, groups, territory_ids[]; Domingo G1–G4 per **Q2**), `cart_places`, `cart_slots`, `people` (**editor-only read**, see Q3), `person_availability`, `person_pairs` (**symmetric**), `cart_schedules`, `cart_assignments`, `cart_blackouts`, `program_weeks` (date-keyed jsonb validated by Zod), `profiles` (role: viewer/editor/admin), `device_tokens`.

---

## 4. Phases and task DAG

Each task follows the Orca task-spec contract: target, change, constraints, ownership, acceptance. **Provider** column: `oc` = opencode free model (DeepSeek/GLM/Nemotron), `cl` = Claude. Claude does coordination, security and design review. Mechanical and parallel work goes to opencode.

### Phase 0: Foundation (sequential, ~2 days)
| ID | Task | Provider | Acceptance |
|---|---|---|---|
| F1 | Create repo, pnpm workspace, TS strict, ESLint + Prettier, Vitest, CI skeleton, bundle-size budget, secret-grep step (incl. the v1 password literal and `service_role`/`sb_secret_`) | cl | `pnpm -r typecheck test build` green in CI |
| F2 | Port `src/lib/**` → `packages/core` plus its 59 tests. **Do NOT port**: carrito seed people (`carrito/store.ts:34-85`, ~40 real names → replace with fake seed), `useAdminAuth` legacy fallback, `.env.example`, `SALIDAS-SETUP.md`, `papaparse`, `geocodeCorner`. Adjust `store.test.ts` if it asserts on real names | oc | 59 tests pass; secret/PII grep finds no v1 names or password literal |
| F3 | **Sanitized parser fixtures**: dump `PdfItem[][]` JSON from the real PDFs locally with fake names, then commit them | cl (handles real PDFs locally) | Fixtures contain only fake names; all 13 parser tests run (not skipped) and pass on a clean clone in CI |
| F4 | `ui-tokens` from 04 §4 (type, color roles light/dark/Sol, spacing, radii, motion) + Atkinson self-hosted | oc → cl review via `/impeccable` | Tokens build to CSS vars; contrast ≥ 7:1 in Sol theme |
| F5 | Supabase v2 project/schema, migrations, RLS by role, `disable_signup`, Zod schemas | cl (security-critical) | RLS tests: anon can't read `people` or write anything; viewer can't write; editor can |

### Phase 1: Core fixes in `packages/core` (parallel, after F2)
| ID | Task | Provider | Acceptance (named test gates) |
|---|---|---|---|
| C1 | Scheduler: seeded RNG, pure function, **symmetric must-be-with**, same-day double-booking guard, human-readable deduped warnings | oc | Gates `scheduler.gender-rule`, `scheduler.pairs-never-split`, `scheduler.no-double-booking`, `scheduler.deterministic-with-seed` |
| C2 | KML → territories: area centroid, MultiPolygon, duplicate-id detection; move KML sync out of the build into a manual/scheduled import | oc | `kml.duplicate-id-errors`, build works offline |
| C3 | v1 → v2 import script (read-only on v1) | oc → cl review | Dry run against a v1 snapshot reproduces every week, person and program |

### Phase 2: Web app (fan out per screen, after F1, F4, F5 and Shell)
| ID | Task | Provider | Acceptance |
|---|---|---|---|
| W0 | **Shell**: router + lazy routes, tab bar / rail, avatar sheet, theme incl. Sol, auth provider (one instance), offline banner, query persistence, error boundaries | cl | Per-route budgets in CI: Salidas/Carrito/Programa initial eager JS ≤ 150 KB gz, Mapa chunk tracked separately; maplibre absent from the initial chunk; warm tab switch < 100 ms on mid-range Android; realtime/token refresh paused on `visibilitychange`/background, refetch on resume, no polling while realtime is connected; unsynced local edits are never overwritten by a mount-time fetch; failed writes retry with backoff |
| W1 | Salidas (member): day strip, cards, "Ver en el mapa", share card | oc → cl `/impeccable critique` | Playwright: today's day is selected by default; share PNG matches the print layout |
| W2 | Mapa: persistent map instance (no remount), all territories visible, multi-assignment sheet, locate modes with GPS stop and throttled heading (rAF), **DOM popups (no `setHTML`)** | cl (perf + XSS) | All territories always outlined and numbered, today's filled; tapping a territory in 2+ salidas lists all of them; locate `off` stops `watchPosition` and the compass listeners; camera updates from heading ≤ 1 per frame (rAF), orientation-compensated; target 60 fps pan (if < 30 fps → D1 trigger); XSS test payload renders as text |
| W3 | Carrito (member): "Mis turnos" + virtualized month grid | oc | Grid of 12 weeks × 10 slots scrolls at 60 fps |
| W4 | Programa (member): week nav, "Mis partes", assembly banner | oc | Parser fixtures render the expected week |
| A1 | Gestión Salidas: edit week, confirm + **undo** on delete, CAS conflict sheet | oc → cl review | Two-browser conflict test shows the conflict sheet; no silent overwrite |
| A2 | Gestión Carrito: Personas / Lugares / Turnos / Generar (scheduler in a worker), controlled inputs | oc | Regenerating keeps notes; pairs are symmetric in the UI; editable fields are controlled (no `defaultValue` for remote data); no duplicated desktop/mobile input DOM |
| A3 | Gestión Programa: upload, **full parsed preview**, edit/delete week | oc | Re-selecting the same file works; preview lists every parsed part |
| P1 | PWA: manifest, icons, Workbox app shell, offline last-data | oc | DevTools ▸ Application ▸ Manifest shows no installability errors (`beforeinstallprompt` fires); airplane-mode reload shows the last schedule |
| P2 | Quality pass: `/impeccable audit`, `/web-design-guidelines`, `/accessibility`, the anti-slop checklist (04 §5) | cl | Zero P0/P1 findings; WCAG 2.2 AA |

### Phase 3: Mobile (after W0; parallel with the late Phase 2 tasks)
| ID | Task | Provider | Acceptance |
|---|---|---|---|
| M0 | **Capacitor spike (2–3 days)**: map fps, cold start, compass in WKWebView, pdf.js worker, geolocation prompt on a low-end Android + an iPhone | cl | `docs/06-capacitor-spike.md` with measured numbers on a ≤3 GB RAM Android and an iPhone (pan fps min/avg, cold start ms, compass, pdf.js worker, geo prompt), pass/fail per D1 trigger, and a go/pivot verdict |
| M1 | Shell: `capacitor.config.ts` hardened (no `server.url`, empty `allowNavigation`, debugging off, `allowBackup=false`), splash, status bar edge-to-edge, back button | oc → cl `/capacitor-security` | `/capacitor-best-practices` audit clean |
| M2 | Native adapters: secure session storage (Keychain `AfterFirstUnlockThisDeviceOnly`), geolocation, heading plugin if needed, share/filesystem, haptics, network, lifecycle refetch | oc | Session survives a restart; sign-out wipes secure storage |
| M3 | CI builds: Android AAB (local + GH Actions), iOS on a macOS runner → TestFlight | cl | A signed build reaches TestFlight and the Play internal track |
| M4 | Push: `device_tokens` + Edge Function (FCM v1) for "Salidas de mañana", "Te asignaron al carrito", "Programa nuevo" | oc → cl review | A test push arrives on both OSes; no PII in the payload |
| M5 | Capgo OTA, signed channels, auto-rollback | oc | A bad bundle auto-reverts |
| M6 | Store prep: Spanish permission strings, privacy policy, Data Safety / nutrition labels, reviewer notes, Unlisted request | cl | Submitted |

### Phase 4: Cutover
Freeze v1 → final import (C3) → switch domain → monitor for 2 weeks → retire v1 (owner approves each step).

**Critical path:** F1 → F5 → W0 → W2 → M0 → M3 → M6. Everything else fans out around it.

---

## 5. Must-preserve business rules (each is a named test gate in CI)
**Authoritative list: `docs/research/01-app-audit.md` §5.1–5.3. Port every bullet there as a named test.** That includes: the scheduler week anchoring, range, blackout, eligibility, sort keys, `targetAppearances ≤ 0` = unlimited, transitive must-be-with cleanup, and gender check only at full size with fallback warning; both day-of-week systems (ISO for Carrito vs JS for Salidas/Mapa, never unified silently); the salidas adapter hiding empty slots, the "Grupo N" label, the default template and the legacy migration; and the Programa layout constants and ISO-date merge. Highlights: the scheduler ordering and gender rule (minority gender must be paired, fill fallback with warning); notes preserved on regenerate; gender inference by first name; `parseTerritoryIds` ("5-12" = {5,12}, not a range); territory id = first integer in the Placemark name; palette hash (members know the colours); salidas day order and Wednesday `weekStart`; the Programa keying (Tuesday for midweek, Saturday for weekend), year rollover and both PDF layout parsers; locate cycle off→follow→compass; PNG share card with `data-export-hide`.

---

## 6. Performance budgets (CI-enforced where possible)
- Eager JS ≤ 150 KB gz, CSS ≤ 25 KB gz. MapLibre and pdf.js load lazily.
- LCP < 1.5 s and INP < 100 ms on Moto G-class hardware with throttled 4G.
- No polling while realtime is connected. Nothing runs in hidden tabs.
- Skeletons, not spinners. Optimistic mutations. Lists virtualized above 50 rows.
- APK ≤ 8 MB, IPA ≤ 15 MB, native cold start to first frame < 2 s.

---

## 7. Design process (anti-slop)
- Write `PRODUCT.md` and `DESIGN.md` first with `/impeccable shape` (Operate mode), seeded from 04.
- Use `ui-ux-pro-max` only as a lookup for tokens and pairings. Use `emil-design-eng` for motion and feel. `design-taste-frontend` is **not** used for app screens (its own scope says so).
- Every screen PR runs through `/impeccable critique`, then `/web-design-guidelines`, then `/accessibility`, then the 04 §5 checklist: no gradients, no emoji or glyph icons, no glassmorphism, no tracked uppercase eyebrows, no cream+gold, no uniform card kit, no decorative motion, voseo copy.
- Do the visual QA with real screenshots at 390 px and 1440 px in light, dark and Sol themes.

---

## 8. Agent / provider setup (Orca)

What works now:
- **Orca orchestration**: run created; 4 Claude workers ran in parallel for this research wave.
- **opencode**: verified end to end. The plan cross-review (`docs/research/05-plan-review.md`) ran as an Orca worker on the free "Big Pickle" model. Orca **cannot pin `--model`** for this opencode build (error `capability_unsupported`), so workers use opencode's configured default model. To use a different free model (`deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `nemotron-3-ultra-free`, `mimo-v2.6-flash-free`), set it as the default in opencode's config. opencode gets the mechanical and parallel tasks.

What does not work, and how to fix it:
| Agent | Problem | Fix |
|---|---|---|
| codex | CLI not installed, Orca reports "not signed in" | `npm i -g @openai/codex` then `codex login` |
| cursor | `cursor-agent` CLI not installed | Install the Cursor CLI per cursor.com/docs/cli (verify the Windows install path), then `cursor-agent login` |
| gemini | Installed, but not an Orca agent id | It can only run inside a worker shell. Or enable it if Orca adds support (check `orca agent-context`). |
| claude | Orca shows credential `stale-token` | Run `claude /login` (or re-auth in the Orca settings) so future Claude workers start reliably |

---

## 9. Open decisions for the owner (blocking Phase 0)
1. **Q1, DB isolation**: (A) a new Supabase project (recommended) or (B) a `v2` schema in the same project?
2. **Q2, Domingo model**: adopt the per-group G1–G4 territory layout from `ModeloNuevo.jpeg`?
3. **Q3, people data**: should viewers stay anonymous? If yes, names and availability become editor-only, and members get "Soy…" as a local-only name pick.
4. **Q4, editor accounts**: one account per editor (recommended, gives an audit trail) or keep one shared admin?
5. **Q5, store accounts**: personal or organization? A personal Google Play account needs 12 testers for 14 days. An Apple organization account needs a D-U-N-S number.
6. **Q6, repo visibility**: private (macOS CI minutes are metered → consider Codemagic) or public?
7. **Q7, v1 hotfix**. Two items are dashboard-only and need no code change, so do them now: (a) rotate the Supabase admin password; (b) check Auth ▸ "Allow new users to sign up" and turn it off. The code hotfix (escape popup XSS, remove the bundled fallback, tighten RLS) **would** modify v1 and needs your explicit OK. Note: if v1 RLS stops anon reads, C3's import must use an authenticated read instead.

### Decisions recorded 2026-10-16
- Q1: **new Supabase project** (owner).
- Q2–Q4: defaults chosen by the coordinator, owner may revise: G1–G4 Domingo model; anonymous viewers with `people` editor-only; per-editor accounts.
- Q5/Q6: deferred until Phase 3. The repo stays local/private for now.
- Q7: no v1 hotfix now; the owner will ask later.
