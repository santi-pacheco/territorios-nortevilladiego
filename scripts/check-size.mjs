// Bundle budget: eager JS (entry + its static imports) must stay under the limit.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'apps/web/dist';
const BUDGET_KB = Number(process.env.EAGER_JS_BUDGET_KB ?? 150);
const manifestPath = join(DIST, '.vite/manifest.json');
if (!existsSync(manifestPath)) { console.error('no manifest; build web first'); process.exit(1); }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entry = Object.values(manifest).find((c) => c.isEntry);
const seen = new Set();
function collect(key) {
  const chunk = manifest[key];
  if (!chunk || seen.has(chunk.file)) return;
  seen.add(chunk.file);
  for (const imp of chunk.imports ?? []) collect(imp);
}
collect(Object.keys(manifest).find((k) => manifest[k] === entry));
let total = 0;
for (const f of seen) total += gzipSync(readFileSync(join(DIST, f))).length;
const kb = total / 1024;
console.log(`eager JS: ${kb.toFixed(1)} KB gz (budget ${BUDGET_KB}) — ${[...seen].join(', ')}`);
if (kb > BUDGET_KB) process.exit(1);
