// Rasterise apps/web/public/icon.svg into the PWA PNG icons: node scripts/gen-icons.mjs
// Uses the Playwright Chromium already installed for visual QA (no extra dependency).
// PNGs are full-bleed (no rounded corners): launchers and iOS apply their own mask, and the
// line + stations sit inside the maskable safe zone (centre circle, 40 % radius).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dir = 'apps/web/public';
const svg = readFileSync(`${dir}/icon.svg`, 'utf8').replace(/ rx="112"/, '');
const icons = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512 },
];

const browser = await chromium.launch();
for (const { file, size } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `${dir}/${file}`, omitBackground: false });
  await page.close();
  console.log(`${dir}/${file}`);
}
await browser.close();
