# 04 — UX / visual direction for TerritoriosMap 2.0

Scope: research and planning only. No code changed. Line numbers point at commit `4c30149`.

## 0. Evidence and method

- I read every file in `src/components/**`, plus `src/App.tsx`, `src/index.css`, `index.html`, `src/lib/salidasColors.ts`, `src/lib/colors.ts`, `src/data/useAdminAuth.ts` and `ModeloNuevo.jpeg`.
- I ran the app with `vite` and captured it through Edge headless over CDP, with real device emulation at 390×844 (DPR 2, mobile + touch) and at 1440×900. I checked that `innerWidth === scrollWidth`, so there is no horizontal overflow at 390.
  - Plain `--window-size=390` in headless gets clamped to 492px and gives misleading crops. Use CDP `Emulation.setDeviceMetricsOverride` for future screenshots.
  - The screenshots sit in the worker scratchpad, not in the repo.
- **Limitation:** there is no `.env` locally, so Supabase is disabled. Every screen rendered in local mode with empty data ("Solo este dispositivo"): no salidas, no carrito schedule, no programa. I critiqued populated states and admin states (editing, tables, modals) from the code, not from pixels.

What the screenshots show:

| Screen | 390 mobile | 1440 desktop |
|---|---|---|
| Mapa | The brand truncates to "CON…" / "Terr…". The sheet opens at 72 vh and covers about 2/3 of the map. Day chips wrap onto 3 rows. "TOCÁ O ARRASTRÁ PARA BAJAR" is shown in tracked caps. The empty state sits in a dashed box and the bottom of the sheet is blank. | Basemap only. **No territory outlines are visible.** The legend reads "0 territorios hoy". The footer claims "sincronizadas con Supabase" while the app runs local. |
| Salidas | A faithful copy of the paper form. The toolbar wraps: "MES — ●" with an unexplained dot, then three buttons. The fields stack 1 per row, so one slot takes about 260 px. | A narrow 630 px form centred on a cream canvas, with lots of dead space. |
| Carrito | The only content is the italic line "Todavía no hay cronograma publicado." Nothing else is on the screen. | Same. |
| Programa | A week navigator with ‹ › glyph buttons, then a dashed empty box with no next step. | Same, centred at max-w-3xl. |

---

## 1. Critique of the current UI

### 1.1 Global shell (`src/App.tsx`, `src/index.css`)

1. **The header spends its space on branding, not on the task.**
   - The two-line logo (`App.tsx:27-28`) truncates to "CON…/Terr…" at 390 px. It still takes about 40% of the bar.
   - The tab toggle uses 11–12 px text on ~24 px-tall targets (`App.tsx:69-71`), well under 48 dp.
   - On mid-range Android the tabs are the main navigation, and they sit at the top, far from the thumb.
2. **The navy→blue gradient header** (`App.tsx:158`) is decorative. Its shadow leaks onto every screen.
3. **The sync status is fragmented.**
   - The header `SyncDot` hides its label behind a non-existent `xs:` breakpoint (`App.tsx:50`), so the label never shows.
   - The dot is hidden with `invisible` on every view except Mapa (`App.tsx:163`).
   - Each view then re-implements its own `SyncBadge` + `SYNC_META`: `SalidasView.tsx:12-28`, `CarritoView.tsx:10-26`, `ProgramaView.tsx:9-25`. On mobile all three show only a bare grey dot (`hidden sm:inline`), so users can't tell what it means.
4. **Login is repeated in every view.**
   - Each view has its own "Iniciar sesión" button and `LoginModal` mount (`SalidasView.tsx:116-132`, `CarritoView.tsx:51-61`, `ProgramaView.tsx:67-77`).
   - Admin editing is a mode layered over the public screens. Members see admin chrome ("Iniciar sesión" in gold outline) on every screen.
5. **Hash routing** (`App.tsx:62-66`) has no deep links to a day, territory or week. It does not work with native deep links, and it cannot split code by route.
6. **The base palette lands on two known "AI default" tells.**
   - The canvas `--color-jw-ivory: #f7f5f0` (`index.css:10`) is the warm-cream look.
   - Gold is used as an accent on navy. Outdoors, cream lowers contrast against white cards.
7. **Contrast is too low for sunlight.**
   - `jw-mute #6b7280` on ivory is about 4.6:1. It is used for most secondary text at 10–11 px.
   - "HOY" uses gold text on a 15% gold tint (`DaySwitcher.tsx:35`), about 2:1. It fails AA.
8. **Type sizes are too small for the audience.**
   - `text-[10px]`/`text-[11px]` appears 89 times in `src`: eyebrows, chips, sync labels, the map footer `App.tsx:223`, and the person role in `ProgramaView.tsx:227`.
   - Inter is loaded render-blocking from Google with 5 weights (`index.html:9-11`).
9. **Motion runs without a reason.**
   - The selected marker bobs forever (`index.css:61,90`).
   - `pulse-ring` loops forever (`index.css:95-106`).
   - Every list item fades in on each render (`ScheduleList.tsx:53`, `index.css:118`).
   - There is no `prefers-reduced-motion` handling anywhere.
10. **Glyphs and emoji stand in for icons.**
    - Emoji in the map popup HTML (`MapView.tsx:33`) and the selection chip (`App.tsx` `DesktopSelectionChip`, "📍 {corner}").
    - Text glyphs used as icons: `×` (`App.tsx:335`, `SalidaDayBlock.tsx:30`), `✕` (`ScheduleTab.tsx:246`), `▲▼` (`ScheduleTab.tsx:304`), `＋` (`SalidasView.tsx:228`), `‹ ›` (`ProgramaView.tsx:87,98`).
    - These render differently on each Android OEM font.

### 1.2 Mapa (`App.tsx`, `MapView.tsx`, `MobileSheet.tsx`, `ScheduleList.tsx`, `DaySwitcher.tsx`)

1. **Territories are invisible unless they are assigned that day.**
   - Unhighlighted fill-opacity is `0` (`MapView.tsx:130`) and the inner line width is `0` (`MapView.tsx:148`).
   - On a day with no salidas, or for anyone who just wants to see "where is 23", the territory map shows no territories (see the 1440 shot). This is the top Mapa bug.
2. **The sheet opens expanded by default.**
   - `useState(true)` (`App.tsx:97`) and `FULL_HEIGHT_VH = 72` (`MobileSheet.tsx:28`) hide the map on first load.
   - `bottomInset` is computed from `window.innerHeight` during render (`App.tsx:150-154`), so it doesn't update on rotation or when the URL bar collapses.
3. **The day switcher is meant to scroll horizontally but wraps.** It sits in an `overflow-x-auto` row (`MobileSheet.tsx:203`), but `DaySwitcher` has `flex-wrap` (`DaySwitcher.tsx:12`). The result is 3 rows of 64 px chips, which pushes the list below the fold. Each chip also repeats the full day name under the short one ("Mié / Miércoles · 0 salidas").
4. **The drag hint is instruction copy, not affordance.** "Tocá o arrastrá para ver N salidas" is in tracked caps, with two chevrons (`MobileSheet.tsx:184-188`). A proper grabber plus snap points makes this text unnecessary.
5. **The sheet's drag code is hand-rolled.** About 90 lines of touch and mouse listeners with a touch-guard timer (`MobileSheet.tsx:70-159`). It has two snap points and no velocity. This is a common source of bugs. 2.0 should use a native bottom sheet on the apps and one sheet primitive on web.
6. **Selection feedback is duplicated.** There is a mobile pill (`App.tsx` `MobileSelectionPill`), a desktop chip with a gold gradient header, a MapLibre HTML popup, and the in-list "● Marcado en el mapa / click para deseleccionar" (`ScheduleList.tsx:87-91`). Four surfaces say the same thing. "click" is also desktop wording on a phone.
7. **The map popup is built as an inline-styled HTML string** (`MapView.tsx:25-34`). It can't follow theme tokens and it bypasses React.
8. **The locate button is 44 px** (`LocateControl.tsx:18`). That is under the 48 dp target. On mobile the MapLibre zoom buttons duplicate pinch zoom and take space in the top-right.
9. **The legend is desktop-only** (`App.tsx` `Legend`, `hidden lg:block`). It hardcodes three swatches that have nothing to do with the real hash palette (`colors.ts:11-20`).
10. **The territory colour palette** (`colors.ts:11-20`) has 8 saturated hues hashed by id. Neighbouring polygons can get the same colour, and the red/green pair fails for colour-blind users. Each polygon needs a number label, not only a colour.

### 1.3 Salidas (`SalidasView.tsx`, `SalidaDayBlock.tsx`, `SalidaSlotCard.tsx`, `SalidaField.tsx`, `DomingoBlock.tsx`)

1. **The editable screen, the reading screen and the PNG export are one DOM tree** (`SalidasView.tsx:143-200`, the `cardRef`). Because of that:
   - Members read a paper form on a phone. It uses uppercase labels ("GRUPOS:", "CONDUCTOR:"), lines at 13 px, and empty slots that still show all four labels.
   - Edit affordances have to be hidden with `.exporting` CSS hacks (`index.css` "Salidas PNG export" block).
   - The mobile layout can't be improved without breaking the export.
2. **The 390 layout drifts from the reference.** `ModeloNuevo.jpeg` puts GRUPOS|CONDUCTOR side by side, and LUGAR (wide)|TERRITORIO (narrow). At 390 they stack (`SalidaSlotCard.tsx:43,53`, `sm:flex-row`), so the shared image changes shape depending on the device that exported it.
3. **Domingo does not match the reference.** The reference Sunday block is HORA / CONDUCTOR | LUGAR / "TERRITORIO NUMERO" / **G1 · G2 · G3 · G4** (a territory per group). `DomingoSlot` (`src/types.ts:51-58`) has only `grupos` and `territorioNumero`, and `DomingoBlock.tsx:42-60` renders the weekday layout. This is a data-model change for 2.0, not only a visual one.
4. **Jueves and Domingo share identical colours** (`salidasColors.ts:17` and `:20`). In the reference they are two different blues.
5. **Editing controls are too small and too close together.**
   - The remove buttons are 20–24 px red circles that overhang the card edge (`SalidaSlotCard.tsx:68`, `SalidaDayBlock.tsx:28`, `DomingoBlock.tsx:69,80`).
   - Deleting a whole day is one tap with no undo.
   - The "+ agregar salida" rows are dashed 12 px text.
6. **The toolbar** (`SalidasView.tsx:68-134`) mixes several kinds of control at the same weight: the month input, the week date input, the sync badge, and the export, copy and login buttons. At 390 it wraps into the "MES — ●" fragment. The two main member actions (share the week, see a salida on the map) are missing or not prominent.
7. **The empty state shows the template anyway.** With no data, the view renders a full page of empty forms ("MIERCOLES DE —. HORA:"). Members can't tell "no salidas" from "not loaded".

### 1.4 Carrito (`CarritoView.tsx`, `carrito/*.tsx`)

1. **The public view gives members nothing to do.** The only content is italic grey text (`ScheduleTab.tsx:357-361`). The member's real question, "¿cuándo me toca?", is never answered directly.
2. **Per-person highlighting is admin-only.** The "highlight this person's turns" feature (`ScheduleTab.tsx:466-492`, `highlight` state) sits inside `{editing && …}`. It is the most useful member feature and members can't reach it.
3. **The admin tabs are desktop tables on a phone.** `PeopleTab.tsx:52-104` has a 5-column table, `SlotsTab.tsx:55-118` has 6 columns with inline-edit rows that hold native `select`/`time` inputs, and `PlacesTab.tsx`. At 390 they scroll sideways and the action buttons are 11 px.
4. **Destructive actions use `window.confirm`.**
   - `PeopleTab.tsx:29`, `PlacesTab.tsx:36` and `SlotsTab.tsx:42`.
   - In a WebView or Capacitor these are system dialogs with no app styling.
5. **The person picker** (`ScheduleTab.tsx:232-269`) is an absolutely positioned 224 px dropdown inside a table cell. On mobile it clips at the screen edges. Its rows are 12 px text with about 28 px targets, and "no disp." is in 10 px grey.
6. **"Generar" has no preview or diff.** It regenerates the schedule and shows warnings afterwards (`ScheduleTab.tsx:105-113, 346-353`). Manual edits can be overwritten with no undo.
7. **The schedule grid** (`ScheduleTab.tsx:384-433`) is an 11–12 px table-fixed layout with uppercase headers. Notes are 10 px italic inputs that save on blur with no feedback.

### 1.5 Programa (`ProgramaView.tsx`, `programa/UploadPanel.tsx`)

1. **The card headers are the navy gradient with a gold eyebrow** (`ProgramaView.tsx:128-131`). The same treatment is reused for every card, so nothing stands out.
2. **There is no "my part" view.** Members open Programa to find their own name. The page lists every part (`ProgramaView.tsx:193-218`) with names right-aligned at 13 px and roles in 10 px caps (`:227`).
3. **The week navigator uses `‹ ›` text glyphs** in 36 px boxes (`:85-98`). "Ir a esta semana" only appears once you have left the current week, which is good. Swipe between weeks is missing.
4. **The empty state** (`:109-114`) gives no next step to members ("vuelve a consultar el …").
5. **The upload panel** (`UploadPanel.tsx`) works, but its feedback is plain coloured text ("Leyendo PDF…" in amber). There is no progress, no per-week preview of the parsed parts, and the year has to be entered by hand.

### 1.6 Security note (relevant to "secure apps")

`useAdminAuth.ts:9-10` ships a hardcoded fallback admin credential in the client bundle. It is used when Supabase isn't configured, and anyone can read it in the JS. `LoginModal.tsx:9` also pre-fills the user as `admin`. 2.0 must remove the fallback entirely and require real Supabase auth. Admin screens should be a separate lazy chunk that isn't fetched for anonymous users.

---

## 2. Information architecture for 2.0

### 2.1 Principles

- **Members first, admins second.** About 95% of sessions are read-only: "what's today, where, with whom, is it my turn". Editing moves to a separate **Gestión** area, so the public screens don't carry edit chrome.
- **Day is the spine.** Salidas, Mapa and Carrito are all organised by day of the week. The printed form's day colours (`salidasColors.ts`) are already learned by members, and they become the app's navigation colour code (§4.2).
- **One shell.** Sync status, auth, theme and offline handling live in one place, not in each view.

### 2.2 Navigation model

**Mobile web and native apps: bottom tab bar, 4 tabs.** The tab bar sits in the thumb zone and maps 1:1 to native `NativeTabs` / `BottomNavigation`.

| Tab | Icon (outline set) | Purpose | Default content |
|---|---|---|---|
| **Salidas** (default) | calendar-days | This week's field-service meetings | Day strip with today selected, then that day's salidas as cards |
| **Mapa** | map | Territories, plus where to go | Full-screen map with all territories outlined and numbered; today's assigned ones filled |
| **Carrito** | cart / stand | Cart-witnessing turns | "Mis turnos" first if a person is chosen, then the month grid |
| **Programa** | book-open | Midweek and weekend meetings | Current week, with "Mis partes" pinned on top when a name is set |

- **Top-right avatar button:** opens a sheet with "Soy…" (choose your name, saved only on this device, with no account), theme (Sistema / Claro / Oscuro / **Sol**, see §4.2), text size, "Iniciar sesión", and **Gestión** after sign-in.
- **Gestión** is a stack pushed over the tabs, not a fifth tab. Its entries are Salidas de la semana, Carrito (Personas / Lugares / Turnos / Generar), and Programa (Cargar PDF).
- **Cross-links:** a salida card's "Ver en el mapa" switches to the Mapa tab focused on those territory ids. Tapping a polygon on the map opens a sheet with that territory's salida(s) and "Cómo llegar" (geo: intent / Apple Maps).

**Desktop web (≥1024 px): left rail** with the same 4 destinations plus Gestión at the bottom.
- Salidas and Mapa merge into a split view: the list is 400 px on the left, the map on the right, with hover linking. This is the current behaviour, kept.
- Carrito and Programa use a 2-column layout instead of one centred narrow column. The grid or program goes on the left; "Mis turnos / Mis partes" and filters go on the right.

### 2.3 Routes (replacing `#hash`, `App.tsx:62-66`)

```
/salidas                 → this week, today selected
/salidas/:dia            → mie | jue | vie | sab | dom
/mapa?t=12,14&dia=vie    → focus territories
/carrito?persona=:id     → highlight a person
/programa/:semana        → YYYY-MM-DD (Monday)
/gestion/salidas | /gestion/carrito/{personas,lugares,turnos,generar} | /gestion/programa
/compartir/salidas/:semana → print-faithful share card (renders the PNG)
```

The same paths are used as native deep links (`territorios://salidas/vie`), so a WhatsApp link opens the app directly on the right day.

---

## 3. Per-screen redesign notes

### 3.1 Salidas (member)

- **Day strip:** one row that never wraps. It holds 5–7 segments of equal width (Mié Jue Vie Sáb Dom). Each segment has a 4 px top bar in its **day colour**, a two-line label (short day name 15 px semibold, date number 13 px), and a count dot.
  - Today is marked by a filled day-colour background, not a gold pill.
  - Swipe left or right on the list changes day.
- **Salida card:** a white surface with the day-colour bar on the left edge (6 px). Content:
  - Line 1: time, large (24 px, tabular), then the territory number badge or badges on the right.
  - Line 2: meeting place (17 px semibold), wrapping onto 2 lines, never truncated. The current corner text is truncated at `ScheduleList.tsx:78`.
  - Line 3: conductor and groups (15 px, secondary).
  - Actions: "Ver en el mapa" and "Cómo llegar", both text buttons 48 px tall.
- **Empty day:** "No hay salidas el viernes." plus a link to the next day that has salidas ("Ver sábado").
- **Header action:** "Compartir semana" opens the system share sheet with the PNG made by the share card (§3.6).

### 3.2 Mapa

- **All territories always outlined**, with a number label at the centroid (symbol layer). Assigned territories for the selected day get the fill. Selected gets a strong fill and a 3 px outline. This fixes `MapView.tsx:130,148`.
- **A floating day chip**, top-left ("Viernes · 3 salidas"), opens the day strip in a small popover. The map is full-screen by default. The sheet starts at **peek** (about 120 px: day + count + first salida) and has three snap points: peek, half, full.
- **Territory search:** a "Buscar territorio" field (number) in the top bar flies to the polygon.
- **Locate button:** 56 px FAB, bottom-right above the sheet, with three states (off / follow / compass, as today). Remove the MapLibre zoom buttons on touch devices.
- **Tapping a polygon** opens one sheet (no HTML popup, no pill) with: territory number, assigned salida(s) today, "Cómo llegar", and the last-worked date if 2.0 tracks it.
- **Legend:** inline in the sheet header ("Coloreados: asignados hoy"), not a floating desktop card.
- **Dark and Sol themes:** dark uses CARTO `dark-matter`. Sol keeps `positron` but raises polygon outline opacity and label halo. The basemap follows the theme, and a setting can force a light map in dark mode.

### 3.3 Carrito (member)

- **"Mis turnos"** comes first, once the user has picked a name in "Soy…". Show the next 3 turns as cards: date, day colour, time range, place with its colour swatch, and partners.
- **Month grid:** on mobile, a vertical list grouped by week (as today in `ScheduleTab.tsx:435-463`) with bigger type. A "Buscar persona" filter reuses the existing `highlight` logic (`ScheduleTab.tsx:466-492`) for everyone.
- **Empty:** "El cronograma de carrito todavía no está publicado." plus who to contact (configurable text).

### 3.4 Programa (member)

- **"Mis partes"** is pinned on top when "Soy…" matches a name in the parsed program: part, time, date, assistant.
- **Two segments:** "Entre semana" and "Fin de semana". Section colours (gris / dorado / bordó) come from the PDF (`ProgramaView.tsx:28-33`). Keep them as a 4 px section rule and a section title in sentence case, not a gradient header.
- **Rows:** time (tabular, 15 px) | part title (17 px) | name(s) on their own line below on mobile, not right-aligned beside the title.
- **Week navigation:** swipe, plus icon buttons (chevron SVG, 48 px). "Esta semana" is a chip that appears when you navigate away.
- **Asamblea weeks:** keep the one-banner logic (`ProgramaView.tsx:45-53`). Make it a full-width notice in a calm tint, without letter-spaced caps.

### 3.5 Gestión (admin, lazy chunk)

- **Salidas editor:** a form per slot in a bottom sheet (mobile) or side panel (desktop), not inline borderless inputs.
  - Fields: Hora (time picker), Lugar (text, with suggestions from history), Territorio(s) (number chips with a map picker), Conductor (autocomplete), Grupos.
  - The Domingo form adds G1–G4 territory fields to match `ModeloNuevo.jpeg`. This needs a `DomingoSlot` model change.
  - "Copiar semana anterior" is the main time-saver.
  - Publish states: Borrador → Publicado, with a "Publicar" button. The toast says "Publicado".
- **Carrito:**
  - People and slots as list rows that open an edit sheet. No tables under 1024 px.
  - "Generar" shows a preview diff ("12 turnos cambian") before "Aplicar".
  - The person picker is a full-height searchable sheet, with available people first and "no disponible" as a readable 13 px label.
- **Deletes:** run immediately with an "Deshacer" snackbar (5 s). There are no `window.confirm` dialogs. A destructive bulk action (delete a day, regenerate) gets a styled confirm sheet that names the consequence.
- **Programa upload:** a drop zone or file picker, the year inferred from the PDF dates, and a per-week preview list with warnings shown inline next to the week they concern.

### 3.6 Share card (Salidas and Carrito export)

- **A dedicated route that renders off-screen, faithful to `ModeloNuevo.jpeg`.**
  - Fixed 1080 px width, independent of the device, so every exported image has the same layout.
  - GRUPOS|CONDUCTOR side by side, LUGAR|TERRITORIO 3:1, and the Domingo G1–G4 row.
- **Print-only day colours:** this card is the only place that uses the soft `header`/`band` day colours from `salidasColors.ts`. The app UI uses the stronger `day.*.accent` variants (§4.2).
- **Generated on demand** and passed to `navigator.share({ files })` on web and the native share sheet in the apps. This also removes the `.exporting` CSS hack.

---

## 4. Design tokens

### 4.1 Typography

- **Family: Atkinson Hyperlegible Next** (variable, OFL, Google Fonts) for all UI text.
  - It was designed for low-vision readability: distinct `Il1`, open counters, and clear Spanish diacritics. That directly serves older members reading outdoors.
  - Numerals use **Atkinson Hyperlegible Mono** for times and territory numbers (`font-variant-numeric: tabular-nums` fallback).
  - This is deliberate. It is not Inter (the current choice, `index.css:14`) or the other default sans faces.
- **Loading:** self-host WOFF2 with Latin + Latin-Extended subset, two weights (400, 650 via the variable axis), `font-display: swap`, and preload one file. Remove the render-blocking Google Fonts `<link>` (`index.html:9-11`). Native: bundle the same fonts.
- **Scale:** ratio about 1.2, base 17 px. Use `rem` on web and `sp` on native so OS font scaling works. Test at 200%.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `type.display` | 30 / 36 | 650 | Day name on the Salidas header |
| `type.title` | 24 / 30 | 650 | Screen titles, time on a salida card |
| `type.heading` | 20 / 26 | 650 | Card titles, sheet titles |
| `type.body` | 17 / 26 | 400 | Body text, places, names |
| `type.body-strong` | 17 / 26 | 650 | Emphasis inside body |
| `type.secondary` | 15 / 22 | 400 | Conductor, groups, meta |
| `type.caption` | 13 / 18 | 400 | Timestamps, attributions. **Floor: nothing smaller than 13 px.** |
| `type.numeric` | inherits size | 650 | Mono tabular for times and territory numbers |

- **Sentence case everywhere.** No `uppercase tracking-[0.16em]` eyebrows. `uppercase` appears 56 times in `src/components` + `App.tsx`.

### 4.2 Colour roles

**Base.** These colours are chosen for sunlight first. Surfaces are pure white, not cream, and ink is navy-black, so body text reaches at least 12:1 contrast.

| Role | Light | Dark | Sol (high-contrast outdoor) |
|---|---|---|---|
| `bg.canvas` | `#EEF1F5` | `#0F1A2B` | `#FFFFFF` |
| `bg.surface` | `#FFFFFF` | `#17243A` | `#FFFFFF` |
| `bg.surface-raised` | `#FFFFFF` + `shadow.1` | `#1E2D47` | `#FFFFFF` + 2 px `border.strong` |
| `text.primary` | `#0E1B33` (≈16:1) | `#E9EEF6` | `#000000` |
| `text.secondary` | `#3F4B5E` (≈8.9:1) | `#AEB9CB` | `#1A1A1A` |
| `text.disabled` | `#7A8496` | `#6C7890` | `#4A4A4A` |
| `border.subtle` | `#D5DBE4` | `#2A3A56` | `#000000` |
| `border.strong` | `#8994A6` | `#4A5C7C` | `#000000` |
| `brand` (actions, selection) | `#1F3A68` (existing navy) | `#8FB0E6` | `#0A2A66` |
| `on-brand` | `#FFFFFF` | `#0F1A2B` | `#FFFFFF` |
| `focus-ring` | `#1F6FEB` 3 px | `#79A8FF` 3 px | `#000000` 3 px + white 2 px |
| `status.ok` | `#1E7A3E` | `#6CCB8A` | `#0B5D27` |
| `status.warn` | `#9A5B00` | `#F2B45A` | `#6B3F00` |
| `status.danger` | `#B3261E` | `#F2867E` | `#8C0F09` |
| `status.offline` | `#5B6475` | `#9AA4B6` | `#000000` |
| `map.me` | `#1A73E8` | `#6FA8FF` | `#0050D0` |

- **Gold (`#d4a857`) is no longer a UI accent.** It fails as text on white (about 2:1). Keep it only in the Programa "maestros" section rule, where it comes from the PDF.
- **Day colours: the signature of 2.0.** They come from `ModeloNuevo.jpeg` and `salidasColors.ts`.
  - `print` is the existing soft band for the share card.
  - `accent` is a stronger variant for UI bars and today fills, with at least 3:1 against white as a non-text graphic.
  - `on-accent` is the text colour on a filled accent.

| Day | `day.X.print` (header/band) | `day.X.accent` | `day.X.on-accent` |
|---|---|---|---|
| Miércoles | `#b3b3b3` / `#d9d9d9` | `#6B6F76` | `#FFFFFF` |
| Jueves | `#a9c0e0` / `#c9d8ee` | `#3D63A6` | `#FFFFFF` |
| Viernes | `#f1dca7` / `#faecc6` | `#A87410` | `#FFFFFF` |
| Sábado | `#c6e0b4` / `#d8ebcb` | `#4A7A2C` | `#FFFFFF` |
| Domingo | `#bdd7ee` / `#ddebf7` (**new**, splits from Jueves; `salidasColors.ts:20`) | `#1F7A8C` (teal-blue, distinct from Jueves) | `#FFFFFF` |
| Lunes / Martes | keep current | `#A34848` / `#7A4A9A` | `#FFFFFF` |

- In dark mode, accents are lightened about 20% (e.g. Jueves `#7FA2DE`) and `on-accent` becomes `#0F1A2B`.
- **Territory palette:** replace the 8-hue hash (`colors.ts`) with fill states and a number label, so colour is not the only cue. Use `map.assigned` = `brand` at 35% opacity, `map.selected` = `brand` at 80%, and `map.outline` = `#1F3A68` at 60% (1 px) with labels always visible. An optional "colour by salida" mode can use the day accents.

### 4.3 Spacing, sizing, radii, elevation

- **Spacing (4 px base):** `space.1`=4, `2`=8, `3`=12, `4`=16, `5`=24, `6`=32, `7`=48. Screen gutter is 16 on phones and 24 on tablets and up.
- **Touch targets:** minimum **48×48 dp** for every interactive element, including remove and close buttons. List rows are at least 56. The primary FAB is 56. Space targets at least 8 px apart.
- **Radii, varied by hierarchy rather than one value everywhere:**
  - `radius.sm` = 6: inputs, chips, badges.
  - `radius.md` = 10: cards.
  - `radius.lg` = 20: top corners of bottom sheets and dialogs.
  - `radius.full`: avatar, FAB, count dot.
  - The day strip and the share card use 0–2 (form-like).
- **Elevation:** `shadow.1` = `0 1px 2px rgb(14 27 51 / .12)` for cards, `shadow.2` = `0 6px 20px rgb(14 27 51 / .18)` for sheets and the FAB. Dark mode uses surface steps instead of shadows. Nothing else gets a shadow. The current code has 11 distinct custom `shadow-[…]` values.

### 4.4 Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion.press` | 90 ms | linear | Pressed-state background |
| `motion.quick` | 160 ms | `cubic-bezier(.2,0,0,1)` | Chip and toggle state, fades |
| `motion.standard` | 240 ms | `cubic-bezier(.2,0,0,1)` | Sheet snap, expand or collapse, tab content |
| `motion.emphasis` | 320 ms | `cubic-bezier(.3,0,0,1)` | Map fly-to (cap), shared-element day change |
| `motion.exit` | 160 ms | `cubic-bezier(.3,0,1,1)` | Dismiss |

- **Rules:**
  - Motion only answers a user action.
  - Nothing loops, except the live-location pulse, which runs only while in follow mode.
  - Remove `bob` (`index.css:61`).
  - `prefers-reduced-motion` (and Android "remove animations") turns transforms into a crossfade of up to 120 ms, and map `easeTo` becomes `jumpTo`.

---

## 5. Anti-AI-slop rules (enforced in review)

1. No purple or blue-violet gradients. **No gradients at all** on headers, cards or buttons. That removes `App.tsx:158`, `App.tsx:333`, `ProgramaView.tsx:128` and `ScheduleList.tsx:56`.
2. No emoji as icons, and no Unicode glyphs as icons (`× ✕ ▲ ▼ ＋ ‹ ›`, emoji in `MapView.tsx:33`). Use a single SVG outline icon set (e.g. Lucide on web, with the same glyphs on native via `lucide-react-native`) at 24 px with a 2 px stroke.
3. No glassmorphism. No `backdrop-blur` on bars or sheets (currently `App.tsx:190,332,361`, `MobileSheet.tsx:167`, `SalidasView.tsx:68`, `CarritoView.tsx:47`, `ProgramaView.tsx:57`). Outdoors, blur over a map lowers legibility.
4. No centered hero with 3 feature cards, no marketing landing page, no "Bienvenido" splash. The app opens straight onto today's salidas.
5. No tracked uppercase eyebrows above headings ("DÍA DE SERVICIO", "SEMANA", "REUNIÓN DEL FIN DE SEMANA"). The heading is the label.
6. No middle-dot meta strings as the default layout ("Viernes · 3 salidas", "Grupo 2 · Juan"). Use real layout (a line break, a secondary style) and keep `·` for at most one inline pair.
7. No warm cream canvas (`#f7f5f0`) and no gold-on-navy "premium" accent. White surfaces on a cool grey canvas.
8. No uniform card kit: not one radius and one soft shadow on every block. Lists are rows divided by hairlines. Cards are reserved for salida, turn and part items.
9. No decorative motion: no fade-in on every list item, no bobbing markers, no hover lift on cards.
10. No "→" appended to buttons, and no monospace for labels. Mono is allowed only for times and territory numbers, where tabular alignment matters.
11. No instruction copy that a proper affordance replaces ("Tocá o arrastrá para…", "click para deseleccionar").
12. Copy rules: Rioplatense voseo, as today ("Tocá", "Subí"). Use sentence case and plain verbs. A button and its confirmation use the same verb ("Publicar" → "Publicado"). Errors say what happened and what to do, with no apologies.

---

## 6. Performance-oriented UI rules

1. **Route-level code splitting.**
   - Move to path routes (§2.3) and `React.lazy` per tab. `MapView` and `maplibre-gl` (the largest dependency) load only when Mapa is first visited. Prefetch on idle after first paint.
   - `pdfjs` is already lazy (`src/lib/programa/pdfItems.ts:6-9`). Extend that pattern to `html-to-image`, which is only needed by the share route, and to the whole Gestión area.
2. **Load data per route.** Today `App.tsx:90-93` mounts `useTerritories`, `useSalidas`, `useCarrito` and `usePrograma` on every load, whatever the view. Each tab should fetch only its own data, through a query cache (TanStack Query or equivalent) with `staleTime` and persisted cache, so a cold start shows the last data instantly.
3. **Skeletons, not spinners or "Cargando…".**
   - Each screen has a skeleton that matches its final layout: day strip, then 3 salida-card shapes.
   - Replace `Cargando mapa…` (`App.tsx:229`) with the map container plus outline skeleton, and replace "Leyendo PDF…" (`UploadPanel.tsx:118`) with a determinate progress bar.
   - Skeleton shimmer is optional and off under reduced motion.
4. **Offline first.**
   - Service worker (web) and local storage (native) cache the last-published week, the territories GeoJSON, the program and the carrito.
   - The global status line shows "Sin conexión · datos del lunes 14:30" in plain words. There are no bare dots.
5. **Optimistic updates** for every admin edit. Apply locally, show "Guardando…" in the shell, and roll back with an error toast on failure. Deletes use an undo snackbar instead of a confirm.
6. **Virtualization.** Use it for Carrito people and turns lists and the Programa history once they exceed about 50 rows (TanStack Virtual on web, FlashList on native). The month grid renders the visible weeks only.
7. **Map performance.**
   - Pre-build territories as GeoJSON or vector tiles at build time instead of parsing KML in the client (the `@tmcw/togeojson` dependency).
   - Use `promoteId` and feature-state, as today.
   - Labels come from a centroid point source.
   - Debounce geolocation-driven `easeTo` to at most 1/s.
8. **Font and asset budget.**
   - 2 self-hosted WOFF2 files, about 60 KB total. No Google Fonts request.
   - SVG icons are tree-shaken.
   - Initial JS for the Salidas route is ≤ 120 KB gzip on web. LCP is under 2.0 s on a Moto G-class device over 4G.
9. **No layout reads in render.** Replace `window.innerHeight` reads during render (`App.tsx:150-154`, `MobileSheet.tsx:30-33`) with CSS `dvh` units and a ResizeObserver-driven inset.
10. **Input latency.**
    - Use `content-visibility: auto` on off-screen week groups.
    - Use `startTransition` for day switches, so the strip responds instantly and the list renders after.
    - Keep list item components memoised by id.

---

## 7. Open decisions for the coordinator

1. **Domingo model:** confirm the G1–G4 per-group territory layout from `ModeloNuevo.jpeg` as the 2.0 data shape. This is a schema change in `salidas`.
2. **"Soy…" identity:** a local-only name pick (no account) is enough for "Mis turnos / Mis partes". It needs a privacy line: the name stays on this device only.
3. **Native stack:** this direction is stack-agnostic. Tokens map 1:1 to CSS variables and to a TS theme object for React Native, and the tab model maps to native tab bars. The choice (Expo vs Capacitor) belongs to the architecture report.
4. **Font licence and size check** of Atkinson Hyperlegible Next with the latin-ext subset before committing. The fallback is the system UI font with the same scale.
