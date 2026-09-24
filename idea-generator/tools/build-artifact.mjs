// Genera la versión de Ideario que se publica como página de claude.ai: un único
// HTML sin <head> propio (la plataforma añade el esqueleto), con el CSS y el JS en línea.
// Uso: node tools/build-artifact.mjs [salida]   (por defecto dist/ideario.html)

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ESBUILD_VERSION = '0.25.10';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist/ideario.html'));

const between = (text, start, end) => {
  const match = text.match(new RegExp(`${start}([\\s\\S]*?)${end}`));
  if (!match) throw new Error(`No se encontró ${start} … ${end} en index.html`);
  return match[1].trim();
};

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const description = html.match(/<meta name="description"[^>]*>/)[0];
const fonts = between(html, '<!-- FONTS:START -->', '<!-- FONTS:END -->');
const body = between(html, '<!-- APP:START -->', '<!-- APP:END -->');
const css = await readFile(path.join(root, 'css/styles.css'), 'utf8');

// El SDK de la API queda fuera: en claude.ai la IA va por la cuenta de la persona.
const js = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  '--yes', `esbuild@${ESBUILD_VERSION}`, 'js/main.js',
  '--bundle', '--format=iife', '--target=es2020', '--legal-comments=none',
  '--external:./js/vendor/anthropic-sdk.js',
], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

const page = `${title}
${description}
${fonts}
<style>
${css}</style>
${body}
<script>
${js.replace(/<\/script/gi, '<\\/script')}</script>
`;

await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`${path.relative(process.cwd(), out)} (${Math.round(page.length / 1024)} KB)`);
