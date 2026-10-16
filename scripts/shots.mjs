/* global document */
// Visual QA captures: node scripts/shots.mjs <url-path> [outDir]
// Captures 390x844 (mobile, 2x) and 1440x900 (desktop) in light, dark and sol themes,
// and reports horizontal overflow so layout bugs fail loudly instead of hiding in a crop.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const path = process.argv[2] ?? '/salidas';
const out = process.argv[3] ?? 'apps/web/.impeccable/review';
const base = process.env.BASE_URL ?? 'http://localhost:5191';
const themes = (process.env.THEMES ?? 'light,dark,sol').split(',');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const viewports = [
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
];
let overflow = 0;
for (const theme of themes) {
  for (const vp of viewports) {
    const { width, height, ...rest } = vp;
    delete rest.name;
    const ctx = await browser.newContext({ ...rest, viewport: { width, height }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
    await ctx.addInitScript((t) => localStorage.setItem('tm-theme', t), theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    if (scrollW > vp.width) {
      overflow++;
      console.error(`OVERFLOW ${theme}/${vp.name}: scrollWidth ${scrollW} > ${vp.width}`);
    }
    const file = `${out}/${vp.name}-${theme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file, errors.length ? `errors: ${errors.join(' | ')}` : '');
    await ctx.close();
  }
}
await browser.close();
process.exit(overflow ? 1 : 0);
