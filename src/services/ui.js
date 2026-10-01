/**
 * ui.js — Renderização de telas (Biblioteca, Leitor, Player, Configurações).
 * UI reativa simples: funções puras que escrevem innerHTML + delegação de eventos.
 */

import { fmtBytes, getSettings, saveSettings, saveProgress } from './storage.js';
import { CONTEXTS, AGE_LABELS, GENDER_LABELS } from './ttsEngine.js';
import { validateGeminiKey } from './textCleaner.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  const mm = m % 60, ss = Math.floor(s % 60);
  return h ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};

/* ------------------------------ Components ------------------------------ */

export function bookCard(b, usage, progress) {
  const pct = b.chapterCount ? Math.round(((progress?.chapter ?? 0) / b.chapterCount) * 100) : 0;
  const resumed = !!progress && (progress.chapter > 0 || progress.segment > 0);
  return `
  <article class="book-card group relative rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/50 overflow-hidden shadow-lg shadow-black/20 transition-all hover:-translate-y-1 cursor-pointer" data-book="${esc(b.id)}">
    <div class="aspect-[2/3] bg-gradient-to-br from-slate-700 to-slate-900 relative overflow-hidden">
      ${b.cover ? `<img src="${b.cover}" alt="" class="w-full h-full object-cover" loading="lazy">`
                 : `<div class="w-full h-full flex items-center justify-center text-5xl font-black text-indigo-400/40">${esc((b.title || '?')[0].toUpperCase())}</div>`}
      ${usage?.segments ? `<span class="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/90 text-white font-semibold shadow" title="Áudio em cache">🔊 ${fmtBytes(usage.bytes)}</span>` : ''}
      ${resumed ? `<span class="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/90 text-white font-semibold shadow">${pct}%</span>` : ''}
      <div class="absolute inset-x-0 bottom-0 h-1 bg-black/40">${resumed ? `<div class="h-full bg-indigo-400" style="width:${pct}%"></div>` : ''}</div>
      <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center gap-2 pb-3">
        <button class="play-btn px-4 py-2 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold flex items-center gap-1.5 shadow-lg" data-book="${esc(b.id)}" data-resume="1">${resumed ? '▶ Continuar' : '▶ Ouvir'}</button>
        ${resumed ? `<button class="play-btn px-3 py-2 rounded-full bg-slate-700/90 hover:bg-slate-600 text-white text-sm font-semibold shadow-lg" data-book="${esc(b.id)}" data-resume="0" title="Começar do início">↺</button>` : ''}
      </div>
    </div>
    <div class="p-3">
      <h3 class="text-sm font-semibold text-slate-100 line-clamp-2 leading-snug">${esc(b.title)}</h3>
      <p class="text-xs text-slate-400 mt-0.5 truncate">${esc(b.author)}</p>
      <div class="flex items-center justify-between mt-2">
        <span class="text-[10px] text-slate-500">${b.chapterCount} capítulos</span>
        <button class="del-book text-slate-500 hover:text-red-400 p-1 rounded transition-colors" data-del="${esc(b.id)}" title="Remover livro">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0l1 13h8l1-13"/></svg>
        </button>
      </div>
    </div>
  </article>`;
}

/** Barra da biblioteca: busca + ordenação + estatísticas globais. */
export function libraryToolbar(count, stats) {
  return `
  <div class="flex flex-wrap items-center gap-2 mb-4">
    <div class="relative flex-1 min-w-48">
      <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path stroke-linecap="round" d="M20 20l-3.5-3.5"/></svg>
      <input id="lib-search" type="search" placeholder="Buscar título ou autor…" class="w-full rounded-xl bg-slate-800 border border-slate-700 pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-400 focus:outline-none">
    </div>
    <select id="lib-sort" class="rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-200 px-3 py-2">
      <option value="recent">Mais recentes</option>
      <option value="title">Título A–Z</option>
      <option value="author">Autor A–Z</option>
      <option value="progress">Progresso</option>
    </select>
    ${stats ? `<span class="text-xs text-slate-400 ml-auto" title="Estatísticas de escuta">🎧 ${stats.listenedMin} min ouvidos · ${stats.chaptersDone} caps. concluídos</span>` : ''}
  </div>`;
}

export function emptyLibrary() {
  return `
  <div class="col-span-full flex flex-col items-center justify-center py-20 text-center" id="dropzone">
    <div class="w-24 h-24 rounded-3xl bg-indigo-500/10 border-2 border-dashed border-indigo-400/40 flex items-center justify-center mb-6">
      <svg class="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V6m0 0l-4 4m4-4l4 4M4 20h16"/></svg>
    </div>
    <h2 class="text-xl font-bold text-slate-100">Arraste seu .epub aqui</h2>
    <p class="text-slate-400 mt-2 max-w-sm">ou</p>
    <button id="btn-browse" class="mt-3 px-6 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all">Selecionar arquivo e-Pub</button>
    <p class="text-xs text-slate-500 mt-6 max-w-xs">Seus livros ficam apenas neste dispositivo. Tudo é processado localmente no navegador.</p>
  </div>`;
}

/* ------------------------------ Reader ------------------------------ */

let _renderedSig = ''; // evita re-render completo quando nada mudou

function segHtml(seg, i, activeSeg, wordHi) {
  let html = esc(seg);
  if (i === activeSeg && wordHi) {
    const { charIndex, len } = wordHi;
    const before = esc(seg.slice(0, charIndex));
    const word = esc(seg.slice(charIndex, charIndex + (len || 1)));
    const after = esc(seg.slice(charIndex + (len || 1)));
    html = `${before}<mark class="bg-indigo-500/30 text-indigo-200 rounded px-0.5">${word}</mark>${after}`;
  }
  const activeCls = i === activeSeg
    ? 'seg active bg-indigo-500/10 border-l-2 border-indigo-400 text-slate-100'
    : 'border-l-2 border-transparent text-slate-300';
  return `<p class="seg px-3 py-2 rounded-r-lg transition-colors ${activeCls}" data-seg="${i}">${html}</p>`;
}

/** Render completo (troca de capítulo). Ignora se nada mudou. */
export function renderReader(segments, activeSeg, wordHi) {
  const el = $('#reader-content');
  if (!el) return;
  const sig = `${segments.length}::${activeSeg}::${wordHi ? wordHi.charIndex : -1}`;
  if (sig === _renderedSig) return;
  _renderedSig = sig;
  el.innerHTML = segments.map((seg, i) => segHtml(seg, i, activeSeg, wordHi)).join('');
  if (activeSeg >= 0) $(`.seg[data-seg="${activeSeg}"]`, el)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** Atualização incremental: só re-renderiza o trecho que mudou de estado. */
export function updateReaderHighlight(segments, activeSeg, wordHi) {
  const el = $('#reader-content');
  if (!el) return;
  const prev = _renderedSig.match(/^\d+::(-?\d+)::(-?\d+)$/);
  const prevSeg = prev ? Number(prev[1]) : -1;
  const prevWord = prev ? Number(prev[2]) : -1;
  const newWord = wordHi ? wordHi.charIndex : -1;
  if (prevSeg === activeSeg && prevWord === newWord) return;
  // Segmento anterior perde o destaque
  if (prevSeg >= 0 && prevSeg !== activeSeg) {
    const old = $(`.seg[data-seg="${prevSeg}"]`, el);
    if (old) old.outerHTML = segHtml(segments[prevSeg], prevSeg, -1, null);
  }
  const active = $(`.seg[data-seg="${activeSeg}"]`, el);
  const html = activeSeg >= 0 ? segHtml(segments[activeSeg], activeSeg, activeSeg, wordHi) : '';
  if (!active && activeSeg >= 0) {
    el.innerHTML = segments.map((seg, i) => segHtml(seg, i, activeSeg, wordHi)).join('');
  } else if (active && active.innerHTML !== html) {
    active.outerHTML = html;
  }
  _renderedSig = `${segments.length}::${activeSeg}::${newWord}`;
  if (activeSeg >= 0) $(`.seg[data-seg="${activeSeg}"]`, el)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function chapterSelect(chapters, current) {
  return chapters.map((c) =>
    `<option value="${c.index}" ${c.index === current ? 'selected' : ''}>${esc(c.title)}</option>`
  ).join('');
}

export function voiceOptions(voices, current) {
  return voices.map((v) =>
    `<option value="${esc(v.id)}" ${v.id === current ? 'selected' : ''}>${esc(v.name)}</option>`
  ).join('');
}

/* ------------------------------ Settings modal ------------------------------ */

export function settingsModal(s) {
  return `
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" id="modal-settings">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" data-close></div>
    <div class="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-5">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold text-slate-100">Configurações</h2>
        <button class="text-slate-400 hover:text-slate-200" data-close>✕</button>
      </div>

      <label class="block">
        <span class="text-sm font-medium text-slate-300">Chave da API Gemini (opcional)</span>
        <input id="set-gemini" type="password" value="${esc(s.geminiKey)}" placeholder="AIza..."
          class="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none">
        <span class="text-xs text-slate-500">Usada para limpar o texto (notas de rodapé, nº de página) antes da narração. Free tier.</span>
      </label>

      <label class="flex items-center justify-between cursor-pointer">
        <div>
          <span class="text-sm font-medium text-slate-300">Lembrar chave neste dispositivo</span>
          <p class="text-xs text-slate-500">Desligado: a chave vale só nesta sessão (mais seguro).</p>
        </div>
        <input id="set-remember-key" type="checkbox" ${s.rememberKey ? 'checked' : ''} class="w-5 h-5 accent-indigo-500">
      </label>

      <div class="rounded-xl border border-slate-700 p-3">
        <p class="text-sm font-medium text-slate-300">Dicionário de pronúncia</p>
        <p class="text-xs text-slate-500 mb-2">Um por linha: <code>origem = destino</code>. Aplicado antes da voz (ex.: <code>API = A-P-I</code>).</p>
        <textarea id="set-pron" rows="4" placeholder="API = A-P-I\nPython = Paithon"
          class="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-xs text-slate-100 font-mono focus:border-indigo-400 focus:outline-none">${esc(s.pronunciation || '')}</textarea>
      </div>

      <label class="block">
        <span class="text-sm font-medium text-slate-300">Bridge TTS remota (opcional)</span>
        <input id="set-proxy" type="url" value="${esc(s.proxyUrl || '')}" placeholder="https://meu-worker.workers.dev"
          class="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none">
        <span class="text-xs text-slate-500">Endpoint compatível com POST /api/tts (ex.: Cloudflare Worker). Vazio = mesma origem.</span>
      </label>

      <label class="flex items-center justify-between cursor-pointer">
        <div>
          <span class="text-sm font-medium text-slate-300">Pré-processar com Gemini</span>
          <p class="text-xs text-slate-500">Melhora a leitura; cai no fallback local sem chave.</p>
        </div>
        <input id="set-gemini-on" type="checkbox" ${s.useGemini ? 'checked' : ''} class="w-5 h-5 accent-indigo-500">
      </label>

      <label class="flex items-center justify-between cursor-pointer">
        <div>
          <span class="text-sm font-medium text-slate-300">Baixar próximo capítulo em segundo plano</span>
          <p class="text-xs text-slate-500">Sintetiza à frente para ouvir sem esperas.</p>
        </div>
        <input id="set-autonext" type="checkbox" ${s.autoCacheNext ? 'checked' : ''} class="w-5 h-5 accent-indigo-500">
      </label>

      <label class="block">
        <span class="text-sm font-medium text-slate-300">Pausa entre parágrafos</span>
        <select id="set-gap" class="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none">
          ${[[0, 'Sem pausa'], [400, '0,4 s'], [800, '0,8 s'], [1200, '1,2 s'], [2000, '2 s']].map(([ms, label]) =>
            `<option value="${ms}" ${Number(s.paragraphGap) === ms ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <span class="text-xs text-slate-500">Aplica-se ao fim de cada parágrafo durante a reprodução.</span>
      </label>

      <label class="block">
        <span class="text-sm font-medium text-slate-300">Delay autonext</span>
        <select id="set-autonext-delay" class="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none">
          ${[[0, 'Imediato'], [300, '0,3 s'], [600, '0,6 s'], [1000, '1 s'], [1500, '1,5 s']].map(([ms, label]) =>
            `<option value="${ms}" ${Number(s.autonextDelayMs) === ms ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <span class="text-xs text-slate-500">Pausa antes de ir para o próximo capítulo (quando autonext ligado).</span>
      </label>

      <div class="flex gap-3 pt-2">
        <button id="set-save" class="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold">Salvar</button>
        <button class="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold" data-close>Cancelar</button>
      </div>
    </div>
  </div>`;
}

/* ------------------------------ Player bar ------------------------------ */

export function playerBar(rate = 1) {
  const saved = Number(rate) || 1;
  return `
  <div id="playerbar" class="fixed bottom-0 inset-x-0 z-40 border-t border-slate-700/60 bg-slate-900/95 backdrop-blur">
    <div class="h-1 bg-slate-800"><div id="pb-progress" class="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style="width:0%"></div></div>
    <div class="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
      <div class="hidden sm:block min-w-0 flex-1">
        <p id="pb-title" class="text-sm font-semibold text-slate-100 truncate">—</p>
        <p id="pb-chapter" class="text-xs text-slate-400 truncate">—</p>
      </div>
      <div class="flex items-center gap-1">
        <button id="pb-prev-ch" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="Capítulo anterior">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
        <button id="pb-back" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="-10s">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 110 12 6 6 0 01-5.7-4.2l-1.9.7A8 8 0 1012 5z"/></svg></button>
        <button id="pb-play" class="w-11 h-11 rounded-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30 transition-transform active:scale-95" title="Play/Pause (Espaço)">
          <svg id="pb-icon-play" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          <svg id="pb-icon-pause" class="w-5 h-5 hidden" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
          <svg id="pb-icon-spin" class="w-5 h-5 hidden animate-spin" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path stroke-linecap="round" d="M21 12a9 9 0 00-9-9"/></svg>
        </button>
        <button id="pb-fwd" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="+10s">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7a6 6 0 100 12 6 6 0 005.7-4.2l1.9.7A8 8 0 1112 5z"/></svg></button>
        <button id="pb-next-ch" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="Próximo capítulo">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg></button>
      </div>
      <div class="flex items-center gap-2 flex-1 justify-end">
        <span id="pb-time" class="text-xs text-slate-400 tabular-nums">0:00</span>
        <select id="pb-rate" class="rounded-lg bg-slate-800 border border-slate-600 text-xs text-slate-200 px-1.5 py-1" title="Velocidade">
          ${[0.75, 0.9, 1, 1.25, 1.5, 1.75, 2].map((r) => `<option value="${r}" ${r === saved ? 'selected' : ''}>${r}×</option>`).join('')}
        </select>
        <button id="pb-voice-open" class="flex items-center gap-1.5 rounded-lg bg-slate-800 border border-slate-600 text-xs text-slate-200 px-2.5 py-1.5 hover:border-indigo-400" title="Escolher voz">
          <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8M12 4a3 3 0 013 3v4a3 3 0 11-6 0V7a3 3 0 013-3z"/></svg>
          <span id="pb-voice-name" class="max-w-24 truncate">Voz</span>
        </button>
        <select id="pb-sleep" class="rounded-lg bg-slate-800 border border-slate-600 text-xs text-slate-200 px-1.5 py-1" title="Sleep timer">
          <option value="">🌙 —</option>
          <option value="5">🌙 5 min</option>
          <option value="15">🌙 15 min</option>
          <option value="30">🌙 30 min</option>
          <option value="60">🌙 60 min</option>
          <option value="chapter">🌙 fim do capítulo</option>
        </select>
        <button id="pb-cache" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="Baixar capítulo inteiro">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14"/></svg></button>
        <button id="pb-book-dl" class="p-2 rounded-lg hover:bg-slate-800 text-slate-300" title="Baixar livro inteiro (fila retomável)">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg></button>
      </div>
    </div>
  </div>`;
}

export function toast(msg, kind = 'info') {
  const colors = { info: 'bg-slate-800', ok: 'bg-emerald-600', warn: 'bg-amber-600', err: 'bg-red-600' };
  const t = document.createElement('div');
  t.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-xl text-white text-sm font-medium shadow-2xl ${colors[kind]} transition-all`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translate(-50%,-10px)'; }, 2600);
  setTimeout(() => t.remove(), 3100);
}

/** Toast persistente com ação (ex.: "Nova versão — Recarregar"). */
export function actionToast(msg, actionLabel, onAction, ms = 0) {
  const t = document.createElement('div');
  t.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-xl bg-slate-800 border border-indigo-500/40 text-white text-sm font-medium shadow-2xl flex items-center gap-3';
  const span = document.createElement('span');
  span.textContent = msg;
  const btn = document.createElement('button');
  btn.className = 'px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 font-semibold';
  btn.textContent = actionLabel;
  btn.onclick = () => { t.remove(); onAction?.(); };
  t.append(span, btn);
  document.body.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
  return t;
}

/* ------------------------------ Storage panel ------------------------------ */

export function storagePanel(book, usage, est, bookDl, stats) {
  const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  const heard = stats && stats.listenedMin
    ? `
    <div class="flex items-baseline justify-between text-xs">
      <span class="text-slate-400">Ouvido neste livro</span>
      <span class="font-semibold text-slate-100">${stats.listenedMin} min · ${stats.chaptersDone} cap. concluído${stats.chaptersDone === 1 ? '' : 's'}</span>
    </div>`
    : '';
  const dl = bookDl ? `
    <div class="space-y-1.5 pt-1">
      <div class="flex items-baseline justify-between text-xs">
        <span class="text-slate-400">Livro inteiro</span>
        <span class="font-semibold text-slate-100">${bookDl.done}/${bookDl.total} caps ${bookDl.active ? '· ⏳ gerando…' : ''}</span>
      </div>
      <div class="h-1.5 rounded-full bg-slate-700 overflow-hidden"><div class="h-full bg-emerald-500" style="width:${bookDl.total ? (bookDl.done / bookDl.total) * 100 : 0}%"></div></div>
    </div>` : '';
  return `
  <div class="rounded-2xl bg-slate-800/60 border border-slate-700/60 p-4 space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-bold text-slate-200 flex items-center gap-2">
        <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M4 7v10c0 1.1.9 2 2 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H6a2 2 0 00-2 2z"/></svg>
        Armazenamento
      </h3>
      <button id="st-refresh" class="text-xs text-slate-400 hover:text-slate-200">atualizar</button>
    </div>
    <div class="flex items-baseline justify-between text-xs">
      <span class="text-slate-400">Áudio deste livro</span>
      <span class="font-semibold text-slate-100">${fmtBytes(usage.bytes)} · ${usage.segments} trechos</span>
    </div>
    <div class="flex items-baseline justify-between text-xs">
      <span class="text-slate-400">Uso total do app</span>
      <span class="font-semibold text-slate-100">${fmtBytes(est.usage)} de ${fmtBytes(est.quota)}</span>
    </div>
    <div class="h-1.5 rounded-full bg-slate-700 overflow-hidden"><div class="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style="width:${pct}%"></div></div>
    ${heard}
    ${dl}
    <div class="flex gap-2 pt-1">
      <button id="st-export-mp3" class="flex-1 text-xs py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20 font-medium">⬇ Exportar capítulo (MP3)</button>
      <button id="st-delete-audio" class="flex-1 text-xs py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 font-medium">Apagar áudio em cache</button>
    </div>
  </div>`;
}

export async function bindSettings(app) {
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#btn-settings-open')) {
      const s = await getSettings();
      const holder = document.createElement('div');
      holder.innerHTML = settingsModal(s);
      document.body.appendChild(holder);
      $('#modal-settings [data-close]', holder).onclick = () => holder.remove();
      $('#set-save', holder).onclick = async () => {
        const geminiKey = $('#set-gemini', holder).value.trim();
        const useGemini = $('#set-gemini-on', holder).checked;
        const proxyUrl = $('#set-proxy', holder).value.trim();
        const rememberKey = $('#set-remember-key', holder).checked;
        const pronunciation = $('#set-pron', holder).value;
        // O checkbox #set-autonext era renderizado mas nunca lido: o usuário
        // desligava "baixar próximo capítulo" e nada mudava ao reabrir.
        const autoCacheNext = $('#set-autonext', holder).checked;
        const paragraphGap = Number($('#set-gap', holder).value) || 0;
        const autonextDelay = Number($('#set-autonext-delay', holder).value) || 0;
        await saveSettings({ geminiKey: rememberKey ? geminiKey : '', useGemini, proxyUrl, rememberKey, pronunciation, autoCacheNext, paragraphGap, autonextDelayMs: autonextDelay });
        app?.onSettingsSaved?.({ autoCacheNext, paragraphGap, autonextDelayMs: autonextDelay });
        if (!rememberKey && geminiKey) { try { sessionStorage.setItem('vox-gemini-key', geminiKey); } catch {} }
        else { try { sessionStorage.removeItem('vox-gemini-key'); } catch {} }
        const { setProxyUrl } = await import('./ttsEngine.js');
        setProxyUrl(proxyUrl);
        holder.remove();
        toast('Configurações salvas', 'ok');
        // Valida a chave em segundo plano e avisa qual modelo será usado
        if (geminiKey && useGemini) {
          validateGeminiKey(geminiKey).then((v) => {
            if (v.ok) toast(`Gemini conectado ✓ (modelo: ${v.model})`, 'ok');
            else toast(`Gemini indisponível: ${v.error || 'verifique a chave'} — usando limpeza local`, 'warn');
          });
        }
      };
    }
  });
}

/* ------------------------------ Voice picker modal ------------------------------ */

export function voicePickerModal(voices, currentVoice, currentContext) {
  const ctx = CONTEXTS.find((c) => c.id === currentContext) || CONTEXTS[0];
  const cur = voices.find((v) => v.id === currentVoice);
  const ages = [...new Set(voices.map((v) => v.age).filter(Boolean))];
  const genders = [...new Set(voices.map((v) => v.gender).filter(Boolean))];
  const tags = [...new Set(voices.flatMap((v) => v.tags || []))];

  return `
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" id="modal-voice">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" data-close></div>
    <div class="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl max-h-[85vh] flex flex-col">
      <div class="p-5 pb-3 border-b border-slate-700/60">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-slate-100">Escolher voz</h2>
          <button class="text-slate-400 hover:text-slate-200" data-close>✕</button>
        </div>

        <p class="text-xs text-slate-400 mt-3 mb-1.5">Melhor para</p>
        <div class="flex flex-wrap gap-1.5" id="vp-contexts">
          ${CONTEXTS.map((c) => `
            <button data-ctx="${c.id}" title="${esc(c.hint || '')}"
              class="ctx-chip px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${c.id === currentContext ? 'bg-indigo-500 border-indigo-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-indigo-400'}">
              ${c.emoji} ${esc(c.label)}
            </button>`).join('')}
        </div>

        <div class="grid grid-cols-2 gap-2 mt-3">
          <select id="vp-age" class="rounded-lg bg-slate-800 border border-slate-600 text-xs text-slate-200 px-2 py-1.5">
            <option value="">Idade: todas</option>
            ${ages.map((a) => `<option value="${a}" ${a === '' ? 'selected' : ''}>Idade: ${AGE_LABELS[a] || a}</option>`).join('')}
          </select>
          <select id="vp-gender" class="rounded-lg bg-slate-800 border border-slate-600 text-xs text-slate-200 px-2 py-1.5">
            <option value="">Gênero: todos</option>
            ${genders.map((g) => `<option value="${g}" ${g === '' ? 'selected' : ''}>Gênero: ${GENDER_LABELS[g] || g}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-1.5" id="vp-list">
        ${voices.map((v) => `
          <button data-voice="${esc(v.id)}" class="voice-item w-full text-left rounded-xl border p-3 transition-colors ${v.id === currentVoice ? 'bg-indigo-500/15 border-indigo-400/60' : 'bg-slate-800/50 border-slate-700/60 hover:border-indigo-400/40'}">
            <div class="flex items-center gap-3">
              <span class="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 ${v.gender === 'M' ? 'bg-sky-500/15 text-sky-300' : 'bg-fuchsia-500/15 text-fuchsia-300'}">
                ${v.gender === 'M' ? '♂' : '♀'}
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-slate-100 truncate">${esc(v.name)} <span class="text-[10px] text-slate-400 font-normal">${esc(AGE_LABELS[v.age] || '')}</span></p>
                <p class="text-[11px] text-slate-400 truncate">${esc(v.locale)} · ${(v.tags || []).join(', ') || 'geral'}${v.personalities?.length ? ' · ' + esc(v.personalities.join(', ')) : ''}</p>
              </div>
              ${v.id === currentVoice ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500 text-white font-semibold shrink-0">em uso</span>' : `<span class="preview-btn text-[10px] px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 shrink-0" data-preview="${esc(v.id)}">▶ prévia</span>`}
            </div>
          </button>`).join('')}
      </div>

      <div class="p-4 pt-3 border-t border-slate-700/60">
        <p class="text-xs text-slate-400 mb-2">Prosódia aplicada: <span class="text-slate-200 font-medium">${ctx.emoji} ${esc(ctx.label)}</span> <span class="text-slate-500">(${ctx.ratePct >= 0 ? '+' : ''}${ctx.ratePct}% vel. · ${ctx.pitchHz >= 0 ? '+' : ''}${ctx.pitchHz}Hz tom)</span></p>
        <button id="vp-apply" class="w-full py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold">Aplicar</button>
      </div>
    </div>
  </div>`;
}

export { esc };
