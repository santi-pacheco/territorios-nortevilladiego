// Extrae PdfItem[][] (una lista de fragmentos por página) de un PDF de programa,
// con la misma forma que consume packages/core/src/programa (ver PdfItem en types.ts).
//
// Uso: node tools/fixtures/extract-pdf-items.mjs <archivo.pdf> [salida.json]
// Sin salida, escribe el JSON por stdout. Los PDF reales contienen nombres reales:
// la salida cruda va a un directorio fuera del repo; sólo se commitea lo saneado.
/* global process, console */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function readPdfPages(data) {
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, font: it.fontName });
    }
    pages.push(items);
  }
  await task.destroy();
  return pages;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('Uso: node tools/fixtures/extract-pdf-items.mjs <archivo.pdf> [salida.json]');
    process.exit(1);
  }
  const pages = await readPdfPages(await readFile(input));
  const json = JSON.stringify(pages, null, 1);
  if (output) await writeFile(output, json + '\n');
  else process.stdout.write(json + '\n');
}
