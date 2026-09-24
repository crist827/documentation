// Prueba de extremo a extremo en Chromium (Playwright). Recorre la app como lo
// haría una persona: en modo PWA, con la API de Anthropic simulada, y dentro de
// claude.ai simulado (base de datos, `sample` y descargas de mentira).
// Uso: NODE_PATH="$(npm root -g)" node tests/e2e.mjs [carpeta-para-capturas]
//      (tras `node tools/build-artifact.mjs`; detrás de un proxy, añade NODE_USE_ENV_PROXY=1)

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Servidor estático mínimo. /__artifact.html envuelve dist/ideario.html como lo hace claude.ai.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/__artifact.html') {
      const fragment = await readFile(path.join(root, 'dist/ideario.html'), 'utf8');
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${fragment}</body></html>`);
      return;
    }
    const file = path.join(root, url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);
    if (!file.startsWith(root)) throw new Error('fuera de la raíz');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('no encontrado');
  }
});
await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' };

/** Contexto de navegador tipo móvil. Las fuentes de Google se piden desde Node (que respeta el proxy si lo hay). */
async function newPhoneContext() {
  const context = await browser.newContext(phone);
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    try {
      const response = await fetch(route.request().url(), { headers: { 'user-agent': route.request().headers()['user-agent'] } });
      await route.fulfill({
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') ?? '', 'access-control-allow-origin': '*' },
        body: Buffer.from(await response.arrayBuffer()),
      });
    } catch {
      await route.abort();
    }
  });
  return context;
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  // Las fuentes pueden fallar sin red; cualquier otro recurso que falle es un error.
  page.on('requestfailed', (request) => {
    if (!/fonts\.(googleapis|gstatic)\.com/.test(request.url())) errors.push(`requestfailed: ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().startsWith('https://api.anthropic.com/')) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  return errors;
}

async function shot(page, name) {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

const stamp = (page) => page.locator('#count-stamp').textContent();
const tab = (page, name) => page.locator(`.tab[data-tab="${name}"]`).click();

/** La ficha cuyo título es exactamente `title` (las propuestas guardadas pueden citarlo). */
const card = (page, title) => page.locator('.idea-body').filter({
  has: page.locator('.idea-title').getByText(title, { exact: true }),
});

async function addIdea(page, text) {
  await page.locator('#idea-title').fill(text);
  await page.locator('#idea-title').press('Enter');
}

const REPLY = {
  ideas: [
    { title: 'Ruta nocturna de fuentes con telescopio', note: 'Une las fuentes del mapa con la observación de estrellas.', technique: 'Fusión', inspiredBy: ['i1', 'i2'] },
    { title: 'Recetario ilustrado del barrio', note: 'Recoge las recetas de cada portal en un libro.', technique: 'Otro formato', inspiredBy: ['i3'] },
    { title: 'Club de reparación para niños', note: 'Aprender a arreglar juguetes en familia.', technique: 'Otro público', inspiredBy: ['i4'] },
  ],
};

try {
  // ------------------------------------------------------------ PWA (IndexedDB + sin conexión)
  {
    const context = await newPhoneContext();
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(base);
    await page.locator('#ideas-empty').waitFor();
    assert.equal(await page.title(), 'Ideario de bolsillo');
    await shot(page, '01-vacio');

    await addIdea(page, 'Huerto en el balcón con riego automático #plantas');
    await addIdea(page, 'Mercadillo de trueque de ropa infantil #barrio');
    await addIdea(page, 'Guía de bares con juegos de mesa');
    assert.equal(await stamp(page), '3 fichas');
    assert.equal(await page.locator('.idea').count(), 3);
    assert.match(await page.locator('.idea').first().textContent(), /Guía de bares con juegos de mesa/);
    assert.match(await page.locator('.idea').nth(2).textContent(), /#plantas/);

    await tab(page, 'generate');
    assert.match(await page.locator('#generator').textContent(), /Te faltan 2 ideas/);
    assert.ok(await page.locator('#generator .btn-big').isDisabled());
    await shot(page, '02-generador-apagado');

    await tab(page, 'settings');
    await page.locator('#examples-btn').click();
    await page.waitForFunction(() => document.querySelector('#count-stamp').textContent === '11 fichas');
    assert.ok(await page.locator('#remove-examples-btn').isVisible());

    await tab(page, 'generate');
    assert.equal(await page.locator('.mode-option[data-mode="local"]').getAttribute('aria-checked'), 'true');
    await page.locator('[data-action="generate"]').click();
    await page.locator('.proposal').first().waitFor();
    assert.equal(await page.locator('.proposal').count(), 6);
    assert.equal(await page.locator('#tab-badge').textContent(), '6');
    await page.locator('.proposal [data-action="keep"]').first().click();
    await page.locator('.proposal.is-kept').first().waitFor();
    await page.locator('.proposal:not(.is-kept) [data-action="keep"]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.proposal.is-kept').length === 2);
    assert.equal(await stamp(page), '13 fichas');
    assert.match(await page.locator('.proposal.is-kept').first().textContent(), /Guardada como Nº 01[23]/);
    await page.locator('.proposal:not(.is-kept) [data-action="discard"]').first().click();
    assert.equal(await page.locator('.proposal').count(), 5);
    await page.waitForTimeout(600);
    await shot(page, '03-propuestas');

    // Todo sigue ahí al recargar.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#count-stamp').textContent === '13 fichas');
    await tab(page, 'generate');
    assert.equal(await page.locator('.proposal').count(), 5);
    assert.equal(await page.locator('.proposal.is-kept').count(), 2);

    // Filtros, búsqueda, favoritas y edición.
    await tab(page, 'ideas');
    await page.locator('[data-filter="chosen"]').click();
    assert.equal(await page.locator('.idea').count(), 2);
    assert.equal(await page.locator('.idea .badge-chosen').count(), 2);
    await page.locator('[data-filter="all"]').click();
    await page.locator('#search').fill('abuela');
    assert.equal(await page.locator('.idea').count() >= 1, true);
    await page.locator('#search').fill('zzz-nada');
    assert.match(await page.locator('#list-status').textContent(), /Ninguna idea contiene/);
    await page.locator('#search').fill('');

    await page.locator('.idea-fav').first().click();
    await page.locator('[data-filter="fav"]').click();
    assert.equal(await page.locator('.idea').count(), 1);
    await page.locator('[data-filter="all"]').click();

    await card(page, 'Guía de bares con juegos de mesa').click();
    await page.locator('#edit-sheet').waitFor();
    await shot(page, '04-editar');
    await page.locator('#edit-title').fill('Guía de bares con juegos de mesa y torneos');
    await page.locator('#edit-tags').fill('#ocio, noche');
    await page.locator('#edit-save').click();
    const edited = card(page, 'Guía de bares con juegos de mesa y torneos');
    await edited.waitFor();
    assert.match(await edited.textContent(), /#ocio.*#noche/s);

    await edited.click();
    await page.locator('#edit-title').fill('   ');
    await page.locator('#edit-save').click();
    assert.ok(await page.locator('#edit-error').isVisible());
    await page.locator('#edit-delete').click();
    await page.waitForFunction(() => document.querySelector('#count-stamp').textContent === '12 fichas');
    await page.locator('#toast-action').click();
    await page.waitForFunction(() => document.querySelector('#count-stamp').textContent === '13 fichas');

    // IA con clave de API: la petición va al SDK y se responde con datos simulados.
    let apiRequest = null;
    await page.route('https://api.anthropic.com/**', async (route) => {
      apiRequest = route.request();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5',
          content: [{ type: 'text', text: JSON.stringify(REPLY) }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        }),
      });
    });
    await tab(page, 'settings');
    await page.locator('#api-key').fill('sk-ant-e2e-0000');
    await page.locator('#key-form button[type="submit"]').click();
    assert.match(await page.locator('.key-saved').textContent(), /sk-ant-…0000/);
    await shot(page, '05-ajustes');
    await tab(page, 'generate');
    assert.equal(await page.locator('.mode-option[data-mode="ai"]').getAttribute('aria-checked'), 'true');
    await page.locator('[data-action="generate"]').click();
    await page.locator('.proposal', { hasText: 'Recetario ilustrado del barrio' }).waitFor();
    assert.equal(await page.locator('.proposal').count(), 3);
    assert.match(await page.locator('#proposals-sub').textContent(), /Con IA/);
    assert.equal(apiRequest.headers()['x-api-key'], 'sk-ant-e2e-0000');
    assert.equal(JSON.parse(apiRequest.postData()).model, 'claude-opus-5');

    // Error de la API: se explica y la app sigue funcionando.
    await page.unroute('https://api.anthropic.com/**');
    await page.route('https://api.anthropic.com/**', (route) => route.fulfill({
      status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    }));
    await page.locator('[data-action="generate"]').click();
    await page.locator('.gen-error').waitFor();
    assert.match(await page.locator('.gen-error').textContent(), /clave de API no es válida/);
    assert.equal(await page.locator('.proposal').count(), 3);

    // Tema oscuro.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('.mode-option[data-mode="local"]').click();
    await page.locator('[data-action="generate"]').click();
    await page.locator('.proposal-list:not(.is-dealing)').waitFor();
    await page.locator('.proposal [data-action="keep"]').first().click();
    await page.waitForTimeout(700);
    await shot(page, '06-propuestas-oscuro');
    await tab(page, 'ideas');
    await shot(page, '07-ideas-oscuro');

    // Sin red: la app abre desde la caché del service worker y conserva las ideas.
    assert.ok(await page.evaluate(() => navigator.serviceWorker.ready.then((r) => Boolean(r.active))));
    const beforeOffline = await stamp(page);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction((text) => document.querySelector('#count-stamp').textContent === text, beforeOffline);
    await tab(page, 'generate');
    await page.locator('.mode-option[data-mode="local"]').click();
    await page.locator('[data-action="generate"]').click();
    await page.locator('.proposal-list:not(.is-dealing) .proposal').first().waitFor();
    await context.setOffline(false);
    errors.splice(0, errors.length, ...errors.filter((e) => !/requestfailed: https:\/\/fonts/.test(e)));

    assert.deepEqual(errors, []);
    console.log('✓ PWA: anotar, generar sin conexión y con IA, guardar, editar, deshacer, recargar y abrir sin red');
    await context.close();
  }

  // ------------------------------------------------------------ Dentro de claude.ai (simulado)
  const claudeMock = () => {
    const docs = new Map();
    const listeners = new Set();
    const calls = { sample: [], downloads: [] };
    window.__claudeMock = { docs, calls };
    const children = (path) => [...docs.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
      .map(([key, value]) => ({ id: key.split('/').pop(), exists: true, data: () => structuredClone(value), metadata: {} }));
    const notify = () => { for (const fn of listeners) fn(); };
    const query = (path) => ({
      orderBy: () => query(path),
      limit: () => query(path),
      get: async () => { const d = children(path); return { docs: d, size: d.length, empty: !d.length }; },
      onSnapshot(next) {
        const fire = () => next({ docs: children(path) });
        listeners.add(fire);
        setTimeout(fire, 0);
        return () => listeners.delete(fire);
      },
    });
    const doc = (path) => ({
      id: path.split('/').pop(),
      path,
      get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }),
      set: async (value) => { docs.set(path, structuredClone(value)); notify(); },
      delete: async () => { docs.delete(path); notify(); },
      collection: (name) => ({ ...query(`${path}/${name}`), doc: (id) => doc(`${path}/${name}/${id}`) }),
    });
    const sample = async (input) => ({ text: String(input), truncated: false });
    sample.json = async (input, options) => {
      calls.sample.push({ input, options });
      await new Promise((r) => setTimeout(r, 50));
      return window.__nextSampleReply;
    };
    const capabilities = {
      db: { doc, collection: (path) => ({ ...query(path), doc: (id) => doc(`${path}/${id}`) }) },
      user: { id: async () => 'u_test' },
      sample,
      downloads: { save: async (file) => { calls.downloads.push(file.filename); return { status: 'saved' }; } },
    };
    window.claude = { use: (name) => new Promise((resolve) => setTimeout(() => resolve(capabilities[name] ?? null), 20)) };
  };

  for (const [label, url] of [['claude.ai (módulos)', base], ['claude.ai (página publicada)', `${base}__artifact.html`]]) {
    const context = await newPhoneContext();
    await context.addInitScript(claudeMock);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(url);
    await page.evaluate((reply) => { window.__nextSampleReply = reply; }, REPLY);
    await page.locator('#ideas-empty').waitFor();
    await tab(page, 'settings');
    await page.waitForFunction(() => /cuenta de Claude/.test(document.querySelector('#storage-info').textContent));
    assert.ok(await page.locator('#install-panel').isHidden());
    assert.match(await page.locator('#ai-settings').textContent(), /usa tu cuenta de Claude/);
    await page.locator('#examples-btn').click();
    await page.waitForFunction(() => document.querySelector('#count-stamp').textContent === '8 fichas');
    const stored = await page.evaluate(() => [...window.__claudeMock.docs.keys()].filter((k) => k.includes('/ideas/')).length);
    assert.equal(stored, 8);
    assert.ok(await page.evaluate(() => [...window.__claudeMock.docs.keys()].every((k) => k.startsWith('data/users/u_test/ideario/'))));

    await tab(page, 'generate');
    await page.waitForFunction(() => document.querySelector('.mode-option[data-mode="ai"]')?.getAttribute('aria-checked') === 'true');
    await page.locator('[data-action="generate"]').click();
    await page.locator('.proposal', { hasText: 'Ruta nocturna de fuentes' }).waitFor();
    const sampleCall = await page.evaluate(() => window.__claudeMock.calls.sample[0]);
    assert.equal(sampleCall.options.cache, false);
    assert.match(sampleCall.input, /<ideas>/);
    await page.locator('.proposal [data-action="keep"]').first().click();
    await page.waitForFunction(() => document.querySelector('#count-stamp').textContent === '9 fichas');
    assert.match(await page.locator('.proposal.is-kept .proposal-kicker').textContent(), /Fusión.*Nº 00/s);
    if (label.includes('publicada')) await shot(page, '08-claude-propuestas');

    await tab(page, 'settings');
    await page.locator('#export-btn').click();
    await page.waitForFunction(() => window.__claudeMock.calls.downloads.length === 1);
    assert.match(await page.evaluate(() => window.__claudeMock.calls.downloads[0]), /^ideario-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(await page.evaluate(() => navigator.serviceWorker?.controller ?? null), null);

    assert.deepEqual(errors, []);
    console.log(`✓ ${label}: base de datos privada, IA con la cuenta de Claude y exportación`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
