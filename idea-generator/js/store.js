// Almacenamiento de las ideas. Tres implementaciones con la misma interfaz:
//  - IdbStore: IndexedDB del navegador (la app instalada en el móvil).
//  - ClaudeDbStore: base de datos privada de la persona cuando la app se abre en claude.ai.
//  - MemoryStore: último recurso si el navegador no deja guardar nada.
//
// Interfaz: listIdeas(), putIdea(idea), putIdeas(ideas), deleteIdea(id), deleteIdeas(ids),
//           getMeta(key), setMeta(key, value), watch(onIdeas, onError) -> unsubscribe, kind.

import { parseTags, tidy } from './text.js';

/** Identificador corto y válido como segmento de ruta. */
export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const ID_PATTERN = /^[A-Za-z0-9_.~:@+-]{1,64}$/;

/** Valida y completa una idea venida de fuera (copias de seguridad, base de datos). */
export function sanitizeIdea(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = tidy(raw.title).slice(0, 280);
  if (!title) return null;
  const now = Date.now();
  const tags = Array.isArray(raw.tags) ? parseTags(raw.tags.join(' ')).slice(0, 12) : [];
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((id) => typeof id === 'string' && ID_PATTERN.test(id)).slice(0, 3)
    : [];
  return {
    id: typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : uid(),
    seq: Number.isFinite(raw.seq) && raw.seq >= 1 ? Math.floor(raw.seq) : 0,
    title,
    note: String(raw.note ?? '').trim().slice(0, 1000),
    tags,
    origin: raw.origin === 'chosen' ? 'chosen' : 'mine',
    technique: raw.technique ? tidy(raw.technique).slice(0, 40) : null,
    sources,
    engine: raw.engine === 'ai' || raw.engine === 'local' ? raw.engine : null,
    favorite: Boolean(raw.favorite),
    example: Boolean(raw.example),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };
}

/** Siguiente número de ficha. */
export function nextSeq(ideas) {
  return ideas.reduce((max, idea) => Math.max(max, idea.seq || 0), 0) + 1;
}

const BACKUP_APP = 'ideario';
const BACKUP_VERSION = 1;

export function serializeBackup(ideas, exportedAt = new Date()) {
  return JSON.stringify({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    ideas,
  }, null, 2);
}

/** Lee una copia de seguridad. Lanza un Error con un mensaje legible si no es válida. */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es una copia de Ideario (no es JSON válido).');
  }
  const list = Array.isArray(data) ? data : data?.ideas;
  if (!Array.isArray(list)) throw new Error('El archivo no contiene una lista de ideas.');
  const ideas = list.map(sanitizeIdea).filter(Boolean);
  if (!ideas.length && list.length) throw new Error('No se encontró ninguna idea válida en el archivo.');
  return ideas;
}

/**
 * Mezcla ideas importadas con las existentes: añade las nuevas, actualiza las
 * que tengan una versión más reciente y numera las nuevas detrás de las actuales
 * (o conserva su número si el ideario está vacío).
 */
export function mergeImported(existing, imported) {
  const byId = new Map(existing.map((idea) => [idea.id, idea]));
  const added = [];
  const updated = [];
  for (const idea of imported) {
    const current = byId.get(idea.id);
    if (!current) added.push(idea);
    else if ((idea.updatedAt ?? 0) > (current.updatedAt ?? 0)) updated.push({ ...idea, seq: current.seq });
  }
  if (existing.length) {
    let seq = nextSeq(existing);
    added.sort((a, b) => (a.seq || Infinity) - (b.seq || Infinity) || a.createdAt - b.createdAt);
    for (const idea of added) idea.seq = seq++;
  } else {
    let seq = nextSeq(added);
    for (const idea of added) if (!idea.seq) idea.seq = seq++;
  }
  return { added, updated };
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Ejecuta `task` sobre cada elemento con como mucho `limit` tareas a la vez. */
async function inPool(items, limit, task) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

export class MemoryStore {
  kind = 'memory';

  constructor() {
    this.ideas = new Map();
    this.meta = new Map();
  }

  async listIdeas() { return [...this.ideas.values()].map(clone); }
  async putIdea(idea) { this.ideas.set(idea.id, clone(idea)); }
  async putIdeas(ideas) { for (const idea of ideas) this.ideas.set(idea.id, clone(idea)); }
  async deleteIdea(id) { this.ideas.delete(id); }
  async deleteIdeas(ids) { for (const id of ids) this.ideas.delete(id); }
  async getMeta(key) { return clone(this.meta.get(key)); }
  async setMeta(key, value) { this.meta.set(key, clone(value)); }
  watch() { return () => {}; }
}

const DB_NAME = 'ideario';
const DB_VERSION = 1;

export class IdbStore {
  kind = 'device';

  static open(indexedDBImpl = globalThis.indexedDB) {
    return new Promise((resolve, reject) => {
      if (!indexedDBImpl) {
        reject(new Error('IndexedDB no está disponible'));
        return;
      }
      const request = indexedDBImpl.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('ideas')) db.createObjectStore('ideas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(new IdbStore(request.result));
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
    });
  }

  constructor(db) {
    this.db = db;
  }

  /** Abre una transacción y resuelve cuando se ha escrito en disco. */
  run(storeName, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      const request = work(store);
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada'));
    });
  }

  listIdeas() { return this.run('ideas', 'readonly', (store) => store.getAll()); }
  putIdea(idea) { return this.run('ideas', 'readwrite', (store) => store.put(clone(idea))); }
  putIdeas(ideas) {
    return this.run('ideas', 'readwrite', (store) => { for (const idea of ideas) store.put(clone(idea)); });
  }
  deleteIdea(id) { return this.run('ideas', 'readwrite', (store) => store.delete(id)); }
  deleteIdeas(ids) {
    return this.run('ideas', 'readwrite', (store) => { for (const id of ids) store.delete(id); });
  }
  async getMeta(key) {
    const row = await this.run('meta', 'readonly', (store) => store.get(key));
    return row?.value;
  }
  setMeta(key, value) { return this.run('meta', 'readwrite', (store) => store.put({ key, value: clone(value) })); }
  watch() { return () => {}; }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Base de datos de claude.ai (capacidad `db`). Cada persona tiene su subárbol
 * privado `data/users/<id>/`, así que sus ideas solo las ve ella, desde
 * cualquier dispositivo.
 */
export class ClaudeDbStore {
  kind = 'claude';

  constructor(db, userId) {
    const root = db.doc(`data/users/${userId}/ideario`);
    this.ideasRef = root.collection('ideas');
    this.metaRef = root.collection('meta');
    this.chains = new Map();
  }

  /** Una escritura cada vez por documento; reintenta una vez si el servicio está saturado. */
  serial(path, write) {
    const attempt = async () => {
      try {
        return await write();
      } catch (error) {
        if (error?.code !== 'unavailable') throw error;
        await sleep(300 + Math.random() * 500);
        return write();
      }
    };
    const next = (this.chains.get(path) ?? Promise.resolve()).catch(() => {}).then(attempt);
    this.chains.set(path, next);
    return next;
  }

  async listIdeas() {
    const snap = await this.ideasRef.orderBy('createdAt', 'desc').limit(1000).get();
    return snap.docs.map((doc) => clone(doc.data()));
  }

  putIdea(idea) {
    return this.serial(`ideas/${idea.id}`, () => this.ideasRef.doc(idea.id).set(clone(idea)));
  }

  putIdeas(ideas) { return inPool(ideas, 4, (idea) => this.putIdea(idea)); }

  deleteIdea(id) { return this.serial(`ideas/${id}`, () => this.ideasRef.doc(id).delete()); }

  deleteIdeas(ids) { return inPool(ids, 4, (id) => this.deleteIdea(id)); }

  async getMeta(key) {
    const snap = await this.metaRef.doc(key).get();
    return snap.exists ? clone(snap.data().value) : undefined;
  }

  setMeta(key, value) {
    return this.serial(`meta/${key}`, () => this.metaRef.doc(key).set({ value: clone(value) }));
  }

  /** Mantiene la lista sincronizada con otros dispositivos. */
  watch(onIdeas, onError) {
    return this.ideasRef.orderBy('createdAt', 'desc').limit(1000).onSnapshot(
      (snap) => onIdeas(snap.docs.map((doc) => clone(doc.data()))),
      (error) => onError?.(error),
    );
  }
}

async function openClaudeStore(claude) {
  try {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!db || !user) return null;
    const userId = await user.id();
    if (!userId) return null;
    const store = new ClaudeDbStore(db, userId);
    await store.listIdeas(); // comprueba que se puede leer antes de confiar en ella
    return store;
  } catch {
    return null;
  }
}

/**
 * Abre el mejor almacenamiento disponible: la base de datos de claude.ai si la
 * app se abre allí, si no IndexedDB y, como último recurso, memoria.
 */
export async function openStore({ claude = null } = {}) {
  if (claude) {
    const store = await openClaudeStore(claude);
    if (store) return store;
  }
  try {
    return await IdbStore.open();
  } catch {
    return new MemoryStore();
  }
}
