// Genera los PNG de la app a partir de icons/icon.svg con Chromium (Playwright).
// Uso: NODE_PATH="$(npm root -g)" node tools/render-icons.mjs
//      (necesita el paquete `playwright` instalado, global o localmente).

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'icons/icon.svg'), 'utf8');
const background = source.match(/<rect id="bg"[^>]*fill="([^"]+)"/)[1];
const art = source.match(/<g id="art">[\s\S]*<\/g>\s*(?=<\/svg>)/)[0];

// Versión a sangre (sin esquinas redondeadas) con el dibujo reducido para que
// quepa en la zona segura de los iconos «maskable» y en el de iOS.
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${background}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${art}</g>
</svg>`;

const targets = [
  { file: 'icon-192.png', size: 192, svg: source, transparent: true },
  { file: 'icon-512.png', size: 512, svg: source, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, svg: fullBleed(0.74), transparent: false },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(0.86), transparent: false },
];

const browser = await chromium.launch();
try {
  for (const { file, size, svg, transparent } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style>
      <img src="${dataUrl}" width="${size}" height="${size}" style="display:block">`);
    await page.waitForFunction(() => document.images[0].complete);
    await page.screenshot({ path: path.join(root, 'icons', file), omitBackground: transparent });
    await page.close();
    console.log(`icons/${file}`);
  }
} finally {
  await browser.close();
}
