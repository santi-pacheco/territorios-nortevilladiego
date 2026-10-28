import { platform } from '@territorios/platform';

/**
 * Self-hosted font CSS (the WOFF2 files inlined as data URLs) computed at most once per
 * session. Held as a promise so two simultaneous exports do not both walk the stylesheets.
 */
/** Browsers refuse canvases past roughly 16k px on a side (Safari the strictest). */
const MAX_CANVAS_SIDE = 16_000;

let fontEmbed: Promise<string> | null = null;

/** Controls and edit affordances marked `data-export-hide` stay out of the image. */
function keepNode(node: HTMLElement): boolean {
  // html-to-image walks Text and SVG nodes too; only elements can carry the attribute.
  if (!(node instanceof HTMLElement)) return true;
  return !node.hasAttribute('data-export-hide');
}

/**
 * Renders `node` to a PNG. `html-to-image` is imported only here, on first use, so it never
 * lands in the startup bundle; the self-hosted Atkinson fonts are embedded once so the image
 * keeps the app's face instead of a system fallback.
 */
export async function renderPng(node: HTMLElement, maxPixelRatio = 2): Promise<Blob> {
  const { toBlob, getFontEmbedCSS } = await import('html-to-image');
  // Web fonts must be settled before the snapshot, or text renders in the fallback face.
  await document.fonts?.ready;
  if (fontEmbed === null) fontEmbed = getFontEmbedCSS(node).catch(() => '');
  const blob = await toBlob(node, {
    // Tall documents (a month of Programa) drop the ratio instead of exceeding canvas limits.
    pixelRatio: Math.min(maxPixelRatio, MAX_CANVAS_SIDE / Math.max(node.offsetHeight, 1)),
    backgroundColor: '#ffffff',
    fontEmbedCSS: await fontEmbed,
    filter: keepNode,
  });
  if (!blob) throw new Error('No se pudo generar la imagen.');
  return blob;
}

/** Image copy is supported (Chrome/Edge/Android Chrome, Safari 13.1+). */
export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}

/** The OS share sheet can take this PNG as a file (phones, some desktops). */
export function canShareImage(blob: Blob, fileName: string): boolean {
  if (platform().kind !== 'web') return true;
  const file = new File([blob], fileName, { type: 'image/png' });
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/** Must run inside the tap that asked for it: browsers only allow clipboard writes then. */
export async function copyImage(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function shareImage(blob: Blob, fileName: string, title: string): Promise<void> {
  await platform().share({ name: fileName, blob, title });
}

export function downloadImage(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
