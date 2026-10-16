// Verifica que ningún nombre real del PDF quede en los fixtures ni en los tests.
//
// Uso: pnpm exec tsx tools/fixtures/check-pii.ts <entre-semana.pdf> <fin-de-semana.pdf> <año>
// Toma los nombres que los parsers leen del PDF real, los parte en palabras (sin tildes,
// sin mayúsculas, 3+ letras) y busca cada palabra completa en los archivos revisados.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNames, loadSource, norm, tokens } from './programa-pii';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCAN_DIRS = ['tools/fixtures', 'packages/core/src/programa/__tests__'];

const [midweekPdf, weekendPdf, yearArg] = process.argv.slice(2);
if (!midweekPdf || !weekendPdf || !yearArg) {
  console.error('Uso: tsx tools/fixtures/check-pii.ts <entre-semana.pdf> <fin-de-semana.pdf> <año>');
  process.exit(1);
}

const src = await loadSource(midweekPdf, weekendPdf, Number(yearArg));
const { people, places } = collectNames(src);
const banned = new Set([...people, ...places].flatMap(tokens).filter((t) => t.length >= 3));

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = (await Promise.all(SCAN_DIRS.map((d) => walk(join(ROOT, d))))).flat();
let hits = 0;
for (const file of files) {
  const words = new Set((await readFile(file, 'utf8')).split(/[^\p{L}\p{N}]+/u).map(norm));
  const found = [...banned].filter((t) => words.has(t));
  if (found.length) {
    hits += found.length;
    // No se imprime la palabra: sería volcar el nombre real en la terminal / CI.
    console.error(`FALLA ${relative(ROOT, file)}: ${found.length} palabra(s) de nombres reales`);
  }
}
console.log(`${banned.size} palabras de nombres reales revisadas en ${files.length} archivos: ${hits ? `${hits} coincidencias` : 'ninguna coincidencia'}.`);
process.exit(hits ? 1 : 0);
