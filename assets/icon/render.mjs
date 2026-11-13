// Genera assets/icon/png/icon_<N>.png da icon.svg (Playwright + Chromium, sfondo trasparente).
// Uso: node assets/icon/render.mjs
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(dir, 'icon.svg'), 'utf8');
mkdirSync(path.join(dir, 'png'), { recursive: true });

const browser = await chromium.launch();
for (const n of [16, 32, 64, 128, 256, 512, 1024]) {
  const page = await browser.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${n}px;height:${n}px}</style>${svg}`);
  await page.screenshot({ path: path.join(dir, 'png', `icon_${n}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
