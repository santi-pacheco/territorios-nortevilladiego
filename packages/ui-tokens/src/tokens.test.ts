import { describe, expect, it } from 'vitest';

import { generateCss } from '../scripts/build-css.mjs';
import {
  dayIds,
  dayPrint,
  fontFaces,
  fontFamilies,
  line,
  roundel,
  station,
  themes,
  themeIds,
  type,
  withAlpha,
  type ThemeName,
} from './tokens';

/**
 * Locks 04 §4.2 + PLAN F4: body text vs surface ≥ 4.5:1 in light and dark,
 * ≥ 7:1 in Sol. Colours are adjusted until every pair below passes.
 */

/** WCAG 2.1 relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected a #RRGGBB colour, got "${hex}"`);
  const value = match[1] as string;
  const linear = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const red = linear(parseInt(value.slice(0, 2), 16) / 255);
  const green = linear(parseInt(value.slice(2, 4), 16) / 255);
  const blue = linear(parseInt(value.slice(4, 6), 16) / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.1 contrast ratio between two colours (1 … 21). */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Body/UI text needs 4.5:1, and 7:1 in Sol (outdoor sunlight). */
const MIN_TEXT: Record<ThemeName, number> = { light: 4.5, dark: 4.5, sol: 7 };
/** Non-text graphics: borders, fills, focus ring (WCAG 1.4.11). */
const MIN_GRAPHIC = 3;
/** WCAG exempts disabled text; we still keep a readable floor. */
const MIN_DISABLED: Record<ThemeName, number> = { light: 3, dark: 3, sol: 7 };

const STATUSES = ['ok', 'warn', 'danger', 'offline'] as const;

/** Collects every string stored in a token tree (for the anti-slop guard). */
function collectStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, found);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, found);
  }
  return found;
}

describe('WCAG contrast', () => {
  for (const themeId of themeIds) {
    const theme = themes[themeId];
    const min = MIN_TEXT[themeId];
    const surfaces = {
      surface: theme.bg.surface,
      'surface-raised': theme.bg.surfaceRaised,
      canvas: theme.bg.canvas,
    };

    describe(`${themeId} theme (≥ ${min}:1)`, () => {
      for (const [surfaceName, surface] of Object.entries(surfaces)) {
        it(`body text on ${surfaceName}`, () => {
          expect(
            contrast(theme.text.primary, surface),
            `text.primary on ${surfaceName} in ${themeId}`,
          ).toBeGreaterThanOrEqual(min);
          expect(
            contrast(theme.text.secondary, surface),
            `text.secondary on ${surfaceName} in ${themeId}`,
          ).toBeGreaterThanOrEqual(min);
        });
      }

      it(`disabled text keeps a floor on the surface`, () => {
        expect(
          contrast(theme.text.disabled, theme.bg.surface),
          `text.disabled on surface in ${themeId}`,
        ).toBeGreaterThanOrEqual(MIN_DISABLED[themeId]);
      });

      it(`status colours are readable text on the surface`, () => {
        for (const status of STATUSES) {
          expect(
            contrast(theme.status[status], theme.bg.surface),
            `status.${status} on surface in ${themeId}`,
          ).toBeGreaterThanOrEqual(min);
        }
      });

      it(`brand works as text and as a button label`, () => {
        expect(
          contrast(theme.brand, theme.bg.surface),
          `brand on surface in ${themeId}`,
        ).toBeGreaterThanOrEqual(min);
        expect(
          contrast(theme.onBrand, theme.brand),
          `on-brand on brand in ${themeId}`,
        ).toBeGreaterThanOrEqual(min);
      });

      it(`day chips keep their label readable (on-accent on accent)`, () => {
        for (const dayId of dayIds) {
          const day = theme.day[dayId];
          expect(
            contrast(day.onAccent, day.accent),
            `day.${dayId} label in ${themeId}`,
          ).toBeGreaterThanOrEqual(min);
        }
      });

      it(`graphics reach 3:1 (accents, focus ring, strong border, map pin)`, () => {
        for (const dayId of dayIds) {
          expect(
            contrast(theme.day[dayId].accent, theme.bg.surface),
            `day.${dayId} accent on surface in ${themeId}`,
          ).toBeGreaterThanOrEqual(MIN_GRAPHIC);
        }
        expect(
          contrast(theme.focusRing, theme.bg.surface),
          `focus ring on surface in ${themeId}`,
        ).toBeGreaterThanOrEqual(MIN_GRAPHIC);
        expect(
          contrast(theme.border.strong, theme.bg.surface),
          `border.strong on surface in ${themeId}`,
        ).toBeGreaterThanOrEqual(MIN_GRAPHIC);
        expect(
          contrast(theme.map.me, theme.bg.surface),
          `map.me on surface in ${themeId}`,
        ).toBeGreaterThanOrEqual(MIN_GRAPHIC);
      });
    });
  }

  it(`printed day bands carry text.primary (share card)`, () => {
    for (const dayId of dayIds) {
      for (const swatch of ['strong', 'soft'] as const) {
        const ink = themes.light.text.primary;
        const band = dayPrint[dayId][swatch];
        expect(
          contrast(ink, band),
          `text.primary on day.${dayId}.print.${swatch} (${band})`,
        ).toBeGreaterThanOrEqual(MIN_TEXT.light);
      }
    }
  });
});

describe('owner palette decisions (F4 correction)', () => {
  it(`uses ink as the brand/action colour, flipping per theme`, () => {
    expect(themes.light.brand).toBe('#14181F');
    expect(themes.light.onBrand).toBe('#FFFFFF');
    expect(themes.dark.brand).toBe('#E9EEF6');
    expect(themes.dark.onBrand).toBe('#14181F');
    expect(themes.sol.brand).toBe('#000000');
    expect(themes.sol.onBrand).toBe('#FFFFFF');
  });

  it(`keeps the light neutrals on the corrected ink/white pair`, () => {
    expect(themes.light.text.primary).toBe('#14181F');
    expect(themes.light.text.secondary).toBe('#4A5363');
    expect(themes.light.bg.canvas).toBe('#EEF1F4');
    expect(themes.light.bg.surface).toBe('#FFFFFF');
    expect(themes.light.border.subtle).toBe('#D5DBE4');
  });

  it(`keeps the dark neutrals on the corrected pair`, () => {
    expect(themes.dark.bg.canvas).toBe('#0F141B');
    expect(themes.dark.bg.surface).toBe('#171D26');
    expect(themes.dark.text.primary).toBe('#E9EEF6');
    expect(themes.dark.text.secondary).toBe('#AEB7C4');
  });

  it(`fills territories with the day accent, never navy, and outlines with ink`, () => {
    for (const themeId of themeIds) {
      const theme = themes[themeId];
      expect(theme.map.outline, `map.outline in ${themeId}`).toBe(
        withAlpha(theme.text.primary, 60),
      );
      for (const dayId of dayIds) {
        expect(theme.map.assigned[dayId], `map.assigned.${dayId} in ${themeId}`).toBe(
          withAlpha(theme.day[dayId].accent, 35),
        );
        expect(theme.map.selected[dayId], `map.selected.${dayId} in ${themeId}`).toBe(
          withAlpha(theme.day[dayId].accent, 80),
        );
      }
    }
  });

  it(`locks the line stripe, station dot and roundel sizes`, () => {
    expect(line.stripeWidth).toBe(8);
    expect(station.dot).toBe(24);
    expect(roundel).toBe(30);
  });
});

describe('typography', () => {
  it(`keeps the 13 px caption floor and a 17 px body`, () => {
    expect(type.caption.size).toBeGreaterThanOrEqual(13);
    expect(type.body.size).toBeGreaterThanOrEqual(17);
    expect(type.body.size).toBe(type.bodyStrong.size);
  });

  it(`uses Atkinson Hyperlegible, never Inter`, () => {
    expect(fontFamilies.ui).toContain('Atkinson Hyperlegible Next');
    expect(fontFamilies.numeric).toContain('Atkinson Hyperlegible Mono');
    expect(fontFamilies.ui).not.toContain('Inter');
  });

  it(`declares the four WOFF2 files: latin + latin-ext for both families`, () => {
    expect(fontFaces).toHaveLength(4);
    expect(new Set(fontFaces.map((face) => face.file)).size).toBe(4);
    for (const face of fontFaces) {
      expect(face.file).toMatch(/\.woff2$/);
      expect(face.family).toMatch(/^Atkinson Hyperlegible (Next|Mono)$/);
      expect(face.unicodeRange).toMatch(/^U\+/);
    }
    expect(fontFaces.filter((face) => face.subset === 'latin')).toHaveLength(2);
    expect(fontFaces.filter((face) => face.subset === 'latin-ext')).toHaveLength(2);
  });
});

describe('anti-slop (04 §5)', () => {
  const values = [...collectStrings(themes), ...collectStrings(dayPrint)];

  it(`has no gradients and never a warm cream or gold value`, () => {
    const banned = ['#f7f5f0', '#d4a857'];
    for (const value of values) {
      expect(value.toLowerCase()).not.toContain('gradient');
      expect(banned).not.toContain(value.toLowerCase());
    }
  });
});

describe('generated dist/tokens.css', () => {
  const css = generateCss();

  const blockOf = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `missing "${selector}" block`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  };

  it(`covers light, dark, Sol and the OS dark fallback`, () => {
    expect(blockOf(':root')).toContain('--tk-bg-canvas: #EEF1F4;');
    expect(blockOf(':root')).toContain('--tk-brand: #14181F;');
    expect(blockOf('[data-theme=dark]')).toContain('--tk-bg-canvas: #0F141B;');
    expect(blockOf('[data-theme=dark]')).toContain('--tk-brand: #E9EEF6;');
    expect(blockOf('[data-theme=sol]')).toContain('--tk-text-primary: #000000;');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(blockOf(':root:not([data-theme])')).toContain('--tk-bg-canvas: #0F141B;');
  });

  it(`emits per-day map fills and the map mark sizes`, () => {
    const root = blockOf(':root');
    expect(root).toContain('--tk-map-assigned-lunes: rgb(163 72 72 / 35%);');
    expect(root).toContain('--tk-map-selected-lunes: rgb(163 72 72 / 80%);');
    expect(root).toContain('--tk-map-outline: rgb(20 24 31 / 60%);');
    expect(root).toContain('--tk-line-stripe-width: 8px;');
    expect(root).toContain('--tk-station-dot: 24px;');
    expect(root).toContain('--tk-roundel: 30px;');
  });

  it(`emits static type, spacing, radius and motion tokens in rem/px/ms`, () => {
    const root = blockOf(':root');
    expect(root).toContain('--tk-type-body-size: 1.0625rem;');
    expect(root).toContain('--tk-type-body-leading: 1.625rem;');
    expect(root).toContain('--tk-type-caption-size: 0.8125rem;');
    expect(root).toContain('--tk-space-5: 1.5rem;');
    expect(root).toContain('--tk-gutter: var(--tk-space-4);');
    expect(root).toContain('--tk-touch-min: 3rem;');
    expect(root).toContain('--tk-radius-md: 10px;');
    expect(root).toContain('--tk-motion-standard-duration: 240ms;');
    expect(root).toContain('--tk-day-viernes-print-strong: #f1dca7;');
  });

  it(`maps tokens into Tailwind 4 namespaces with @theme inline`, () => {
    const theme = blockOf('@theme inline');
    expect(theme).toContain('--color-brand: var(--tk-brand);');
    expect(theme).toContain('--color-canvas: var(--tk-bg-canvas);');
    expect(theme).toContain('--color-day-domingo: var(--tk-day-domingo-accent);');
    expect(theme).toContain('--text-body: var(--tk-type-body-size);');
    expect(theme).toContain('--text-body--line-height: var(--tk-type-body-leading);');
    expect(theme).toContain('--radius-md: var(--tk-radius-md);');
    expect(theme).toContain('--spacing-gutter: var(--tk-gutter);');
    expect(theme).toContain('--spacing-roundel: var(--tk-roundel);');
    expect(theme).toContain('--color-map-assigned-domingo: var(--tk-map-assigned-domingo);');
    expect(theme).toContain('--font-sans: var(--tk-font-ui);');
  });

  it(`self-hosts the fonts with font-display: swap and relative urls`, () => {
    expect(css).toContain('font-display: swap;');
    expect(css).not.toMatch(/https?:\/\/fonts\./);
    for (const face of fontFaces) {
      expect(css).toContain(`url("../fonts/${face.file}")`);
    }
  });

  it(`passes the 200 KB font budget while generating`, () => {
    expect(() => generateCss()).not.toThrow();
  });
});
