import type { PdfItem } from '@territorios/core';

/**
 * Text items of every page with their position. pdf.js is imported on demand so it only
 * downloads when an editor reads a PDF; the worker is a Vite asset URL.
 */
export async function readPdfPages(data: ArrayBuffer): Promise<PdfItem[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const pages: PdfItem[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        items.push({
          str: it.str,
          x: it.transform[4] as number,
          y: it.transform[5] as number,
          w: it.width,
          font: it.fontName,
        });
      }
      pages.push(items);
    }
    return pages;
  } finally {
    void task.destroy();
  }
}
