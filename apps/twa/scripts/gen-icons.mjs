// Rasterise the PWA icons into the TWA's Android resources: node apps/twa/scripts/gen-icons.mjs
// (run from the repo root). Uses the Playwright Chromium already installed for visual QA, the
// same way scripts/gen-icons.mjs does; no image dependency.
//   - mipmap-*/ic_launcher.png             legacy launcher icon (API < 26) from icon-512.png
//   - mipmap-*/ic_launcher_foreground.png  adaptive foreground from icon-maskable-512.png
//   - mipmap-*/ic_launcher_monochrome.png  themed icon (Android 13+): the glyph of icon.svg
//   - drawable-*/ic_notification_icon.png  white glyph for push notifications
//   - drawable-xxxhdpi/splash.png          splash image (pre-Android 12) from icon-512.png
/* global Buffer, console, Image, document -- Node script; Image/document run in the page */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const web = 'apps/web/public';
const res = 'apps/twa/app/src/main/res';
const png = (file) => `data:image/png;base64,${readFileSync(`${web}/${file}`).toString('base64')}`;
// Glyph only (no background square), white on transparent.
const glyph = `data:image/svg+xml;base64,${Buffer.from(
  readFileSync(`${web}/icon.svg`, 'utf8').replace(/<rect width="512"[^>]*\/>/, ''),
).toString('base64')}`;

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
// [dir prefix, file, src, size in dp, scale of the image inside the canvas]
// Adaptive layers are 108 dp; drawing the maskable icon at 80 % keeps its safe zone inside
// the 66 dp area every launcher mask shows. The rest is ic_launcher_background (#14181F).
const outputs = [
  ['mipmap', 'ic_launcher.png', png('icon-512.png'), 48, 1],
  ['mipmap', 'ic_launcher_foreground.png', png('icon-maskable-512.png'), 108, 0.8],
  ['mipmap', 'ic_launcher_monochrome.png', glyph, 108, 0.8],
  ['drawable', 'ic_notification_icon.png', glyph, 24, 1.2],
];

const browser = await chromium.launch();
const page = await browser.newPage();
const render = (src, size, scale) =>
  page.evaluate(
    async ([src, size, scale]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const d = size * scale;
      ctx.drawImage(img, (size - d) / 2, (size - d) / 2, d, d);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    [src, size, scale],
  );
const write = async (dir, file, src, px, scale) => {
  mkdirSync(`${res}/${dir}`, { recursive: true });
  writeFileSync(`${res}/${dir}/${file}`, Buffer.from(await render(src, px, scale), 'base64'));
  console.log(`${res}/${dir}/${file}`);
};

for (const [prefix, file, src, dp, scale] of outputs) {
  for (const [density, factor] of Object.entries(densities)) {
    await write(`${prefix}-${density}`, file, src, Math.round(dp * factor), scale);
  }
}
await write('drawable-xxxhdpi', 'splash.png', png('icon-512.png'), 512, 1);
await browser.close();
