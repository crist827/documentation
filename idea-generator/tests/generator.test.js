import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_COUNT, MIN_IDEAS, generateLocal, joinWithAnd } from '../js/generator.js';
import { normalize } from '../js/text.js';

const IDEAS = [
  'Huerto urbano en la azotea del edificio',
  'App para intercambiar libros entre vecinos',
  'Taller de cocina con las recetas de la abuela',
  'Pódcast sobre inventos olvidados',
  'Mapa colaborativo de fuentes de agua potable en la ciudad',
  'Club de caminatas nocturnas para mirar estrellas',
].map((title, i) => ({ id: `i${i + 1}`, title, note: '', tags: i % 2 ? ['barrio'] : [], favorite: false }));

test('el generador se enciende con 5 ideas y da 6 propuestas por tanda', () => {
  assert.equal(MIN_IDEAS, 5);
  assert.equal(DEFAULT_COUNT, 6);
});

test('sin ideas no hay propuestas', () => {
  assert.deepEqual(generateLocal([]), []);
  assert.deepEqual(generateLocal([{ id: 'x', title: '   ' }]), []);
});

test('propuestas completas, distintas y con origen conocido', () => {
  const proposals = generateLocal(IDEAS, { seed: 42 });
  assert.equal(proposals.length, DEFAULT_COUNT);
  const ids = new Set(IDEAS.map((idea) => idea.id));
  const existing = new Set(IDEAS.map((idea) => normalize(idea.title)));
  for (const p of proposals) {
    assert.ok(p.title.length > 5, p.title);
    assert.ok(p.note.length > 10, p.note);
    assert.ok(p.technique);
    assert.equal(p.engine, 'local');
    assert.ok(p.sources.length >= 1 && p.sources.every((id) => ids.has(id)), p.key);
    assert.ok(!existing.has(normalize(p.title)));
  }
  assert.equal(new Set(proposals.map((p) => p.key)).size, proposals.length);
  assert.equal(new Set(proposals.map((p) => normalize(p.title))).size, proposals.length);
});

test('misma semilla, mismas propuestas', () => {
  assert.deepEqual(generateLocal(IDEAS, { seed: 7 }), generateLocal(IDEAS, { seed: 7 }));
  assert.notDeepEqual(generateLocal(IDEAS, { seed: 7 }), generateLocal(IDEAS, { seed: 8 }));
});

test('no repite propuestas ya vistas mientras haya alternativas', () => {
  const seen = [];
  for (let round = 0; round < 5; round += 1) {
    const batch = generateLocal(IDEAS, { seed: 100 + round, exclude: seen });
    assert.equal(batch.length, DEFAULT_COUNT);
    for (const p of batch) assert.ok(!seen.includes(p.key), `repetida: ${p.key}`);
    seen.push(...batch.map((p) => p.key));
  }
});

test('reparte las técnicas dentro de una tanda', () => {
  const proposals = generateLocal(IDEAS, { seed: 3, count: 6 });
  const perTechnique = new Map();
  for (const p of proposals) perTechnique.set(p.technique, (perTechnique.get(p.technique) ?? 0) + 1);
  assert.ok(Math.max(...perTechnique.values()) <= 2);
});

test('no propone el mismo formato que ya tiene la idea', () => {
  const ideas = [{ id: 'm', title: 'Mapa de fuentes de agua', note: '', tags: [] }];
  for (let seed = 1; seed <= 60; seed += 1) {
    for (const p of generateLocal(ideas, { seed, count: 6 })) {
      assert.ok(!p.title.startsWith('Un mapa colaborativo basado en'), p.title);
    }
  }
});

test('funciona con ideas sin palabras clave', () => {
  const ideas = ['Algo para todos', 'Otra cosa más', 'Lo mismo pero mejor', 'Una idea nueva', 'Para ellos'].map(
    (title, i) => ({ id: `z${i}`, title, note: '', tags: [] }),
  );
  const proposals = generateLocal(ideas, { seed: 5 });
  assert.equal(proposals.length, DEFAULT_COUNT);
});

test('joinWithAnd usa «e» ante sonido /i/', () => {
  assert.equal(joinWithAnd(['agua', 'inventos']), 'agua e inventos');
  assert.equal(joinWithAnd(['padres', 'hijos']), 'padres e hijos');
  assert.equal(joinWithAnd(['nieve', 'hielo']), 'nieve y hielo');
  assert.equal(joinWithAnd(['huerto', 'libros', 'cocina']), 'huerto, libros y cocina');
  assert.equal(joinWithAnd(['solo']), 'solo');
});
