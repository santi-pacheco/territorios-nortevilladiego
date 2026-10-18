/* global console, process, document, window, URL, fetch */
// CSP check: loads the built app under the exact production headers from apps/web/vercel.json
// and fails on any `securitypolicyviolation` or console error.
//
//   pnpm --filter @territorios/web build          # default mode: .env.production.local (hosted)
//   pnpm --filter @territorios/web preview --port 4319 --strictPort
//   node tools/security/csp-check.mjs [--base http://localhost:4319] [--shots <dir>]
//
// `vite preview` does not apply vercel.json, so every same-origin response gets the `/(.*)`
// headers injected here (documents, scripts and workers alike, as on Vercel). The service
// worker is blocked: a precached navigation would never reach the route and would skip the
// header. A canary fetch to a foreign *.supabase.co project must be the one and only violation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const BASE = arg('--base', 'http://localhost:4319');
const SHOTS = arg('--shots', null);
const CANARY = 'https://csp-canary-not-this-project.supabase.co/rest/v1/';

const vercel = JSON.parse(readFileSync(new URL('../../apps/web/vercel.json', import.meta.url), 'utf8'));
const injected = Object.fromEntries(
  vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key.toLowerCase(), h.value]),
);
const POLICY = injected['content-security-policy'];
if (!POLICY) throw new Error('vercel.json has no Content-Security-Policy header');

const violations = [];
const errors = [];
const carto = { style: 0, sprite: 0, glyphs: 0, tiles: 0 };
let metaCsp = 0;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
  serviceWorkers: 'block',
  viewport: { width: 1280, height: 860 },
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  permissions: ['clipboard-read', 'clipboard-write'],
});

await context.route('**/*', async (route) => {
  if (new URL(route.request().url()).origin !== new URL(BASE).origin) return route.continue();
  const response = await route.fetch();
  const headers = { ...response.headers(), ...injected };
  if (route.request().resourceType() === 'document') {
    const body = await response.text();
    if (/http-equiv=["']?Content-Security-Policy/i.test(body)) metaCsp++;
    return route.fulfill({ response, headers, body });
  }
  return route.fulfill({ response, headers });
});

await context.exposeBinding('__cspViolation', ({ page }, v) => violations.push({ page: page.url(), ...v }));
await context.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolation({ directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber });
  });
});

const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push({ page: page.url(), text: m.text() });
});
page.on('pageerror', (e) => errors.push({ page: page.url(), text: `pageerror: ${e.message}` }));
page.on('worker', (w) => w.on('console', (m) => m.type() === 'error' && errors.push({ page: `worker ${w.url()}`, text: m.text() })));
page.on('response', (r) => {
  const url = r.url();
  if (!/basemaps\.cartocdn\.com/.test(url) || r.status() >= 400) return;
  if (url.endsWith('style.json')) carto.style++;
  else if (/\/sprite/.test(url)) carto.sprite++;
  else if (/\/fonts\//.test(url)) carto.glyphs++;
  else if (/\.(mvt|pbf)(\?|$)/.test(url)) carto.tiles++;
});

const shot = async (name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });
const settle = () => page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

async function visit(path, extra) {
  const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  const header = res?.headers()['content-security-policy'];
  if (header !== POLICY) throw new Error(`${path}: the CSP header was not applied`);
  await settle();
  if (extra) await extra();
  await page.waitForTimeout(1500);
  await shot(path.replace(/\W+/g, '_') || 'root');
  console.log(`visited ${path}`);
}

await visit('/salidas', async () => {
  // Share-image flow: html-to-image renders the week card to a PNG and opens the share sheet.
  const share = page.getByRole('button', { name: 'Compartir semana' });
  await share.waitFor({ timeout: 20_000 });
  await share.click();
  await page.getByText('Preparando imagen…').waitFor({ state: 'detached', timeout: 30_000 });
  if (await page.getByText('No pudimos preparar la imagen').count()) throw new Error('share image failed');
  await page.waitForTimeout(1000);
  await shot('share-sheet');
  await page.keyboard.press('Escape');
  console.log('share image rendered');
});
await visit('/mapa', async () => {
  await page.locator('canvas').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(4000);
});
await visit('/programa');
await visit('/mis-asignaciones');
await visit('/gestion');

// The header must be live: a foreign Supabase project is refused, and that is the only refusal.
const before = violations.length;
await page.evaluate((u) => fetch(u).catch(() => {}), CANARY);
await page.waitForTimeout(500);
const canary = violations.splice(before).filter((v) => v.blocked.startsWith(CANARY.slice(0, 40)));
const canaryErrors = errors.filter((e) => e.text.includes('csp-canary') || /Failed to fetch/.test(e.text));
for (const e of canaryErrors) errors.splice(errors.indexOf(e), 1);

await browser.close();

console.log('\nCSP:', POLICY);
console.log('CARTO responses:', carto);
console.log('meta CSP tags in served HTML:', metaCsp);
console.log('canary blocked:', canary.length === 1 ? 'yes' : `NO (${canary.length})`);
console.log(`violations: ${violations.length}`);
for (const v of violations) console.log('  ', JSON.stringify(v));
console.log(`console errors: ${errors.length}`);
for (const e of errors) console.log('  ', JSON.stringify(e));

const ok =
  violations.length === 0 &&
  errors.length === 0 &&
  canary.length === 1 &&
  metaCsp === 0 &&
  Object.values(carto).every((n) => n > 0);
console.log(ok ? '\ncsp-check: PASS' : '\ncsp-check: FAIL');
process.exit(ok ? 0 : 1);
