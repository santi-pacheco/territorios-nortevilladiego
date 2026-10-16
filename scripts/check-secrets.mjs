// Fails CI if secrets or v1 PII leak into source or build output.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps', 'packages', 'supabase'];
const SKIP = new Set(['node_modules', '.git', 'android', 'ios']);
const PATTERNS = [
  /service_role/i,
  /sb_secret_[A-Za-z0-9]/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Extra literals (e.g. leaked v1 password) come from env so they are never committed themselves.
  ...(process.env.FORBIDDEN_LITERALS ?? '').split(',').filter(Boolean).map((lit) => ({ test: (t) => t.includes(lit), toString: () => '<forbidden literal>' })),
];

let hits = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.size < 5_000_000 && /\.(m?[jt]sx?|json|sql|html|css|md|toml|ya?ml)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      for (const re of PATTERNS) if (re.test(text) && !p.endsWith('check-secrets.mjs')) {
        console.error(`secret pattern ${re} in ${p}`);
        hits++;
      }
    }
  }
}
for (const r of ROOTS) if (existsSync(r)) walk(r);
if (hits) process.exit(1);
console.log('check-secrets: clean');
