import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanDir, scanText } from '../check-secrets.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const jwt = (role) => {
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.c2lnbmF0dXJl`;
};

test('allowlisted placeholder e-mails are not flagged', () => {
  const text = 'mailto:you@example.com noreply@anthropic.com admin@email.com viewer@test.local';
  assert.deepEqual(scanText(text, 'supabase/README.md'), []);
});

test('a real-looking e-mail in application code is flagged and redacted', () => {
  const findings = scanText('contacto: jane.doe@gmail.com', 'apps/web/src/x.ts');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /^e-mail j\*\*\*@gmail\.com$/);
});

test('mailto: is allowed under supabase/ but not in apps/ or packages/', () => {
  assert.equal(scanText('mailto:you@example.com', 'supabase/config.toml').length, 0);
  assert.ok(scanText('mailto:you@example.com', 'packages/core/src/x.ts').some((f) => /mailto/.test(f.message)));
});

test('Argentine phone numbers are flagged', () => {
  assert.ok(scanText('Llamar al +54 9 11 2345-6789', 'packages/core/src/x.ts').length > 0);
  assert.ok(scanText('o al 011 4567-8901', 'apps/web/src/x.ts').length > 0);
});

test('a JWT with a service_role payload is flagged', () => {
  assert.ok(scanText(jwt('service_role'), 'apps/web/dist/app.js').some((f) => /service_role/.test(f.message)));
});

test('other JWTs and safe text are not flagged', () => {
  assert.deepEqual(scanText(jwt('anon'), 'apps/web/dist/app.js'), []);
  assert.deepEqual(scanText('const x = 42; // nothing sensitive', 'apps/web/src/x.ts'), []);
});

test('fixture run: scanDir flags only the leaking fixture', () => {
  const findings = scanDir(join(here, 'fixtures'));
  const files = new Set(findings.map((f) => f.file.replace(/\\/g, '/')));
  assert.ok([...files].some((f) => f.endsWith('fixtures/leak.txt')));
  assert.ok(![...files].some((f) => f.endsWith('fixtures/clean.txt')));
});
