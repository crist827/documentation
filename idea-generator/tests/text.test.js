import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  capitalize,
  contentWords,
  extractHashtags,
  ideaKeywords,
  normalize,
  parseTags,
  recurringThemes,
  shortTitle,
  stemKey,
} from '../js/text.js';

test('normalize quita tildes y mayúsculas', () => {
  assert.equal(normalize('Canción ÁRBOL Pingüino'), 'cancion arbol pinguino');
});

test('capitalize respeta los signos de apertura', () => {
  assert.equal(capitalize('¿y si…?'), '¿Y si…?');
  assert.equal(capitalize('«hola»'), '«Hola»');
  assert.equal(capitalize(''), '');
});

test('extractHashtags separa las etiquetas del texto', () => {
  assert.deepEqual(extractHashtags('Huerto en la azotea #Barrio #plantas #barrio'), {
    text: 'Huerto en la azotea',
    tags: ['barrio', 'plantas'],
  });
  assert.deepEqual(extractHashtags('#idea sin texto'), { text: 'sin texto', tags: ['idea'] });
  assert.deepEqual(extractHashtags('Precio 100#no'), { text: 'Precio 100#no', tags: [] });
});

test('parseTags admite comas, espacios y almohadillas', () => {
  assert.deepEqual(parseTags('#cocina, barrio  vida-sana #Cocina'), ['cocina', 'barrio', 'vida-sana']);
  assert.deepEqual(parseTags(''), []);
});

test('shortTitle recorta sin dejar preposiciones colgando', () => {
  assert.equal(shortTitle('Taller de cocina con las recetas de la abuela'), 'Taller de cocina con las recetas…');
  assert.equal(shortTitle('Idea corta.'), 'Idea corta');
  assert.equal(shortTitle('Pódcast sobre inventos olvidados'), 'Pódcast sobre inventos olvidados');
});

test('contentWords descarta palabras vacías y verbos y marca adjetivos', () => {
  const words = contentWords('App para intercambiar libros entre vecinos del huerto urbano');
  assert.deepEqual(words.map((w) => w.word), ['libros', 'vecinos', 'huerto', 'urbano']);
  assert.deepEqual(words.map((w) => w.follower), [false, false, false, true]);
  // Los préstamos en -er no se toman por verbos.
  assert.deepEqual(contentWords('Newsletter para influencer').map((w) => w.word), ['newsletter', 'influencer']);
});

test('ideaKeywords prioriza el tema y deja al final la palabra de formato', () => {
  assert.deepEqual(
    ideaKeywords({ title: 'Taller de cocina con las recetas de la abuela', tags: ['familia'] }),
    ['cocina', 'recetas', 'abuela', 'familia', 'taller'],
  );
  assert.deepEqual(ideaKeywords({ title: 'Algo para todos' }), []);
});

test('stemKey agrupa singular y plural', () => {
  assert.equal(stemKey('ciudades'), stemKey('ciudad'));
  assert.equal(stemKey('libros'), stemKey('libro'));
  assert.equal(stemKey('calles'), stemKey('calle'));
  assert.equal(stemKey('flores'), stemKey('flor'));
});

test('recurringThemes cuenta temas repetidos y omite formatos', () => {
  const themes = recurringThemes([
    { id: 'a', title: 'Taller de huertos en el barrio', tags: [] },
    { id: 'b', title: 'Taller de cocina', tags: ['barrio'] },
    { id: 'c', title: 'Un huerto en casa', tags: [] },
  ]);
  assert.deepEqual(themes.map((t) => [t.word, t.count]), [['barrio', 2], ['huertos', 2]]);
  assert.deepEqual(themes[0].ideaIds, ['a', 'b']);
});
