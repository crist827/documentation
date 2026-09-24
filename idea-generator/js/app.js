// Controlador de la interfaz: estado, pintado y eventos.

import { generateWithApiKey, generateWithSample } from './ai.js';
import { EXAMPLE_IDEAS } from './examples.js';
import { DEFAULT_COUNT, MIN_IDEAS, generateLocal } from './generator.js';
import { mergeImported, nextSeq, parseBackup, sanitizeIdea, serializeBackup, uid } from './store.js';
import { extractHashtags, normalize, parseTags, shortTitle, tidy } from './text.js';

const MAX_SEEN_KEYS = 400;
const MAX_RECENT_TITLES = 40;
const SLOW_AFTER_MS = 15000;

const $ = (selector) => document.querySelector(selector);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const seqLabel = (idea) => `Nº ${String(idea.seq || 0).padStart(3, '0')}`;

const dayFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const yearFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const format = date.getFullYear() === new Date().getFullYear() ? dayFormat : yearFormat;
  return format.format(date).replace('.', '');
}

function cleanNote(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const sortIdeas = (ideas) => [...ideas].sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);

/** Preferencias de este dispositivo. El almacenamiento puede fallar (modo privado): nunca es crítico. */
const prefs = {
  get(key) {
    try { return localStorage.getItem(`ideario.${key}`); } catch { return null; }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(`ideario.${key}`);
      else localStorage.setItem(`ideario.${key}`, value);
    } catch { /* sin almacenamiento local: se pierde la preferencia */ }
  },
};

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg>';
const SPARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3.5 12.9 9l5.6 1.8-5.6 1.9L11 18.2l-1.9-5.5-5.6-1.9L9.1 9Z"/><path d="m18.5 15 .7 1.9 1.9.6-1.9.7-.7 1.9-.6-1.9-1.9-.7 1.9-.6Z"/></svg>';

export function createApp({ claude = null } = {}) {
  const state = {
    ready: false,
    ideas: [],
    filter: 'all',
    query: '',
    proposals: [],
    batch: null,
    seenKeys: [],
    recentTitles: [],
    mode: prefs.get('mode') === 'local' ? 'local' : 'ai',
    generating: false,
    slow: false,
    genError: '',
    aiChecked: !claude,
    editingId: null,
    dealing: false,
    justKept: null,
  };
  const env = { store: null, sample: null, abort: null, installEvent: null };
  let toastTimer = 0;
  let toastHandler = null;
  let wipeArmedUntil = 0;
  let slowTimer = 0;

  const ideaMap = () => new Map(state.ideas.map((idea) => [idea.id, idea]));
  const isKept = (proposal, map = ideaMap()) => Boolean(proposal.keptId && map.has(proposal.keptId));
  const pendingProposals = () => {
    const map = ideaMap();
    return state.proposals.filter((p) => !isKept(p, map));
  };

  // ---------------------------------------------------------------- IA

  function aiStatus() {
    if (claude) {
      if (env.sample) return 'ready';
      return state.aiChecked ? 'unavailable' : 'checking';
    }
    return prefs.get('apiKey') ? 'ready' : 'needs-key';
  }

  const effectiveMode = () => (state.mode === 'ai' && aiStatus() === 'ready' ? 'ai' : 'local');

  // ---------------------------------------------------------------- Pintado

  function renderCounts() {
    const counts = {
      all: state.ideas.length,
      mine: state.ideas.filter((idea) => idea.origin !== 'chosen').length,
      chosen: state.ideas.filter((idea) => idea.origin === 'chosen').length,
      fav: state.ideas.filter((idea) => idea.favorite).length,
    };
    $('#count-stamp').textContent = plural(counts.all, 'ficha', 'fichas');
    for (const el of document.querySelectorAll('[data-count]')) el.textContent = counts[el.dataset.count];
    for (const chip of document.querySelectorAll('[data-filter]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
    }
  }

  function visibleIdeas() {
    let list = state.ideas;
    if (state.filter === 'mine') list = list.filter((idea) => idea.origin !== 'chosen');
    else if (state.filter === 'chosen') list = list.filter((idea) => idea.origin === 'chosen');
    else if (state.filter === 'fav') list = list.filter((idea) => idea.favorite);
    const query = normalize(tidy(state.query));
    if (query) {
      list = list.filter((idea) => normalize(`${idea.title} ${idea.note} ${idea.tags.join(' ')}`).includes(query));
    }
    return list;
  }

  function ideaCard(idea) {
    const chosen = idea.origin === 'chosen';
    const badges = [];
    if (chosen) {
      badges.push(`<span class="badge badge-chosen">Elegida${idea.technique ? ` · ${escapeHtml(idea.technique)}` : ''}</span>`);
    }
    if (idea.example) badges.push('<span class="badge badge-example">Ejemplo</span>');
    const tags = idea.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('');
    const foot = badges.length || tags ? `<span class="idea-foot">${badges.join('')}${tags}</span>` : '';
    const id = escapeHtml(idea.id);
    const label = escapeHtml(shortTitle(idea.title, 6, 40));
    return `<li class="idea${chosen ? ' idea-chosen' : ''}">
      <button type="button" class="idea-body" data-action="edit" data-id="${id}">
        <span class="idea-meta">${seqLabel(idea)} · ${formatDate(idea.createdAt)}</span>
        <span class="idea-title">${escapeHtml(idea.title)}</span>
        ${idea.note ? `<span class="idea-note">${escapeHtml(idea.note)}</span>` : ''}
        ${foot}
      </button>
      <button type="button" class="idea-fav" data-action="fav" data-id="${id}" aria-pressed="${idea.favorite}"
        aria-label="${idea.favorite ? 'Quitar de favoritas' : 'Marcar como favorita'}: ${label}">${STAR}</button>
    </li>`;
  }

  function renderIdeas() {
    const listEl = $('#idea-list');
    const status = $('#list-status');
    const empty = $('#ideas-empty');
    if (!state.ready) {
      status.hidden = false;
      status.textContent = 'Abriendo tu ideario…';
      empty.hidden = true;
      listEl.innerHTML = '';
      return;
    }
    empty.hidden = state.ideas.length > 0;
    const list = visibleIdeas();
    if (!state.ideas.length) {
      status.hidden = true;
    } else if (!list.length) {
      status.hidden = false;
      status.textContent = tidy(state.query)
        ? `Ninguna idea contiene «${tidy(state.query)}».`
        : 'No hay ideas con este filtro todavía.';
    } else {
      status.hidden = true;
    }
    listEl.innerHTML = list.map(ideaCard).join('');
  }

  function modeOption(mode, name, description, checked, extraClass = '') {
    return `<button type="button" role="radio" class="mode-option${extraClass}" data-action="mode" data-mode="${mode}"
      aria-checked="${checked}"><span class="mode-name">${name}</span><span class="mode-desc">${description}</span></button>`;
  }

  function renderGenerator() {
    const el = $('#generator');
    const total = state.ideas.length;
    if (!state.ready) {
      el.innerHTML = '<div class="gen-card"><p class="gen-kicker">Generador</p><p class="gen-text">Abriendo tu ideario…</p></div>';
      return;
    }

    if (total < MIN_IDEAS) {
      const missing = MIN_IDEAS - total;
      const filled = [...state.ideas].sort((a, b) => a.seq - b.seq).slice(0, MIN_IDEAS);
      const slots = Array.from({ length: MIN_IDEAS }, (_, i) => (filled[i]
        ? `<li class="slot is-filled">${seqLabel(filled[i])}</li>`
        : '<li class="slot"><span class="sr-only">Hueco libre</span></li>')).join('');
      el.innerHTML = `<div class="gen-card">
        <p class="gen-kicker">Generador apagado</p>
        <h2 class="gen-title">Te ${missing === 1 ? 'falta' : 'faltan'} ${plural(missing, 'idea', 'ideas')} para encenderlo</h2>
        <p class="gen-text">El generador trabaja con tus propias ideas: las combina, las cruza y las transforma. Necesita al menos ${MIN_IDEAS}.</p>
        <ol class="slots" aria-label="${total} de ${MIN_IDEAS} ideas">${slots}</ol>
        <div class="gen-actions">
          <button type="button" class="btn btn-primary btn-big" disabled>${SPARK}<span>Generar ideas</span></button>
          <button type="button" class="btn btn-quiet" data-action="go-ideas">Anotar ideas</button>
        </div>
      </div>`;
      return;
    }

    const chosen = state.ideas.filter((idea) => idea.origin === 'chosen').length;
    const mine = total - chosen;
    const status = aiStatus();
    const mode = effectiveMode();
    const aiDescriptions = {
      ready: claude ? 'Claude lee tu ideario y propone ideas nuevas' : 'Claude, con tu clave de API',
      checking: 'Comprobando si está disponible…',
      unavailable: 'No disponible en esta vista',
      'needs-key': 'Añade una clave de API en Ajustes',
    };
    const aiClass = status === 'ready' ? '' : ' is-unavailable';
    const pending = pendingProposals().length;

    let action;
    if (state.generating) {
      const reading = mode === 'ai'
        ? (state.slow ? 'Claude sigue pensando; puede tardar hasta un minuto…' : `Claude está leyendo tus ${total} ideas…`)
        : 'Combinando tus ideas…';
      action = `<div class="gen-progress" role="status"><span class="spinner" aria-hidden="true"></span><span>${reading}</span>
        ${mode === 'ai' ? '<button type="button" class="btn btn-quiet" data-action="stop">Detener</button>' : ''}</div>`;
    } else {
      action = `<button type="button" class="btn btn-primary btn-big" data-action="generate">${SPARK}<span>${pending ? 'Generar otras' : 'Generar ideas'}</span></button>`;
    }

    el.innerHTML = `<div class="gen-card is-ready">
      <p class="gen-kicker">Generador listo</p>
      <h2 class="gen-title">${plural(total, 'idea', 'ideas')} en tu ideario</h2>
      <p class="gen-text">${plural(mine, 'tuya', 'tuyas')} y ${plural(chosen, 'elegida', 'elegidas')} de propuestas anteriores. Cuantas más anotes, más variadas serán las propuestas.</p>
      <div class="mode" role="radiogroup" aria-label="Cómo generar">
        ${modeOption('ai', 'Con IA', aiDescriptions[status], mode === 'ai', aiClass)}
        ${modeOption('local', 'Sin conexión', 'Combina tus ideas en el dispositivo', mode === 'local')}
      </div>
      <div class="gen-actions">${action}</div>
      ${state.genError ? `<p class="gen-error" role="alert">${escapeHtml(state.genError)}</p>` : ''}
    </div>`;
  }

  function batchSummary() {
    const batch = state.batch;
    if (!batch) return '';
    const source = batch.engine === 'ai'
      ? (batch.used < batch.total
        ? `Con IA, a partir de tus ${batch.used} ideas favoritas y más recientes`
        : `Con IA, a partir de ${plural(batch.total, 'idea', 'ideas')}`)
      : `Sin conexión, combinando ${plural(batch.total, 'idea', 'ideas')}`;
    const pending = pendingProposals().length;
    return `${source} · ${pending ? `${pending} por revisar` : 'todas revisadas'}`;
  }

  function proposalCard(proposal, map) {
    const kept = isKept(proposal, map);
    const sources = proposal.sources.map((id) => map.get(id)).filter(Boolean);
    const from = sources.length ? `<span>de ${sources.map(seqLabel).join(' + ')}</span>` : '';
    const id = escapeHtml(proposal.id);
    const keptIdea = kept ? map.get(proposal.keptId) : null;
    const actions = kept
      ? `<p class="proposal-kept">${STAR}<span>Guardada como ${seqLabel(keptIdea)}</span></p>
         <button type="button" class="btn btn-quiet btn-small" data-action="unkeep" data-id="${id}">Deshacer</button>`
      : `<button type="button" class="btn btn-primary btn-small" data-action="keep" data-id="${id}">Guardar</button>
         <button type="button" class="btn btn-quiet btn-small" data-action="discard" data-id="${id}">Descartar</button>`;
    const justKept = kept && proposal.id === state.justKept ? ' just-kept' : '';
    return `<li class="proposal${kept ? ' is-kept' : ''}${justKept}">
      <p class="proposal-kicker"><span>${escapeHtml(proposal.technique)}</span>${from}</p>
      <h3 class="proposal-title"><span class="highlight">${escapeHtml(proposal.title)}</span></h3>
      ${proposal.note ? `<p class="proposal-note">${escapeHtml(proposal.note)}</p>` : ''}
      <div class="proposal-actions">${actions}</div>
    </li>`;
  }

  function renderProposals() {
    const section = $('#proposals');
    section.hidden = !state.proposals.length;
    if (!state.proposals.length) return;
    const map = ideaMap();
    $('#proposals-sub').textContent = batchSummary();
    const listEl = $('#proposal-list');
    listEl.classList.toggle('is-dealing', state.dealing);
    listEl.innerHTML = state.proposals.map((p) => proposalCard(p, map)).join('');
    $('#proposals-done').hidden = pendingProposals().length > 0;
  }

  function renderBadge() {
    const badge = $('#tab-badge');
    const pending = pendingProposals().length;
    badge.hidden = !pending;
    badge.textContent = pending ? String(pending) : '';
  }

  function renderDataSettings() {
    const info = {
      claude: 'Tus ideas se guardan en tu cuenta de Claude, en un espacio privado: solo tú las ves, desde cualquier dispositivo en el que abras este enlace.',
      device: 'Tus ideas se guardan en este dispositivo, dentro del navegador. Exporta una copia de vez en cuando por si cambias de móvil o borras los datos del navegador.',
      memory: 'Este navegador no deja guardar datos: tus ideas se perderán al cerrar la página. Exporta una copia antes de salir.',
    };
    $('#storage-info').textContent = env.store ? info[env.store.kind] : 'Abriendo tu ideario…';
    const hasExamples = state.ideas.some((idea) => idea.example);
    $('#examples-btn').hidden = hasExamples;
    $('#remove-examples-btn').hidden = !hasExamples;
    const wipe = $('#wipe-btn');
    wipe.disabled = !state.ideas.length;
    if (Date.now() > wipeArmedUntil) wipe.textContent = 'Borrar todas las ideas';
  }

  function renderAiSettings() {
    const el = $('#ai-settings');
    if (claude) {
      const text = {
        ready: 'La IA usa tu cuenta de Claude: la primera vez que generes te pedirá permiso, y cada tanda de propuestas consume parte de tu uso.',
        checking: 'Comprobando si Claude está disponible…',
        unavailable: 'La IA no está disponible en esta vista. El generador sin conexión funciona igual.',
      }[aiStatus()];
      el.innerHTML = `<p class="panel-text">${text}</p>`;
      return;
    }
    const key = prefs.get('apiKey');
    el.innerHTML = `<form class="key-form" id="key-form" novalidate>
      <p class="panel-text">Con una clave de API de Anthropic, Claude lee tu ideario y propone ideas nuevas.
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Consigue una clave</a>.</p>
      ${key ? `<p class="key-saved">Clave guardada: <code>${escapeHtml(`${key.slice(0, 7)}…${key.slice(-4)}`)}</code></p>` : ''}
      <label class="field-label" for="api-key">${key ? 'Cambiar la clave' : 'Clave de API'}</label>
      <input class="field" id="api-key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="sk-ant-…">
      <div class="row">
        <button type="submit" class="btn btn-primary">Guardar clave</button>
        ${key ? '<button type="button" class="btn btn-quiet" id="remove-key">Quitar clave</button>' : ''}
      </div>
      <p class="panel-note">La clave se guarda solo en este dispositivo. Al generar con IA, tus ideas se envían a la API de Anthropic y el uso se cobra en tu cuenta.</p>
    </form>`;
  }

  function renderAll() {
    renderCounts();
    renderIdeas();
    renderGenerator();
    renderProposals();
    renderBadge();
    renderDataSettings();
  }

  // ---------------------------------------------------------------- Avisos

  function hideToast() {
    const el = $('#toast');
    el.hidden = true;
    toastHandler = null;
  }

  function toast(message, { action = '', onAction = null, timeout = 4000 } = {}) {
    $('#toast-text').textContent = message;
    const button = $('#toast-action');
    button.hidden = !action;
    button.textContent = action;
    toastHandler = onAction;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, timeout);
  }

  function reportSaveError(error) {
    console.error(error);
    const quota = error?.code === 'quota_exceeded';
    toast(quota
      ? 'Tu ideario ha llegado al máximo de fichas. Borra algunas para seguir añadiendo.'
      : 'No se pudo guardar el cambio. Revisa la conexión y vuelve a intentarlo.', { timeout: 6000 });
  }

  // ---------------------------------------------------------------- Persistencia

  async function persistProposals() {
    try {
      await env.store.setMeta('proposals', { items: state.proposals, batch: state.batch });
    } catch (error) {
      console.error(error);
    }
  }

  async function persistHistory() {
    try {
      await env.store.setMeta('history', { keys: state.seenKeys, titles: state.recentTitles });
    } catch (error) {
      console.error(error);
    }
  }

  function setIdeas(ideas) {
    state.ideas = sortIdeas(ideas);
    renderAll();
  }

  async function saveIdeas(ideas) {
    const ids = new Set(ideas.map((idea) => idea.id));
    const previous = state.ideas;
    setIdeas([...ideas, ...state.ideas.filter((idea) => !ids.has(idea.id))]);
    try {
      if (ideas.length === 1) await env.store.putIdea(ideas[0]);
      else await env.store.putIdeas(ideas);
      return true;
    } catch (error) {
      setIdeas(previous);
      reportSaveError(error);
      return false;
    }
  }

  async function removeIdeas(ids) {
    const drop = new Set(ids);
    const removed = state.ideas.filter((idea) => drop.has(idea.id));
    const previous = state.ideas;
    setIdeas(state.ideas.filter((idea) => !drop.has(idea.id)));
    try {
      if (ids.length === 1) await env.store.deleteIdea(ids[0]);
      else await env.store.deleteIdeas(ids);
      return removed;
    } catch (error) {
      setIdeas(previous);
      reportSaveError(error);
      return [];
    }
  }

  function offerUndo(message, removed) {
    if (!removed.length) return;
    toast(message, {
      action: 'Deshacer',
      timeout: 7000,
      onAction: async () => {
        if (await saveIdeas(removed)) toast(removed.length === 1 ? 'Idea recuperada.' : `${removed.length} ideas recuperadas.`);
      },
    });
  }

  // ---------------------------------------------------------------- Ideas

  function newIdea(fields) {
    const now = Date.now();
    return {
      id: uid(),
      seq: nextSeq(state.ideas),
      title: fields.title,
      note: fields.note ?? '',
      tags: fields.tags ?? [],
      origin: fields.origin ?? 'mine',
      technique: fields.technique ?? null,
      sources: fields.sources ?? [],
      engine: fields.engine ?? null,
      favorite: false,
      example: Boolean(fields.example),
      createdAt: now,
      updatedAt: now,
    };
  }

  async function addIdeaFromComposer() {
    const titleInput = $('#idea-title');
    const noteInput = $('#idea-note');
    const fromTitle = extractHashtags(titleInput.value);
    const fromNote = extractHashtags(noteInput.value);
    if (!fromTitle.text || !env.store) return;
    const before = state.ideas.length;
    const idea = newIdea({
      title: fromTitle.text,
      note: cleanNote(noteInput.value.replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '$1')),
      tags: [...new Set([...fromTitle.tags, ...fromNote.tags])],
    });
    titleInput.value = '';
    noteInput.value = '';
    syncComposer();
    if (!(await saveIdeas([idea]))) {
      titleInput.value = fromTitle.text;
      syncComposer();
      return;
    }
    if (!claude) navigator.storage?.persist?.().catch(() => {});
    if (before < MIN_IDEAS && state.ideas.length >= MIN_IDEAS) {
      toast(`Guardada como ${seqLabel(idea)}. ¡Ya tienes ${MIN_IDEAS} ideas: el generador está listo!`, {
        action: 'Generar', timeout: 8000, onAction: () => switchTab('generate'),
      });
    } else {
      toast(`Guardada como ${seqLabel(idea)}.`);
    }
    titleInput.focus();
  }

  function syncComposer() {
    const title = $('#idea-title');
    $('#save-idea').disabled = !env.store || !extractHashtags(title.value).text;
    for (const area of [title, $('#idea-note')]) {
      if (area.offsetParent === null) continue; // oculto: no se puede medir
      area.style.height = 'auto';
      area.style.height = `${Math.min(area.scrollHeight, 280)}px`;
    }
  }

  async function toggleFavorite(id) {
    const idea = state.ideas.find((item) => item.id === id);
    if (!idea) return;
    await saveIdeas([{ ...idea, favorite: !idea.favorite, updatedAt: Date.now() }]);
  }

  async function loadExamples() {
    if (!env.store) return;
    let seq = nextSeq(state.ideas);
    const base = Date.now() - EXAMPLE_IDEAS.length * 60000;
    const ideas = EXAMPLE_IDEAS.map((example, i) => ({
      ...newIdea({ ...example, example: true }),
      seq: seq++,
      createdAt: base + i * 60000,
      updatedAt: base + i * 60000,
    }));
    if (await saveIdeas(ideas)) {
      toast(`Se añadieron ${ideas.length} ideas de ejemplo. Puedes quitarlas desde Ajustes.`, {
        action: 'Generar', timeout: 7000, onAction: () => switchTab('generate'),
      });
    }
  }

  async function removeExamples() {
    const ids = state.ideas.filter((idea) => idea.example).map((idea) => idea.id);
    offerUndo(`Se quitaron ${plural(ids.length, 'idea', 'ideas')} de ejemplo.`, await removeIdeas(ids));
  }

  async function wipeAll() {
    const wipe = $('#wipe-btn');
    if (Date.now() > wipeArmedUntil) {
      wipeArmedUntil = Date.now() + 5000;
      wipe.textContent = `Toca otra vez para borrar ${plural(state.ideas.length, 'idea', 'ideas')}`;
      setTimeout(renderDataSettings, 5100);
      return;
    }
    wipeArmedUntil = 0;
    const removed = await removeIdeas(state.ideas.map((idea) => idea.id));
    offerUndo(`Se borraron ${plural(removed.length, 'idea', 'ideas')}.`, removed);
  }

  // ---------------------------------------------------------------- Edición

  function openEditor(id) {
    const idea = state.ideas.find((item) => item.id === id);
    if (!idea) return;
    state.editingId = id;
    $('#edit-meta').textContent = `${seqLabel(idea)} · ${formatDate(idea.createdAt)}`;
    $('#edit-title').value = idea.title;
    $('#edit-note').value = idea.note;
    $('#edit-tags').value = idea.tags.map((tag) => `#${tag}`).join(' ');
    $('#edit-fav').checked = idea.favorite;
    $('#edit-error').hidden = true;
    $('#edit-title').removeAttribute('aria-invalid');
    const origin = $('#edit-origin');
    if (idea.origin === 'chosen') {
      const map = ideaMap();
      const sources = idea.sources.map((sourceId) => map.get(sourceId)).filter(Boolean).map(seqLabel);
      const engine = idea.engine === 'ai' ? 'la IA' : 'el generador sin conexión';
      origin.textContent = `Propuesta de ${engine}${idea.technique ? ` (${idea.technique})` : ''}`
        + `${sources.length ? `, a partir de ${sources.join(' y ')}` : ''}.`;
      origin.hidden = false;
    } else {
      origin.hidden = true;
    }
    const sheet = $('#edit-sheet');
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else sheet.setAttribute('open', '');
  }

  function closeEditor() {
    const sheet = $('#edit-sheet');
    if (typeof sheet.close === 'function') sheet.close();
    else sheet.removeAttribute('open');
    state.editingId = null;
  }

  async function saveEditor() {
    const idea = state.ideas.find((item) => item.id === state.editingId);
    if (!idea) {
      closeEditor();
      return;
    }
    const fromTitle = extractHashtags($('#edit-title').value);
    const error = $('#edit-error');
    if (!fromTitle.text) {
      error.hidden = false;
      $('#edit-title').setAttribute('aria-invalid', 'true');
      $('#edit-title').focus();
      return;
    }
    const note = cleanNote($('#edit-note').value);
    const tags = [...new Set([...parseTags($('#edit-tags').value), ...fromTitle.tags])].slice(0, 12);
    const changedText = fromTitle.text !== idea.title || note !== idea.note;
    const updated = {
      ...idea,
      title: fromTitle.text,
      note,
      tags,
      favorite: $('#edit-fav').checked,
      example: idea.example && !changedText,
      updatedAt: Date.now(),
    };
    closeEditor();
    if (await saveIdeas([updated])) toast('Cambios guardados.');
  }

  async function deleteFromEditor() {
    const id = state.editingId;
    closeEditor();
    offerUndo('Idea borrada.', await removeIdeas([id]));
  }

  // ---------------------------------------------------------------- Generación

  function rememberShown(proposals) {
    state.seenKeys = [...proposals.map((p) => p.key), ...state.seenKeys].slice(0, MAX_SEEN_KEYS);
    state.recentTitles = [...proposals.map((p) => p.title), ...state.recentTitles].slice(0, MAX_RECENT_TITLES);
  }

  async function generate() {
    if (state.generating || state.ideas.length < MIN_IDEAS) return;
    const mode = effectiveMode();
    state.generating = true;
    state.slow = false;
    state.genError = '';
    renderGenerator();

    try {
      let result;
      if (mode === 'ai') {
        env.abort = new AbortController();
        clearTimeout(slowTimer);
        slowTimer = setTimeout(() => { state.slow = true; renderGenerator(); }, SLOW_AFTER_MS);
        const options = { count: DEFAULT_COUNT, avoid: state.recentTitles, signal: env.abort.signal };
        result = env.sample
          ? await generateWithSample(env.sample, state.ideas, options)
          : await generateWithApiKey(prefs.get('apiKey'), state.ideas, options);
      } else {
        const proposals = generateLocal(state.ideas, { count: DEFAULT_COUNT, seed: Date.now(), exclude: state.seenKeys });
        result = { proposals, used: state.ideas.length, total: state.ideas.length };
      }
      if (!result.proposals.length) {
        state.genError = 'No salió ninguna propuesta nueva. Anota alguna idea más y vuelve a probar.';
        return;
      }
      state.proposals = result.proposals.map((p) => ({ ...p, id: uid(), keptId: null }));
      state.batch = { engine: mode, createdAt: Date.now(), used: result.used, total: result.total };
      rememberShown(state.proposals);
      persistProposals();
      persistHistory();
      // Las tarjetas entran «repartidas» solo al llegar una tanda nueva.
      state.dealing = true;
      setTimeout(() => {
        state.dealing = false;
        $('#proposal-list').classList.remove('is-dealing');
      }, 900);
      requestAnimationFrame(() => {
        const heading = $('#proposals-title');
        heading.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      });
    } catch (error) {
      if (error?.code === 'cancelled') return;
      // Los errores conocidos ya se explican en pantalla; los inesperados, a la consola.
      if (error?.name === 'AiError') console.warn(error.message);
      else console.error(error);
      state.genError = error?.message || 'Algo falló al generar. Vuelve a intentarlo.';
      if (error?.code === 'unavailable') {
        env.sample = null;
        renderAiSettings();
      }
    } finally {
      clearTimeout(slowTimer);
      state.generating = false;
      env.abort = null;
      renderGenerator();
      renderProposals();
      renderBadge();
    }
  }

  function inheritedTags(sourceIds) {
    const map = ideaMap();
    const tags = sourceIds.flatMap((id) => map.get(id)?.tags ?? []);
    return [...new Set(tags)].slice(0, 4);
  }

  async function keepProposal(id) {
    const proposal = state.proposals.find((p) => p.id === id);
    if (!proposal || isKept(proposal)) return;
    const idea = newIdea({
      title: proposal.title,
      note: proposal.note,
      tags: inheritedTags(proposal.sources),
      origin: 'chosen',
      technique: proposal.technique,
      sources: proposal.sources,
      engine: proposal.engine,
    });
    proposal.keptId = idea.id;
    state.justKept = proposal.id;
    setTimeout(() => { if (state.justKept === proposal.id) state.justKept = null; }, 700);
    if (await saveIdeas([idea])) {
      toast(`Guardada en tu ideario como ${seqLabel(idea)}.`);
      persistProposals();
    } else {
      proposal.keptId = null;
      renderProposals();
    }
  }

  async function unkeepProposal(id) {
    const proposal = state.proposals.find((p) => p.id === id);
    if (!proposal?.keptId) return;
    const removed = await removeIdeas([proposal.keptId]);
    if (removed.length) {
      proposal.keptId = null;
      renderProposals();
      renderBadge();
      persistProposals();
    }
  }

  function discardProposal(id) {
    state.proposals = state.proposals.filter((p) => p.id !== id);
    if (!state.proposals.length) state.batch = null;
    renderProposals();
    renderGenerator();
    renderBadge();
    persistProposals();
  }

  function chooseMode(mode) {
    if (mode === 'ai' && aiStatus() === 'needs-key') {
      switchTab('settings');
      $('#api-key')?.focus();
      toast('Añade tu clave de API para generar con IA.');
      return;
    }
    if (mode === 'ai' && aiStatus() === 'checking') {
      toast('Comprobando si Claude está disponible… Prueba de nuevo en un momento.');
      return;
    }
    if (mode === 'ai' && aiStatus() !== 'ready') {
      toast('La IA no está disponible aquí. El generador sin conexión funciona igual.');
      return;
    }
    state.mode = mode;
    state.genError = '';
    prefs.set('mode', mode);
    renderGenerator();
  }

  // ---------------------------------------------------------------- Pestañas

  function switchTab(tab) {
    const views = { ideas: '#view-ideas', generate: '#view-generate', settings: '#view-settings' };
    for (const [name, selector] of Object.entries(views)) $(selector).hidden = name !== tab;
    for (const button of document.querySelectorAll('[data-tab]')) {
      if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------- Copias de seguridad

  function backupName() {
    return `ideario-${new Date().toISOString().slice(0, 10)}.json`;
  }

  async function exportBackup() {
    if (!state.ideas.length) {
      toast('Todavía no hay ideas que exportar.');
      return;
    }
    const json = serializeBackup(state.ideas);
    if (claude) {
      const downloads = await claude.use('downloads').catch(() => null);
      if (downloads) {
        try {
          await downloads.save({ filename: backupName(), data: json });
          toast('Copia de seguridad guardada.');
          return;
        } catch (error) {
          if (error?.code === 'declined') return;
        }
      }
      try {
        await navigator.clipboard.writeText(json);
        toast('Copia copiada al portapapeles: pégala en una nota para guardarla.');
      } catch {
        toast('No se pudo exportar desde esta vista.');
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = backupName();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Copia de seguridad descargada.');
  }

  async function importBackup(file) {
    if (!file || !env.store) return;
    try {
      const imported = parseBackup(await file.text());
      const { added, updated } = mergeImported(state.ideas, imported);
      if (!added.length && !updated.length) {
        toast('Esa copia no tiene ideas nuevas.');
        return;
      }
      if (await saveIdeas([...added, ...updated])) {
        const parts = [];
        if (added.length) parts.push(`${plural(added.length, 'idea nueva', 'ideas nuevas')}`);
        if (updated.length) parts.push(`${plural(updated.length, 'actualizada', 'actualizadas')}`);
        toast(`Importación lista: ${parts.join(' y ')}.`);
      }
    } catch (error) {
      toast(error.message || 'No se pudo leer el archivo.', { timeout: 6000 });
    }
  }

  // ---------------------------------------------------------------- Eventos

  const actions = {
    edit: (el) => openEditor(el.dataset.id),
    fav: (el) => toggleFavorite(el.dataset.id),
    'load-examples': () => loadExamples(),
    'go-ideas': () => { switchTab('ideas'); $('#idea-title').focus(); },
    generate: () => generate(),
    stop: () => env.abort?.abort(),
    mode: (el) => chooseMode(el.dataset.mode),
    keep: (el) => keepProposal(el.dataset.id),
    unkeep: (el) => unkeepProposal(el.dataset.id),
    discard: (el) => discardProposal(el.dataset.id),
  };

  function bindEvents() {
    $('#app').addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        switchTab(tab.dataset.tab);
        return;
      }
      const filter = event.target.closest('[data-filter]');
      if (filter) {
        state.filter = filter.dataset.filter;
        renderCounts();
        renderIdeas();
        return;
      }
      const target = event.target.closest('[data-action]');
      if (target && !target.disabled && actions[target.dataset.action]) actions[target.dataset.action](target);
    });

    const composer = $('#composer');
    composer.addEventListener('submit', (event) => {
      event.preventDefault();
      addIdeaFromComposer();
    });
    composer.addEventListener('input', syncComposer);
    $('#idea-title').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });
    $('#idea-note').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });
    $('#toggle-note').addEventListener('click', (event) => {
      const note = $('#composer-note');
      note.hidden = !note.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!note.hidden));
      event.currentTarget.textContent = note.hidden ? 'Añadir detalle' : 'Quitar detalle';
      if (note.hidden) {
        $('#idea-note').value = '';
      } else {
        syncComposer();
        $('#idea-note').focus();
      }
    });

    $('#search').addEventListener('input', (event) => {
      state.query = event.target.value;
      renderIdeas();
    });

    $('#edit-form').addEventListener('submit', (event) => {
      event.preventDefault();
      saveEditor();
    });
    $('#edit-cancel').addEventListener('click', closeEditor);
    $('#edit-delete').addEventListener('click', deleteFromEditor);
    $('#edit-sheet').addEventListener('close', () => { state.editingId = null; });
    $('#edit-sheet').addEventListener('click', (event) => {
      // Un toque en el fondo oscuro cierra la hoja.
      if (event.target === event.currentTarget) closeEditor();
    });

    $('#toast-action').addEventListener('click', () => {
      const handler = toastHandler;
      hideToast();
      handler?.();
    });

    $('#export-btn').addEventListener('click', exportBackup);
    $('#import-file').addEventListener('change', (event) => {
      importBackup(event.target.files?.[0]);
      event.target.value = '';
    });
    $('#remove-examples-btn').addEventListener('click', removeExamples);
    $('#wipe-btn').addEventListener('click', wipeAll);

    $('#ai-settings').addEventListener('submit', (event) => {
      if (event.target.id !== 'key-form') return;
      event.preventDefault();
      const key = $('#api-key').value.trim();
      if (!key) {
        toast('Pega tu clave de API en el campo.');
        return;
      }
      prefs.set('apiKey', key);
      state.mode = 'ai';
      prefs.set('mode', 'ai');
      renderAiSettings();
      renderGenerator();
      toast('Clave guardada en este dispositivo.');
    });
    $('#ai-settings').addEventListener('click', (event) => {
      if (event.target.id !== 'remove-key') return;
      prefs.set('apiKey', null);
      renderAiSettings();
      renderGenerator();
      toast('Clave eliminada de este dispositivo.');
    });
  }

  function setupInstall() {
    if (claude) return;
    const panel = $('#install-panel');
    panel.hidden = false;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) {
      $('#install-status').textContent = 'Ya estás usando Ideario como app instalada.';
      panel.querySelector('.install-steps').hidden = true;
      return;
    }
    const button = $('#install-btn');
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      env.installEvent = event;
      button.hidden = false;
    });
    button.addEventListener('click', async () => {
      const event = env.installEvent;
      if (!event) return;
      env.installEvent = null;
      button.hidden = true;
      event.prompt();
      await event.userChoice.catch(() => null);
    });
    window.addEventListener('appinstalled', () => {
      button.hidden = true;
      $('#install-status').textContent = 'Ideario está instalada. Ábrela desde la pantalla de inicio.';
    });
  }

  // ---------------------------------------------------------------- Arranque

  async function attachStore(store) {
    env.store = store;
    const [ideas, saved, history] = await Promise.all([
      store.listIdeas().catch(() => []),
      store.getMeta('proposals').catch(() => null),
      store.getMeta('history').catch(() => null),
    ]);
    state.ideas = sortIdeas(ideas.map(sanitizeIdea).filter(Boolean));
    if (Array.isArray(saved?.items)) {
      state.proposals = saved.items.filter((p) => p && p.id && tidy(p.title));
      state.batch = saved.batch ?? null;
    }
    state.seenKeys = Array.isArray(history?.keys) ? history.keys : [];
    state.recentTitles = Array.isArray(history?.titles) ? history.titles : [];
    state.ready = true;
    store.watch(
      (list) => setIdeas(list.map(sanitizeIdea).filter(Boolean)),
      () => toast('Se perdió la conexión con tu ideario. Recarga la página para seguir guardando.', { timeout: 8000 }),
    );
    renderAll();
    syncComposer();
  }

  async function detectAi() {
    if (!claude) return;
    env.sample = await claude.use('sample').catch(() => null);
    state.aiChecked = true;
    renderAiSettings();
    renderGenerator();
  }

  function start() {
    bindEvents();
    setupInstall();
    const initial = { '#generar': 'generate', '#ajustes': 'settings' }[location.hash];
    if (initial) switchTab(initial);
    renderAll();
    renderAiSettings();
    syncComposer();
  }

  return { start, attachStore, detectAi };
}
