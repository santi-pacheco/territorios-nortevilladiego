disposition: fix

Substitution: this harness ships no finish-reviewer agent, so the degraded `reference/degraded/finish-reviewer.md` role ran inline, in a fresh context, by a worker that did not build the UI.

Missing inputs: no QUALITY BAR card was provided for the "Línea del día" world, so the ceiling is judged against FORM's four "raises". The STORY change-mark state ("Cambió desde tu última visita") was not captured because it needs a version bump between two visits; it is unverified, not a blocker. Unread: no other skill reference files, and only sampled source (`StationLine.tsx`, `SalidasScreen.tsx`, `styles.css` station rules, `gestion/route.tsx`, `gestion/carrito/ui.tsx`).

## Evidence (check 0)

Date of capture: 2026-10-16 (Friday), local Supabase with fixture data (all names synthetic), dev server `pnpm --filter @territorios/web dev --port 5311`.

The brief's `desktop.png` / `mobile.png` slots map to `<route>/desktop-<theme>.png` (1440×900) and `<route>/mobile-<theme>.png` (390×844 @2x), written by `scripts/shots.mjs` under `apps/web/.impeccable/review/final/`:

| Route | Files | Valid |
|---|---|---|
| `/salidas/jue` | `salidas-jue/{mobile,desktop}-{light,dark,sol}.png` | yes |
| `/salidas/vie` | `salidas-vie/{mobile,desktop}-{light,dark,sol}.png` (real clock: today's 10:00 already past) | yes |
| `/salidas/jue` at Thu 08:20, `/salidas/vie` at Fri 09:20 (Playwright fixed clock, to show "Próxima") | `salidas-jue-0820/*-light.png`, `salidas-vie-0920/*-light.png` | yes |
| `/mapa?t=2,3&dia=jue` | `mapa/{mobile,desktop}-{light,dark,sol}.png` (scratch copy of shots.mjs with `--use-angle=swiftshader --enable-unsafe-swiftshader`, 4 s settle) | yes, tiles and polygons rendered |
| `/carrito` | `carrito/{mobile,desktop}-{light,dark,sol}.png` | yes |
| `/programa?semana=2026-10-12` | `programa/{mobile,desktop}-{light,dark,sol}.png` | yes |
| `/gestion/salidas?semana=2026-10-12`, `/gestion/programa`, `/gestion/carrito` (Personas, Generar, Turnos), signed in as a local editor | `gestion/*-{mobile,desktop}-{light,dark}-vp.png` (viewport captures, Chromium `--lang=es-AR`) | yes |

The full-page Gestión captures (`gestion/*-{light,dark}.png` without `-vp`) paint the fixed bottom bar mid-page and cut the desktop rail at 900 px. That is a fullPage artefact of fixed elements, so they are not cited as evidence; the `-vp` set is. No horizontal page overflow on any capture (shots.mjs exit 0 for every route). Gestión has no Sol captures; the brief did not ask for them.

Seed: `impeccable concept-seed --check-seed seed:03cb1d9aaa48756d`, run from `apps/web`, printed `SEED KNOWN: seed:03cb1d9aaa48756d was rolled on this machine.` (exit 0). From the repo root it prints SEED UNKNOWN, because the record lives in `apps/web/.impeccable/questions/seeds/`. The dealt hand in that record (boarding pass, acetate tab board, timetable rack, terminal wayfinding, emission rail) matches FORM's raises.

Mechanical detector, run from `apps/web` as `C:/Users/Santiago/.claude/skills/impeccable/scripts/impeccable detect --json src`, exit 0. Raw output:

```
[]
```

Measured, not eyeballed:
- Ground: pixel sample of the light canvas = `rgb(238,241,244)` = `#EEF1F4`, which is OWN-WORLD's `#eef1f4` exactly.
- Day accent used as text ("Próxima · en N min", `.text-day-ink` = 80% accent mixed into ink): the raw accents alone already pass. Light on white is 4.69 (Vie, the worst) to 6.41; dark on `#171D26` is 4.83 to 6.55; Sol on white is 7.21 to 7.78. The mix only darkens them, so this passes AA, and Sol keeps ≥ 7:1.
- Gestión mobile section nav: `.gestion-nav` scrollWidth 369 > clientWidth 358 on every Gestión screen at 390 px. The active "Programa" pill is clipped at the right edge.

## persistence

Pass. `apps/web/PRODUCT.md` exists. The build is code-led, so no `state.json`, comp round or approval record is owed. `.impeccable/mocks/decision/` holds the direction round's hand (exempt). DESIGN.md is absent, which is correct for a new world: it is written after a ship verdict.

## fidelity

Code-led build. `mocks/decision/assigned.html` is a critique reference, so this section has no element matrix against it, only what it dared that the build did not.

| Row | Verdict | Evidence |
|---|---|---|
| TYPE | match | Self-hosted Atkinson Hyperlegible Next for text and Atkinson Hyperlegible Mono for times, numbers and roundels (`packages/ui-tokens/fonts`). Ranks by weight; display/title/body steps are few and obvious. No system display face. |
| MATERIAL | match | OWN-WORLD is a flat world: white station cards, hairlines, ink roundels, flat day stripe. The build adds no faked physicality, gradients, glass or bevels. |
| GROUND (light) | match | Sampled `#EEF1F4` equals OWN-WORLD. |
| GROUND (dark, Sol) | no authority | OWN-WORLD names only the light canvas, so there is no target for the dark (`#0F141B`) or Sol (`#FFFFFF`) ground and no verdict is given. |
| THESIS: day as a line, salidas as stations in time order | match | 8 px day-colour stripe, 24 px station dots, cards in time order (`salidas-jue/mobile-light.png`). |
| Mono time 28 px, place 17/600, conductor + groups 15 secondary, roundels | match | Same capture. |
| Next station outlined 2 px ink with "Próxima · en N min" | match | `salidas-jue-0820/mobile-light.png`, `salidas-vie-0920/mobile-light.png`: filled dot, 2 px ink outline, tag in day ink. |
| Past stations "hollow and faded" | contradicted | `salidas-vie/mobile-light.png`: a past station gets a dashed 6 px dot border and a dashed card border. At 24 px the dashed ring reads as a segmented loading spinner, not a hollow spent stop. The sketch's tinted hollow dot plus opacity is the dare left untaken. |
| Day tabs: line swatch plus one tick per salida | match | Mié · / Jue ··· / Vie · … |
| Header caption "congregation + week" | missing | The caption reads "Esta semana del 12 de octubre" with no "Cong. Norte Villa Diego". PRODUCT.md says to keep that name, yet it appears nowhere in the rendered UI (grep finds it only in `index.html <title>`). The sketch carried it in the caption. |
| Bottom tab bar on mobile | match | All member captures. |
| Left rail on desktop with a Salidas + Mapa split | missing | `salidas-jue/desktop-light.png`: the rail is present, but Salidas is a single 736 px column on a 1440 px canvas with no map pane. Roughly half the desktop viewport is empty canvas where the contract promised the map. |
| STORY: change marks persist until seen | unverified | `StationLine.tsx` freezes `changedSinceSeen` per visit and calls `markSeen`; not captured. |
| Mapa: day line carries over (accent polygons, mono roundels, same day strip) | match | `mapa/mobile-light.png`, `mapa/mobile-dark.png`. |
| Carrito / Programa member screens: rows with hairlines, mono times | match (adaptation) | Lists are rows, not card grids, per DESIGN-RULES. Carrito's place swatches add a second colour per screen; DESIGN-RULES allows colour that does a job, and these identify the place. |
| Gestión › Programa header | added without approval | `gestion/programa-{mobile,desktop}-light-vp.png`: a second white header block ("Gestión" caption + "Programa" title, plus a second AccountButton on mobile) is nested inside the Gestión header. Salidas and Carrito sections don't do this. |

## ceiling

Judged against FORM's raises, since no QUALITY BAR card exists:
- **State by line form (emission rail):** used for next (filled dot plus ink outline). Past uses dashes instead of a hollow, faded segment, and the stripe itself never changes form: no spent-segment tint above the next station. The line could carry "where we are" on its own.
- **Few type sizes, rank by weight (timetable):** reached on Salidas. On member Programa, the midweek row's mono `19:00` sits on a different baseline and size from its part title (`programa/mobile-light.png`), so the timetable column loses its rail.
- **Day tabs show extent ticks (acetate manual):** reached.
- **Change marks persist until seen (boarding pass):** built but not captured (see missing inputs).
- **Unused across the shell:** the line vocabulary stops at Salidas and Mapa. Carrito turns and Programa parts never borrow the station form, the day stripe or the "Próxima" treatment, although both are time-ordered and the contract says other screens "must look like they belong next to Salidas". This is a reach, not a defect.

## material_fixes

1. FIRST VIEWPORT, desktop: build the promised Salidas + Mapa split at the `lg` breakpoint (station line left, the day's territories map right, sharing the day selection), instead of a lone centred column.
2. FIRST VIEWPORT and the PRODUCT.md brand commitment: put "Cong. Norte Villa Diego" back in the Salidas header caption, as "Cong. Norte Villa Diego · Semana del 12 de octubre" with the week chevrons kept. Truncate the week part, never the congregation.
3. FIRST VIEWPORT, past stations: render them hollow (white centre, accent ring at reduced strength) and faded (card opacity or tinted text), drop the dashed dot and card borders, and keep the `(ya salió)` sr-only text.
4. Gestión › Programa: remove the nested "Gestión / Programa" header block and its second AccountButton. Use the same plain section heading that Gestión › Carrito uses.
5. Craft floor (kicker ban): delete the "Encargados" caption above "Gestión". It carries no information the heading lacks; the member captions carry real data (week, count, period) and pass. The nested "Gestión" caption goes with fix 4.
6. Gestión mobile section nav (`.gestion-nav`, 369 > 358 px at 390 px): fit the three tabs (smaller gap or icon-above-label like the bottom bar), or scroll them with a visible edge. Today the active "Programa" pill is clipped.
7. Copy: "Grupos 2" and "Grupos 3" should be singular. The `Grupos ${m.groups}` branch in `StationLine.tsx` needs "Grupo N" for a single group and "Grupos 1 y 2" for several.
8. Header captions truncate on 390 px: Carrito shows "12 de octubre al 25 de o…" and Programa shows "12 oct – 18 oct …". Shorten the formats ("12–25 oct", "12–18 oct") so the caption fits at 17 px base and at 200% text.

Lower, not counted above: Gestión Carrito › Personas desktop rows show "Libre", "2" and "—" columns with no header, so the editor has to guess what they mean. Gestión › Programa sets the year in mono inside proportional dates ("Sábado 31 oct 2026").

## keep

The day line itself: 8 px accent stripe, station dots, 28 px mono times, ink roundels, the 2 px ink "Próxima" card, tick-counted day tabs, and the exact `#EEF1F4` ground. Fix around it; do not soften it into list cards.

## Verdict pass 1

Scoring only. A fresh-context worker ran this pass on 2026-10-16. It did not build the fixes. Captures were taken fresh on dev server `:5321` with local Supabase, Chromium `--lang=es-AR --use-angle=swiftshader --enable-unsafe-swiftshader`, and a fixed Playwright clock for the time-of-day states. The editor was the local `encargado-review@example.com`, recreated per `gestion/README.md`. 200% text was simulated with `html { font-size: 200% }`. All captures are in `apps/web/.impeccable/review/verdict-1/`. The fix worker's `fixes/REPORT.md` was not used as evidence. No capture had horizontal page overflow. The working tree also held uncommitted Carrito schedule-switcher edits (`routes/carrito/route.tsx`, `routes/gestion/carrito/index.tsx`) that are not part of this fix batch. They show up in the Carrito captures but are not scored.

### verdict

| # | Fix | Score | Evidence |
|---|---|---|---|
| 1 | Desktop Salidas + Mapa split | resolved | `salidas-jue-0820-desktop-light.png`: the station line sits left, and the right pane shows the day's map with roundels 1–3 drawn on the territory polygons. No empty canvas. |
| 2 | Congregation in Salidas caption, truncate week not congregation | partial | `salidas-jue-0820-mobile-light.png`: the caption reads "Cong. Norte Villa Diego · Esta …". The congregation is back and the chevrons are kept, but at 390 px the week is cut to one word, so the caption no longer says which week the chevrons move through. On desktop it only gets as far as "Esta semana del 1…". At 200% text (`salidas-jue-200-mobile-light.png`) the congregation wraps one word per line over four lines and the week disappears. The fix traded the missing congregation for a missing week. |
| 3 | Past stations hollow + faded, no dashes | resolved | `salidas-vie-1100-mobile-light.png` (Fri 11:00): the 10:00 station has a hollow dot (white centre, tinted accent ring) and a borderless faded card. There are no dashed borders, and the sr-only `(ya salió)` text is in the DOM. |
| 4 | Gestión › Programa nested header removed | resolved | `gestion-programa-{mobile,desktop}-light.png`: a plain "Programa" section heading matches Carrito, and there is one AccountButton. |
| 5 | "Encargados" kicker removed | resolved | The text "Encargados" is absent from every Gestión capture's `innerText`. The heading is "Gestión" alone. |
| 6 | Gestión mobile nav fits | resolved | `.gestion-nav` scrollWidth 358 = clientWidth 358 on every Gestión screen at 390 px. The active "Programa" pill is fully visible (`gestion-programa-mobile-light.png`). |
| 7 | Grupo / Grupos copy | resolved | The rendered text reads "Grupos 1 y 2", "Grupo 3" and "Grupo 2" (`salidas-jue-0820`, `salidas-vie-1100`). |
| 8 | Carrito / Programa captions fit at 390 and at 200% | partial | At 390 px both fit: "Octubre (ejemplo) · 12–25 oct" (`carrito-mobile-light.png`) and "Esta semana · 12–18 oct" (`programa-mobile-light.png`). Carrito at 200% works as intended: the name truncates and the range is kept. Programa at 200% (`programa-200-mobile-light.png`, and the fix worker's own `fixes/text200-programa-semana=2026-10-12.png`) draws the next-week chevron on top of "oct" ("12–18 ›oct"). The range is a `shrink-0` span that overflows its box under the chevron. |
| ceiling | Programa midweek timetable rail | resolved | `programa-mobile-light.png`: mono `19:00` and "Canción y oración" share a baseline and weight, so the time column holds its rail. |

Regressions introduced by the fix batch (at most three):
- Salidas caption at 200% text: the congregation wraps word by word into a four-line block between the chevrons, which pushes "Jueves 15" down. This is counted under fix 2, not as a separate item.

### remaining

- Fix 2: keep the week legible beside the congregation. For example, reuse `shortRange()` so the caption reads "Cong. Norte Villa Diego · 12–18 oct", the same pattern Programa uses. At 200% text, let the congregation truncate or move onto its own line, not wrap word by word.
- Fix 8: Programa caption at 200% text. The `shrink-0` range must not run under the next-week chevron: let the caption box shrink-wrap its content, or let the range wrap below.

disposition: fix

This pass scored only fixes 1–8 and the Programa ceiling item. Ship stays blocked until fixes 2 and 8 are resolved, so DESIGN.md and design.json were not written.
