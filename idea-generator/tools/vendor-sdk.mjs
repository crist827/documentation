// Empaqueta el SDK oficial de Anthropic para el navegador en js/vendor/anthropic-sdk.js.
// La app solo lo descarga cuando alguien genera con IA usando su propia clave de API.
// Uso: node tools/vendor-sdk.mjs [versión]   (necesita npm y acceso al registro)

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_VERSION = process.argv[2] ?? '0.128.0';
const ESBUILD_VERSION = '0.25.10';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'js/vendor/anthropic-sdk.js');
const work = await mkdtemp(path.join(os.tmpdir(), 'ideario-sdk-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

try {
  const run = (command, args) => execFileSync(command, args, { cwd: work, stdio: 'inherit' });
  await writeFile(path.join(work, 'package.json'), '{"private": true}');
  run(npm, ['install', '--no-audit', '--no-fund', `@anthropic-ai/sdk@${SDK_VERSION}`, `esbuild@${ESBUILD_VERSION}`]);
  await writeFile(path.join(work, 'entry.js'), 'export { default } from "@anthropic-ai/sdk";\n');
  run(npx, ['esbuild', 'entry.js', '--bundle', '--format=esm', '--platform=browser', '--minify',
    '--legal-comments=eof', `--outfile=${outfile}`]);
  const bundle = await readFile(outfile, 'utf8');
  await writeFile(outfile, `/*! @anthropic-ai/sdk ${SDK_VERSION} (MIT) — generado con tools/vendor-sdk.mjs */\n${bundle}`);
  console.log(`js/vendor/anthropic-sdk.js (${SDK_VERSION})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
