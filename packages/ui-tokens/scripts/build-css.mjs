/**
 * Builds `dist/tokens.css` from `src/tokens.ts` (the single source of truth).
 *
 *   pnpm --filter @territorios/ui-tokens build      (node scripts/build-css.mjs)
 *
 * Output:
 *   1. @font-face for the four self-hosted WOFF2 files (relative url(), swap)
 *   2. :root                → light theme colours + all static tokens
 *   3. [data-theme=dark]    → dark colours      4. [data-theme=sol] → Sol colours
 *   5. @media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }
 *   6. @theme inline        → Tailwind 4 namespaces (colour, text, radius,
 *                             spacing, shadow) so apps can `@import` this file
 *                             and use theme-aware utilities.
 *
 * `generateCss()` is pure apart from validating the font files, so the tests
 * can assert on the exact CSS without touching dist/.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  dayIds,
  dayPrint,
  focus,
  fontFaces,
  fontFamilies,
  layout,
  line,
  motion,
  radius,
  roundel,
  space,
  station,
  themes,
  type,
} from '../src/tokens.ts';

/** Type sizes and spacing are rem (04 §4.1: OS font scaling must work). */
const ROOT_PX = 16;
/** Acceptance: all font files together stay under 200 KB. */
const FONT_BUDGET_BYTES = 200 * 1024;

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = join(pkgRoot, 'fonts');
const outDir = join(pkgRoot, 'dist');
const outFile = join(outDir, 'tokens.css');

/** 26 / 16 → "1.625"; avoids 1.1764705882352942 in the output. */
const num = (value) => String(Number(value.toFixed(6)));
const rem = (px) => `${num(px / ROOT_PX)}rem`;
const px = (value) => `${value}px`;
const kebab = (value) => value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

const block = (selector, decls, indent = '') =>
  `${indent}${selector} {\n${decls.map((decl) => `${indent}  ${decl}`).join('\n')}\n${indent}}\n`;

function checkFonts() {
  let total = 0;
  for (const face of fontFaces) {
    const file = join(fontsDir, face.file);
    if (!existsSync(file)) {
      throw new Error(`Missing font file: fonts/${face.file} (download it from Google Fonts)`);
    }
    total += statSync(file).size;
  }
  if (total > FONT_BUDGET_BYTES) {
    throw new Error(`Font budget exceeded: ${total} bytes > ${FONT_BUDGET_BYTES} bytes`);
  }
  return total;
}

function fontFaceCss() {
  return fontFaces
    .map((face) =>
      block('@font-face', [
        `font-family: "${face.family}";`,
        'font-style: normal;',
        `font-weight: ${face.weight};`,
        'font-display: swap;',
        `src: url("../fonts/${face.file}") format("woff2");`,
        `unicode-range: ${face.unicodeRange};`,
      ]),
    )
    .join('\n');
}

/** Theme-independent tokens: type, spacing, radii, focus, motion, print days. */
function staticDecls() {
  const decls = [
    `/* Families: self-hosted Atkinson Hyperlegible Next + Mono (OFL) */`,
    `--tk-font-ui: ${fontFamilies.ui};`,
    `--tk-font-numeric: ${fontFamilies.numeric};`,
    `--tk-font-variant-numeric: tabular-nums;`,
    `/* Type scale: ratio ~1.2 on a 17 px base (04 §4.1) */`,
  ];
  for (const [id, token] of Object.entries(type)) {
    const name = kebab(id);
    decls.push(
      `--tk-type-${name}-size: ${rem(token.size)};`,
      `--tk-type-${name}-leading: ${rem(token.lineHeight)};`,
      `--tk-type-${name}-weight: ${token.weight};`,
    );
  }
  decls.push(`/* Spacing: 4 px base (04 §4.3) */`);
  for (const [step, value] of Object.entries(space))
    decls.push(`--tk-space-${step}: ${rem(value)};`);
  decls.push(
    `--tk-gutter: var(--tk-space-4);`,
    `--tk-gutter-lg: var(--tk-space-5);`,
    `/* Touch targets: 48 dp min, 56 rows/FAB */`,
    `--tk-touch-min: ${rem(layout.touchMin)};`,
    `--tk-touch-row: ${rem(layout.touchRow)};`,
    `--tk-touch-fab: ${rem(layout.touchFab)};`,
    `--tk-touch-gap: ${rem(layout.touchGap)};`,
    `/* Map marks (owner decision): line stripe, station dot, territory roundel */`,
    `--tk-line-stripe-width: ${px(line.stripeWidth)};`,
    `--tk-station-dot: ${px(station.dot)};`,
    `--tk-roundel: ${px(roundel)};`,
    `/* Radii vary by hierarchy */`,
  );
  for (const [name, value] of Object.entries(radius))
    decls.push(`--tk-radius-${name}: ${px(value)};`);
  decls.push(
    `/* Focus: 3 px ring + 2 px outer contrast ring */`,
    `--tk-focus-ring-width: ${px(focus.width)};`,
    `--tk-focus-ring-outline-width: ${px(focus.outlineWidth)};`,
    `--tk-focus-ring-outline-color: ${focus.outlineColor};`,
    `/* Motion: only in answer to a user action */`,
  );
  for (const [name, token] of Object.entries(motion)) {
    decls.push(
      `--tk-motion-${name}-duration: ${token.duration}ms;`,
      `--tk-motion-${name}-easing: ${token.easing};`,
    );
  }
  decls.push(`/* Day bands of the printed form (share card) */`);
  for (const id of dayIds) {
    decls.push(
      `--tk-day-${id}-print-strong: ${dayPrint[id].strong};`,
      `--tk-day-${id}-print-soft: ${dayPrint[id].soft};`,
    );
  }
  return decls;
}

/** Everything that changes between light, dark and Sol. */
function colorDecls(themeId) {
  const theme = themes[themeId];
  const decls = [
    `/* ${themeId} theme */`,
    `--tk-bg-canvas: ${theme.bg.canvas};`,
    `--tk-bg-surface: ${theme.bg.surface};`,
    `--tk-bg-surface-raised: ${theme.bg.surfaceRaised};`,
    `--tk-text-primary: ${theme.text.primary};`,
    `--tk-text-secondary: ${theme.text.secondary};`,
    `--tk-text-disabled: ${theme.text.disabled};`,
    `--tk-border-subtle: ${theme.border.subtle};`,
    `--tk-border-strong: ${theme.border.strong};`,
    `--tk-brand: ${theme.brand};`,
    `--tk-on-brand: ${theme.onBrand};`,
    `--tk-focus-ring: ${theme.focusRing};`,
    `--tk-status-ok: ${theme.status.ok};`,
    `--tk-status-warn: ${theme.status.warn};`,
    `--tk-status-danger: ${theme.status.danger};`,
    `--tk-status-offline: ${theme.status.offline};`,
    `--tk-map-me: ${theme.map.me};`,
    `--tk-map-outline: ${theme.map.outline};`,
  ];
  for (const id of dayIds) {
    decls.push(
      `--tk-day-${id}-accent: ${theme.day[id].accent};`,
      `--tk-day-${id}-on-accent: ${theme.day[id].onAccent};`,
      `--tk-map-assigned-${id}: ${theme.map.assigned[id]};`,
      `--tk-map-selected-${id}: ${theme.map.selected[id]};`,
    );
  }
  decls.push(
    `--tk-shadow-card: ${theme.shadow.card};`,
    `--tk-shadow-sheet: ${theme.shadow.sheet};`,
  );
  return decls;
}

/** Tailwind 4 namespaces. `inline` keeps the var() so utilities re-resolve per theme. */
function tailwindThemeDecls() {
  const decls = [
    `/* Fonts */`,
    `--font-sans: var(--tk-font-ui);`,
    `--font-mono: var(--tk-font-numeric);`,
    `/* Colour roles */`,
    `--color-canvas: var(--tk-bg-canvas);`,
    `--color-surface: var(--tk-bg-surface);`,
    `--color-surface-raised: var(--tk-bg-surface-raised);`,
    `--color-ink: var(--tk-text-primary);`,
    `--color-ink-soft: var(--tk-text-secondary);`,
    `--color-ink-disabled: var(--tk-text-disabled);`,
    `--color-line: var(--tk-border-subtle);`,
    `--color-line-strong: var(--tk-border-strong);`,
    `--color-brand: var(--tk-brand);`,
    `--color-on-brand: var(--tk-on-brand);`,
    `--color-focus-ring: var(--tk-focus-ring);`,
    `--color-ok: var(--tk-status-ok);`,
    `--color-warn: var(--tk-status-warn);`,
    `--color-danger: var(--tk-status-danger);`,
    `--color-offline: var(--tk-status-offline);`,
    `--color-map-me: var(--tk-map-me);`,
    `--color-map-outline: var(--tk-map-outline);`,
  ];
  for (const id of dayIds) {
    decls.push(
      `--color-day-${id}: var(--tk-day-${id}-accent);`,
      `--color-day-${id}-on: var(--tk-day-${id}-on-accent);`,
      `--color-map-assigned-${id}: var(--tk-map-assigned-${id});`,
      `--color-map-selected-${id}: var(--tk-map-selected-${id});`,
    );
  }
  decls.push(`/* Font sizes (text-*) */`);
  for (const id of Object.keys(type)) {
    const name = kebab(id);
    decls.push(
      `--text-${name}: var(--tk-type-${name}-size);`,
      `--text-${name}--line-height: var(--tk-type-${name}-leading);`,
    );
  }
  decls.push(`/* Radii (rounded-*) */`);
  for (const name of Object.keys(radius)) {
    decls.push(`--radius-${name}: var(--tk-radius-${name});`);
  }
  decls.push(
    `/* Spacing: 4 px base grid + named layout values */`,
    `--spacing: ${rem(4)};`,
    `--spacing-gutter: var(--tk-gutter);`,
    `--spacing-gutter-lg: var(--tk-gutter-lg);`,
    `--spacing-touch: var(--tk-touch-min);`,
    `--spacing-row: var(--tk-touch-row);`,
    `/* Map marks (w-line-stripe, w-station, w-roundel) */`,
    `--spacing-line-stripe: var(--tk-line-stripe-width);`,
    `--spacing-station: var(--tk-station-dot);`,
    `--spacing-roundel: var(--tk-roundel);`,
    `/* Elevation (shadow-*) */`,
    `--shadow-card: var(--tk-shadow-card);`,
    `--shadow-sheet: var(--tk-shadow-sheet);`,
  );
  return decls;
}

export function generateCss() {
  checkFonts();
  const light = colorDecls('light');
  const dark = colorDecls('dark');
  const sol = colorDecls('sol');
  return [
    `/* TerritoriosMap 2.0 design tokens — GENERATED FILE, do not edit.`,
    ` * Source: packages/ui-tokens/src/tokens.ts · Build: pnpm --filter @territorios/ui-tokens build`,
    ` * Import from a CSS file processed by Tailwind 4:`,
    ` *   @import "@territorios/ui-tokens/tokens.css";`,
    ` */`,
    fontFaceCss(),
    block(':root', [...light, ...staticDecls()]),
    block('[data-theme=dark]', dark),
    block('[data-theme=sol]', sol),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme])', dark, '  ')}}\n`,
    block('@theme inline', tailwindThemeDecls()),
  ].join('\n');
}

export function writeCss() {
  checkFonts();
  const css = generateCss();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, css, 'utf8');
  return outFile;
}

const entry = globalThis.process?.argv?.[1];
const isMain =
  import.meta.main ?? (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url));
if (isMain) writeCss();
