/**
 * storage.js — Camada de persistência (IndexedDB via localforage)
 *
 * Bancos:
 *   voxreader_books    -> metadados dos livros { [bookId]: BookMeta }
 *   voxreader_text     -> texto/segmentos por capítulo { [`${bookId}::${idx}`]: ChapterText }
 *   voxreader_audio    -> Blobs de áudio  { [`${bookId}::${idx}::${voiceKey}::${segIdx}`]: Blob }
 *   voxreader_manifest -> manifests de áudio por capítulo { [`${bookId}::${idx}::${voiceKey}`]: AudioManifest }
 *   voxreader_state    -> progresso de leitura, settings, chave Gemini
 *
 * Economia de quota: TTS só é chamado se o manifest/segmento NÃO existir localmente.
 */

/* localforage vem de <script> global (vendor/localforage.min.js) */
const { localforage } = window;

const books = localforage.createInstance({ name: 'voxreader_books', storeName: 'books' });
const text = localforage.createInstance({ name: 'voxreader_text', storeName: 'chapters' });
const audio = localforage.createInstance({ name: 'voxreader_audio', storeName: 'audio' });
const manifest = localforage.createInstance({ name: 'voxreader_manifest', storeName: 'manifests' });
const state = localforage.createInstance({ name: 'voxreader_state', storeName: 'state' });
const timings = localforage.createInstance({ name: 'voxreader_timings', storeName: 'timings' });
const usage = localforage.createInstance({ name: 'voxreader_usage', storeName: 'usage' });

const k = {
  text: (b, c) => `${b}::${c}`,
  audioSeg: (b, c, v, s) => `${b}::${c}::${v}::${s}`,
  audioManifest: (b, c, v) => `${b}::${c}::${v}`,
};

/* ------------------------------ Settings ------------------------------ */

const DEFAULT_SETTINGS = {
  voice: 'pt-BR-FranciscaNeural',
  voiceContext: 'default',
  rate: 1.0,
  fontSize: 17,
  fontFamily: 'serif',   // serif | sans
  theme: 'dark',
  geminiKey: '',
  useGemini: false,
  rememberKey: true,
  autoCacheNext: true,
  proxyUrl: '',          // bridge TTS remota opcional (ex.: Cloudflare Worker)
  pronunciation: '',     // dicionário "origem = destino", um por linha
  paragraphGap: 0,       // pausa entre parágrafos (ms)
};

export async function getSettings() {
  const s = (await state.getItem('settings')) || {};
  return { ...DEFAULT_SETTINGS, ...s };
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await state.setItem('settings', next);
  return next;
}

/* ------------------------------ Progresso ------------------------------ */

export async function getProgress(bookId) {
  return (await state.getItem(`progress::${bookId}`)) || null;
}
export async function saveProgress(bookId, { chapter, segment }) {
  return state.setItem(`progress::${bookId}`, { chapter, segment, at: Date.now() });
}

/** Marca capítulo como concluído + acumula estatísticas de escuta. */
export async function markChapterDone(bookId, chapterIdx, listenSeconds) {
  const done = (await state.getItem(`done::${bookId}`)) || {};
  const already = !!done[chapterIdx];
  done[chapterIdx] = true;
  await state.setItem(`done::${bookId}`, done);
  if (!already) {
    const meta = await books.getItem(bookId);
    if (meta) { meta.chaptersDone = (meta.chaptersDone || 0) + 1; await books.setItem(bookId, meta); }
  }
  await addListenSeconds(bookId, listenSeconds || 0);
}

/** Segundos ouvidos por livro (acumulado a cada segmento terminado). */
export async function addListenSeconds(bookId, seconds) {
  if (!seconds) return;
  const s = (await state.getItem(`listen::${bookId}`)) || { seconds: 0, updatedAt: 0 };
  s.seconds += seconds;
  s.updatedAt = Date.now();
  await state.setItem(`listen::${bookId}`, s);
}

/**
 * Minutos ouvidos + capítulos concluídos. Sem bookId, agrega todos os livros
 * (usa a barra da biblioteca); com bookId, só aquele livro (usa a lateral do
 * leitor). Antes o argumento era aceito e ignorado — a lateral mostrava o
 * total global como se fosse do livro aberto.
 */
export async function getListenStats(bookId) {
  // Sem bookId, agrega todos os livros. Com bookId, só aquele: as chaves são
  // `listen::<bookId>` e `done::<bookId>` (uma por livro, sem sufixo), então
  // startsWith não serve — `book1` casaria com `book12`.
  const matches = bookId
    ? (key) => key === `listen::${bookId}` || key === `done::${bookId}`
    : (key) => key.startsWith('listen::') || key.startsWith('done::');
  let seconds = 0, chaptersDone = 0;
  await state.iterate((v, key) => { // callback sem return: undefined não interrompe o iterate()
    if (!matches(key)) return;
    if (key.startsWith('listen::')) seconds += v?.seconds || 0;
    else if (key !== 'done::') chaptersDone += Object.keys(v || {}).length;
  });
  return { listenedMin: Math.round(seconds / 60), chaptersDone };
}

/** Capítulos concluídos de um livro (Set de índices). */
export async function getDoneChapters(bookId) {
  const done = (await state.getItem(`done::${bookId}`)) || {};
  return new Set(Object.keys(done).map(Number));
}

/* ------------------------------ Livros ------------------------------ */

export async function listBooks() {
  const out = [];
  // IMPORTANTE: callback deve retornar undefined — valor não-undefined interrompe o iterate()
  await books.iterate((v) => { out.push(v); });
  return out.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt));
}
export async function getBook(bookId) {
  return books.getItem(bookId);
}
export async function putBook(meta) {
  return books.setItem(meta.id, meta);
}
export async function touchBook(bookId) {
  const m = await books.getItem(bookId);
  if (m) await books.setItem(bookId, { ...m, lastOpenedAt: Date.now() });
}
export async function updateBookFields(bookId, patch) {
  const m = await books.getItem(bookId);
  if (!m) return null;
  const next = { ...m, ...patch };
  await books.setItem(bookId, next);
  return next;
}

/* --------------------------- Texto de capítulos --------------------------- */

export async function saveChapterText(bookId, chapterIdx, data) {
  return text.setItem(k.text(bookId, chapterIdx), data);
}
export async function loadChapterText(bookId, chapterIdx) {
  return text.getItem(k.text(bookId, chapterIdx));
}
export async function isChapterTextCached(bookId, chapterIdx) {
  return (await text.getItem(k.text(bookId, chapterIdx))) != null;
}

/* ------------------------------ Áudio (cache) ------------------------------ */

/** Manifest de um capítulo para uma voz: { segments: [durSeg...], mimeType, createdAt } */
export async function getAudioManifest(bookId, chapterIdx, voiceKey) {
  return manifest.getItem(k.audioManifest(bookId, chapterIdx, voiceKey));
}
export async function saveAudioManifest(bookId, chapterIdx, voiceKey, data) {
  return manifest.setItem(k.audioManifest(bookId, chapterIdx, voiceKey), { ...data, updatedAt: Date.now() });
}

/** Cache-first: devolve Blob se existir; nunca vai à rede. */
export async function getAudioSegment(bookId, chapterIdx, voiceKey, segIdx) {
  return audio.getItem(k.audioSeg(bookId, chapterIdx, voiceKey, segIdx));
}
export async function hasAudioSegment(bookId, chapterIdx, voiceKey, segIdx) {
  return (await audio.getItem(k.audioSeg(bookId, chapterIdx, voiceKey, segIdx))) != null;
}
export async function saveAudioSegment(bookId, chapterIdx, voiceKey, segIdx, blob) {
  const key = k.audioSeg(bookId, chapterIdx, voiceKey, segIdx);
  // Regerar um segmento sobrescreve o existente: o contador precisa da diferença,
  // senão usage.bytes cresce a cada synth e o total do app nunca volta ao real.
  const prevSize = await audio.getItem(key).then((b) => b?.size || 0).catch(() => 0);
  await audio.setItem(key, blob);
  const deltaBytes = blob.size - prevSize;
  const deltaSegments = prevSize ? 0 : 1;
  if (deltaBytes !== 0 || deltaSegments !== 0) {
    await _bumpUsage(bookId, deltaBytes, deltaSegments);
  }
}

/** Timings exatos por palavra (do Edge TTS), alinhados ao índice do áudio. */
export async function getAudioTiming(bookId, chapterIdx, voiceKey, segIdx) {
  return timings.getItem(k.audioSeg(bookId, chapterIdx, voiceKey, segIdx));
}
export async function saveAudioTiming(bookId, chapterIdx, voiceKey, segIdx, data) {
  return timings.setItem(k.audioSeg(bookId, chapterIdx, voiceKey, segIdx), data);
}

/* --------------------- Contadores de uso (O(1) por livro) --------------------- */

async function _bumpUsage(bookId, deltaBytes, deltaSegments = 1) {
  const u = (await usage.getItem(bookId)) || { bytes: 0, segments: 0 };
  u.bytes = Math.max(0, u.bytes + deltaBytes);
  u.segments = Math.max(0, u.segments + deltaSegments);
  await usage.setItem(bookId, u);
  return u;
}

/** Varredura completa (migração / recálculo após deleção). */
export async function recomputeBookUsage(bookId) {
  let bytes = 0, segments = 0;
  await audio.iterate((blob, key) => {
    if (key.startsWith(`${bookId}::`)) { bytes += blob?.size || 0; segments++; } // bloco sem return
  });
  const u = { bytes, segments };
  await usage.setItem(bookId, u);
  return u;
}

export async function deleteChapterAudio(bookId, chapterIdx, voiceKey) {
  const m = await getAudioManifest(bookId, chapterIdx, voiceKey);
  if (m) {
    await Promise.all(
      m.segments.map(async (_, i) => {
        await audio.removeItem(k.audioSeg(bookId, chapterIdx, voiceKey, i));
        await timings.removeItem(k.audioSeg(bookId, chapterIdx, voiceKey, i));
      })
    );
  }
  await manifest.removeItem(k.audioManifest(bookId, chapterIdx, voiceKey));
  await recomputeBookUsage(bookId);
}

export async function deleteBook(bookId) {
  const meta = await books.getItem(bookId);
  const tasks = [];
  const collect = (store) => store.iterate((v, key) => {
    if (key.startsWith(`${bookId}::`)) { tasks.push(store.removeItem(key)); } // bloco sem return
  });
  await collect(text);
  await collect(manifest);
  await collect(audio);
  await collect(timings);
  await Promise.all(tasks);
  // Chaves de estado por livro — sem estas, getListenStats() continuaria contando
  // minutos e capítulos de um livro já removido, para sempre.
  await Promise.all([
    state.removeItem(`progress::${bookId}`),
    state.removeItem(`listen::${bookId}`),
    state.removeItem(`done::${bookId}`),
  ]);
  await usage.removeItem(bookId);
  await books.removeItem(bookId);
  return meta?.title || bookId;
}

/* --------------------------- Estimativa de uso --------------------------- */

export async function estimateBookUsage(bookId) {
  const cached = await usage.getItem(bookId);
  if (cached) return cached;
  return recomputeBookUsage(bookId); // migração: primeira leitura faz a varredura e cacheia
}

export async function estimateStorage() {
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    return { usage: e.usage, quota: e.quota };
  }
  return { usage: null, quota: null };
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && navigator.storage?.persist) {
      if (!(await navigator.storage.persisted())) return await navigator.storage.persist();
      return true;
    }
  } catch { /* noop */ }
  return false;
}

/* ------------------------------ Export ------------------------------ */

export function fmtBytes(n) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
