import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running production-like server (`vite preview` of a build that
 * points at local Supabase). See `e2e/editor.spec.ts` for the required environment.
 *
 * Results go outside the repo and trace/screenshot/video stay off: the Programa test reads
 * real PDFs, so no artifact of it may land in the working tree.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.E2E_OUTPUT_DIR ?? join(tmpdir(), 'territorios-e2e'),
  // Both tests write to the same database.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5301',
    ...devices['Pixel 7'],
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    actionTimeout: 15_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium' }],
});
