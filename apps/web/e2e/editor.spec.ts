/**
 * Editor workflows end to end: Gestión ▸ Programa (PDF upload → publish → member view) and
 * Gestión ▸ Carrito (generate → publish → member view → regenerate and republish in place).
 *
 * Runs against a production build served with its real CSP (`vite preview`) and local
 * Supabase. Every page fails the test on a console error, an uncaught exception or a CSP
 * violation. Both tests write to the database: run `npx supabase db reset` afterwards.
 *
 * Environment:
 *   E2E_BASE_URL           default http://localhost:5301
 *   E2E_EDITOR_EMAIL       local editor account (see src/routes/gestion/README.md)
 *   E2E_EDITOR_PASSWORD
 *   E2E_PROGRAMA_PDF_DIR   folder with the monthly program PDFs (real names: never commit
 *                          them, nor any screenshot or trace of these pages)
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EDITOR_EMAIL;
const PASSWORD = process.env.E2E_EDITOR_PASSWORD;
const PDF_DIR = process.env.E2E_PROGRAMA_PDF_DIR;

test.skip(!EMAIL || !PASSWORD, 'Set E2E_EDITOR_EMAIL and E2E_EDITOR_PASSWORD.');

interface Guard {
  page: Page;
  workers: string[];
  /** Fails if the page logged an error, threw, or reported a CSP violation. */
  assertClean: () => Promise<void>;
}

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/** Watch a page for console errors, uncaught errors and CSP violations. */
async function guard(page: Page): Promise<Guard> {
  const problems: string[] = [];
  const workers: string[] = [];
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations!.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  page.on('console', (msg) => {
    // pdf.js falls back to a main-thread "fake worker" (a warning) when the real one is blocked.
    if (msg.type() === 'error' || /fake worker/i.test(msg.text())) {
      problems.push(`console.${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('worker', (w) => workers.push(w.url()));
  return {
    page,
    workers,
    assertClean: async () => {
      const csp = await page.evaluate(() => window.__cspViolations ?? []);
      expect([...problems, ...csp.map((v) => `CSP: ${v}`)]).toEqual([]);
    },
  };
}

async function newGuardedPage(browser: Browser): Promise<Guard> {
  const context = await browser.newContext();
  return guard(await context.newPage());
}

async function signIn(page: Page) {
  await page.goto('/gestion');
  await expect(page.getByRole('heading', { name: 'Necesitás iniciar sesión como encargado' })).toBeVisible();
  await page.getByRole('button', { name: 'Tu cuenta y ajustes' }).locator('visible=true').first().click();
  const sheet = page.getByRole('dialog', { name: 'Ajustes' });
  await sheet.getByLabel('Correo').fill(EMAIL!);
  await sheet.getByLabel('Contraseña').fill(PASSWORD!);
  await sheet.getByRole('button', { name: 'Entrar' }).click();
  // Once the editor role loads, the sign-in screen (and the sheet it owns) gives way to Gestión.
  await expect(page.getByRole('navigation', { name: 'Secciones de gestión' })).toBeVisible();
  await expect(sheet).toHaveCount(0);
}

test.describe.configure({ mode: 'serial' });

test('Gestión Programa: upload both PDFs, publish, members see the week', async ({ page }) => {
  const pdfs = PDF_DIR && existsSync(PDF_DIR)
    ? readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).map((f) => join(PDF_DIR, f))
    : [];
  test.skip(pdfs.length < 2, 'Set E2E_PROGRAMA_PDF_DIR to the folder with the midweek and weekend PDFs.');

  const editor = await guard(page);
  await signIn(page);
  await page.getByRole('navigation', { name: 'Secciones de gestión' }).getByRole('link', { name: 'Programa' }).click();
  await expect(page.getByRole('heading', { name: 'Subir programa del mes' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(pdfs);

  const preview = page.locator('section[aria-labelledby="gp-preview-h"]');
  await expect(preview.getByRole('heading', { name: 'Vista previa' })).toBeVisible();
  // Each file was read and classified (midweek and weekend), none failed.
  await expect(preview.getByText(/^Entre semana · \d+ fechas$/)).toBeVisible();
  await expect(preview.getByText(/^Fin de semana · \d+ fechas$/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Weeks, each with its meetings; midweek meetings list their parts.
  expect(await preview.getByRole('heading', { level: 3, name: /^Semana / }).count()).toBeGreaterThanOrEqual(4);
  const midweek = preview.locator('article').filter({ has: page.getByRole('heading', { level: 4, name: /^Entre semana · / }) });
  const weekend = preview.locator('article').filter({ has: page.getByRole('heading', { level: 4, name: /^Fin de semana · / }) });
  expect(await midweek.count()).toBeGreaterThanOrEqual(4);
  expect(await weekend.count()).toBeGreaterThanOrEqual(4);
  for (const card of await midweek.all()) {
    const parts = await card.locator('ol > li').count();
    const assembly = await card.locator('ol').count() === 0;
    expect(assembly || parts > 3).toBe(true);
  }
  // The seeded week (2026-10-13) is in the PDF: it replaces the published sample.
  await expect(preview.getByText('Reemplaza lo publicado').first()).toBeVisible();

  const publish = preview.getByRole('button', { name: /^Publicar \d+ reuniones$/ });
  const count = Number((await publish.textContent())!.match(/\d+/)![0]);
  await publish.click();
  await expect(page.getByRole('status').getByText(`Publicamos ${count} reuniones.`)).toBeVisible();
  await expect(page.getByRole('status').locator('.text-danger')).toHaveCount(0);

  // pdf.js parsed in its real worker (not the main-thread fallback) under the production CSP.
  expect(editor.workers.some((u) => u.includes('pdf.worker'))).toBe(true);
  await editor.assertClean();

  // Member view, signed out.
  const member = await newGuardedPage(page.context().browser()!);
  await member.page.goto('/programa?semana=2026-10-12');
  const entre = member.page.locator('section[aria-labelledby="entre-semana"]');
  await expect(entre.getByRole('heading', { name: 'Reunión de entre semana' })).toBeVisible();
  // The seed had a single placeholder part; the published PDF week has the full program.
  expect(await entre.locator('ul.border-t > li').count()).toBeGreaterThan(3);
  await expect(entre.getByRole('heading', { level: 3, name: /Tesoros de la Biblia/ })).toBeVisible();
  await expect(member.page.getByRole('heading', { name: 'Reunión del fin de semana' })).toBeVisible();
  await expect(member.page.getByText('Hermano Ejemplo')).toHaveCount(0);
  await member.assertClean();
  await member.page.context().close();
});

test('Gestión Carrito: generate, publish, regenerate in place keeping notes', async ({ page }) => {
  const TITLE = 'Carrito E2E noviembre 2026';
  const NOTE = 'Llevar folletos nuevos';
  const editor = await guard(page);
  await signIn(page);

  async function openGenerar() {
    await page.getByRole('navigation', { name: 'Secciones de gestión' }).getByRole('link', { name: 'Carrito' }).click();
    await page.getByRole('radiogroup', { name: 'Secciones del carrito' }).getByRole('radio', { name: 'Generar' }).check();
    await expect(page.getByRole('button', { name: 'Generar', exact: true })).toBeVisible();
  }
  /** The Tuesday cell (Lugar Uno) of the first preview week. */
  const firstWeekCell = () =>
    page
      .locator('section[aria-labelledby="carrito-preview-h"] > div > div')
      .first()
      .locator('div.rounded-sm')
      .filter({ hasText: 'Lugar Uno' });

  await openGenerar();
  await page.getByLabel('Título').fill(TITLE);
  await page.getByLabel('Desde').fill('2026-11-02');
  await page.getByLabel('Hasta').fill('2026-11-29');
  await page.getByRole('button', { name: 'Generar', exact: true }).click();

  const weeks = page.getByRole('heading', { level: 3, name: /^Semana del / });
  await expect(weeks).toHaveCount(4);
  expect(editor.workers.some((u) => u.includes('scheduler.worker'))).toBe(true);
  // The seed people were scheduled.
  await expect(page.getByRole('button', { name: /Prueba|Fictici|Inventada/ }).first()).toBeVisible();

  // Typed key by key, as a person would (spaces included).
  const note = firstWeekCell().getByPlaceholder('Nota…');
  await note.pressSequentially(NOTE);
  await expect(note).toHaveValue(NOTE);

  // The only schedule today is the seeded one: replace it (the default).
  await expect(page.getByRole('radio', { name: /^Reemplazar «Octubre \(ejemplo\)»/ })).toBeChecked();
  await page.getByRole('button', { name: /^Publicar \d+ turnos?$/ }).click();
  await expect(page.getByRole('status').getByText(/^Publicamos \d+ cambios?\.$/)).toBeVisible();
  await expect(page.getByRole('status').locator('.text-danger')).toHaveCount(0);
  await editor.assertClean();

  // Member view, signed out: the new schedule and its note.
  const member = await newGuardedPage(page.context().browser()!);
  await member.page.goto('/carrito');
  await expect(member.page.getByText(new RegExp(`^${TITLE} · `))).toBeVisible();
  await expect(member.page.getByText(NOTE).locator('visible=true').first()).toBeVisible();
  await member.assertClean();

  // Reload so the note can only come from the server, then regenerate over the same schedule.
  await page.reload();
  await openGenerar();
  await expect(page.getByLabel('Título')).toHaveValue(TITLE);
  await expect(page.getByLabel('Desde')).toHaveValue('2026-11-02');
  await expect(page.getByLabel('Hasta')).toHaveValue('2026-11-29');
  await page.getByRole('button', { name: 'Generar', exact: true }).click();
  await expect(weeks).toHaveCount(4);
  await expect(firstWeekCell().getByPlaceholder('Nota…')).toHaveValue(NOTE);

  await expect(page.getByRole('radio', { name: `Reemplazar «${TITLE}» (se mantienen las notas)` })).toBeChecked();
  await page.getByRole('button', { name: /^Publicar \d+ turnos?$/ }).click();
  await expect(
    page.getByRole('status').getByText(/^(Publicamos \d+ cambios?\.|Ya estaba publicado así; no hubo cambios\.)$/),
  ).toBeVisible();
  await expect(page.getByRole('status').locator('.text-danger')).toHaveCount(0);
  await editor.assertClean();

  // Republished in place: same schedule, note intact.
  await member.page.reload();
  await expect(member.page.getByText(new RegExp(`^${TITLE} · `))).toBeVisible();
  await expect(member.page.getByText(NOTE).locator('visible=true').first()).toBeVisible();
  await member.assertClean();
  await member.page.context().close();
});
