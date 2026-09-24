import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AI_MODEL,
  AiError,
  PROPOSALS_SCHEMA,
  buildPrompt,
  fromSampleError,
  generateWithApiKey,
  generateWithSample,
  parseProposals,
  selectIdeasForPrompt,
} from '../js/ai.js';

const loadSdk = () => import('../js/vendor/anthropic-sdk.js');

const IDEAS = [
  { id: 'a', title: 'Huerto en la azotea', note: 'Con vecinos', tags: ['barrio'], favorite: false, origin: 'mine', createdAt: 1 },
  { id: 'b', title: 'Club de lectura nocturno', note: '', tags: [], favorite: true, origin: 'mine', createdAt: 2 },
  { id: 'c', title: 'Recetario de la abuela', note: '', tags: ['cocina'], favorite: false, origin: 'chosen', createdAt: 3 },
];

const REPLY = {
  ideas: [
    { title: 'Club de lectura en la azotea', note: 'Leer al aire libre con los vecinos.', technique: 'Fusión', inspiredBy: ['i1', 'i3'] },
    { title: 'Huerto en la azotea', note: 'Repetida: ya existe.', technique: 'Fusión', inspiredBy: ['i2'] },
    { title: 'Recetas del huerto', note: 'Cocinar lo cosechado.', technique: '', inspiredBy: ['[i2]', 'i9', 3] },
  ],
};

test('las favoritas y las recientes entran primero en el prompt', () => {
  const { lines, refs, used, total } = selectIdeasForPrompt(IDEAS);
  assert.deepEqual([...refs.values()], ['b', 'c', 'a']);
  assert.match(lines[0], /^\[i1\] ★ Club de lectura nocturno$/);
  assert.match(lines[1], /\(elegida\) · #cocina$/);
  assert.match(lines[2], /· Detalle: Con vecinos · #barrio$/);
  assert.equal(used, 3);
  assert.equal(total, 3);
});

test('el prompt respeta el límite de ideas y de bytes', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `x${i}`, title: `Idea número ${i}`, tags: [], createdAt: i }));
  assert.equal(selectIdeasForPrompt(many, { maxIdeas: 10 }).used, 10);
  const small = selectIdeasForPrompt(many, { maxBytes: 100 });
  assert.ok(small.used < 10 && small.used >= 1);
  assert.equal(small.total, 50);
});

test('buildPrompt pide el número de ideas y evita repetir propuestas', () => {
  const { prompt } = buildPrompt(IDEAS, { count: 4, avoid: ['Algo ya visto'] });
  assert.match(prompt, /Propón 4 ideas nuevas/);
  assert.match(prompt, /<ideas>\n\[i1\] ★ Club de lectura nocturno/);
  assert.match(prompt, /- Algo ya visto/);
  assert.match(prompt, /"inspiredBy"/);
});

test('parseProposals traduce referencias y descarta repetidas', () => {
  const { refs } = selectIdeasForPrompt(IDEAS);
  const proposals = parseProposals(REPLY, refs, { existingTitles: IDEAS.map((i) => i.title) });
  assert.equal(proposals.length, 2);
  assert.deepEqual(proposals[0], {
    title: 'Club de lectura en la azotea',
    note: 'Leer al aire libre con los vecinos.',
    technique: 'Fusión',
    sources: ['b', 'a'],
    engine: 'ai',
    key: 'ai|club de lectura en la azotea',
  });
  assert.equal(proposals[1].technique, 'IA');
  assert.deepEqual(proposals[1].sources, ['c', 'a']);
  assert.deepEqual(parseProposals(null, refs), []);
  assert.deepEqual(parseProposals({ ideas: [{ title: '' }, 'x', null] }, refs), []);
});

test('los errores de sample se traducen a mensajes claros', () => {
  assert.equal(fromSampleError({ code: 'not_granted' }).code, 'unavailable');
  assert.equal(fromSampleError({ code: 'rate_limited' }).code, 'rate_limited');
  assert.equal(fromSampleError({ code: 'cancelled' }).code, 'cancelled');
  assert.equal(fromSampleError({ code: 'invalid_json' }).code, 'bad_output');
  assert.equal(fromSampleError({ code: 'lo_que_sea' }).code, 'network');
  assert.ok(fromSampleError({}) instanceof AiError);
});

test('generateWithSample pide JSON sin caché y devuelve propuestas', async () => {
  const calls = [];
  const sample = { json: async (prompt, options) => { calls.push({ prompt, options }); return REPLY; } };
  const signal = new AbortController().signal;
  const result = await generateWithSample(sample, IDEAS, { signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cache, false);
  assert.equal(calls[0].options.signal, signal);
  assert.equal(result.proposals.length, 2);
  assert.equal(result.used, 3);
});

test('generateWithSample propaga el error traducido', async () => {
  const sample = { json: async () => { throw { code: 'refused', message: 'no' }; } };
  await assert.rejects(generateWithSample(sample, IDEAS), (error) => error instanceof AiError && error.code === 'refused');
});

function fakeFetch(respond) {
  const requests = [];
  const fetch = async (url, init) => {
    const headers = new Headers(init.headers);
    requests.push({ url: String(url), headers, body: JSON.parse(init.body) });
    const { status = 200, body } = respond(requests.length);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, requests };
}

const message = (overrides = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: AI_MODEL,
  content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(REPLY) }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 20 },
  ...overrides,
});

test('generateWithApiKey llama a la API con el SDK oficial', async () => {
  const { fetch, requests } = fakeFetch(() => ({ body: message() }));
  const result = await generateWithApiKey('sk-ant-test', IDEAS, { loadSdk, clientOptions: { fetch, maxRetries: 0 } });
  assert.equal(result.proposals.length, 2);
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.match(request.url, /^https:\/\/api\.anthropic\.com\/v1\/messages\?beta=true$/);
  assert.equal(request.headers.get('x-api-key'), 'sk-ant-test');
  assert.equal(request.headers.get('anthropic-dangerous-direct-browser-access'), 'true');
  assert.match(request.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(request.body.model, 'claude-opus-5');
  assert.equal(request.body.fallbacks, 'default');
  assert.equal(request.body.output_config.effort, 'medium');
  assert.deepEqual(request.body.output_config.format, { type: 'json_schema', schema: PROPOSALS_SCHEMA });
  assert.equal(request.body.betas, undefined);
});

test('generateWithApiKey traduce los errores de la API', async () => {
  const unauthorized = fakeFetch(() => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'bad key' } } }));
  await assert.rejects(
    generateWithApiKey('sk-bad', IDEAS, { loadSdk, clientOptions: { fetch: unauthorized.fetch, maxRetries: 0 } }),
    (error) => error.code === 'auth',
  );

  const refused = fakeFetch(() => ({ body: message({ stop_reason: 'refusal', content: [] }) }));
  await assert.rejects(
    generateWithApiKey('sk-ok', IDEAS, { loadSdk, clientOptions: { fetch: refused.fetch, maxRetries: 0 } }),
    (error) => error.code === 'refused',
  );

  const garbage = fakeFetch(() => ({ body: message({ content: [{ type: 'text', text: 'no es json' }] }) }));
  await assert.rejects(
    generateWithApiKey('sk-ok', IDEAS, { loadSdk, clientOptions: { fetch: garbage.fetch, maxRetries: 0 } }),
    (error) => error.code === 'bad_output',
  );

  await assert.rejects(
    generateWithApiKey('sk-ok', IDEAS, { loadSdk: () => Promise.reject(new Error('offline')) }),
    (error) => error.code === 'network',
  );
});

test('generateWithApiKey se puede detener', async () => {
  const controller = new AbortController();
  const fetch = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const pending = generateWithApiKey('sk-ok', IDEAS, { loadSdk, signal: controller.signal, clientOptions: { fetch, maxRetries: 0 } });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => error.code === 'cancelled');
});
