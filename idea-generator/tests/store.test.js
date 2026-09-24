import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ClaudeDbStore,
  MemoryStore,
  mergeImported,
  nextSeq,
  parseBackup,
  sanitizeIdea,
  serializeBackup,
} from '../js/store.js';

test('sanitizeIdea valida y completa los campos', () => {
  assert.equal(sanitizeIdea(null), null);
  assert.equal(sanitizeIdea({ title: '   ' }), null);
  const idea = sanitizeIdea({ id: 'con espacios/no', title: '  Hola   mundo ', tags: ['#A', 'b c'], origin: 'raro', seq: 2.7, sources: ['ok', 'mal/id', 5] });
  assert.notEqual(idea.id, 'con espacios/no');
  assert.equal(idea.title, 'Hola mundo');
  assert.deepEqual(idea.tags, ['a', 'b', 'c']);
  assert.equal(idea.origin, 'mine');
  assert.equal(idea.seq, 2);
  assert.deepEqual(idea.sources, ['ok']);
  assert.equal(idea.favorite, false);
});

test('nextSeq sigue la numeración', () => {
  assert.equal(nextSeq([]), 1);
  assert.equal(nextSeq([{ seq: 3 }, { seq: 9 }, {}]), 10);
});

test('la copia de seguridad va y vuelve', () => {
  const ideas = [sanitizeIdea({ id: 'a', seq: 1, title: 'Uno', createdAt: 1, updatedAt: 1 })];
  const text = serializeBackup(ideas, new Date('2026-01-02T03:04:05Z'));
  assert.match(text, /"app": "ideario"/);
  assert.deepEqual(parseBackup(text), ideas);
  assert.deepEqual(parseBackup(JSON.stringify(ideas)), ideas);
  assert.throws(() => parseBackup('no es json'), /no es JSON válido/);
  assert.throws(() => parseBackup('{"otra":1}'), /no contiene una lista/);
  assert.throws(() => parseBackup('{"ideas":[{"title":""}]}'), /ninguna idea válida/);
});

test('mergeImported añade nuevas, actualiza las más recientes y numera', () => {
  const existing = [
    { id: 'a', seq: 1, title: 'A', updatedAt: 5, createdAt: 1 },
    { id: 'b', seq: 2, title: 'B', updatedAt: 5, createdAt: 2 },
  ];
  const imported = [
    { id: 'a', seq: 7, title: 'A nueva', updatedAt: 9, createdAt: 1 },
    { id: 'b', seq: 2, title: 'B vieja', updatedAt: 1, createdAt: 2 },
    { id: 'c', seq: 1, title: 'C', updatedAt: 1, createdAt: 3 },
  ];
  const { added, updated } = mergeImported(existing, imported);
  assert.deepEqual(added.map((i) => [i.id, i.seq]), [['c', 3]]);
  assert.deepEqual(updated.map((i) => [i.id, i.seq, i.title]), [['a', 1, 'A nueva']]);

  const fresh = mergeImported([], [{ id: 'x', seq: 4, title: 'X', createdAt: 1 }, { id: 'y', seq: 0, title: 'Y', createdAt: 2 }]);
  assert.deepEqual(fresh.added.map((i) => [i.id, i.seq]), [['x', 4], ['y', 5]]);
});

test('MemoryStore guarda copias independientes', async () => {
  const store = new MemoryStore();
  const idea = { id: 'a', title: 'Uno', tags: ['x'] };
  await store.putIdea(idea);
  idea.tags.push('y');
  assert.deepEqual((await store.listIdeas())[0].tags, ['x']);
  await store.setMeta('k', { v: 1 });
  assert.deepEqual(await store.getMeta('k'), { v: 1 });
  await store.deleteIdeas(['a']);
  assert.deepEqual(await store.listIdeas(), []);
});

/** Imitación mínima de la capacidad `db` de claude.ai para probar las rutas y las llamadas. */
function fakeDb({ failFirstWrite = false } = {}) {
  const docs = new Map();
  const log = [];
  let failNext = failFirstWrite;
  const docRef = (path) => ({
    path,
    id: path.split('/').pop(),
    async get() {
      const data = docs.get(path);
      return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data ? Object.freeze({ ...data }) : undefined) };
    },
    async set(data) {
      log.push(['set', path]);
      if (failNext) {
        failNext = false;
        throw { code: 'unavailable', message: 'busy' };
      }
      docs.set(path, JSON.parse(JSON.stringify(data)));
    },
    async delete() {
      log.push(['delete', path]);
      docs.delete(path);
    },
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  const query = (path) => {
    const list = () => [...docs.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
      .map(([key, data]) => ({ id: key.split('/').pop(), exists: true, data: () => Object.freeze({ ...data }) }));
    return {
      orderBy: () => query(path),
      limit: () => query(path),
      async get() {
        const all = list();
        return { docs: all, size: all.length, empty: !all.length };
      },
      onSnapshot(next) {
        next({ docs: list() });
        return () => {};
      },
    };
  };
  const collectionRef = (path) => ({ ...query(path), path, doc: (id) => docRef(`${path}/${id}`) });
  return { db: { doc: docRef, collection: collectionRef }, docs, log };
}

test('ClaudeDbStore guarda en el espacio privado de la persona', async () => {
  const { db, docs, log } = fakeDb();
  const store = new ClaudeDbStore(db, 'u_123');
  await store.putIdea({ id: 'a', title: 'Uno', createdAt: 1 });
  await store.setMeta('history', { keys: ['k'] });
  assert.ok(docs.has('data/users/u_123/ideario/ideas/a'));
  assert.deepEqual(docs.get('data/users/u_123/ideario/meta/history'), { value: { keys: ['k'] } });
  assert.deepEqual((await store.listIdeas()).map((i) => i.id), ['a']);
  assert.deepEqual(await store.getMeta('history'), { keys: ['k'] });
  assert.equal(await store.getMeta('nada'), undefined);

  let seen = null;
  store.watch((ideas) => { seen = ideas; });
  assert.deepEqual(seen.map((i) => i.id), ['a']);

  await store.deleteIdeas(['a']);
  assert.deepEqual(await store.listIdeas(), []);
  assert.deepEqual(log.at(-1), ['delete', 'data/users/u_123/ideario/ideas/a']);
});

test('ClaudeDbStore reintenta una vez si el servicio está ocupado', async () => {
  const { db, docs, log } = fakeDb({ failFirstWrite: true });
  const store = new ClaudeDbStore(db, 'u_1');
  await store.putIdea({ id: 'a', title: 'Uno', createdAt: 1 });
  assert.equal(log.filter(([op]) => op === 'set').length, 2);
  assert.ok(docs.has('data/users/u_1/ideario/ideas/a'));
});
