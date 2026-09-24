// Utilidades de texto para español: normalización, #etiquetas y palabras clave.
// Todo es puro (sin DOM) para poder probarlo con `node --test`.

/** Minúsculas y sin tildes: «Canción» -> «cancion». */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

/** Primera letra en mayúscula, respetando «¿» y «¡» iniciales. */
export function capitalize(text) {
  const s = String(text ?? '');
  const i = s.search(/\p{L}/u);
  if (i < 0) return s;
  return s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1);
}

/** Espacios colapsados y recortados. */
export function tidy(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

const HASHTAG = /(^|\s)#([\p{L}\p{N}_-]+)/gu;

/** Convierte una etiqueta escrita por la persona en su forma guardada. */
export function cleanTag(tag) {
  return String(tag ?? '')
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .slice(0, 32);
}

/**
 * Separa las #etiquetas del texto de una idea.
 * «Huerto en la azotea #barrio #plantas» -> { text: 'Huerto en la azotea', tags: ['barrio', 'plantas'] }
 */
export function extractHashtags(input) {
  const tags = [];
  const text = String(input ?? '').replace(HASHTAG, (_, lead, tag) => {
    const clean = cleanTag(tag);
    if (clean && !tags.includes(clean)) tags.push(clean);
    return lead;
  });
  return { text: tidy(text), tags };
}

/** Lee etiquetas escritas como «#cocina, barrio vida-sana». */
export function parseTags(input) {
  const tags = [];
  for (const part of String(input ?? '').split(/[\s,;]+/)) {
    const clean = cleanTag(part);
    if (clean && !tags.includes(clean)) tags.push(clean);
  }
  return tags;
}

/** Recorta un título largo para citarlo dentro de otra frase. */
export function shortTitle(title, maxWords = 7, maxChars = 52) {
  const full = tidy(title).replace(/[.,;:!?…]+$/u, '');
  const words = full.split(' ');
  const kept = [];
  for (const word of words.slice(0, maxWords)) {
    if (kept.length && [...kept, word].join(' ').length > maxChars) break;
    kept.push(word);
  }
  if (kept.length === words.length) return full;
  // Sin «de…», «con las…» colgando al final del recorte.
  while (kept.length > 2 && STOPWORDS.has(normalize(kept[kept.length - 1]))) kept.pop();
  return `${kept.join(' ').replace(/[,;:]+$/u, '')}…`;
}

// Palabras vacías, en forma normalizada (sin tildes).
const STOPWORDS = new Set(`
a al ante bajo con contra de del desde durante en entre hacia hasta mediante para por segun sin so sobre tras via versus
el la lo los las un una unos unas este esta esto estos estas ese esa eso esos esas aquel aquella aquello aquellos aquellas
mi mis tu tus su sus nuestro nuestra nuestros nuestras vuestro vuestra vuestros vuestras cada otro otra otros otras
mismo misma mismos mismas tal tales todo toda todos todas algun alguno alguna algunos algunas ningun ninguno ninguna
varios varias cualquier cualquiera demas cierto cierta ciertos ciertas propio propia propios propias
y e o u ni que pero sino aunque porque pues si como cuando donde mientras cual cuales cuyo cuya quien quienes
yo tu el ella ello nosotros nosotras vosotros vosotras ellos ellas usted ustedes me te se nos os le les mi ti conmigo contigo consigo
no ya muy mas menos tan tanto tambien tampoco solo solamente siempre nunca jamas aqui alli ahi alla aca hoy ayer manana
antes despues luego ahora bien mal asi casi aun todavia quiza quizas acaso incluso ademas apenas mucho mucha muchos muchas
poco poca pocos pocas bastante demasiado etc tipo tipos
es son era eran fue fueron ser sea sean sido siendo estar esta estan estaba estaban estado estoy hay habia haber ha han he hemos
tiene tienen tener tengo tenia hace hacen hacer hago puede pueden poder podria podrian quiero quiere quieren querer
voy va van ir dar da dan ver veo usar usa usan sirve sirven servir crear crea crean
permite permiten ayuda ayudan ayude ayuden conecta conectan reune reunen ofrece ofrecen ensena ensenan muestra muestran
vende venden comparte comparten busca buscan encuentra encuentran organiza organizan recomienda recomiendan gestiona gestionan
combina combinan mezcla mezclan une unen facilita facilitan explica explican guarda guardan envia envian recoge recogen
avisa avisan calcula calculan lleva llevan trae traen convierte convierten transforma transforman genera generan
cosa cosas algo nada idea ideas forma formas manera maneras parte partes vez veces dia dias ano anos
gente persona personas mundo sistema sistemas proyecto proyectos lugar lugares traves gracias lado pesar ejemplo ejemplos
app apps aplicacion aplicaciones web pagina paginas plataforma plataformas servicio servicios herramienta herramientas
producto productos negocio negocios empresa empresas programa programas
nuevo nueva nuevos nuevas mejor mejores gran grande grandes pequeno pequena pequenos pequenas facil dificil
`.split(/\s+/).filter(Boolean));

// Sustantivos frecuentes que acaban en -ar y no son verbos.
const AR_NOUNS = new Set(`
hogar hogares mar bar azar collar militar altar pilar radar nectar azucar dolar familiar escolar solar lunar
popular celular polar particular similar titular auxiliar nuclear par jaguar avatar bazar hangar bienestar malestar
billar telar olivar palmar pinar pulgar palomar ejemplar ambar nenufar azahar charla
`.split(/\s+/).filter(Boolean));

// Verbos frecuentes en -er / -ir. Lo demás que acabe así (póster, influencer…) se trata como sustantivo.
const ER_IR_VERBS = new Set(`
aprender comprender emprender sorprender depender defender entender extender encender vender comer beber leer creer
correr recorrer meter prometer someter ceder conceder proceder suceder perder responder corresponder esconder romper
ofrecer crecer conocer reconocer parecer aparecer desaparecer merecer agradecer favorecer fortalecer establecer pertenecer
nacer hacer deshacer satisfacer tener mantener obtener contener detener sostener entretener poner componer proponer disponer
exponer suponer imponer traer atraer distraer caer ver prever ser saber caber haber poder querer soler doler mover promover
remover volver devolver envolver resolver disolver escoger recoger coger acoger proteger vencer convencer ejercer cocer
escribir vivir compartir recibir decidir descubrir abrir subir cubrir construir destruir incluir reducir producir traducir
conducir dirigir elegir corregir exigir pedir seguir conseguir servir repetir medir vestir sentir dormir morir salir venir
decir ir oir reir reunir unir anadir invertir convertir divertir prevenir intervenir imprimir transmitir permitir admitir
emitir existir insistir asistir resistir consistir distribuir contribuir sustituir prohibir definir dividir cumplir surgir
difundir ocurrir discutir repartir partir impartir huir excluir concluir fluir influir instruir
`.split(/\s+/).filter(Boolean));

const ENCLITIC = /(se|lo|la|los|las|le|les)$/;

function looksLikeVerb(norm) {
  if (AR_NOUNS.has(norm)) return false;
  if (/^.{2,}ar$/.test(norm)) return true;
  if (ER_IR_VERBS.has(norm)) return true;
  const stem = norm.replace(ENCLITIC, '');
  if (stem !== norm && (/^.{2,}ar$/.test(stem) || ER_IR_VERBS.has(stem))) return true;
  return /(ando|iendo|mente)$/.test(norm);
}

/** ¿Sirve esta palabra (normalizada) como tema de una idea? */
export function isContentWord(norm) {
  if (norm.length < 3 || /\d/.test(norm)) return false;
  if (STOPWORDS.has(norm)) return false;
  return !looksLikeVerb(norm);
}

/**
 * Palabras con contenido de un texto, en orden de aparición.
 * `follower` marca las que siguen a otra palabra con contenido: en español
 * suelen ser adjetivos («huerto urbano», «agua potable»), peores como tema.
 */
export function contentWords(text) {
  const words = String(text ?? '').toLowerCase().match(/\p{L}+/gu) ?? [];
  const out = [];
  let previousWasContent = false;
  for (const word of words) {
    const norm = normalize(word);
    const content = isContentWord(norm);
    if (content) out.push({ word, norm, follower: previousWasContent });
    previousWasContent = content;
  }
  return out;
}

/** Clave para agrupar singular y plural: «ciudades» y «ciudad» -> «ciudad». */
export function stemKey(norm) {
  let key = norm.endsWith('s') && norm.length > 3 ? norm.slice(0, -1) : norm;
  if (/[dlnrzj]e$/.test(key) && key.length > 3) key = key.slice(0, -1);
  return key;
}

// Sustantivos que suelen nombrar el formato de una idea («Taller de cocina»,
// «Pódcast sobre…») más que su tema.
const FORMAT_HEADS = new Set(`
app apps taller talleres podcast podcasts club clubes diario diarios mapa mapas curso cursos canal canales tienda tiendas
kit kits evento eventos reto retos ruta rutas newsletter comunidad comunidades blog blogs revista revistas guia guias
feria ferias festival festivales concurso concursos grupo grupos red redes juego juegos serie series video videos
tutorial tutoriales manual manuales catalogo catalogos directorio directorios agenda agendas calendario calendarios
coleccion colecciones boletin boletines libro servicio suscripcion producto
`.split(/\s+/).filter(Boolean));

/** ¿Es una palabra de formato (taller, pódcast, mapa…)? Recibe la forma normalizada. */
export function isFormatWord(norm) {
  return FORMAT_HEADS.has(norm);
}

function tagWords(idea) {
  return (idea.tags ?? []).map((tag) => {
    const word = String(tag).replace(/[-_]+/g, ' ');
    return { word, norm: normalize(word) };
  });
}

/**
 * Palabras clave de una idea, de mejor a peor candidata a «tema»: núcleos del
 * título, etiquetas, adjetivos del título, núcleos del detalle y, al final, la
 * palabra de formato con la que empiece el título.
 */
export function ideaKeywords(idea) {
  const title = contentWords(idea.title);
  const leadingFormat = title.length && isFormatWord(title[0].norm) ? title[0] : null;
  const body = leadingFormat ? title.slice(1) : title;
  const ordered = [
    ...body.filter((k) => !k.follower),
    ...tagWords(idea),
    ...body.filter((k) => k.follower),
    ...contentWords(idea.note).filter((k) => !k.follower),
    ...(leadingFormat ? [leadingFormat] : []),
  ];
  const seen = new Set();
  const out = [];
  for (const k of ordered) {
    const key = stemKey(k.norm);
    if (!k.word || seen.has(key)) continue;
    seen.add(key);
    out.push(k.word);
  }
  return out;
}

/**
 * Temas que se repiten en la colección: palabras (y etiquetas) presentes en
 * al menos `minCount` ideas distintas, ordenadas por frecuencia. Las palabras
 * de formato no cuentan como tema.
 */
export function recurringThemes(ideas, minCount = 2) {
  const byKey = new Map();
  for (const idea of ideas) {
    const counted = new Set();
    const candidates = [
      ...contentWords(idea.title).filter((k) => !k.follower),
      ...contentWords(idea.note).filter((k) => !k.follower),
      ...tagWords(idea),
    ];
    for (const { word, norm } of candidates) {
      const key = stemKey(norm);
      if (counted.has(key) || isFormatWord(norm)) continue;
      counted.add(key);
      const entry = byKey.get(key) ?? { word, count: 0, ideaIds: [] };
      entry.count += 1;
      entry.ideaIds.push(idea.id);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'es'));
}
