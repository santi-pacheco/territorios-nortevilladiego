// Genera los fixtures saneados de los parsers de programa a partir de los PDF reales.
//
// Uso: pnpm exec tsx tools/fixtures/sanitize-programa.ts <entre-semana.pdf> <fin-de-semana.pdf> <año> <AAAA-MM>
//   p. ej. ... "Programa octubre 2026.pdf" "RP OCTUBRE AZUL 2026.pdf" 2026 2026-10
// Escribe midweek-<AAAA-MM>.json y weekend-<AAAA-MM>.json en packages/core/src/programa/__tests__/fixtures.
// Los PDF quedan fuera del repo; el JSON crudo nunca se escribe a disco.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildTargets, loadSource, mapStrings, parse, sanitizePages, sanitizeString } from './programa-pii';

const OUT_DIR = fileURLToPath(new URL('../../packages/core/src/programa/__tests__/fixtures/', import.meta.url));

const [midweekPdf, weekendPdf, yearArg, tag] = process.argv.slice(2);
if (!midweekPdf || !weekendPdf || !yearArg || !tag) {
  console.error('Uso: tsx tools/fixtures/sanitize-programa.ts <entre-semana.pdf> <fin-de-semana.pdf> <año> <AAAA-MM>');
  process.exit(1);
}
const year = Number(yearArg);

const src = await loadSource(midweekPdf, weekendPdf, year);
const targets = buildTargets(src);
const midweek = sanitizePages(src.midweekPages, targets);
const weekend = sanitizePages(src.weekendPages, targets);

// El saneado no debe cambiar lo que leen los parsers salvo los nombres: misma estructura,
// mismos roles, mismas partes. Si algo se pega o se corre de fila, falla acá.
const expected = mapStrings(src.parsed, (s) => sanitizeString(s, targets));
const actual = parse(midweek, weekend, year);
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error('El saneado cambia la salida de los parsers; no se escriben fixtures.');
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}midweek-${tag}.json`, JSON.stringify(midweek, null, 1) + '\n');
await writeFile(`${OUT_DIR}weekend-${tag}.json`, JSON.stringify(weekend, null, 1) + '\n');
const people = targets.filter((t) => t.kind === 'person').length;
console.log(`OK: ${people} personas y ${targets.length - people} lugares saneados; parsers equivalentes.`);
