import { platform } from '@territorios/platform';

/** Which delivery path the PNG actually took, so callers can word their confirmation. */
export type SharePath = 'share' | 'download';

/**
 * Self-hosted font CSS (the WOFF2 files inlined as data URLs) computed at most once per
 * session. Held as a promise so two simultaneous exports do not both walk the stylesheets.
 */
let fontEmbed: Promise<string> | null = null;

/** Controls and edit affordances marked `data-export-hide` stay out of the image. */
function keepNode(node: HTMLElement): boolean {
  // html-to-image walks Text and SVG nodes too; only elements can carry the attribute.
  if (!(node instanceof HTMLElement)) return true;
  return !node.hasAttribute('data-export-hide');
}

/**
 * Renders `node` to a PNG and delivers it, preferring the OS share sheet (WhatsApp) and
 * falling back to a download. Returns which path was used.
 *
 * `html-to-image` is imported only here, on the first call, so it never lands in the startup
 * bundle. The self-hosted Atkinson fonts are embedded once (html-to-image reads the
 * `@font-face` rules and inlines the WOFF2 files) so exported text keeps the app's face
 * instead of a system fallback. Delivery goes through `platform().share`, which shares files
 * on web when the browser allows it, uses the native share sheet on iOS/Android and
 * downloads otherwise.
 */
export async function shareNodeAsPng(
  node: HTMLElement,
  fileName: string,
  title: string,
): Promise<SharePath> {
  const { toBlob, getFontEmbedCSS } = await import('html-to-image');

  // Web fonts must be settled before the snapshot, or text renders in the fallback face.
  await document.fonts?.ready;

  if (fontEmbed === null) {
    fontEmbed = getFontEmbedCSS(node).catch(() => '');
  }
  const css = await fontEmbed;

  const blob = await toBlob(node, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    fontEmbedCSS: css,
    filter: keepNode,
  });
  if (!blob) throw new Error('No se pudo generar la imagen.');

  const file = new File([blob], fileName, { type: 'image/png' });
  const web = platform();
  const canShareFiles =
    typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  await web.share({ name: fileName, blob, title });
  if (canShareFiles || web.kind !== 'web') return 'share';

  // Download branch: also drop the PNG on the clipboard so it can be pasted straight into
  // WhatsApp. Best effort — a blocked clipboard must never fail the export.
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
  } catch {
    // Some browsers only allow clipboard writes from a trusted gesture; ignore.
  }
  return 'download';
}
