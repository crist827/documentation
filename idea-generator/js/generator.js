// Generador de ideas sin conexión: recombina las ideas guardadas con técnicas
// clásicas de creatividad (fusión, cambio de público, de formato, de escala…).
// Es determinista para una misma semilla, lo que permite probarlo.

import { capitalize, contentWords, ideaKeywords, normalize, recurringThemes, shortTitle, stemKey, tidy } from './text.js';

/** Ideas necesarias para encender el generador. */
export const MIN_IDEAS = 5;
/** Propuestas por tanda. */
export const DEFAULT_COUNT = 6;

// `head`: la palabra (normalizada) que delata ese formato en el título de una idea.
const FORMATS = [
  { article: 'una', name: 'app', head: 'app', feminine: true },
  { article: 'un', name: 'juego de mesa', head: 'juego' },
  { article: 'un', name: 'pódcast', head: 'podcast' },
  { article: 'un', name: 'taller práctico', head: 'taller' },
  { article: 'una', name: 'suscripción mensual', head: 'suscripcion', feminine: true },
  { article: 'un', name: 'evento de fin de semana', head: 'evento' },
  { article: 'un', name: 'canal de vídeos cortos', head: 'canal' },
  { article: 'un', name: 'libro ilustrado', head: 'libro' },
  { article: 'un', name: 'servicio a domicilio', head: 'servicio' },
  { article: 'una', name: 'comunidad online', head: 'comunidad', feminine: true },
  { article: 'un', name: 'producto físico', head: 'producto' },
  { article: 'un', name: 'reto de 30 días', head: 'reto' },
  { article: 'una', name: 'newsletter semanal', head: 'newsletter', feminine: true },
  { article: 'un', name: 'kit para regalar', head: 'kit' },
  { article: 'una', name: 'ruta guiada', head: 'ruta', feminine: true },
  { article: 'un', name: 'curso corto', head: 'curso' },
  { article: 'una', name: 'tienda temporal', head: 'tienda', feminine: true },
  { article: 'un', name: 'mapa colaborativo', head: 'mapa' },
];

const AUDIENCES = [
  'niños y niñas', 'personas mayores', 'estudiantes', 'pequeños comercios', 'turistas', 'deportistas',
  'familias con bebés', 'quienes trabajan desde casa', 'dueños de mascotas', 'gente que vive sola',
  'profesores', 'personas con poco tiempo', 'vecinos de un mismo edificio', 'viajeros con poco presupuesto',
  'personas que se acaban de mudar',
];

const CONSTRAINTS = [
  'sin presupuesto', 'en un solo fin de semana', 'sin usar internet', 'solo con materiales reciclados',
  'en tamaño de bolsillo', 'totalmente gratis', 'con cero residuos', 'para diez personas como máximo',
  'sin necesidad de instrucciones', 'en cinco minutos al día',
];

const SCALES = [
  'para toda una ciudad', 'en miniatura, para una sola persona', 'a escala de barrio',
  'para todo el mundo, en varios idiomas', 'solo un día al año',
];

const GOALS = [
  'ahorrar tiempo', 'ahorrar dinero', 'reducir residuos', 'conocer gente nueva', 'aprender algo nuevo',
  'cuidar la salud', 'dormir mejor', 'desconectar del móvil', 'apoyar el comercio local',
  'pasar más tiempo en familia', 'hacer ejercicio sin darse cuenta', 'ayudar a otras personas',
];

/** Generador pseudoaleatorio pequeño y reproducible (mulberry32). */
export function createRng(seed) {
  let state = Number(seed) >>> 0 || 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function weightedPick(rng, items, weightOf) {
  const weights = items.map((item, i) => weightOf(item, i));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return pick(rng, items);
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

const quote = (text) => `«${text}»`;
const withArticle = (format) => `${format.article} ${format.name}`;
const basedOn = (format) => (format.feminine ? 'basada' : 'basado');

/** «y» pasa a «e» ante palabras que empiezan por el sonido /i/ («huerto e inventos»). */
function and(word) {
  const norm = normalize(word).replace(/^[^\p{L}]+/u, '');
  return /^h?i/.test(norm) && !/^hi[aeou]/.test(norm) ? 'e' : 'y';
}

/** «huerto, libros y cocina»; usa «e» cuando toca («agua e inventos»). */
export function joinWithAnd(words) {
  if (words.length === 1) return words[0];
  const last = words[words.length - 1];
  return `${words.slice(0, -1).join(', ')} ${and(last)} ${last}`;
}

function createContext(ideas, rng) {
  const prepared = ideas.map((idea) => {
    const keywords = ideaKeywords(idea);
    return {
      id: idea.id,
      idea,
      short: shortTitle(idea.title),
      keywords,
      keys: new Set(keywords.map((word) => stemKey(normalize(word)))),
      titleKeys: new Set(contentWords(idea.title).map((k) => stemKey(k.norm))),
    };
  });
  const byId = new Map(prepared.map((p) => [p.id, p]));
  const usage = new Map();
  // Favoritas pesan el doble; las ya usadas en esta tanda, menos.
  const weight = (p) => (p.idea.favorite ? 2 : 1) / (1 + 2 * (usage.get(p.id) ?? 0));
  const related = (a, b) => [...a.keys].some((key) => b.keys.has(key));

  return {
    rng,
    byId,
    usage,
    themes: recurringThemes(ideas),
    pickOne() {
      return prepared.length ? weightedPick(rng, prepared, weight) : null;
    },
    /** Pareja para `a`, prefiriendo ideas que no comparten temas (cruces más lejanos). */
    pickPartner(a, exclude = []) {
      const pool = prepared.filter((p) => p !== a && !exclude.includes(p));
      if (!pool.length) return null;
      return weightedPick(rng, pool, (p) => weight(p) * (related(a, p) ? 0.5 : 1.5));
    },
    /** Una de las mejores palabras clave de `p` (casi siempre la primera) que no repita las de `avoid`. */
    keyword(p, avoid = []) {
      const avoidKeys = avoid.filter(Boolean).map((word) => stemKey(normalize(word)));
      const options = p.keywords.filter((word) => !avoidKeys.includes(stemKey(normalize(word)))).slice(0, 3);
      if (!options.length) return null;
      const bias = [6, 3, 1];
      return weightedPick(rng, options, (_, i) => bias[i]);
    },
    /** Un formato que no sea ya el de ninguna de las ideas de origen. */
    format(...sources) {
      const fresh = FORMATS.filter((f) => !sources.some((p) => p.titleKeys.has(stemKey(f.head))));
      return pick(rng, fresh.length ? fresh : FORMATS);
    },
  };
}

const TECHNIQUES = [
  {
    id: 'fusion',
    label: 'Fusión',
    minIdeas: 2,
    weight: 3,
    make(ctx) {
      const a = ctx.pickOne();
      const b = a && ctx.pickPartner(a);
      if (!b) return null;
      const ka = ctx.keyword(a);
      const kb = ctx.keyword(b, [ka]);
      const format = ctx.format(a, b);
      const title = ka && kb
        ? `${capitalize(withArticle(format))} que combine ${joinWithAnd([ka, kb])}`
        : `${capitalize(withArticle(format))} que junte ${quote(a.short)} ${and(b.short)} ${quote(b.short)}`;
      const note = pick(ctx.rng, [
        `Une ${quote(a.short)} con ${quote(b.short)}: quédate con lo mejor de cada una y busca qué pueden hacer juntas.`,
        `Nace de cruzar ${quote(a.short)} y ${quote(b.short)}. ¿Qué resolverían mejor juntas que por separado?`,
      ]);
      return { title, note, sources: [a, b], param: format.name };
    },
  },
  {
    id: 'whatif',
    label: '¿Y si…?',
    minIdeas: 2,
    weight: 2,
    make(ctx) {
      const a = ctx.pickOne();
      const b = a && ctx.pickPartner(a);
      if (!b) return null;
      const ka = ctx.keyword(a);
      const kb = ctx.keyword(b, [ka]);
      if (!kb) return null;
      const note = ka
        ? `Mantén la mecánica de ${quote(a.short)}, pero cambia ${ka} por ${kb}, que sale de ${quote(b.short)}.`
        : `Mantén la mecánica de ${quote(a.short)}, pero llévala al terreno de ${kb}, que sale de ${quote(b.short)}.`;
      return { title: `¿Y si ${quote(a.short)} fuera sobre ${quote(kb)}?`, note, sources: [a, b], param: kb };
    },
  },
  {
    id: 'audience',
    label: 'Otro público',
    minIdeas: 1,
    weight: 2,
    make(ctx) {
      const a = ctx.pickOne();
      const audience = pick(ctx.rng, AUDIENCES);
      const note = pick(ctx.rng, [
        `Mismo núcleo, otro público. ¿Qué cambiarías en el lenguaje, el precio o el canal para ${audience}?`,
        `Imagina ${quote(a.short)} diseñada desde cero para ${audience}. ¿Qué sobra y qué falta?`,
      ]);
      return { title: `${quote(a.short)} para ${audience}`, note, sources: [a], param: audience };
    },
  },
  {
    id: 'format',
    label: 'Otro formato',
    minIdeas: 1,
    weight: 2,
    make(ctx) {
      const a = ctx.pickOne();
      const format = ctx.format(a);
      const note = pick(ctx.rng, [
        `Lleva ${quote(a.short)} a otro formato: a veces la misma idea funciona mejor como ${format.name}.`,
        `¿Cómo sería ${quote(a.short)} en forma de ${format.name}? Piensa en la manera más barata de probarlo.`,
      ]);
      return {
        title: `${capitalize(withArticle(format))} ${basedOn(format)} en ${quote(a.short)}`,
        note,
        sources: [a],
        param: format.name,
      };
    },
  },
  {
    id: 'constraint',
    label: 'Reto',
    minIdeas: 1,
    weight: 1,
    make(ctx) {
      const a = ctx.pickOne();
      const constraint = pick(ctx.rng, CONSTRAINTS);
      return {
        title: `${quote(a.short)}, ${constraint}`,
        note: `Ponle un límite fuerte: ¿cómo harías ${quote(a.short)} ${constraint}? Las restricciones obligan a encontrar atajos.`,
        sources: [a],
        param: constraint,
      };
    },
  },
  {
    id: 'reverse',
    label: 'Al revés',
    minIdeas: 1,
    weight: 1,
    make(ctx) {
      const a = ctx.pickOne();
      const note = pick(ctx.rng, [
        'Invierte la premisa: cambia quién da y quién recibe, el orden de los pasos o lo que se considera el problema.',
        `¿Qué pasaría si ${quote(a.short)} hiciera justo lo contrario de lo que se espera?`,
      ]);
      return { title: `${quote(a.short)}, pero al revés`, note, sources: [a], param: 'reverse' };
    },
  },
  {
    id: 'scale',
    label: 'Otra escala',
    minIdeas: 1,
    weight: 1,
    make(ctx) {
      const a = ctx.pickOne();
      const scale = pick(ctx.rng, SCALES);
      return {
        title: `${quote(a.short)} ${scale}`,
        note: `Cambia la escala: ¿qué se rompe y qué se vuelve posible si ${quote(a.short)} fuera ${scale}?`,
        sources: [a],
        param: scale,
      };
    },
  },
  {
    id: 'purpose',
    label: 'Otro propósito',
    minIdeas: 1,
    weight: 1,
    make(ctx) {
      const a = ctx.pickOne();
      const goal = pick(ctx.rng, GOALS);
      return {
        title: `${quote(a.short)} como forma de ${goal}`,
        note: `Busca un segundo propósito: ¿y si ${quote(a.short)} sirviera sobre todo para ${goal}?`,
        sources: [a],
        param: goal,
      };
    },
  },
  {
    id: 'theme',
    label: 'Tema recurrente',
    minIdeas: 2,
    weight: 2,
    make(ctx) {
      const top = ctx.themes.slice(0, 6);
      if (!top.length) return null;
      const first = pick(ctx.rng, top);
      const others = top.filter((t) => t !== first);
      const second = others.length && ctx.rng() < 0.6 ? pick(ctx.rng, others) : null;
      const ids = [...new Set([...first.ideaIds, ...(second ? second.ideaIds : [])])].slice(0, 3);
      const sources = ids.map((id) => ctx.byId.get(id)).filter(Boolean);
      const format = ctx.format(...sources);
      const topic = second ? joinWithAnd([quote(first.word), quote(second.word)]) : quote(first.word);
      const counts = second
        ? `${capitalize(first.word)} aparece en ${first.count} de tus ideas y ${second.word} en ${second.count}.`
        : `${capitalize(first.word)} aparece en ${first.count} de tus ideas.`;
      return {
        title: `${capitalize(withArticle(format))} sobre ${topic}`,
        note: `${counts} Es un tema tuyo: dale un proyecto propio.`,
        sources,
        param: `${first.word}|${second?.word ?? ''}|${format.name}`,
      };
    },
  },
  {
    id: 'triple',
    label: 'Mezcla de tres',
    minIdeas: 3,
    weight: 1,
    make(ctx) {
      const a = ctx.pickOne();
      const b = a && ctx.pickPartner(a);
      const c = b && ctx.pickPartner(a, [b]);
      if (!c) return null;
      const ka = ctx.keyword(a);
      const kb = ctx.keyword(b, [ka]);
      const kc = ctx.keyword(c, [ka, kb]);
      if (!ka || !kb || !kc) return null;
      const format = ctx.format(a, b, c);
      return {
        title: `${capitalize(withArticle(format))} que combine ${joinWithAnd([ka, kb, kc])}`,
        note: `Junta piezas de ${quote(a.short)}, ${quote(b.short)} y ${quote(c.short)}. Quédate solo con lo que encaje.`,
        sources: [a, b, c],
        param: format.name,
      };
    },
  },
];

/**
 * Propone `count` ideas nuevas a partir de `ideas`.
 * `exclude` son claves de propuestas ya mostradas, para no repetirlas mientras
 * haya alternativas. Cada propuesta indica la técnica y las ideas de origen.
 */
export function generateLocal(ideas, { count = DEFAULT_COUNT, seed = Date.now(), exclude = [] } = {}) {
  const usable = ideas.filter((idea) => idea && idea.id && tidy(idea.title));
  if (!usable.length) return [];

  const rng = createRng(seed);
  const ctx = createContext(usable, rng);
  const excluded = new Set(exclude);
  const techniques = TECHNIQUES.filter((t) => usable.length >= t.minIdeas);
  const takenTitles = new Set(usable.map((idea) => normalize(tidy(idea.title))));
  const takenKeys = new Set();
  const perTechnique = new Map();
  const maxPerTechnique = Math.max(1, Math.ceil(count / 3));
  const maxAttempts = count * 40;
  const proposals = [];

  for (let attempt = 0; proposals.length < count && attempt < maxAttempts; attempt += 1) {
    // Si ya se agotaron las combinaciones nuevas, se aceptan algunas ya vistas.
    const allowSeen = attempt >= count * 25;
    const open = techniques.filter((t) => (perTechnique.get(t.id) ?? 0) < maxPerTechnique);
    const technique = weightedPick(rng, open.length ? open : techniques,
      (t) => t.weight / (1 + (perTechnique.get(t.id) ?? 0)));
    const made = technique.make(ctx);
    if (!made || !made.sources.length) continue;

    const sources = made.sources.map((p) => p.id);
    const key = `${technique.id}|${[...sources].sort().join('+')}|${made.param}`;
    if (takenKeys.has(key) || (!allowSeen && excluded.has(key))) continue;
    const titleKey = normalize(made.title);
    if (takenTitles.has(titleKey)) continue;

    takenKeys.add(key);
    takenTitles.add(titleKey);
    perTechnique.set(technique.id, (perTechnique.get(technique.id) ?? 0) + 1);
    for (const id of sources) ctx.usage.set(id, (ctx.usage.get(id) ?? 0) + 1);
    proposals.push({
      title: made.title,
      note: made.note,
      technique: technique.label,
      sources,
      engine: 'local',
      key,
    });
  }
  return proposals;
}
