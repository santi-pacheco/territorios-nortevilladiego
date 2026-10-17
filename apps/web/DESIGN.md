---
name: Territorios
description: Cong. Norte Villa Diego's weekly field-service arrangements, drawn as one train line per day.
colors:
  canvas: "#EEF1F4"
  surface: "#FFFFFF"
  ink: "#14181F"
  ink-soft: "#4A5363"
  ink-disabled: "#7A8496"
  line: "#D5DBE4"
  line-strong: "#8994A6"
  focus-ring: "#1F6FEB"
  ok: "#1E7A3E"
  warn: "#9A5B00"
  danger: "#B3261E"
  offline: "#5B6475"
  map-me: "#1A73E8"
  day-lunes: "#A34848"
  day-martes: "#7A4A9A"
  day-miercoles: "#6B6F76"
  day-jueves: "#3D63A6"
  day-viernes: "#9C6A0E"
  day-sabado: "#4A7A2C"
  day-domingo: "#1F7A8C"
typography:
  display:
    fontFamily: "'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "2.25rem"
  title:
    fontFamily: "'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: "1.875rem"
  heading:
    fontFamily: "'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: "1.625rem"
  body:
    fontFamily: "'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: "1.625rem"
  secondary:
    fontFamily: "'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.375rem"
  caption:
    fontFamily: "'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
  station-time:
    fontFamily: "'Atkinson Hyperlegible Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: "1.875rem"
    fontFeature: "tnum"
  numeric:
    fontFamily: "'Atkinson Hyperlegible Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: "1.625rem"
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "10px"
  sheet: "16px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  touch: "48px"
  row: "56px"
  line-stripe: "8px"
  station-dot: "24px"
  roundel: "30px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "48px"
  station-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px 16px 16px"
  station-card-next:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px 16px 16px"
  roundel:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.numeric}"
    rounded: "{rounded.full}"
    size: "30px"
  day-tab:
    textColor: "{colors.ink-soft}"
    padding: "8px 4px 10px"
    height: "64px"
  tab-link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.caption}"
    height: "64px"
---

# Design System: Territorios

## Overview

**Creative North Star: "La Línea del Día"**

Every day of the week is a train line in its printed-card colour, and every salida is a station on that line, in time order. Members read the screen the way they read a transit diagram on a platform: which line is today's, which station is next, and how long until it. The world borrows its grammar from a commuter-rail line diagram. That means one coloured stripe, round station dots, mono timetable numerals and ink roundels for territory numbers. It refuses the category default of grey list cards with a blue accent.

The surface is quiet so the line can be loud. A cool grey canvas carries white station cards and ink text, and the day accent is the only strong colour on any screen. State is carried by form as well as hue. The next station gets a filled dot and a 2 px ink outline. Past stations go hollow and fade, so the information survives colour blindness, glare and the Sol theme.

The density is that of a pocket timetable read outdoors on a mid-range phone. Type is large (17 px body, nothing under 13 px), there are few sizes, and rank comes from weight. Targets are at least 48 px. It is legible before it is decorative.

**Key Characteristics:**
- One 8 px day-accent stripe per screen; everything else is ink, white and cool grey.
- Station cards in time order along the stripe, with 24 px station dots.
- Times and territory numbers in Atkinson Hyperlegible Mono with tabular figures.
- Territory numbers sit in round ink roundels (30 px) with white mono digits.
- Three themes from one token source: light, dark, and Sol (high contrast for direct sun).
- Flat: no gradients, no glass, no faked material.

## Colors

The palette is ink on white over cool grey, plus seven day accents learned from the printed weekly card. Only one accent appears on any screen.

### Primary
- **Day Accents** (`day-lunes` … `day-domingo`): the printed card's day colours, deepened until white text on them clears AA (Sol scale: ≥ 7:1). Each one paints its day's line stripe, station dots, day-tab swatch and selected underline, map territory fills (35% assigned, 80% selected), and the "Próxima · en N min" tag (accent mixed 80% into ink). Members navigate by these colours, so they are a code, not decoration.

### Neutral
- **Platform Ink** (`ink`): body text, headings, primary buttons, roundels, the next-station outline. Brand and action are the theme's ink, never a separate blue.
- **Timetable Grey** (`ink-soft`): secondary text (conductor, groups, captions, inactive tabs).
- **Disabled Grey** (`ink-disabled`): disabled controls only.
- **Cool Platform Canvas** (`canvas`): the page ground. It is cool, never cream.
- **Card White** (`surface`): station cards, headers, the tab bar, the rail, sheets.
- **Hairline** (`line`): card borders, row dividers, the tab-bar top edge, the rail edge.
- **Strong Hairline** (`line-strong`): input borders, the secondary button outline, hovered station cards on desktop.
- **Focus Blue** (`focus-ring`): the 3 px keyboard focus outline. It is the one non-ink blue, kept for focus and for the map's "you are here" pin (`map-me`).
- **Status** (`ok`, `warn`, `danger`, `offline`): system messages, the offline banner and change marks (`warn` at 14% over the surface).

Dark and Sol themes redefine every role under `[data-theme]`. See `.impeccable/design.json` for the per-theme values. Dark uses a `#0F141B` canvas, surface steps in place of shadows, and lightened day accents with dark on-accent text. Sol uses pure white and black, black borders, and darkened day accents.

### Named Rules
**The One Line Rule.** A screen shows one day accent at full strength: today's or the selected day's. Other colour on the screen identifies something, such as a carrito place swatch. Nothing is tinted for mood.

**The Ink Is the Brand Rule.** Actions, selection and emphasis use the theme's ink. There is no navy, no gold, and no brand blue.

**The Sun First Rule.** Every text pair is locked by `packages/ui-tokens/src/tokens.test.ts`: light body text ≥ 12:1, Sol ≥ 7:1. Never introduce a colour pair the test does not cover.

## Typography

**Body Font:** Atkinson Hyperlegible Next (self-hosted variable 200–800, with `ui-sans-serif, system-ui` fallback)
**Numeric Font:** Atkinson Hyperlegible Mono (self-hosted 400–700, with `ui-monospace` fallback), always tabular

**Character:** Atkinson Hyperlegible Next was drawn for low-vision readers, so letterforms stay unambiguous in glare. The mono companion gives times and numbers the fixed rhythm of a departure board.

### Hierarchy
- **Display** (700, 30 px / 36 px): the screen title (day name on Salidas, "Programa", "Carrito"). One per screen.
- **Station Time** (Mono 700, 24 px / 30 px): the departure time on a station card.
- **Title** (650, 24 px / 30 px): section titles inside a screen.
- **Heading** (650, 20 px / 26 px): meeting-block headings, sheet titles, card titles.
- **Body** (400 / 650, 17 px / 26 px): places, names, parts. The base size for the whole app.
- **Secondary** (400, 15 px / 22 px): conductor, groups, the header caption, metadata.
- **Caption** (400–700, 13 px / 18 px): tab-bar and rail labels. This is the floor; nothing renders smaller.
- **Numeric** (Mono 650, inherits size): territory numbers, timetable times in Programa, counts.

All sizes are emitted in `rem`, so the scale follows the user's font-size setting, and every screen must survive 200% text.

### Named Rules
**The Few Sizes Rule.** Rank by weight before adding a size. A new screen uses the existing steps, and a step not in this list is a defect.

**The Departure Board Rule.** Every time and every territory number is set in the mono face with tabular figures. Proportional digits never sit in a time column.

## Layout

The layout is a single column on phones and a rail plus split on desktop.

- **Phones (< 1024 px):** content sits in a centred column at most 768 px wide, with a 16 px gutter. A fixed bottom tab bar (64 px plus the safe area) carries Salidas, Mapa, Carrito and Programa, each with an icon above an explicit label.
- **Desktop (≥ 1024 px):** a 96 px left rail replaces the tab bar. On Salidas the station line takes the left pane and the selected day's territory map fills the rest, sticky at full viewport height, so the two read as one view.
- **Screen header:** a secondary-size caption carries the context (congregation and week, or a period) on its own line and wraps rather than truncates. Below it the display title shares a row with the week chevrons, which wrap under the title at large text sizes. The account button sits top right on phones and at the bottom of the rail on desktop.
- **Rhythm:** 4 px base (4, 8, 12, 16, 24, 32, 48). Station cards stack 16 px apart, and the dot column and card column sit 16 px apart.
- **Touch:** interactive targets are ≥ 48 px, rows are 56 px, and targets are spaced ≥ 8 px apart.

## Elevation & Depth

The system is flat. Depth comes from tone (white cards on a cool grey canvas) and from hairlines, not from shadows. Light mode keeps two quiet shadows: one for the selected segment of a segmented control, and one under bottom sheets. Dark and Sol set both to `none`. Dark lifts raised surfaces with a lighter surface step, and Sol frames them with black borders.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgb(14 27 51 / .12)`): the selected segment of a segmented control, light theme only.
- **Sheet** (`box-shadow: 0 6px 20px rgb(14 27 51 / .18)`): bottom sheets and dialogs, light theme only.

### Named Rules
**The Flat Platform Rule.** Surfaces rest flat. Station cards never carry a shadow. Emphasis comes from a stronger border (2 px ink for "next"), never from lift.

## Shapes

Radii vary by hierarchy instead of one value everywhere: 6 px for inputs, segments and small editor controls, 10 px for cards, buttons and rail tiles, 16 px for sheet corners, and full circles for station dots, roundels, change marks and icon buttons. The recurring silhouette is the line diagram itself: a rounded 8 px vertical stripe threaded through 24 px circles. The territory roundel is a pill that holds a circle shape for one or two digits and stretches for longer numbers.

## Components

### Buttons
Solid and quiet, with no colour beyond ink.
- **Shape:** gently rounded (10 px), at least 48 px tall, 20 px side padding, weight 650.
- **Primary:** ink fill with white label (flips in dark: light ink fill, dark label). Disabled drops to 60% opacity.
- **Secondary:** transparent with a 1 px strong-hairline border and an ink label.
- **Icon button:** a 48 px circular target with an ink glyph. On hover it gets an 8% ink wash. It is used only for secondary actions (week chevrons, account) and always has an `aria-label`.

### Inputs / Fields
- **Style:** white field, 1 px strong-hairline border, 6 px radius, 48 px tall, 14 px side padding. The placeholder is in secondary grey.
- **Focus:** the global 3 px focus-blue outline at a 2 px offset (black in Sol).

### Segmented Control
A four-up grid in a canvas-tinted 10 px tray with 4 px padding. The selected segment is a white tile with the card shadow. In Sol the tray gets a 2 px black frame and the selected segment inverts to black with a white label.

### Navigation
- **Bottom tab bar (phones):** white bar with a hairline top edge. Each tab is a 64 px column with a 24 px Lucide icon above a 13 px label. The active tab switches to ink at weight 700 and its icon stroke thickens to 2.5.
- **Rail (desktop):** 96 px white column with a hairline right edge. Links are 72 px tiles with a 10 px radius, and the active tile sits on a canvas-grey wash.
- **Day strip:** one tab per day. Each tab stacks a 36×6 px swatch in the day accent, the abbreviated day name, and one 4 px tick per salida that day. The selected tab is ink at weight 700 with a 4 px day-accent underline.

### Station Line (signature)
The day as a train line. An 8 px stripe in the day accent runs behind a column of 24 px station dots, and a station card sits beside each dot.
- **Upcoming:** the dot is a white centre with a 6 px accent ring. The card is white with a 1 px hairline and 10 px radius, padded 14/16/16 px.
- **Next:** the dot is filled with the accent and haloed in the canvas colour. The card border becomes 2 px ink. A "Próxima · en N min" tag sits in day ink above the time.
- **Past:** the ring fades to 45% accent and the card loses its fill and border. Its text drops to secondary grey, and screen readers hear "(ya salió)".
- **Content order:** mono station time, then place (body, emphasis weight), conductor and groups (secondary), and finally the roundel row with a "Ver en el mapa" link.
- **Change mark:** a warn-tinted pill ("Cambió desde tu última visita") stays above a changed station until the member has seen it.

### Territory Roundel
An ink pill, 30 px tall and at least 30 px wide, with white mono digits (15 px, 700). Roundels sit in a row that forms a 48 px tap target and links to the map. The same roundel marks each territory's centre on the map, so the card and the map speak one vocabulary.

### Bottom Sheet
A native `<dialog>` docked to the bottom on phones (16 px top corners, 92 dvh max, safe-area padding) and centred with 16 px corners on desktop. It enters with a 220 ms slide-and-fade, and the backdrop is ink at 45%.

## Do's and Don'ts

### Do:
- **Do** keep the day accent as the single strong colour on a screen, and draw it as the line (stripe, dots, tab swatch, underline, map fills).
- **Do** carry state by form as well as hue: filled dot plus 2 px ink outline for next, hollow faded ring plus a borderless card for past.
- **Do** set every time and territory number in Atkinson Hyperlegible Mono with tabular figures.
- **Do** read every colour from `packages/ui-tokens` (`--tk-*` custom properties or the Tailwind `@theme` aliases). Screens never invent values.
- **Do** keep touch targets ≥ 48 px, body text at 17 px, and nothing under 13 px. Verify each new screen at 390 px, at 200% text, and in the Sol theme.
- **Do** put an explicit text label next to every navigation icon.

### Don't:
- **Don't** bring back v1's navy and gold, and don't use official JW logos, marks or typefaces.
- **Don't** use gradients, glassmorphism, cream or warm-paper grounds, or faked material (bevels, embossing).
- **Don't** add shadows to station cards or lists. Depth is tone and hairline.
- **Don't** put a decorative kicker or eyebrow above a screen title. The header caption must carry real data (congregation, week, period, count).
- **Don't** truncate the congregation name or the week range in a header. Let the caption wrap.
- **Don't** render lists as grids of cards. Programa and Carrito use hairline-divided rows. Station cards are reserved for the Salidas line.
