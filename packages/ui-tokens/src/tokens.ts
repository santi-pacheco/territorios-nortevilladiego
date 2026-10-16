/**
 * Design tokens for TerritoriosMap 2.0 — the single source of truth.
 *
 * Every value comes from docs/research/04-ux-direction.md §4: the typography
 * scale, colour roles for the light, dark and "Sol" (high-contrast outdoor)
 * themes, day colours from the printed form, spacing, radii, elevation and
 * motion. Screens never invent values: `scripts/build-css.mjs` compiles this
 * file into `dist/tokens.css` (CSS custom properties + a Tailwind 4 `@theme`
 * block) and a future React Native theme reads this same object.
 *
 * Units: lengths are plain numbers in CSS px on web / sp on native. The CSS
 * build writes type sizes, line heights and spacing as `rem` (px ÷ 16) so the
 * 17 px base still scales with the user's font-size setting; radii stay in px
 * because they are shape, not rhythm.
 *
 * Anti-slop (04 §5): flat colours only — no gradients, no cream canvas, no
 * gold accent. `scripts/check-*` and the tests below keep that honest.
 */

/* ------------------------------------------------------------------ theme */

/** `light` is the default (`:root`); `dark` and `sol` need `data-theme`. */
export type ThemeName = 'light' | 'dark' | 'sol';

export const themeIds: readonly ThemeName[] = ['light', 'dark', 'sol'];

/* ------------------------------------------------------------------- days */

/** Week order used by Salidas. Ids are ASCII so they double as CSS var names. */
export type DayId = 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado' | 'domingo';

export const dayIds: readonly DayId[] = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
];

/** Soft band pair of the printed form / share card: header (strong) + rows (soft). */
export interface DayPrint {
  readonly strong: string;
  readonly soft: string;
}

/**
 * From ModeloNuevo.jpeg via the printed form colours (04 §4.2). `domingo`
 * splits from `jueves` in 2.0; `lunes`/`martes` keep the current bands.
 */
export const dayPrint: Record<DayId, DayPrint> = {
  lunes: { strong: '#e0b4b4', soft: '#eecccc' },
  martes: { strong: '#d9c2e0', soft: '#e7d6ee' },
  miercoles: { strong: '#b3b3b3', soft: '#d9d9d9' },
  jueves: { strong: '#a9c0e0', soft: '#c9d8ee' },
  viernes: { strong: '#f1dca7', soft: '#faecc6' },
  sabado: { strong: '#c6e0b4', soft: '#d8ebcb' },
  domingo: { strong: '#bdd7ee', soft: '#ddebf7' },
};

/** `accent` fills a day chip / today's block; `onAccent` is the text on it. */
export interface DayAccent {
  readonly accent: string;
  readonly onAccent: string;
}

/* ------------------------------------------------------------------ fonts */

export interface FontFaceToken {
  /** Family name, unquoted (the CSS build quotes it). */
  readonly family: string;
  readonly subset: 'latin' | 'latin-ext';
  /** Variable weight axis range served by Google Fonts. */
  readonly weight: string;
  /** File name inside `packages/ui-tokens/fonts/`. */
  readonly file: string;
  /** Unicode range, so a browser only downloads the subset it needs. */
  readonly unicodeRange: string;
}

/** Self-hosted (04 §4.1): no Google Fonts request at runtime. OFL licensed. */
export const fontFamilies: { readonly ui: string; readonly numeric: string } = {
  ui: "'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif",
  numeric: "'Atkinson Hyperlegible Mono', ui-monospace, SFMono-Regular, monospace",
};

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
  'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, ' +
  'U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, ' +
  'U+2C60-2C7F, U+A720-A7FF';

/** The four WOFF2 files in `fonts/`, in the order the CSS build emits them. */
export const fontFaces: readonly FontFaceToken[] = [
  {
    family: 'Atkinson Hyperlegible Next',
    subset: 'latin',
    weight: '200 800',
    file: 'AtkinsonHyperlegibleNext-latin.woff2',
    unicodeRange: LATIN,
  },
  {
    family: 'Atkinson Hyperlegible Next',
    subset: 'latin-ext',
    weight: '200 800',
    file: 'AtkinsonHyperlegibleNext-latin-ext.woff2',
    unicodeRange: LATIN_EXT,
  },
  {
    family: 'Atkinson Hyperlegible Mono',
    subset: 'latin',
    weight: '400 700',
    file: 'AtkinsonHyperlegibleMono-latin.woff2',
    unicodeRange: LATIN,
  },
  {
    family: 'Atkinson Hyperlegible Mono',
    subset: 'latin-ext',
    weight: '400 700',
    file: 'AtkinsonHyperlegibleMono-latin-ext.woff2',
    unicodeRange: LATIN_EXT,
  },
];

/* -------------------------------------------------------------- typography */

export interface TypeToken {
  /** CSS px (native sp). Emitted to CSS as rem (px ÷ 16). */
  readonly size: number;
  /** CSS px. Emitted to CSS as rem (px ÷ 16). */
  readonly lineHeight: number;
  /** 400 = text, 650 = emphasis (variable axis, 04 §4.1). */
  readonly weight: 400 | 650;
}

export interface TypeScale {
  /** Day name on the Salidas header. */
  display: TypeToken;
  /** Screen titles, time on a salida card. */
  title: TypeToken;
  /** Card titles, sheet titles. */
  heading: TypeToken;
  /** Body text, places, names. */
  body: TypeToken;
  /** Emphasis inside body. */
  bodyStrong: TypeToken;
  /** Conductor, groups, meta. */
  secondary: TypeToken;
  /** Timestamps, attributions — floor: nothing smaller than 13 px. */
  caption: TypeToken;
  /** Mono tabular numerals for times and territory numbers; size is inherited. */
  numeric: TypeToken;
}

/** Ratio ≈ 1.2 around a 17 px base (04 §4.1). */
export const type: TypeScale = {
  display: { size: 30, lineHeight: 36, weight: 650 },
  title: { size: 24, lineHeight: 30, weight: 650 },
  heading: { size: 20, lineHeight: 26, weight: 650 },
  body: { size: 17, lineHeight: 26, weight: 400 },
  bodyStrong: { size: 17, lineHeight: 26, weight: 650 },
  secondary: { size: 15, lineHeight: 22, weight: 400 },
  caption: { size: 13, lineHeight: 18, weight: 400 },
  numeric: { size: 17, lineHeight: 26, weight: 650 },
};

/* -------------------------------------------------- spacing, radii, layout */

export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 4 px base rhythm (04 §4.3). */
export const space: Record<SpaceStep, number> = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 48,
};

export interface LayoutTokens {
  /** Screen gutter: 16 on phones, 24 up. */
  readonly gutter: number;
  readonly gutterLarge: number;
  /** Every interactive element is at least 48×48 dp (04 §4.3). */
  readonly touchMin: number;
  /** List rows. */
  readonly touchRow: number;
  /** Primary FAB. */
  readonly touchFab: number;
  /** Minimum gap between touch targets. */
  readonly touchGap: number;
}

export const layout: LayoutTokens = {
  gutter: space[4],
  gutterLarge: space[5],
  touchMin: 48,
  touchRow: 56,
  touchFab: 56,
  touchGap: space[2],
};

/* -------------------------------------------------------------- map marks */

export interface LineTokens {
  /** Width of the stripe drawn along a line route on the map and share card. */
  readonly stripeWidth: number;
}

export const line: LineTokens = { stripeWidth: 8 };

export interface StationTokens {
  /** Station marker dot diameter. */
  readonly dot: number;
}

export const station: StationTokens = { dot: 24 };

/** Territory number roundel diameter: ink background, white mono digits. */
export const roundel = 30;

export interface RadiusTokens {
  /** Inputs, chips, badges. */
  readonly xs: number;
  readonly sm: number;
  /** Cards. */
  readonly md: number;
  /** Top corners of bottom sheets and dialogs. */
  readonly lg: number;
  readonly full: number;
}

/** Radii vary by hierarchy instead of one value everywhere (04 §4.3). */
export const radius: RadiusTokens = { xs: 2, sm: 6, md: 10, lg: 20, full: 9999 };

export interface FocusTokens {
  readonly width: number;
  /** Outer contrast ring (Sol needs black ring + white gap). */
  readonly outlineWidth: number;
  readonly outlineColor: string;
}

export const focus: FocusTokens = { width: 3, outlineWidth: 2, outlineColor: '#FFFFFF' };

/* ------------------------------------------------------------------ motion */

export interface MotionToken {
  readonly duration: number;
  readonly easing: string;
}

export interface MotionScale {
  /** Pressed-state background. */
  press: MotionToken;
  /** Chip and toggle state, fades. */
  quick: MotionToken;
  /** Sheet snap, expand or collapse, tab content. */
  standard: MotionToken;
  /** Map fly-to (cap), shared-element day change. */
  emphasis: MotionToken;
  /** Dismiss. */
  exit: MotionToken;
  /** `prefers-reduced-motion` crossfade cap (04 §4.4). */
  reduced: MotionToken;
}

/** Motion only answers a user action; nothing loops (04 §4.4). */
export const motion: MotionScale = {
  press: { duration: 90, easing: 'linear' },
  quick: { duration: 160, easing: 'cubic-bezier(.2,0,0,1)' },
  standard: { duration: 240, easing: 'cubic-bezier(.2,0,0,1)' },
  emphasis: { duration: 320, easing: 'cubic-bezier(.3,0,0,1)' },
  exit: { duration: 160, easing: 'cubic-bezier(.3,0,1,1)' },
  reduced: { duration: 120, easing: 'linear' },
};

/* ------------------------------------------------------------- colour roles */

export interface ThemeColors {
  bg: { canvas: string; surface: string; surfaceRaised: string };
  text: { primary: string; secondary: string; disabled: string };
  border: { subtle: string; strong: string };
  /** Actions and selection: the theme's ink (owner decision, F4 correction). */
  brand: string;
  onBrand: string;
  focusRing: string;
  status: { ok: string; warn: string; danger: string; offline: string };
  day: Record<DayId, DayAccent>;
  map: {
    /** "You are here" pin. */
    me: string;
    /** Territory fill for an assigned day: that day's accent at 35 %. */
    assigned: Record<DayId, string>;
    /** Selected territory: the day's accent at 80 % (never navy). */
    selected: Record<DayId, string>;
    /** Territory outline: theme ink at 60 %, drawn at 1 px. */
    outline: string;
  };
  /** Dark mode uses surface steps instead of shadows (04 §4.3). */
  shadow: { card: string; sheet: string };
}

export type Themes = Record<ThemeName, ThemeColors>;

const SHADOW_CARD = '0 1px 2px rgb(14 27 51 / .12)';
const SHADOW_SHEET = '0 6px 20px rgb(14 27 51 / .18)';

/** `#RRGGBB` at an alpha, e.g. a day accent used as a translucent map fill. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected a #RRGGBB colour, got "${hex}"`);
  const value = match[1] as string;
  const channel = (offset: number): string => String(parseInt(value.slice(offset, offset + 2), 16));
  return `rgb(${channel(0)} ${channel(2)} ${channel(4)} / ${alpha}%)`;
}

/** One map fill per day, so territories follow the current day's accent. */
function dayFills(days: Record<DayId, DayAccent>, alpha: number): Record<DayId, string> {
  const fills = {} as Record<DayId, string>;
  for (const id of dayIds) fills[id] = withAlpha(days[id].accent, alpha);
  return fills;
}

/** Day accents of the light scale (04 §4.2); the other scales derive from it. */
const lightDay: Record<DayId, DayAccent> = {
  lunes: { accent: '#A34848', onAccent: '#FFFFFF' },
  martes: { accent: '#7A4A9A', onAccent: '#FFFFFF' },
  miercoles: { accent: '#6B6F76', onAccent: '#FFFFFF' },
  jueves: { accent: '#3D63A6', onAccent: '#FFFFFF' },
  viernes: { accent: '#9C6A0E', onAccent: '#FFFFFF' },
  sabado: { accent: '#4A7A2C', onAccent: '#FFFFFF' },
  domingo: { accent: '#1F7A8C', onAccent: '#FFFFFF' },
};

/** Dark scale: lightened ~20–35 % so on-accent can stay dark ink (04 §4.2). */
const darkDay: Record<DayId, DayAccent> = {
  lunes: { accent: '#BC7676', onAccent: '#0F1A2B' },
  martes: { accent: '#A989BD', onAccent: '#0F1A2B' },
  miercoles: { accent: '#898C91', onAccent: '#0F1A2B' },
  jueves: { accent: '#7FA2DE', onAccent: '#0F1A2B' },
  viernes: { accent: '#AE882A', onAccent: '#0F1A2B' },
  sabado: { accent: '#6E9556', onAccent: '#0F1A2B' },
  domingo: { accent: '#4C95A3', onAccent: '#0F1A2B' },
};

/** Sol scale: darkened until on-accent clears ≥ 7:1 in direct sun. */
const solDay: Record<DayId, DayAccent> = {
  lunes: { accent: '#8F3D3D', onAccent: '#FFFFFF' },
  martes: { accent: '#6B3F8A', onAccent: '#FFFFFF' },
  miercoles: { accent: '#54575E', onAccent: '#FFFFFF' },
  jueves: { accent: '#34548C', onAccent: '#FFFFFF' },
  viernes: { accent: '#74500A', onAccent: '#FFFFFF' },
  sabado: { accent: '#3A6123', onAccent: '#FFFFFF' },
  domingo: { accent: '#125A6B', onAccent: '#FFFFFF' },
};

/**
 * Colours are chosen for sunlight first: white surfaces (never cream) and ink
 * for text and actions, so body text is ≥ 12:1 in light mode. Contrast of
 * every pair is locked by `src/tokens.test.ts`.
 *
 * Brand/action is the theme's ink (owner decision for F4, which supersedes
 * 04 §4.2's navy): `#14181F` light, `#E9EEF6` dark, `#000000` Sol, with
 * on-brand flipping to white or ink so a button label always clears its fill.
 * Territories are filled with the current day's accent (35 % assigned,
 * 80 % selected — never navy) and outlined with ink at 60 %.
 *
 * Day accents exist as two scales: `light` (04 §4.2) and `dark`, lightened
 * from it so on-accent stays legible. `sol` darkens the light scale
 * enough for ≥ 7:1 on-accent in direct sun — the hue (the signature of 2.0)
 * is unchanged. Two of the doc's values are nudged until the contrast test
 * passes, as the task allows: `viernes` accent (a touch darker than
 * `#A87410`, so `on-accent` clears 4.5:1 with white) and dark `border.strong`
 * (`#4A5C7C` was 2.3:1 on the dark surface — inputs would fail WCAG 1.4.11;
 * `#667C9E` keeps the hue and clears 3:1 on surface and surface-raised).
 */
export const themes: Themes = {
  light: {
    bg: { canvas: '#EEF1F4', surface: '#FFFFFF', surfaceRaised: '#FFFFFF' },
    text: { primary: '#14181F', secondary: '#4A5363', disabled: '#7A8496' },
    border: { subtle: '#D5DBE4', strong: '#8994A6' },
    brand: '#14181F',
    onBrand: '#FFFFFF',
    focusRing: '#1F6FEB',
    status: { ok: '#1E7A3E', warn: '#9A5B00', danger: '#B3261E', offline: '#5B6475' },
    day: lightDay,
    map: {
      me: '#1A73E8',
      assigned: dayFills(lightDay, 35),
      selected: dayFills(lightDay, 80),
      outline: 'rgb(20 24 31 / 60%)', // ink #14181F
    },
    shadow: { card: SHADOW_CARD, sheet: SHADOW_SHEET },
  },
  dark: {
    bg: { canvas: '#0F141B', surface: '#171D26', surfaceRaised: '#1E2D47' },
    text: { primary: '#E9EEF6', secondary: '#AEB7C4', disabled: '#6C7890' },
    border: { subtle: '#2A3A56', strong: '#667C9E' },
    brand: '#E9EEF6',
    onBrand: '#14181F',
    focusRing: '#79A8FF',
    status: { ok: '#6CCB8A', warn: '#F2B45A', danger: '#F2867E', offline: '#9AA4B6' },
    day: darkDay,
    map: {
      me: '#6FA8FF',
      assigned: dayFills(darkDay, 35),
      selected: dayFills(darkDay, 80),
      outline: 'rgb(233 238 246 / 60%)', // ink #E9EEF6
    },
    shadow: { card: 'none', sheet: 'none' },
  },
  sol: {
    bg: { canvas: '#FFFFFF', surface: '#FFFFFF', surfaceRaised: '#FFFFFF' },
    text: { primary: '#000000', secondary: '#1A1A1A', disabled: '#4A4A4A' },
    border: { subtle: '#000000', strong: '#000000' },
    brand: '#000000',
    onBrand: '#FFFFFF',
    focusRing: '#000000',
    status: { ok: '#0B5D27', warn: '#6B3F00', danger: '#8C0F09', offline: '#000000' },
    day: solDay,
    map: {
      me: '#0050D0',
      assigned: dayFills(solDay, 35),
      selected: dayFills(solDay, 80),
      outline: 'rgb(0 0 0 / 60%)', // ink #000000
    },
    shadow: { card: 'none', sheet: 'none' },
  },
};
