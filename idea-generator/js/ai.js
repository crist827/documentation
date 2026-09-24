// Generación con IA (Claude). Hay dos vías:
//  - `sample`: la capacidad del visor de claude.ai; usa la cuenta de Claude de quien abre la página.
//  - una clave de API de Anthropic: se usa el SDK oficial, que solo se descarga cuando hace falta.
// La construcción del prompt y la lectura de la respuesta son puras para poder probarlas.

import { DEFAULT_COUNT } from './generator.js';
import { normalize, tidy } from './text.js';

export const AI_MODEL = 'claude-opus-5';

const MAX_PROMPT_IDEAS = 250;
const MAX_IDEAS_BYTES = 40_000;
const NOTE_CHARS = 280;

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

/** Esquema JSON de la respuesta (salida estructurada en la API). */
export const PROPOSALS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          note: { type: 'string' },
          technique: { type: 'string' },
          inspiredBy: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'note', 'technique', 'inspiredBy'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

const byteLength = (text) => new TextEncoder().encode(text).length;

function clip(text, max) {
  const clean = tidy(text);
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function ideaLine(ref, idea) {
  const parts = [`[${ref}]`];
  if (idea.favorite) parts.push('★');
  parts.push(clip(idea.title, 280));
  if (idea.origin === 'chosen') parts.push('(elegida)');
  let line = parts.join(' ');
  if (tidy(idea.note)) line += ` · Detalle: ${clip(idea.note, NOTE_CHARS)}`;
  if (idea.tags?.length) line += ` · ${idea.tags.map((tag) => `#${tag}`).join(' ')}`;
  return line;
}

/**
 * Elige las ideas que caben en el prompt: favoritas primero y después las más
 * recientes, hasta `maxIdeas` o `maxBytes`. Devuelve las líneas y las referencias.
 */
export function selectIdeasForPrompt(ideas, { maxIdeas = MAX_PROMPT_IDEAS, maxBytes = MAX_IDEAS_BYTES } = {}) {
  const ordered = [...ideas].sort((a, b) =>
    Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const refs = new Map();
  const lines = [];
  let bytes = 0;
  for (const idea of ordered) {
    if (lines.length >= maxIdeas) break;
    const ref = `i${lines.length + 1}`;
    const line = ideaLine(ref, idea);
    const size = byteLength(line) + 1;
    if (bytes + size > maxBytes && lines.length) break;
    bytes += size;
    refs.set(ref, idea.id);
    lines.push(line);
  }
  return { lines, refs, used: lines.length, total: ideas.length };
}

/** Prompt para pedir `count` propuestas nuevas a partir de las ideas guardadas. */
export function buildPrompt(ideas, { count = DEFAULT_COUNT, avoid = [] } = {}) {
  const { lines, refs, used, total } = selectIdeasForPrompt(ideas);
  const avoidList = avoid.map((title) => tidy(title)).filter(Boolean).slice(0, 30);
  const avoidBlock = avoidList.length
    ? `\nTampoco repitas estas propuestas, que ya se le mostraron:\n${avoidList.map((t) => `- ${t}`).join('\n')}\n`
    : '';

  const prompt = `Eres el generador de ideas de Ideario, una libreta personal donde alguien apunta sus ideas. Estas son las ideas que ha guardado hasta ahora. Las marcadas con ★ son sus favoritas y las marcadas con (elegida) salieron de propuestas anteriores que decidió conservar.

<ideas>
${lines.join('\n')}
</ideas>

Propón ${count} ideas nuevas que nazcan de esta colección. Pueden combinar dos o tres ideas, llevar una idea a otro público, formato o escala, o desarrollar un tema que se repita. Que sean concretas, distintas entre sí y fieles a los intereses que se ven en la lista. No repitas ideas que ya están en la lista.
${avoidBlock}
Escribe en el mismo idioma en que están escritas las ideas.

Responde solo con un objeto JSON con esta forma:
{"ideas": [{"title": "…", "note": "…", "technique": "…", "inspiredBy": ["i1", "i4"]}]}

- title: la idea en una frase corta, de 12 palabras como máximo.
- note: una o dos frases que expliquen en qué consiste y por qué puede funcionar.
- technique: una etiqueta breve de cómo surgió, por ejemplo Fusión, Otro público, Otro formato, Tema recurrente o Al revés.
- inspiredBy: los identificadores de las ideas de la lista en las que se basa (de 1 a 3).`;

  return { prompt, refs, used, total };
}

function resolveRef(refs, value) {
  const ref = String(value ?? '').replace(/[[\]\s]/g, '').toLowerCase();
  return refs.get(ref) ?? refs.get(`i${ref}`) ?? null;
}

/**
 * Convierte la respuesta de Claude en propuestas: valida campos, traduce las
 * referencias «i3» a ids reales y descarta títulos repetidos.
 */
export function parseProposals(data, refs, { existingTitles = [], count = DEFAULT_COUNT } = {}) {
  const items = Array.isArray(data?.ideas) ? data.ideas : Array.isArray(data) ? data : [];
  const taken = new Set(existingTitles.map((title) => normalize(tidy(title))));
  const proposals = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const title = clip(item.title, 200);
    if (!title) continue;
    const titleKey = normalize(title);
    if (taken.has(titleKey)) continue;
    taken.add(titleKey);
    const inspiredBy = Array.isArray(item.inspiredBy) ? item.inspiredBy : [];
    const sources = [...new Set(inspiredBy.map((ref) => resolveRef(refs, ref)).filter(Boolean))].slice(0, 3);
    proposals.push({
      title,
      note: clip(item.note, 500),
      technique: clip(item.technique, 40) || 'IA',
      sources,
      engine: 'ai',
      key: `ai|${titleKey}`,
    });
    if (proposals.length >= count) break;
  }
  return proposals;
}

function finish(data, refs, ideas, count, used, total) {
  const proposals = parseProposals(data, refs, { existingTitles: ideas.map((idea) => idea.title), count });
  if (!proposals.length) {
    throw new AiError('bad_output', 'Claude no devolvió propuestas utilizables. Vuelve a intentarlo.');
  }
  return { proposals, used, total };
}

/** Traduce los códigos de error de `sample` a mensajes para la persona. */
export function fromSampleError(error) {
  switch (error?.code) {
    case 'cancelled':
      return new AiError('cancelled', 'Generación detenida.');
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return new AiError('unavailable', 'Esta página no tiene permiso para usar Claude. Puedes seguir con el generador sin conexión.');
    case 'rate_limited':
      return new AiError('rate_limited', 'Has pedido muchas propuestas seguidas o has llegado a tu límite de uso. Espera un poco y vuelve a intentarlo.');
    case 'session_expired':
      return new AiError('auth', 'Tu sesión de Claude ha caducado. Vuelve a iniciar sesión y reinténtalo.');
    case 'refused':
      return new AiError('refused', 'Claude no respondió a esta petición. Prueba con el generador sin conexión.');
    case 'invalid_json':
    case 'empty_completion':
      return new AiError('bad_output', 'La respuesta llegó incompleta. Vuelve a intentarlo.');
    case 'prompt_too_large':
      return new AiError('too_large', 'Tu ideario es demasiado grande para enviarlo de una vez.');
    default:
      return new AiError('network', 'No se pudo contactar con Claude. Revisa la conexión y vuelve a intentarlo.');
  }
}

/** Genera con la capacidad `sample` del visor de claude.ai. */
export async function generateWithSample(sample, ideas, { count = DEFAULT_COUNT, avoid = [], signal } = {}) {
  const { prompt, refs, used, total } = buildPrompt(ideas, { count, avoid });
  let data;
  try {
    // cache: false porque «Generar otras» debe dar una respuesta nueva cada vez.
    data = await sample.json(prompt, { signal, cache: false });
  } catch (error) {
    throw fromSampleError(error);
  }
  return finish(data, refs, ideas, count, used, total);
}

const loadVendoredSdk = () => import('./vendor/anthropic-sdk.js');

function fromSdkError(error, Anthropic) {
  if (error instanceof Anthropic.APIUserAbortError) return new AiError('cancelled', 'Generación detenida.');
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError('auth', 'La clave de API no es válida. Revísala en Ajustes.');
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiError('auth', 'Tu clave de API no tiene permiso para usar este modelo.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError('rate_limited', 'La API está limitando las peticiones. Espera un minuto y vuelve a intentarlo.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiError('bad_request', `La API rechazó la petición: ${error.message}`);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError('network', 'No se pudo conectar con la API de Anthropic. Revisa tu conexión.');
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError('server', 'La API de Anthropic no responde ahora mismo. Vuelve a intentarlo en un rato.');
  }
  return error;
}

/** Genera con una clave de API de Anthropic guardada en este dispositivo. */
export async function generateWithApiKey(apiKey, ideas, {
  count = DEFAULT_COUNT,
  avoid = [],
  signal,
  loadSdk = loadVendoredSdk,
  clientOptions = {},
} = {}) {
  const { prompt, refs, used, total } = buildPrompt(ideas, { count, avoid });
  let Anthropic;
  try {
    ({ default: Anthropic } = await loadSdk());
  } catch {
    throw new AiError('network', 'No se pudo cargar el cliente de la API. Revisa tu conexión.');
  }
  // La clave es de la propia persona y no sale de su dispositivo salvo hacia la API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, ...clientOptions });

  let response;
  try {
    response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      // Si el modelo declina la petición, la API la reintenta con el modelo de respaldo recomendado.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: PROPOSALS_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    }, { signal });
  } catch (error) {
    throw fromSdkError(error, Anthropic);
  }

  if (response.stop_reason === 'refusal') {
    throw new AiError('refused', 'Claude no respondió a esta petición. Prueba con el generador sin conexión.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiError('bad_output', 'La respuesta llegó incompleta. Vuelve a intentarlo.');
  }
  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError('bad_output', 'La respuesta llegó incompleta. Vuelve a intentarlo.');
  }
  return finish(data, refs, ideas, count, used, total);
}
