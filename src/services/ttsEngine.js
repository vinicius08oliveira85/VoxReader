/**
 * ttsEngine.js — Motor TTS híbrido
 *
 * 1) Edge TTS (Microsoft Neural Voices) — cliente WebSocket completo que fala
 *    direto com `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`,
 *    incluindo o token anti-abuse `Sec-MS-GEC` (mesmo algoritmo do projeto edge-tts):
 *        ticks  = unix_now + 11644473600 (época Windows)
 *        ticks -= ticks % 300             (janela de 5 min)
 *        token  = SHA256("{ticks}6A5AA1D4EAFF4E9FB37E23D68491D6F4") hex maiúsculo
 *    Tentamos conexão DIRETA no browser; se o Edge TTS bloquear (403/CORS),
 *    tentamos automaticamente a bridge local opcional (/api/tts) e por fim
 *    caímos para a Web Speech API nativa (offline).
 *
 * 2) Web Speech API — fallback 100% offline, sem áudio exportável (streaming).
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600n; // segundos entre 1601 e 1970
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

/* ------------------------------ Token DRM ------------------------------ */

async function sha256HexUpper(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Sec-MS-GEC: SHA-256 do instante Windows arredondado para baixo em janelas de 5 min. */
export async function generateSecMsGec(skewSeconds = 0) {
  let ticks = BigInt(Math.floor(Date.now() / 1000 + skewSeconds));
  ticks += WIN_EPOCH;
  ticks -= ticks % 300n;           // janela de 5 minutos
  ticks *= 10_000_000n;            // converte p/ intervalos de 100ns (file time)
  return sha256HexUpper(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
}

export async function buildWssUrl(skew = 0) {
  const gec = await generateSecMsGec(skew);
  return `${WSS_URL}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${encodeURIComponent(SEC_MS_GEC_VERSION)}`;
}

/* ------------------------------ Contextos de voz ------------------------------ */

/** Presets de prosódia por contexto — dão "temperamento" diferente à mesma voz. */
export const CONTEXTS = [
  { id: 'default',        label: 'Padrão',                  emoji: '🎧', ratePct: 0,  pitchHz: 0, hint: 'Sem ajustes — leitura neutra' },
  { id: 'narrative',      label: 'Narrativa & História',    emoji: '📖', ratePct: -4, pitchHz: 0, hint: 'Ritmo calmo, estilo storytelling' },
  { id: 'conversational', label: 'Conversacional',          emoji: '💬', ratePct: 2,  pitchHz: 2, hint: 'Tom natural de conversa' },
  { id: 'characters',     label: 'Personagens & Animação',  emoji: '🎭', ratePct: 0,  pitchHz: 6, hint: 'Mais expressividade e energia' },
  { id: 'educational',    label: 'Informativo & Educacional', emoji: '🎓', ratePct: 4, pitchHz: 0, hint: 'Claro e um pouco mais rápido' },
  { id: 'entertainment',  label: 'Entretenimento & TV',     emoji: '📺', ratePct: 2,  pitchHz: 0, hint: 'Estilo apresentador' },
];

export function getContextPreset(id) {
  return CONTEXTS.find((c) => c.id === id) || CONTEXTS[0];
}

export const AGE_LABELS = { young: 'Jovem', adult: 'Meia-idade', senior: 'Sênior' };
export const GENDER_LABELS = { F: 'Feminino', M: 'Masculino' };

/* ------------------------------ Vozes ------------------------------ */

export const EDGE_VOICES = [
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca', locale: 'pt-BR', gender: 'F', age: 'adult',  tags: ['narrative', 'educational'],   personalities: ['Confidente', 'Amigável'] },
  { id: 'pt-BR-AntonioNeural',   name: 'Antonio',   locale: 'pt-BR', gender: 'M', age: 'adult',  tags: ['narrative', 'educational'],   personalities: ['Confidente', 'Amigável'] },
  { id: 'pt-BR-ThalitaNeural',   name: 'Thalita',   locale: 'pt-BR', gender: 'F', age: 'young',  tags: ['conversational', 'entertainment'], personalities: ['Simpática', 'Sorridente'] },
  { id: 'pt-BR-BrendaNeural',    name: 'Brenda',    locale: 'pt-BR', gender: 'F', age: 'adult',  tags: ['conversational'],             personalities: ['Genuína'] },
  { id: 'pt-BR-ElzaNeural',      name: 'Elza',      locale: 'pt-BR', gender: 'F', age: 'senior', tags: ['characters', 'narrative'],    personalities: ['Criativa', 'Contadora de histórias'] },
  { id: 'pt-BR-GiovannaNeural',  name: 'Giovanna',  locale: 'pt-BR', gender: 'F', age: 'adult',  tags: ['conversational'],             personalities: ['Cuidadosa', 'Gentil'] },
  { id: 'pt-BR-LeticiaNeural',   name: 'Leticia',   locale: 'pt-BR', gender: 'F', age: 'young',  tags: ['conversational'],             personalities: ['Alegre', 'Sincera'] },
  { id: 'pt-BR-ManuelaNeural',   name: 'Manuela',   locale: 'pt-BR', gender: 'F', age: 'young',  tags: ['educational', 'entertainment'], personalities: ['Agradável'] },
  { id: 'pt-BR-NicolauNeural',   name: 'Nicolau',   locale: 'pt-BR', gender: 'M', age: 'adult',  tags: ['characters'],                 personalities: ['Expressiva'] },
  { id: 'pt-BR-ValerioNeural',   name: 'Valerio',   locale: 'pt-BR', gender: 'M', age: 'adult',  tags: ['entertainment', 'narrative'], personalities: ['Energética'] },
  { id: 'pt-BR-YaraNeural',      name: 'Yara',      locale: 'pt-BR', gender: 'F', age: 'adult',  tags: ['narrative', 'entertainment'], personalities: ['Elegante'] },
  { id: 'en-US-EmmaMultilingualNeural', name: 'Emma Multilingual', locale: 'en-US', gender: 'F', age: 'adult', tags: ['narrative', 'characters', 'educational'], personalities: ['Versátil', 'Multilíngue'] },
];

/** Mapeia categorias do serviço (voices/list) para nossos contextos. */
function categoriesToTags(categories = []) {
  const map = {
    News: 'educational', Documentary: 'educational', Education: 'educational',
    Fiction: 'narrative', Stories: 'narrative', Novel: 'narrative',
    Conversation: 'conversational', Chat: 'conversational',
    Sports: 'entertainment', Entertainment: 'entertainment', Ads: 'entertainment', Movie: 'characters', Animation: 'characters',
  };
  const tags = new Set();
  for (const c of categories) if (map[c]) tags.add(map[c]);
  return [...tags];
}

/** Lista ao vivo do serviço mesclada com metadados locais (fallback: catálogo embutido). */
export async function fetchEdgeVoices() {
  const localMeta = new Map(EDGE_VOICES.map((v) => [v.id, v]));
  try {
    const res = await fetch(VOICES_URL);
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    return list
      .filter((v) => /^pt-BR|^en-US|^es-ES|^fr-FR/.test(v.Locale))
      .map((v) => {
        const local = localMeta.get(v.ShortName);
        return local || {
          id: v.ShortName,
          name: v.DisplayName || v.ShortName,
          locale: v.Locale,
          gender: v.Gender === 'Female' ? 'F' : 'M',
          age: 'adult',
          tags: categoriesToTags(v.VoiceTag?.ContentCategories),
          personalities: v.VoiceTag?.VoicePersonalities || [],
        };
      })
      .sort((a, b) => {
        const rank = (v) => (v.locale.startsWith('pt-BR') ? 0 : /^pt/.test(v.locale) ? 1 : /^en/.test(v.locale) ? 2 : 3);
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
  } catch {
    return EDGE_VOICES;
  }
}

/* ------------------------------ SSML / protocolo ------------------------------ */

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export /**
 * Idioma do SSML derivado do nome da voz ('pt-BR-FranciscaNeural' → 'pt-BR').
 * Fixar um idioma só faz as vozes de outra região pronunciationirem errado.
 */
function langForVoice(voice) {
  const m = /^([a-z]{2,3})-([A-Z]{2})\b/.exec(String(voice || ''));
  return m ? `${m[1]}-${m[2]}` : 'pt-BR';
}

function ssmlFor(text, voice, ratePct = 0, pitchHz = 0) {
  const rate = `${ratePct >= 0 ? '+' : ''}${ratePct}%`;
  const pitch = `${pitchHz >= 0 ? '+' : ''}${pitchHz}Hz`;
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langForVoice(voice)}'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}'>${escapeXml(text)}</prosody></voice></speak>`;
}

const DATE = () => new Date().toString();
const REQUEST_ID = () => crypto.randomUUID().replace(/-/g, '');

/* ------------------------- Síntese via WebSocket ------------------------- */

/**
 * Converte os formatos de word boundary do Edge para a forma canônica { ms, text }
 * usada por alignWordTimings. O Edge envia Offset/Duration em ticks de 100 ns;
 * a bridge (/api/tts) já entrega [[ms, text]].
 */
export function ssml(text, voice, ratePct = 0, pitchHz = 0) {
  return ssmlFor(text, voice, ratePct, pitchHz);
}

export function normalizeWordBoundaries(raw) {
  const out = [];
  for (const w of raw || []) {
    if (!w) continue;
    // formato de par: [ms, text] (header X-Timings)
    if (Array.isArray(w)) {
      const text = String(w[1] ?? '');
      if (text) out.push({ ms: Math.max(0, Number(w[0]) || 0), text });
      continue;
    }
    const text = String(w.text ?? '');
    if (!text) continue;
    // ticks (100 ns) → ms; já em ms quando `ms` vem preenchido
    const ms = Number.isFinite(w.ms) ? Number(w.ms) : Math.round((Number(w.offset) || 0) / 10000);
    out.push({ ms, text });
  }
  return out;
}

/**
 * Sintetiza UM segmento de texto em MP3 (48kbps mono 24kHz) via Edge TTS.
 * Retorna { blob, wordBoundaries: [{ ms, text }] } (já normalizado).
 */
export function synthesizeEdge(text, { voice = 'pt-BR-FranciscaNeural', ratePct = 0, pitchHz = 0, skew = 0, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));

    let settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    (async () => {
      const url = await buildWssUrl(skew);
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      const reqId = REQUEST_ID();
      const ts = DATE();
      const chunks = [];
      const wordBoundaries = []; // normalizado para { ms, text } (ver normalizeWordBoundaries)

      const sendTurnStart = () => ws.send(
        `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        })
      );

      const sendSsml = () => {
        const ssml = ssmlFor(text, voice, ratePct, pitchHz);
        ws.send(
          `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n` +
          ssml
        );
      };

      const parseMetadata = (buf) => {
        try {
          const s = new TextDecoder().decode(buf);
          const idx = s.indexOf('{');
          if (idx < 0) return;
          const msg = JSON.parse(s.slice(idx));
          if (msg?.Metadata?.[0]?.Type === 'WordBoundary') {
            const d = msg.Metadata[0].Data;
            // Edge emite Offset/Duration em ticks de 100ns; o resto do app
            // (alignWordTimings) só entende { ms, text }.
            wordBoundaries.push({
              ms: Math.round((d.Offset || 0) / 10000),
              text: d.text?.Text || '',
            });
          }
        } catch { /* ignora metadados malformados */ }
      };

      ws.onopen = () => { sendTurnStart(); sendSsml(); };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          if (ev.data.includes('Path:turn.end')) {
            ws.close();
            if (!chunks.length) return finish(reject, new Error('empty audio'));
            finish(resolve, { blob: new Blob(chunks, { type: 'audio/mpeg' }), wordBoundaries });
          }
        } else {
          // binário: header "Path:audio\r\n" de 2 bytes de comprimento + payload
          const view = new DataView(ev.data);
          const headerLen = view.getUint16(0);
          const header = new TextDecoder().decode(new Uint8Array(ev.data, 2, headerLen));
          if (header.includes('Path:audio')) {
            chunks.push(new Uint8Array(ev.data, 2 + headerLen));
          } else if (header.includes('Path:audio.metadata')) {
            // o JSON de metadados vem no PAYLOAD após o header
            parseMetadata(new Uint8Array(ev.data, 2 + headerLen));
          }
        }
      };
      ws.onerror = () => finish(reject, new Error('edge-tts websocket error'));
      ws.onclose = (e) => { if (!settled) finish(reject, new Error(`edge-tts closed (${e.code})`)); };

      if (signal) signal.addEventListener('abort', () => { try { ws.close(); } catch {} finish(reject, new DOMException('aborted', 'AbortError')); }, { once: true });
    })().catch((e) => finish(reject, e));
  });
}

/* --------------------- Síntese com fallback em cascata --------------------- */

let clockSkew = 0; // corrigido a partir do header Date em respostas 403 do proxy
let directBlocked = false; // memo: browser não consegue WebSocket direto (403/CORS)

/** URL da bridge: setting 'proxyUrl' ou mesma origem (default). */
function getProxyUrl() {
  try {
    const raw = localStorage.getItem('voxreader-proxy-url');
    return (raw || '').trim().replace(/\/$/, '') || '';
  } catch { return ''; }
}
/** Atualiza o proxy em runtime (chamado ao salvar settings). */
export function setProxyUrl(url) {
  try {
    if (url) localStorage.setItem('voxreader-proxy-url', String(url).trim().replace(/\/$/, ''));
    else localStorage.removeItem('voxreader-proxy-url');
  } catch { /* noop */ }
  resetEdgeProbe();
}

/**
 * Tenta: (1) WebSocket direto, (2) bridge local /api/tts, (3) lança erro
 * para o chamador cair na Web Speech API.
 */
export async function synthesize(text, opts = {}) {
  const { voice = 'pt-BR-FranciscaNeural', rate = 1, ratePct, pitchHz = 0, signal, proxyUrl } = opts;
  const effectiveRatePct = ratePct ?? Math.round((rate - 1) * 100);
  const proxy = proxyUrl ?? getProxyUrl();

  // 1) direto (memoizado: se já sabemos que o browser bloqueia, pulamos)
  if (!directBlocked) {
    try {
      return await synthesizeEdge(text, { voice, ratePct: effectiveRatePct, pitchHz, skew: clockSkew, signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      directBlocked = true; // 403/CORS não vai mudar nesta sessão
    }
  }

  // 2) bridge (local /api/tts ou remota configurada em Configurações)
  try {
    const res = await fetch(`${proxy}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, ratePct: effectiveRatePct, pitchHz }),
      signal,
    });
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    const blob = await res.blob();
    // Timings por palavra (header X-Timings base64, emitido pela bridge)
    let wordBoundaries = [];
    try {
      const raw = res.headers.get('X-Timings');
      if (raw) {
        wordBoundaries = normalizeWordBoundaries(JSON.parse(atob(raw)));
      }
    } catch { /* sem timings */ }
    return { blob, wordBoundaries };
  } catch (e) {
    if (signal?.aborted) throw e;
  }

  throw new Error('EDGE_UNAVAILABLE');
}

/* ------------------------------ Web Speech ------------------------------ */

export const webSpeech = {
  supported: 'speechSynthesis' in window,
  voices() {
    return window.speechSynthesis ? speechSynthesis.getVoices() : [];
  },
  speak(text, { voiceURI, rate = 1, onboundary, onend, onerror } = {}) {
    if (!this.supported) { onerror?.(new Error('Web Speech indisponível')); return null; }
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voices().find((x) => x.voiceURI === voiceURI);
    if (v) u.voice = v;
    u.rate = Math.min(2, Math.max(0.5, rate));
    u.onboundary = (e) => onboundary?.(e);
    u.onend = () => onend?.();
    u.onerror = (e) => onerror?.(e);
    speechSynthesis.speak(u);
    return u;
  },
  cancel() { if (this.supported) speechSynthesis.cancel(); },
  pause() { if (this.supported) speechSynthesis.pause(); },
  resume() { if (this.supported) speechSynthesis.resume(); },
};

/* ------------------------------ Status ------------------------------ */

let edgeAvailable = null; // memo: null = desconhecido, true/false
let probeCache = null;    // { ok, at } — TTL de 5 min para não sintetizar a cada load

export async function probeEdgeTTS(signal) {
  if (edgeAvailable !== null && probeCache && Date.now() - probeCache.at < 5 * 60 * 1000) {
    return edgeAvailable;
  }
  try {
    const { blob } = await synthesize('ok', { voice: 'pt-BR-FranciscaNeural', signal });
    edgeAvailable = blob && blob.size > 0;
  } catch {
    edgeAvailable = false;
  }
  probeCache = { ok: edgeAvailable, at: Date.now() };
  return edgeAvailable;
}
export function resetEdgeProbe() { edgeAvailable = null; probeCache = null; }
export function isEdgeKnownAvailable() { return edgeAvailable === true; }
