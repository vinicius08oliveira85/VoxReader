/**
 * app.js — Orquestração: biblioteca, importação, leitor, player e PWA.
 */

import { parseEpub, destroyEpub } from './services/epubParser.js';
import { segmentText } from './services/textCleaner.js';
import {
  listBooks, getBook, putBook, deleteBook, touchBook,
  saveChapterText, loadChapterText,
  getSettings, saveSettings, getProgress, saveProgress,
  estimateBookUsage, estimateStorage, requestPersistentStorage,
  getAudioSegment, getAudioManifest, getListenStats,
} from './services/storage.js';
import { EDGE_VOICES, fetchEdgeVoices, probeEdgeTTS, resetEdgeProbe, getContextPreset, synthesize, setProxyUrl } from './services/ttsEngine.js';
import { Player } from './services/player.js';
import {
  $, $$, esc, fmtTime, bookCard, emptyLibrary, renderReader, updateReaderHighlight,
  chapterSelect, playerBar, toast, storagePanel, bindSettings, voicePickerModal,
  libraryToolbar, actionToast,
} from './services/ui.js';

const state = {
  settings: await getSettings(),
  books: [],
  current: null,          // { meta, chapterIdx, record }
  player: new Player(),
  installEvent: null,
  edgeStatus: 'checking', // checking | ok | fail
};

const chapterSegments = (rec) => rec.segments?.length ? rec.segments : segmentText(rec.text);

/* ------------------------------ Bootstrap ------------------------------ */

async function main() {
  applyTheme(state.settings.theme);
  renderShell();
  bindGlobalEvents();
  // onSettingsSaved: o player só lê prosody/gap no load do capítulo, então uma
  // mudança nas Configurações precisa ser empurrada para a instância viva.
  bindSettings({
    onSettingsSaved: ({ paragraphGap, autonextDelayMs }) => {
      state.player.paragraphGapMs = paragraphGap;
      if (autonextDelayMs != null) state.settings.autonextDelayMs = autonextDelayMs;
    },
  });
  registerSW();
  await refreshLibrary();
  restoreLastBook();
  setupInstallPrompt();
  updateEdgeBadge();
  requestPersistentStorage();
  setupFileHandling();
  restoreSessionKey();
}

/** File Handling API: "Abrir com VoxReader" no SO + Share Target no Android. */
function setupFileHandling() {
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = [];
      for (const handle of params.files) {
        try { if ((await handle.getFile()).name.toLowerCase().endsWith('.epub')) files.push(await handle.getFile()); } catch { /* ignora */ }
      }
      if (files.length) { showLibrary(); importFiles(files); }
    });
  }
}

/**
 * Parâmetros de entrada: atalhos do manifest (?screen=library|import) e
 * Share Target (?share=<id>, redirection de um POST multipart).
 * Sem isso, os dois atalhos do manifest abriam a biblioteca e o arquivo
 * compartilhado do Android era silenciosamente descartado.
 */
async function setupShareTarget() {
  const params = new URLSearchParams(location.search);

  const shareId = params.get('share');
  if (shareId) {
    // Limpa a URL primeiro: evita re-importar ao recarregar a página.
    history.replaceState(null, '', location.pathname);
    try {
      const res = await fetch(`/share/${encodeURIComponent(shareId)}`);
      if (!res.ok) {
        toast(res.status === 410 ? 'Compartilhamento expirou — envie o arquivo de novo' : 'Não foi possível baixar o arquivo compartilhado', 'warn');
        return;
      }
      const blob = await res.blob();
      showLibrary();
      await importFiles([new File([blob], 'compartilhado.epub', { type: 'application/epub+zip' })]);
      // Descarta o temporário do servidor assim que o import termina.
      fetch(`/share/${encodeURIComponent(shareId)}`, { method: 'DELETE' }).catch(() => {});
    } catch (e) {
      console.error(e);
      toast('Falha ao importar o arquivo compartilhado', 'err');
    }
    return;
  }

  const screen = params.get('screen');
  if (screen === 'library') {
    showLibrary();
  } else if (screen === 'import') {
    showLibrary();
    $('#file-input').click();
  }
  if (params.get('source') === 'pwa') history.replaceState(null, '', location.pathname);
}

/** Chave Gemini "somente nesta sessão" (settings.rememberKey desligado). */
function restoreSessionKey() {
  try {
    const s = sessionStorage.getItem('vox-gemini-key');
    if (s && !state.settings.geminiKey) state.settings.geminiKey = s;
  } catch { /* noop */ }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Aviso de nova versão com botão "Recarregar"
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          actionToast('Nova versão disponível', 'Recarregar', () => location.reload());
        }
      });
    });
  }).catch(() => {});
}

/* ------------------------------ Shell / tema ------------------------------ */

function renderShell() {
  $('#app').innerHTML = `
  <header class="sticky top-0 z-30 border-b border-slate-700/60 bg-slate-900/80 backdrop-blur">
    <div class="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
      <button id="nav-home" class="flex items-center gap-2 font-black text-lg tracking-tight text-slate-100">
        <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
          <svg class="w-4.5 h-4.5 w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M4 13a8 8 0 0116 0M8 17v-3a4 4 0 018 0v3M5 21v-4m14 4v-4"/></svg>
        </span>
        VoxReader
      </button>
      <span id="edge-badge" class="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400" title="Status do motor de voz neural">● verificando…</span>
      <div class="flex-1"></div>
      <button id="btn-import" class="hidden sm:flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 4v12m0-12L8 8m4-4l4 4M4 20h16"/></svg>
        Importar
      </button>
      <button id="btn-install" class="hidden items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/25">Instalar app</button>
      <button id="btn-theme" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="Alternar tema">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M20.5 14.5A8.5 8.5 0 009.5 3.5a8.5 8.5 0 1011 11z"/></svg>
      </button>
      <button id="btn-settings-open" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="Configurações">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path stroke-linecap="round" d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06A1.7 1.7 0 0015 19.4a1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.51 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 9c.28.62.87 1 1.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.51 1z"/></svg>
      </button>
    </div>
  </header>

  <main id="screen-library" class="max-w-6xl mx-auto px-4 py-8 pb-28">
    <div class="flex items-end justify-between mb-4">
      <div>
        <h1 class="text-2xl font-black text-slate-100">Sua Biblioteca</h1>
        <p class="text-sm text-slate-400 mt-1">Leia e ouça seus e-Pubs — tudo fica no seu dispositivo.</p>
      </div>
      <span id="lib-count" class="text-xs text-slate-500"></span>
    </div>
    <div id="lib-toolbar"></div>
    <div id="lib-grid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4"></div>
  </main>

  <section id="screen-reader" class="hidden max-w-6xl mx-auto px-4 py-6 pb-32">
    <div class="grid lg:grid-cols-[1fr_300px] gap-6">
      <div>
        <div class="flex items-center gap-3 mb-4">
          <button id="rd-back" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="Voltar à biblioteca">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div class="min-w-0 flex-1">
            <h2 id="rd-title" class="font-bold text-slate-100 truncate">—</h2>
            <p id="rd-meta" class="text-xs text-slate-400 truncate">—</p>
          </div>
          <div class="flex items-center gap-1 rounded-lg bg-slate-800 border border-slate-700 px-1" title="Fonte do leitor">
            <button id="font-serif" class="px-2 py-1.5 rounded text-slate-300 hover:text-white text-sm" title="Fonte serifada (Georgia)" style="font-family:Georgia,serif">Aa</button>
            <button id="font-sans" class="px-2 py-1.5 rounded text-slate-300 hover:text-white text-sm" title="Fonte sem serifa (system-ui)" style="font-family:system-ui,sans-serif">Aa</button>
            <span class="w-px h-4 bg-slate-600"></span>
            <button id="font-dec" class="px-2 py-1.5 text-slate-300 hover:text-white text-xs font-bold">A−</button>
            <span id="font-val" class="text-[11px] text-slate-400 tabular-nums w-8 text-center">17</span>
            <button id="font-inc" class="px-2 py-1.5 text-slate-300 hover:text-white text-sm font-bold">A+</button>
          </div>
          <select id="rd-chapter" class="max-w-52 rounded-lg bg-slate-800 border border-slate-600 text-sm text-slate-200 px-2 py-1.5"></select>
        </div>
        <article id="reader-content" class="rounded-2xl bg-slate-900/60 border border-slate-700/60 p-4 sm:p-8 space-y-1 text-[1.05rem] leading-relaxed font-serif max-h-[68vh] overflow-y-auto scroll-smooth"></article>
      </div>
      <aside id="rd-sidebar" class="hidden lg:flex flex-col gap-4"></aside>
    </div>
  </section>

  <div id="player-holder" class="hidden">${playerBar(state.settings.rate)}</div>

  <input id="file-input" type="file" accept=".epub,application/epub+zip" class="hidden" multiple>`;

  $('#player-holder').classList.remove('hidden');
  $('#playerbar').classList.add('translate-y-full', 'opacity-0', 'transition-all', 'duration-300');
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
}

/* ------------------------------ Biblioteca ------------------------------ */

let libSearch = '', libSort = 'recent';

async function refreshLibrary() {
  state.books = await listBooks();
  const grid = $('#lib-grid');
  const stats = await getListenStats();
  $('#lib-count').textContent = state.books.length ? `${state.books.length} livro(s)` : '';
  // Barra de busca/ordenação (apenas com livros)
  const toolbar = $('#lib-toolbar');
  if (state.books.length) {
    toolbar.innerHTML = libraryToolbar(state.books.length, stats);
    $('#lib-search').value = libSearch;
    $('#lib-sort').value = libSort;
    $('#lib-search').addEventListener('input', (e) => { libSearch = e.target.value; renderFilteredGrid(); });
    $('#lib-sort').addEventListener('change', (e) => { libSort = e.target.value; renderFilteredGrid(); });
  } else toolbar.innerHTML = '';
  renderFilteredGrid();
}

async function renderFilteredGrid() {
  const grid = $('#lib-grid');
  grid.innerHTML = '';
  let books = state.books;
  if (libSearch) {
    const q = libSearch.toLowerCase();
    books = books.filter((b) => (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q));
  }
  const sorters = {
    recent: (a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    author: (a, b) => (a.author || '').localeCompare(b.author || ''),
    progress: (a, b) => (b.chaptersDone || 0) - (a.chaptersDone || 0),
  };
  const sorted = [...books].sort(sorters[libSort] || sorters.recent);
  if (!sorted.length) {
    // Biblioteca realmente vazia vs. busca sem resultado são mensagens diferentes:
    // a primeira precisa oferecer a ação de importar.
    grid.innerHTML = state.books.length
      ? '<p class="col-span-full text-center text-slate-500 py-12">Nenhum livro encontrado para a busca.</p>'
      : emptyLibrary();
    $('#btn-browse')?.addEventListener('click', () => $('#file-input').click());
    return;
  }
  for (const b of sorted) {
    const [usage, progress] = await Promise.all([estimateBookUsage(b.id), getProgress(b.id)]);
    const holder = document.createElement('div');
    holder.innerHTML = bookCard(b, usage, progress);
    grid.appendChild(holder.firstElementChild);
  }
}

/* ------------------------------ Importação ------------------------------ */

async function importFiles(files) {
  let lastImportedId = null;
  for (const file of files) {
    if (!/\.epub$/i.test(file.name)) { toast(`"${file.name}" não é um .epub`, 'warn'); continue; }
    toast('Processando livro…', 'info');
    try {
      const parsed = await parseEpub(file);
      const id = await sha1Short(`${file.name}:${file.size}:${file.lastModified}`);
      const settings = state.settings;
      for (const ch of parsed.chapters) {
        await saveChapterText(id, ch.index, {
          title: ch.title,
          text: ch.text,
          segments: segmentText(ch.text),
          geminiUsed: false,
        });
      }
      let coverData = null;
      if (parsed.cover) {
        try { coverData = await blobToDataURL(parsed.cover); } catch { coverData = null; }
      }
      await putBook({
        id,
        title: parsed.meta.title,
        author: parsed.meta.author,
        language: parsed.meta.language,
        cover: coverData,
        chapterCount: parsed.chapters.length,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
      });
      destroyEpub(parsed);
      lastImportedId = id;
      toast(`"${parsed.meta.title}" importado — ${parsed.chapters.length} capítulos`, 'ok');
    } catch (e) {
      console.error(e);
      toast(`Falha ao processar "${file.name}"`, 'err');
    }
  }
  await refreshLibrary();
  if (lastImportedId) openBook(lastImportedId, 0);
}

async function sha1Short(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const blobToDataURL = (b) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b);
});

/* ------------------------------ Leitor ------------------------------ */

async function openBook(bookId, chapterIdx = 0, andPlay = false) {
  const meta = await getBook(bookId);
  if (!meta) return;
  await touchBook(bookId);
  state.current = { meta, chapterIdx, record: null, _titles: null };

  // Auto-avanço: ao terminar o último segmento, passa para o próximo capítulo
  state.player.onChapterEnd = async () => {
    const c = state.current;
    if (!c || c.chapterIdx + 1 >= c.meta.chapterCount) {
      toast('Fim do livro 🎉', 'ok');
      return;
    }
    toast(`Próximo capítulo: ${(c._titles || [])[c.chapterIdx + 1] || ''}`, 'info');
    await loadChapter(c.chapterIdx + 1, true);
    playCurrent();
  };

  $('#screen-library').classList.add('hidden');
  $('#screen-reader').classList.remove('hidden');
  $('#rd-title').textContent = meta.title;
  $('#rd-meta').textContent = `${meta.author} · ${meta.chapterCount} capítulos`;

  await loadChapter(chapterIdx, andPlay);
  if (andPlay) playCurrent();
}

async function loadChapter(chapterIdx, andPlay = false) {
  const cur = state.current;
  if (!cur) return;
  cur.chapterIdx = chapterIdx;

  let record = await loadChapterText(cur.meta.id, chapterIdx);
  if (!record) { toast('Capítulo não encontrado', 'err'); return; }

  // Se o usuário habilitou Gemini depois da importação, re-prepara uma vez
  const settings = state.settings;
  if (settings.useGemini && settings.geminiKey && !record.geminiUsed) {
    toast('Preparando texto com Gemini…');
    const { prepareSegments } = await import('./services/textCleaner.js');
    const { text, segments } = await prepareSegments(record.text, {
      title: record.title, geminiKey: settings.geminiKey, useGemini: true,
    });
    record = { ...record, text, segments, geminiUsed: true };
    await saveChapterText(cur.meta.id, chapterIdx, record);
  }

  cur.record = record;
  const segments = chapterSegments(record);

  $('#rd-chapter').innerHTML = chapterSelect(
    Array.from({ length: cur.meta.chapterCount }, (_, i) => ({ index: i, title: `Cap. ${i + 1}` })),
    chapterIdx
  );
  // Títulos dos capítulos (cache por livro — evita reler o IndexedDB a cada troca)
  if (!cur._titles?.length) {
    const titles = [];
    for (let i = 0; i < cur.meta.chapterCount; i++) {
      const r = await loadChapterText(cur.meta.id, i);
      titles.push(r?.title || `Capítulo ${i + 1}`);
    }
    cur._titles = titles;
  }
  const allTitles = cur._titles.map((t, i) => ({ index: i, title: t }));
  $('#rd-chapter').innerHTML = chapterSelect(allTitles, chapterIdx);

  const voiceId = state.settings.voice;
  const { hasCache } = await state.player.load(cur.meta.id, chapterIdx, segments, voiceId, state.settings.voiceContext);
  // Preferências de reprodução por sessão
  state.player.pronunciation = parsePronunciationDict(state.settings.pronunciation);
  state.player.paragraphGapMs = Number(state.settings.paragraphGap) || 0;
  void hasCache;

  renderReader(segments, -1, null);
  renderSidebar();
  state.player.setMediaMetadata({ title: cur.meta.title, chapter: record.title });

  $('#pb-title').textContent = cur.meta.title;
  $('#pb-chapter').textContent = record.title;

  // Restaura progresso salvo (sem autoplay)
  if (!andPlay) {
    const p = await getProgress(cur.meta.id);
    if (p && p.chapter === chapterIdx && p.segment > 0) {
      state.player.seekSegment(Math.min(p.segment, segments.length - 1), chapterIdx);
    }
  }
  updateProgressBar(0, 0);
}

function renderSidebar() {
  const cur = state.current;
  if (!cur) return;
  const holder = $('#rd-sidebar');
  Promise.all([estimateBookUsage(cur.meta.id), estimateStorage(), getListenStats(cur.meta.id)]).then(([usage, est, stats]) => {
    const bookDl = state.bookDl && state.bookDl.id === cur.meta.id
      ? { done: state.bookDl.done, total: state.bookDl.total, active: state.bookDl.active } : null;
    holder.innerHTML = `
        <nav class="rounded-2xl bg-slate-800/60 border border-slate-700/60 p-2 max-h-72 overflow-y-auto">
          <div class="sticky top-0 bg-slate-800/95 backdrop-blur px-1 pb-1.5">
            <input id="toc-filter" type="search" placeholder="Filtrar ${cur.meta.chapterCount} capítulos…" class="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-400 focus:outline-none">
          </div>
          <div id="toc-list">
          ${Array.from({ length: cur.meta.chapterCount }, (_, i) => i).map((i) => `
            <button class="toc-item w-full text-left text-sm px-2.5 py-1.5 rounded-lg truncate ${i === cur.chapterIdx ? 'bg-indigo-500/20 text-indigo-200 font-semibold' : 'text-slate-300 hover:bg-slate-700/60'}" data-toc="${i}" data-title="${esc((cur['_titles']?.[i] || `capítulo ${i + 1}`).toLowerCase())}">
              ${i + 1}. ${esc(cur['_titles']?.[i] || `Capítulo ${i + 1}`)}
            </button>`).join('')}
          </div>
        </nav>
        ${storagePanel(cur.meta, usage, est, bookDl, stats)}`;
    $$('.toc-item', holder).forEach((btn) =>
      btn.addEventListener('click', () => loadChapter(Number(btn.dataset.toc), state.player.playing)));
    // Filtro do TOC
    $('#toc-filter', holder)?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$('.toc-item', holder).forEach((btn) => {
        btn.classList.toggle('hidden', !!q && !btn.dataset.title.includes(q));
      });
    });
    bindStoragePanelActions(cur);
  });
  fillSidebarTitles();
}

async function fillSidebarTitles() {
  const cur = state.current;
  if (!cur || cur._titles?.length) return; // já carregado (cache por livro)
  const titles = [];
  for (let i = 0; i < cur.meta.chapterCount; i++) {
    const r = await loadChapterText(cur.meta.id, i);
    titles.push(r?.title || `Capítulo ${i + 1}`);
  }
  cur['_titles'] = titles;
  $$('#rd-sidebar .toc-item').forEach((btn) => {
    const i = Number(btn.dataset.toc);
    if (titles[i]) btn.textContent = `${i + 1}. ${titles[i]}`;
  });
}

async function refreshStoragePanel() {
  const cur = state.current;
  if (!cur) return;
  const [usage, est, stats] = await Promise.all([
    estimateBookUsage(cur.meta.id), estimateStorage(), getListenStats(cur.meta.id),
  ]);
  const bookDl = state.bookDl && state.bookDl.id === cur.meta.id
    ? { done: state.bookDl.done, total: state.bookDl.total, active: state.bookDl.active } : null;
  const holder = document.createElement('div');
  holder.innerHTML = storagePanel(cur.meta, usage, est, bookDl, stats);
  const old = $('#rd-sidebar > div:last-child');
  if (old) old.replaceWith(holder.firstElementChild);
  bindStoragePanelActions(cur);
}

function bindStoragePanelActions(cur) {
  $('#st-refresh')?.addEventListener('click', refreshStoragePanel);
  $('#st-delete-audio')?.addEventListener('click', async () => {
    const { deleteChapterAudio } = await import('./services/storage.js');
    for (let i = 0; i < cur.meta.chapterCount; i++) await deleteChapterAudio(cur.meta.id, i, p.voiceKey);
    toast('Áudio em cache apagado', 'ok');
    refreshStoragePanel();
  });
  $('#st-export-mp3')?.addEventListener('click', () => exportChapterMp3(cur));
}

/** Concatena os segmentos MP3 do capítulo em um único arquivo e dispara o download. */
async function exportChapterMp3(cur) {
  toast('Montando MP3 do capítulo…');
  try {
    const voiceKey = state.player.voiceKey;
    const manifest = await getAudioManifest(cur.meta.id, cur.chapterIdx, voiceKey);
    if (!manifest) { toast('Gere o áudio do capítulo primeiro (botão ⬇ no player)', 'warn'); return; }
    const chunks = [];
    let missing = 0;
    for (let i = 0; i < manifest.segments.length; i++) {
      const blob = await getAudioSegment(cur.meta.id, cur.chapterIdx, voiceKey, i);
      if (blob) chunks.push(blob);
      else missing++;
    }
    if (!chunks.length) { toast('Nenhum áudio em cache para este capítulo', 'warn'); return; }
    const merged = new Blob(chunks, { type: 'audio/mpeg' }); // MP3 (CBR) é concatenável
    const url = URL.createObjectURL(merged);
    const a = document.createElement('a');
    const safeTitle = (cur.record?.title || `capitulo-${cur.chapterIdx + 1}`).replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
    a.href = url;
    a.download = `${safeTitle}.mp3`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(missing ? `MP3 exportado (${missing} trechos faltando)` : 'MP3 exportado ✓', missing ? 'warn' : 'ok');
  } catch (e) {
    console.error(e);
    toast('Falha ao exportar MP3', 'err');
  }
}

/* ------------------------------ Player wiring ------------------------------ */

function playCurrent() {
  const cur = state.current;
  if (!cur) return;
  state.player.play(cur.chapterIdx).catch((e) => {
    console.error(e);
    toast('Não foi possível gerar a voz agora (offline?)', 'err');
  });
  if (state.settings.autoCacheNext) cacheNextChapter(cur.chapterIdx);
}

/**
 * Pré-cacheia o capítulo seguinte em um Player separado (autoCacheNext).
 * A opção existia em Configurações mas nada a lia — o usuário descobria a
 * falta de cache só quando o capítulo seguinte começava a sintetizar.
 * Silencioso: falha aqui nunca pode interromper a reprodução atual.
 */
let nextCacheInFlight = 0;
async function cacheNextChapter(chapterIdx) {
  const c = cur();
  if (!c) return;
  const next = chapterIdx + 1;
  if (next >= c.meta.chapterCount || nextCacheInFlight) return;
  const rec = await loadChapterText(c.meta.id, next);
  if (!rec?.segments?.length && !rec?.text) return;
  nextCacheInFlight = next;
  const worker = new Player();
  try {
    worker.voiceKey = state.player.voiceKey;
    worker.voiceId = state.player.voiceId;
    worker.rate = state.player.rate;
    worker.bookId = c.meta.id;
    worker.currentChapter = next;
    worker.segments = rec.segments?.length ? rec.segments : segmentText(rec.text);
    await worker.cacheWholeChapter(next);
    if (state.current?.chapterIdx !== next) refreshStoragePanel();
  } catch (e) {
    console.warn('autoCacheNext falhou:', e);
  } finally {
    nextCacheInFlight = 0;
  }
}

function updateProgressBar(elapsed, total) {
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  $('#pb-progress').style.width = `${pct}%`;
  $('#pb-time').textContent = total > 0 ? `${fmtTime(elapsed)} / ${fmtTime(total)}` : fmtTime(elapsed);
}

/**
 * Reposiciona a barra ao trocar de segmento.
 * Antes era chamado com updateProgressBar(0, 0), o que zerava a barra a cada
 * trecho e só se recuperava no próximo evento 'time' — piscava para 0.
 * Agora soma as durações já Reproduzidas no capítulo.
 */
function syncProgressToSegment(idx) {
  const p = state.player;
  const segs = p.manifest?.segments || [];
  let elapsed = 0;
  for (let i = 0; i < idx; i++) elapsed += segs[i] || 0;
  const bookTotal = segs.reduce((a, b) => a + (b || 0), 0);
  updateProgressBar(elapsed, bookTotal);
}

function bindPlayer() {
  const p = state.player;

  $('#pb-play').addEventListener('click', () => {
    if (!state.current) { toast('Abra um livro primeiro', 'warn'); return; }
    p.toggle(cur().chapterIdx);
  });
  $('#pb-back').addEventListener('click', () => p.skip(-10, cur()?.chapterIdx ?? 0));
  $('#pb-fwd').addEventListener('click', () => p.skip(10, cur()?.chapterIdx ?? 0));
  $('#pb-prev-ch').addEventListener('click', () => stepChapter(-1));
  $('#pb-next-ch').addEventListener('click', () => stepChapter(1));

  // Restaura a velocidade salva (o seletor já vem com ela selecionado via playerBar).
p.setRate(state.settings.rate);

$('#pb-rate').addEventListener('change', async (e) => {
    const rate = Number(e.target.value);
    p.setRate(rate);
    state.settings = await saveSettings({ rate });
  });

  $('#pb-voice-open').addEventListener('click', () => openVoiceModal());

  $('#pb-cache').addEventListener('click', async () => {
    const c = cur(); if (!c) return;
    toast('Baixando capítulo (voz neural)…');
    try {
      await p.cacheWholeChapter(c.chapterIdx, {
        onProgress: (done, total) => { $('#pb-cache').title = `Cacheando ${done}/${total}`; },
      });
      toast('Capítulo salvo para ouvir offline ✓', 'ok');
      refreshStoragePanel();
    } catch (e) {
      toast('Falha ao baixar capítulo', 'err');
      console.error(e);
    }
  });

  // Sleep timer
  $('#pb-sleep').addEventListener('change', (e) => {
    const mode = e.target.value;
    p.setSleep(mode);
    toast(mode ? (mode === 'chapter' ? '🌙 Pausa ao fim do capítulo' : `🌙 Sleep timer: ${mode} min`) : '🌙 Sleep timer desativado');
  });
  p.on('sleep-end', () => refreshStoragePanel());

  // Baixar o livro inteiro (fila retomável, só o que falta)
  $('#pb-book-dl').addEventListener('click', async () => {
    const c = cur(); if (!c || state.bookDl?.active) return;
    state.bookDl = { id: c.meta.id, active: true, done: 0, total: c.meta.chapterCount };
    toast('Baixando livro inteiro em segundo plano…');
    const p2 = state.player;
    for (let ch = 0; ch < c.meta.chapterCount; ch++) {
      if (!state.bookDl?.active) break; // cancelado (troca de livro/stop)
      state.bookDl.done = ch;
      try {
        if (ch !== c.chapterIdx) {
          const rec = await loadChapterText(c.meta.id, ch);
          if (!rec) continue;
          // cacheWholeChapter lê/mexe manifest e currentTiming; salvar e restaurar
          // todos esses campos evita misturar o estado do capítulo em cache com o
          // que está tocando (a barra de progresso e o highlight ficariam errados).
          const saved = {
            segments: p2.segments,
            currentChapter: p2.currentChapter,
            manifest: p2.manifest,
            currentTiming: p2.currentTiming,
          };
          try {
            p2.segments = rec.segments?.length ? rec.segments : segmentText(rec.text);
            p2.currentChapter = ch;
            await p2.cacheWholeChapter(ch);
          } finally {
            Object.assign(p2, saved);
          }
        } else {
          await p2.cacheWholeChapter(ch);
        }
      } catch { /* segue para o próximo capítulo */ }
      refreshStoragePanel();
    }
    state.bookDl.active = false;
    toast(state.bookDl.done >= c.meta.chapterCount ? 'Livro inteiro salvo ✓ (offline)' : 'Download do livro interrompido', 'ok');
    refreshStoragePanel();
  });

  // cliques nos parágrafos → pular para o trecho
  $('#reader-content').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    p.seekSegment(Number(seg.dataset.seg), cur().chapterIdx);
    if (!p.playing) playCurrent();
  });

  // eventos do player
  p.on('segment', ({ idx, total, text }) => {
    renderReader(chapterSegments(cur()?.record) || [], idx, null);
    void text; void total;
    saveProgressThrottled(cur()?.meta?.id, cur()?.chapterIdx ?? 0, idx);
    syncProgressToSegment(idx);
    // Media Session: metadados do livro/capítulo na tela de bloqueio
    const c = cur();
    if (c) p.setMediaMetadata({ title: c.meta.title, chapter: c.record?.title });
  });

  p.on('word', ({ idx, charIndex, len }) => {
    const segs = chapterSegments(cur()?.record) || [];
    updateReaderHighlight(segs, idx, { charIndex, len });
  });

  p.on('time', ({ elapsed, bookTotal }) => updateProgressBar(elapsed, bookTotal));

  p.on('state', (s) => {
    const busy = s === 'synthesizing' || s === 'loading';
    $('#pb-icon-play').classList.toggle('hidden', s === 'playing' || busy);
    $('#pb-icon-pause').classList.toggle('hidden', s !== 'playing');
    $('#pb-icon-spin').classList.toggle('hidden', !busy);
    $('#pb-play').disabled = busy;
    if (s === 'synthesizing') $('#pb-time').textContent = 'gerando voz…';
  });

  p.on('error', (e) => {
    console.warn('player error', e);
    if (String(e).includes('EDGE_UNAVAILABLE')) {
      toast('Voz neural indisponível — usando voz do sistema', 'warn');
      updateEdgeBadge(true);
    }
  });
}

function cur() { return state.current; }

let progressTimer = null;
function saveProgressThrottled(bookId, chapter, segment) {
  if (!bookId) return;
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => saveProgress(bookId, { chapter, segment }), 800);
}

function stepChapter(delta) {
  const c = cur(); if (!c) return;
  const next = c.chapterIdx + delta;
  if (next < 0 || next >= c.meta.chapterCount) { toast(delta > 0 ? 'Fim do livro' : 'Início do livro'); return; }
  loadChapter(next, state.player.playing).then(() => { if (state.player.playing) playCurrent(); });
}

/* ------------------------------ Vozes / status ------------------------------ */

async function populateVoices() {
  let voices = await fetchEdgeVoices();
  if (!voices.some((v) => v.id === state.settings.voice)) {
    voices = [...voices, { id: state.settings.voice, name: state.settings.voice, locale: '—', gender: 'F', age: 'adult', tags: [] }];
  }
  state.voices = voices;
  updateVoiceLabel();
}

function updateVoiceLabel() {
  const v = state.voices?.find((x) => x.id === state.settings.voice);
  const ctx = getContextPreset(state.settings.voiceContext);
  $('#pb-voice-name').textContent = v ? `${ctx.emoji} ${v.name}` : 'Voz';
  $('#pb-voice-open').title = `Voz: ${v?.name || '—'} · ${ctx.label}`;
}

/** Modal de voz: contexto (Melhor para) + idade + gênero + prévia. */
function openVoiceModal() {
  if (!state.voices?.length) { toast('Carregando vozes…'); return; }
  const holder = document.createElement('div');
  holder.innerHTML = voicePickerModal(state.voices, state.settings.voice, state.settings.voiceContext);
  document.body.appendChild(holder);

  let selVoice = state.settings.voice;
  let selCtx = state.settings.voiceContext;
  const filters = { age: '', gender: '' };

  const refresh = () => {
    $$('#vp-contexts .ctx-chip', holder).forEach((b) => {
      const on = b.dataset.ctx === selCtx;
      b.className = `ctx-chip px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? 'bg-indigo-500 border-indigo-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-indigo-400'}`;
    });
    $$('#vp-list .voice-item', holder).forEach((item) => {
      const v = state.voices.find((x) => x.id === item.dataset.voice);
      const visible = (!filters.age || v.age === filters.age) && (!filters.gender || v.gender === filters.gender);
      item.classList.toggle('hidden', !visible);
    });
  };

  $$('#vp-contexts .ctx-chip', holder).forEach((b) => b.addEventListener('click', () => { selCtx = b.dataset.ctx; refresh(); }));
  $('#vp-age', holder).addEventListener('change', (e) => { filters.age = e.target.value; refresh(); });
  $('#vp-gender', holder).addEventListener('change', (e) => { filters.gender = e.target.value; refresh(); });
  $$('#vp-list .preview-btn', holder).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const voiceId = b.dataset.preview;
    b.textContent = '⏳ …';
    try {
      const ctx = getContextPreset(selCtx);
      const { blob } = await synthesize('Olá! Esta é a minha voz. Vou narrar a sua história.', {
        voice: voiceId, ratePct: ctx.ratePct, pitchHz: ctx.pitchHz,
      });
      const a = new Audio(URL.createObjectURL(blob));
      a.play();
      b.textContent = '▶ prévia';
    } catch {
      toast('Prévia indisponível agora', 'warn');
      b.textContent = '▶ prévia';
    }
  }));
  $$('#vp-list .voice-item', holder).forEach((item) => item.addEventListener('click', () => {
    selVoice = item.dataset.voice;
    $$('#vp-list .voice-item', holder).forEach((x) => x.className = x.className.replace('bg-indigo-500/15 border-indigo-400/60', 'bg-slate-800/50 border-slate-700/60 hover:border-indigo-400/40'));
    item.className = item.className.replace('bg-slate-800/50 border-slate-700/60 hover:border-indigo-400/40', 'bg-indigo-500/15 border-indigo-400/60');
  }));

  const close = () => holder.remove();
  $$('[data-close]', holder).forEach((b) => b.addEventListener('click', close));
  $('#vp-apply', holder).addEventListener('click', async () => {
    close();
    const changedVoice = selVoice !== state.settings.voice;
    const changedCtx = selCtx !== state.settings.voiceContext;
    state.settings = await saveSettings({ voice: selVoice, voiceContext: selCtx });
    updateVoiceLabel();
    if (changedVoice) { resetEdgeProbe(); updateEdgeBadge(); }
    if ((changedVoice || changedCtx) && cur()?.record) {
      const wasPlaying = state.player.playing;
      await state.player.load(cur().meta.id, cur().chapterIdx, chapterSegments(cur().record), selVoice, selCtx);
      if (wasPlaying) playCurrent();
      toast(`Voz: ${state.voices.find((v) => v.id === selVoice)?.name || selVoice} · ${getContextPreset(selCtx).label}`, 'ok');
      refreshStoragePanel();
    }
  });
}

async function updateEdgeBadge(forceFail = false) {
  const badge = $('#edge-badge');
  if (forceFail) { state.edgeStatus = 'fail'; }
  if (state.edgeStatus === 'checking') {
    const ok = await probeEdgeTTS().catch(() => false);
    state.edgeStatus = ok ? 'ok' : 'fail';
  }
  const map = {
    ok: ['bg-emerald-500/10 border-emerald-500/30 text-emerald-300', '● voz neural online'],
    fail: ['bg-amber-500/10 border-amber-500/30 text-amber-300', '● modo offline (voz do sistema)'],
    checking: ['bg-slate-800 border-slate-700 text-slate-400', '● verificando…'],
  };
  const [cls, label] = map[state.edgeStatus];
  badge.className = `hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border ${cls}`;
  badge.textContent = label;
}

/* ------------------------------ Eventos globais ------------------------------ */

function bindGlobalEvents() {
  bindPlayer();
  populateVoices();
  if (state.settings.proxyUrl) setProxyUrl(state.settings.proxyUrl);

  $('#nav-home').addEventListener('click', showLibrary);
  $('#rd-back').addEventListener('click', showLibrary);
  setupShareTarget(); // atalhos do manifest (?share=, ?screen=) — antes de qualquer render
  $('#btn-import').addEventListener('click', () => $('#file-input').click());
  $('#rd-chapter').addEventListener('change', (e) => loadChapter(Number(e.target.value), state.player.playing));

  $('#btn-theme').addEventListener('click', async () => {
    const next = state.settings.theme === 'light' ? 'dark' : 'light';
    state.settings = await saveSettings({ theme: next });
    applyTheme(next);
  });

  $('#file-input').addEventListener('change', (e) => {
    importFiles([...e.target.files]);
    e.target.value = '';
  });

  // Tipografia do leitor (tamanho + família)
  let fontSizeNow = state.settings.fontSize;
  const applyFontSize = async (px) => {
    const size = Math.min(26, Math.max(13, Math.round(px)));
    fontSizeNow = size;
    $('#reader-content').style.fontSize = `${size}px`;
    $('#font-val').textContent = size;
    state.settings = await saveSettings({ fontSize: size });
  };
  const applyFontFamily = async (fam) => {
    $('#reader-content').classList.toggle('font-serif', fam === 'serif');
    $('#reader-content').classList.toggle('font-sans', fam === 'sans');
    $('#font-serif').classList.toggle('text-indigo-400', fam === 'serif');
    $('#font-sans').classList.toggle('text-indigo-400', fam === 'sans');
    state.settings = await saveSettings({ fontFamily: fam });
  };
  $('#reader-content').style.fontSize = `${state.settings.fontSize}px`;
  $('#font-val').textContent = state.settings.fontSize;
  applyFontFamily(state.settings.fontFamily || 'serif');
  $('#font-dec').addEventListener('click', () => applyFontSize(fontSizeNow - 1));
  $('#font-inc').addEventListener('click', () => applyFontSize(fontSizeNow + 1));
  $('#font-serif').addEventListener('click', () => applyFontFamily('serif')); 
  $('#font-sans').addEventListener('click', () => applyFontFamily('sans'));

  // drag & drop global
  const dropOverlay = document.createElement('div');
  dropOverlay.className = 'fixed inset-0 z-[60] hidden items-center justify-center bg-indigo-950/80 backdrop-blur-sm border-4 border-dashed border-indigo-400';
  dropOverlay.innerHTML = '<p class="text-2xl font-black text-indigo-100">Solte o arquivo .epub para importar</p>';
  document.body.appendChild(dropOverlay);
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropOverlay.classList.replace('hidden', 'flex'); });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.replace('flex', 'hidden'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0; dropOverlay.classList.replace('flex', 'hidden');
    if (e.dataTransfer?.files?.length) importFiles([...e.dataTransfer.files]);
  });

  // deletar livro (delegação na grade)
  $('#lib-grid').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      if (confirm('Remover este livro e todo o áudio em cache?')) {
        await deleteBook(id);
        if (cur()?.meta?.id === id) { state.player.stop(); showLibrary(); }
        await refreshLibrary();
        toast('Livro removido', 'ok');
      }
      return;
    }
    const play = e.target.closest('.play-btn');
    const card = e.target.closest('[data-book]');
    if (card && play) {
      // "Continuar" retoma do progresso salvo; "↺" começa do início
      const fromStart = play.dataset.resume === '0';
      const prog = await getProgress(card.dataset.book);
      const startChapter = (!fromStart && prog?.chapter > 0) ? prog.chapter : 0;
      openBook(card.dataset.book, startChapter, true);
    } else if (card) {
      openBook(card.dataset.book, 0, false);
    }
  });

  // atalhos de teclado
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); $('#pb-play').click(); }
    if (e.code === 'ArrowLeft') p_skip(-10);
    if (e.code === 'ArrowRight') p_skip(10);
  });
  function p_skip(s) { const c = cur(); if (c) state.player.skip(s, c.chapterIdx); }

  // online/offline
  window.addEventListener('offline', () => toast('Você está offline — cache disponível', 'warn'));
  window.addEventListener('online', () => { toast('Conexão restabelecida', 'ok'); resetEdgeProbe(); updateEdgeBadge(); });
}

function showLibrary() {
  state.player.stop();
  $('#screen-reader').classList.add('hidden');
  $('#screen-library').classList.remove('hidden');
  refreshLibrary();
}

async function restoreLastBook() {
  const books = await listBooks();
  if (books.length && books[0].lastOpenedAt) {
    // apenas prepara a biblioteca; abertura é manual
  }
}

/* ------------------------------ PWA install ------------------------------ */

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installEvent = e;
    const btn = $('#btn-install');
    btn.classList.remove('hidden');
    btn.classList.add('flex');
    btn.onclick = async () => {
      e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') btn.classList.add('hidden');
    };
  });
}

/* ------------------------------ Go ------------------------------ */

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = '<p style="color:#fff;padding:2rem">Erro ao iniciar o app. Veja o console.</p>';
});

// Hook de debug/testes (exposto apenas em runtime local)
window.__vox = { state, importFiles, openBook, refreshLibrary };
