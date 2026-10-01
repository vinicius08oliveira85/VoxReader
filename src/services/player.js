/**
 * player.js — Player de audiobook com fila de segmentos e sincronização de texto.
 *
 * Estratégias de reprodução:
 *  - ONLINE/CACHE: <audio> com Blobs MP3 por segmento (seek real, ±10s, velocidade).
 *  - OFFLINE sem cache: Web Speech API (sem seek real; avança por segmentos).
 *
 * Eventos emitidos via callback `on`:
 *  segment, time, word, state, rate, error, cacheProgress, mode
 */

import { getAudioManifest, getAudioSegment, saveAudioSegment, saveAudioManifest, saveProgress, getAudioTiming, saveAudioTiming, addListenSeconds, markChapterDone } from './storage.js';
import { synthesize, webSpeech, getContextPreset } from './ttsEngine.js';
import { alignWordTimings } from './textCleaner.js';

/** Toast com dedupe (evita spam durante a reprodução). */
let _lastToast = '';
function toastOnce(msg) {
  if (_lastToast === msg) return;
  _lastToast = msg;
  import('./ui.js').then(({ toast }) => toast(msg)).catch(() => {});
  setTimeout(() => { _lastToast = ''; }, 8000);
}

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.bookId = null;
    this.segments = [];
    this.idx = 0;
    this.manifest = null;      // { segments: [dur], mimeType }
    this.voiceKey = '';
    this.rate = 1;
    this.mode = 'idle';        // idle | media | webspeech
    this.playing = false;
    this.voiceId = '';         // id puro da voz (ex.: pt-BR-FranciscaNeural)
    this.prosody = { ratePct: 0, pitchHz: 0 };
    this.pronunciation = new Map(); // dicionário origem→destino aplicado na síntese
    this.currentTiming = null; // [[ms, charIndex, len], ...] do segmento atual
    this.paragraphGapMs = 0;   // pausa entre parágrafos
    this.sleepMode = '';       // '' | '5' | '15' | '30' | '60' | 'chapter'
    this.listeners = {};
    this.synthAbort = null;
    this.synthQueue = Promise.resolve();
    this.objectUrls = new Map();
    this.playToken = 0; // invalida loads antigos quando um novo load/play começa

    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('timeupdate', () => {
      const segDur = this.manifest?.segments?.[this.idx] || 0;
      const bookTotal = this.manifest ? this.manifest.segments.reduce((a, b) => a + (b || 0), 0) : 0;
    this.emit('time', { idx: this.idx, time: this.audio.currentTime, segDur, elapsed: this._elapsed(), bookTotal });
    this._emitWord();
    this._updatePositionState();
    this._scheduleEarlyPrefetch();
    });
    this.audio.addEventListener('play', () => this._acquireWakeLock());
    this.audio.addEventListener('pause', () => this._releaseWakeLock());
    this._initMediaSession();
  }

  /* --------------------- Media Session (tela de bloqueio/fones) --------------------- */

  _initMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* não suportado */ } };
    set('play', () => this.resume());
    set('pause', () => this.pause());
    set('seekbackward', () => this.skip(-10, this.currentChapter));
    set('seekforward', () => this.skip(10, this.currentChapter));
    set('previoustrack', () => this.seekSegment(Math.max(0, this.idx - 1), this.currentChapter));
    set('nexttrack', () => this.seekSegment(this.idx + 1, this.currentChapter));
    set('stop', () => this.stop());
  }

  /** Metadados para o SO (tela de bloqueio, fones, central de mídia). */
  setMediaMetadata({ title, chapter, artwork }) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: chapter || title || 'Audiobook',
        artist: title || 'VoxReader',
        album: 'VoxReader',
        artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/png' }] : [],
      });
    } catch { /* noop */ }
  }

  _updatePositionState() {
    if (!('mediaSession' in navigator) || !this.audio.duration || !isFinite(this.audio.duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(this.audio.currentTime, this.audio.duration),
      });
    } catch { /* noop */ }
  }

  on(ev, cb) { (this.listeners[ev] ||= []).push(cb); return this; }
  emit(ev, data) { (this.listeners[ev] || []).forEach((cb) => { try { cb(data); } catch {} }); }

  /* ------------------------------ Setup ------------------------------ */

  async load(bookId, chapterIdx, segments, voiceId, contextId = 'default') {
    this.stop();
    this.bookId = bookId;
    this.currentChapter = chapterIdx;
    this.segments = segments;
    this.voiceId = voiceId;
    this.prosody = getContextPreset(contextId);
    // Contexto entra na chave de cache: prosódia diferente = áudio diferente
    this.voiceKey = contextId && contextId !== 'default' ? `${voiceId}::${contextId}` : voiceId;
    // O manifest é gravado com voiceKey (audioSeg/manifest usam a mesma chave);
    // consultar por voiceId não acha nada quando há contexto ≠ default.
    const cached = await getAudioManifest(bookId, chapterIdx, this.voiceKey);
    this.manifest = cached && Array.isArray(cached.segments) ? cached : null;
    this.idx = 0;
    this.emit('mode', this.mode);
    this.emit('segment', { idx: 0, total: segments.length, text: segments[0] || '' });
    return { hasCache: !!this.manifest };
  }

  setRate(r) {
    this.rate = r;
    this.audio.playbackRate = r;
    if (this.mode === 'webspeech' && this.currentUtterance) {
      // Web Speech: reinicia segmento com nova velocidade (limitação da API)
      this._speakWebSpeech(this.idx);
    }
    this.emit('rate', r);
  }

  /* ------------------------------ Cache / síntese ------------------------------ */

  isSegmentCached(i) { return !!this.manifest?.segments?.[i]; }

  /** Aplica o dicionário de pronúncia ao texto antes da síntese. */
  _applyPronunciation(text) {
    if (!this.pronunciation?.size) return text;
    let out = text;
    for (const [from, to] of this.pronunciation) {
      out = out.split(from).join(to);
    }
    return out;
  }

  /**
   * Garante blob do segmento: cache -> rede (Edge) -> erro.
   * Retorna { blob, timing } — timing = array [ms, charIndex, len] por palavra (ou null).
   */
  async ensureSegmentBlob(chapterIdx, i) {
    const [blob, cachedTiming] = await Promise.all([
      getAudioSegment(this.bookId, chapterIdx, this.voiceKey, i),
      getAudioTiming(this.bookId, chapterIdx, this.voiceKey, i),
    ]);
    if (blob) return { blob, timing: cachedTiming || null };
    const text = this.segments[i];
    if (!text) throw new Error('segmento inexistente');
    this.emit('state', 'synthesizing');
    this.synthAbort = new AbortController();
    const { blob: generated, wordBoundaries } = await synthesize(this._applyPronunciation(text), {
      voice: this.voiceId, rate: this.rate,
      ratePct: this.prosody.ratePct, pitchHz: this.prosody.pitchHz,
      signal: this.synthAbort.signal,
    });
    await saveAudioSegment(this.bookId, chapterIdx, this.voiceKey, i, generated);
    // Converte wordBoundaries (ms+texto) → charIndex/len no texto do segmento
    let timing = null;
    if (wordBoundaries?.length) {
      timing = alignWordTimings(text, wordBoundaries);
      await saveAudioTiming(this.bookId, chapterIdx, this.voiceKey, i, timing);
    }
    return { blob: generated, timing };
  }

  /** Alinha [{ms,text}] do TTS ao texto do segmento → [[ms, charIndex, len], ...] */
  _alignTimings(segText, wordBoundaries) {
    return alignWordTimings(segText, wordBoundaries);
  }

  /**
   * Pré-processa o capítulo inteiro (para barra de progresso de cache).
   * Sintetiza em série, atualizando manifest após cada segmento —
   * assim o cache sobrevive a interrupções.
   */
  async cacheWholeChapter(chapterIdx, { onProgress } = {}) {
    let manifest = (await getAudioManifest(this.bookId, chapterIdx, this.voiceKey)) || {
      segments: this.segments.map(() => 0), mimeType: 'audio/mpeg', createdAt: Date.now(),
    };
    let done = 0;
    for (let i = 0; i < this.segments.length; i++) {
      if (manifest.segments[i] > 0) { done++; onProgress?.(done, this.segments.length); continue; }
      const { blob } = await this.ensureSegmentBlob(chapterIdx, i);
      const dur = await this._probeDuration(blob);
      manifest.segments[i] = dur;
      await saveAudioManifest(this.bookId, chapterIdx, this.voiceKey, manifest);
      done++;
      onProgress?.(done, this.segments.length);
      this.emit('cacheProgress', { done, total: this.segments.length });
    }
    this.manifest = manifest;
    return manifest;
  }

  /** Aborta a síntese em curso e o prefetch — controles separados, não um só slot. */
  cancelSynthesis() {
    this.synthAbort?.abort();
    this.synthAbort = null;
    this._prefetchAbort?.abort();
    this._prefetchAbort = null;
    this._prefetchActive = false;
    this._prefetchChapterIdx = -1;
    this._prefetchTarget = -1;
    this._prefetchTarget = -1;
  }

  _probeDuration(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      const done = (d) => { URL.revokeObjectURL(url); resolve(d || 0); };
      a.onloadedmetadata = () => done(a.duration);
      a.onerror = () => done(0);
      a.src = url;
      setTimeout(() => done(a.duration || 0), 4000);
    });
  }

  /* ------------------------------ Reprodução ------------------------------ */

  async play(chapterIdx) {
    if (this.playing) return;
    this.playToken++;
    const fullCache = this.manifest && this.manifest.segments.every((d) => d > 0);
    if (fullCache) {
      this.mode = 'media';
      await this._playMedia(chapterIdx);
      return;
    }
    this.mode = 'media';
    try {
      await this._playMedia(chapterIdx);
    } catch (e) {
      if (webSpeech.supported && !/AbortError/i.test(String(e?.name || e))) {
        this.mode = 'webspeech';
        this.emit('mode', 'webspeech');
        this._speakWebSpeech(this.idx);
      } else {
        this.emit('error', e);
      }
    }
  }

  async _playMedia(chapterIdx) {
    const token = ++this.playToken;
    const { blob, timing } = await this.ensureSegmentBlob(chapterIdx, this.idx);
    if (token !== this.playToken) return; // um load novo começou; descarta este
    this.currentTiming = timing;
    const url = URL.createObjectURL(blob);
    const old = this.objectUrls.get(this.idx);
    if (old) URL.revokeObjectURL(old);
    this.objectUrls.set(this.idx, url);
    this.audio.src = url;
    this.audio.playbackRate = this.rate;
    this.emit('segment', { idx: this.idx, total: this.segments.length, text: this.segments[this.idx] });
    await this.audio.play();
    this.playing = true;
    this.emit('state', 'playing');
    saveProgress(this.bookId, { chapter: chapterIdx, segment: this.idx });
    this._prefetch(chapterIdx, this.idx + 1);
    this._scheduleEarlyPrefetch();
  }

  _scheduleEarlyPrefetch() {
    const total = this.segments.length;
    if (total < 3) return;
    const target = this.idx + 2; // 2 segmentos antes do fim
    if (target >= total) return;
    if (this._prefetchActive && this._prefetchTarget === target && this._prefetchChapterIdx === this.currentChapter) return;
    this._prefetch(this.currentChapter, target);
  }

  _prefetch(chapterIdx, i) {
    if (i >= this.segments.length || this.isSegmentCached(i)) return;
    this.synthQueue = this.synthQueue.then(async () => {
      try {
        const blob = await getAudioSegment(this.bookId, chapterIdx, this.voiceKey, i);
        if (blob) return;
        // Prefetch usa o próprio controller: sobrescrever synthAbort faria
        // cancelSynthesis() abortar o prefetch em vez da síntese de playback.
        const ac = new AbortController();
        this._prefetchAbort = ac;
        this._prefetchActive = true;
        this._prefetchChapterIdx = chapterIdx;
        this._prefetchTarget = i;
        const { blob: gen, wordBoundaries } = await synthesize(this._applyPronunciation(this.segments[i]), {
          voice: this.voiceId, rate: this.rate,
          ratePct: this.prosody.ratePct, pitchHz: this.prosody.pitchHz,
          signal: ac.signal,
        });
        await saveAudioSegment(this.bookId, chapterIdx, this.voiceKey, i, gen);
        if (wordBoundaries?.length) {
          const timing = alignWordTimings(this.segments[i], wordBoundaries);
          if (timing) await saveAudioTiming(this.bookId, chapterIdx, this.voiceKey, i, timing);
        }
        if (this.manifest) {
          this.manifest.segments[i] = await this._probeDuration(gen);
          await saveAudioManifest(this.bookId, chapterIdx, this.voiceKey, this.manifest);
        }
      } catch { /* silencioso — retry no playback */ }
      finally { if (this._prefetchAbort === ac) { this._prefetchAbort = null; this._prefetchActive = false; } }
    });
  }

  _speakWebSpeech(i) {
    webSpeech.cancel();
    const text = this.segments[i];
    if (!text) return this._onEnded();
    this.emit('segment', { idx: i, total: this.segments.length, text });
    this.currentUtterance = webSpeech.speak(text, {
      rate: this.rate,
      onboundary: (e) => this.emit('word', { idx: i, charIndex: e.charIndex, len: e.charLength || 0, source: 'webspeech' }),
      onend: () => {
        const gap = this.paragraphGapMs || 0;
        this.idx = i + 1;
        if (gap > 0) {
          clearTimeout(this._gapTimer);
          this._gapTimer = setTimeout(() => {
            if (this.mode === 'idle' || !this.playing) return;
            this._speakWebSpeech(this.idx);
          }, gap);
        } else {
          setTimeout(() => this._speakWebSpeech(this.idx), 250);
        }
      },
      onerror: (e) => this.emit('error', e),
    });
    this.playing = true;
    this.emit('state', 'playing');
    saveProgress(this.bookId, { chapter: this.currentChapter, segment: i });
  }

  _onEnded() {
    this.playing = false;
    // Estatística: acumula a duração do segmento que acabou de terminar
    const segDur = this.audio.duration || this.manifest?.segments?.[this.idx] || 0;
    if (segDur) addListenSeconds(this.bookId, segDur);

    // Sleep timer "fim do capítulo"
    if (this.sleepMode === 'chapter') { this.stop(); this.emit('sleep-end'); toastOnce('🌙 Sleep timer: pausa no fim do capítulo'); return; }

    if (this.idx < this.segments.length - 1) {
      const gap = this.paragraphGapMs || 0;
      this.idx++;
      this.emit('state', 'loading');
      if (gap > 0) {
        clearTimeout(this._gapTimer);
        this._gapTimer = setTimeout(() => {
          if (this.mode === 'idle') return; // abortado
          this.playing = false;
          this.play(this.currentChapter).catch((e) => this.emit('error', e));
        }, gap);
      } else {
        this.play(this.currentChapter).catch((e) => this.emit('error', e));
      }
    } else {
      markChapterDone(this.bookId, this.currentChapter, 0);
      this.emit('state', 'chapter-end');
      // Auto-avança para o próximo capítulo
      if (typeof this.onChapterEnd === 'function') this.onChapterEnd();
      return;
    }
  }

  /* --------------------------- Sleep timer --------------------------- */

  /** mode: '' | '5' | '15' | '30' | '60' | 'chapter' */
  setSleep(mode) {
    clearTimeout(this._sleepTimer);
    this.sleepMode = mode || '';
    if (mode && mode !== 'chapter') {
      this._sleepTimer = setTimeout(() => {
        this.stop();
        this.emit('sleep-end');
        toastOnce('🌙 Sleep timer: reprodução pausada');
      }, Number(mode) * 60 * 1000);
    }
    return this.sleepMode;
  }

  /* --------------------------- Wake Lock --------------------------- */

  async _acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !this._wakeLock) {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
      }
    } catch { /* negado/indisponível */ }
  }
  _releaseWakeLock() {
    try { this._wakeLock?.release(); } catch { /* noop */ }
    this._wakeLock = null;
  }

  /* ------------------------------ Controles ------------------------------ */

  pause() {
    clearTimeout(this._gapTimer);
    if (this.mode === 'media') { this.audio.pause(); this.playing = false; this.emit('state', 'paused'); }
    else if (this.mode === 'webspeech') { webSpeech.pause(); this.playing = false; this.emit('state', 'paused'); }
  }

  /** Botão único Play/Pause: stopped→play · playing→pause · paused→resume */
  toggle(chapterIdx) {
    if (this.mode === 'idle' || (!this.playing && !this.audio.src && this.mode === 'media')) {
      this.play(chapterIdx).catch((e) => this.emit('error', e));
    } else if (this.playing) {
      this.pause();
    } else {
      this.resume();
    }
  }
  resume() {
    if (this.mode === 'media') { this.audio.play(); this.playing = true; this.emit('state', 'playing'); }
    else if (this.mode === 'webspeech') { webSpeech.resume(); this.playing = true; this.emit('state', 'playing'); }
  }
  stop() {
    clearTimeout(this._gapTimer);
    clearTimeout(this._sleepTimer);
    this.cancelSynthesis();
    webSpeech.cancel();
    this.playToken++;
    this.audio.pause();
    this.audio.removeAttribute('src');
    // Blob URLs ficavam presos no mapa até o mesmo índice ser regerado.
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.playing = false;
    this.mode = 'idle';
    this._releaseWakeLock();
    this.emit('state', 'stopped');
  }

  seekSegment(i, chapterIdx) {
    if (i < 0 || i >= this.segments.length) return;
    this.idx = i;
    if (this.mode === 'webspeech') { this.currentChapter = chapterIdx; this._speakWebSpeech(i); return; }
    if (this.playing) { this.audio.pause(); this.playing = false; this.play(chapterIdx); }
    else this.emit('segment', { idx: i, total: this.segments.length, text: this.segments[i] });
  }

  /** ±10s reais dentro do MP3 do segmento; cruza para o segmento vizinho se preciso. */
  skip(seconds, chapterIdx) {
    if (this.mode !== 'media') {
      this.seekSegment(this.idx + (seconds > 0 ? 1 : -1), chapterIdx);
      return;
    }
    const t = this.audio.currentTime + seconds;
    if (t >= 0 && t <= (this.audio.duration || Infinity)) {
      this.audio.currentTime = t;
    } else if (t < 0) {
      const prev = Math.max(0, this.idx - 1);
      this.seekSegment(prev, chapterIdx);
    } else {
      const next = Math.min(this.segments.length - 1, this.idx + 1);
      this.seekSegment(next, chapterIdx);
    }
  }

  _elapsed() {
    if (!this.manifest) return this.audio.currentTime;
    let s = 0;
    for (let i = 0; i < this.idx; i++) s += this.manifest.segments[i] || 0;
    const timing = this.currentTiming;
    if (timing?.length && this.mode === 'media' && this.audio.currentTime) {
      const tMs = this.audio.currentTime * 1000;
      let lastMs = 0;
      for (const [ms] of timing) {
        if (ms <= tMs) lastMs = ms;
        else break;
      }
      if (lastMs > 0) return s + lastMs / 1000;
    }
    return s + (this.audio.currentTime || 0);
  }

  /** Highlight por palavra: timings exatos (Edge) se houver, senão aproximação. */
  _emitWord() {
    const seg = this.segments[this.idx];
    if (!seg) return;
    const timing = this.currentTiming;
    if (timing?.length) {
      const tMs = this.audio.currentTime * 1000;
      let cur = null;
      for (const [ms, charIndex, len] of timing) {
        if (ms <= tMs) cur = [charIndex, len];
        else break;
      }
      if (cur) {
        this.emit('word', { idx: this.idx, charIndex: cur[0], len: cur[1], source: 'exact' });
        return;
      }
    }
    if (!this.audio.duration) return;
    const frac = this.audio.currentTime / this.audio.duration;
    const charIndex = Math.floor(frac * seg.length);
    let len = 1;
    while (charIndex + len < seg.length && /\S/.test(seg[charIndex + len])) len++;
    this.emit('word', { idx: this.idx, charIndex, len, source: 'approx' });
  }

  get currentChapter() { return this._chapterIdx ?? 0; }
  set currentChapter(v) { this._chapterIdx = v; }
}
