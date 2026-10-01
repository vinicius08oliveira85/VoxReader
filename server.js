#!/usr/bin/env node
/**
 * server.js — Servidor estático zero-dependência + bridge opcional Edge TTS.
 *
 *   node server.js            → http://localhost:8080
 *   PORT=3000 node server.js  → porta customizada
 *
 * A bridge /api/tts resolve o 403/CORS do Edge TTS quando o browser é bloqueado:
 * mesma implementação do cliente (WebSocket + Sec-MS-GEC), rodando em Node,
 * onde os headers de "Edge" podem ser enviados livremente.
 */
import http from 'node:http';
import { createReadStream, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const requestedPort = Number(process.env.PORT);
const PORT = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

/**
 * CSP do shell. `unsafe-eval` é exigido pelo runtime do Tailwind (new Function);
 * `unsafe-inline` cobre o bloco <script> de configuração em index.html.
 * cdn.tailwindcss.com saiu da lista: o Tailwind é servido de /vendor/.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' blob: https://speech.platform.bing.com https://generativelanguage.googleapis.com ws: wss:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Origem liberada para a bridge /api/tts. Só a própria origem do servidor: com '*'
 * qualquer site aberto no browser poderia usar a máquina do usuário como proxy de TTS.
 * O remote proxy configurado em Configurações continua acessível (é outra origem,
 * atendida pelo browser, não pelo CORS deste servidor).
 */
function corsOrigin(req) {
  const host = req.headers.host;
  if (!host) return 'null';
  const name = String(host).split(':')[0];
  const isLoopback = name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
  return isLoopback ? `http://${host}` : 'null';
}

/* ------------------------------ /api/tts ------------------------------ */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600n;
const CHROMIUM_FULL_VERSION = '143.0.3650.75';

async function sha256HexUpper(str) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(str, 'ascii').digest('hex').toUpperCase();
}

async function generateSecMsGec(skew = 0) {
  let ticks = BigInt(Math.floor(Date.now() / 1000 + skew));
  ticks += WIN_EPOCH;
  ticks -= ticks % 300n;
  ticks *= 10_000_000n;
  return sha256HexUpper(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
}

async function getWebSocketCtor() {
  // 1º: pacote ws (suporta headers customizados) · 2º: WebSocket nativo do Node ≥22
  try {
    const mod = await import('ws');
    return mod.default ?? mod.WebSocket;
  } catch {
    if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
    throw new Error('PACOTE_WS_AUSENTE');
  }
}

async function edgeTtsWebSocket(text, voice, ratePct = 0, pitchHz = 0) {
  const WebSocket = await getWebSocketCtor();
  const gec = await generateSecMsGec();
  const major = CHROMIUM_FULL_VERSION.split('.')[0];
  const url =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${gec}` +
    `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
  const ws = new WebSocket(url, {
    headers: {
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
    },
  });
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rp = `${ratePct >= 0 ? '+' : ''}${Math.round(ratePct)}%`;
  const ph = `${pitchHz >= 0 ? '+' : ''}${Math.round(pitchHz)}Hz`;
  // xml:lang vem do nome da voz, como no ttsEngine.js do browser: fixar 'pt-BR'
  // fazia toda voz en-US/es-ES/fr-FR pronunciar errado.
  const lang = (String(voice).match(/^([a-z]{2})-([A-Za-z]{2})-/) || [])[0];
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang || 'pt-BR'}'>` +
    `<voice name='${voice}'><prosody rate='${rp}' pitch='${ph}'>${esc(text)}</prosody></voice></speak>`;
  const chunks = [];
  const words = []; // [{ ms, text }] — timing exato por palavra (ticks 100ns → ms)
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 30000);
    ws.on('open', () => {
      const ts = new Date().toString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }));
      ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const s = String(data);
        // audio.metadata chega como mensagem de TEXTO (JSON após o header)
        if (s.includes('Path:audio.metadata')) {
          try {
            const meta = JSON.parse(s.slice(s.indexOf('{')));
            for (const m of meta?.Metadata || []) {
              if (m?.Type === 'WordBoundary' && m?.Data) {
                words.push({ ms: Math.round((m.Data.Offset || 0) / 10000), text: m.Data.text?.Text || '' });
              }
            }
          } catch { /* metadados malformados: ignora */ }
        }
        if (s.includes('Path:turn.end')) {
          clearTimeout(t);
          ws.close();
          resolve({ mp3: Buffer.concat(chunks), words });
        }
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      const header = buf.toString('utf8', 2, 2 + headerLen);
      if (header.includes('Path:audio')) {
        chunks.push(buf.subarray(2 + headerLen));
      } else if (header.includes('Path:audio.metadata')) {
        try {
          const meta = JSON.parse(buf.toString('utf8', 2 + headerLen));
          for (const m of meta?.Metadata || []) {
            if (m?.Type === 'WordBoundary' && m?.Data) {
              words.push({ ms: Math.round((m.Data.Offset || 0) / 10000), text: m.Data.text?.Text || '' });
            }
          }
        } catch { /* metadados malformados: ignora */ }
      }
    });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
    ws.on('close', (code) => {
      clearTimeout(t);
      if (!chunks.length) reject(new Error(`fechado sem áudio (${code})`));
      else resolve({ mp3: Buffer.concat(chunks), words });
    });
  });
}

function handleTts(req, res, body) {
  let payload;
  try { payload = JSON.parse(body); } catch { res.writeHead(400); return res.end('json inválido'); }
  const { text = '', voice = 'pt-BR-FranciscaNeural', rate = 1, ratePct, pitchHz = 0 } = payload;
  if (!text.trim()) { res.writeHead(400); return res.end('texto vazio'); }
  edgeTtsWebSocket(String(text).slice(0, 4000), voice, ratePct != null ? Number(ratePct) : (Number(rate) - 1) * 100, Number(pitchHz) || 0)
    .then(({ mp3, words }) => {
      const headers = {
        'Content-Type': 'audio/mpeg',
        'Content-Length': mp3.length,
        'Access-Control-Allow-Origin': corsOrigin(req),
        'Access-Control-Expose-Headers': 'X-Timings',
        'Cache-Control': 'no-store',
      };
      // Timing por palavra no header (base64 JSON compacto) — limita a ~6KB
      try {
        const payload = JSON.stringify(words.map((w) => [w.ms, w.text]));
        const b64 = Buffer.from(payload, 'utf8').toString('base64');
        if (b64.length <= 6000) headers['X-Timings'] = b64;
      } catch { /* sem timings */ }
      res.writeHead(200, headers);
      res.end(mp3);
    })
    .catch((e) => {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin(req) });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    });
}

/* --------------------------- Share target (PWA) --------------------------- */

/**
 * O manifest.json declara share_target → POST multipart em "/". Sem este
 * treatment o servidor devolvia o shell HTML e o arquivo compartilhado se
 * perdia. O upload vai para um diretório temporário com id aleatório e o
 * browser é redirecionado para "/?share=<id>"; o cliente busca em
 * /share/<id>, importa e pede o descarte com DELETE.
 */
const SHARE_DIR = join(tmpdir(), 'voxreader-share');
const SHARE_MAX_BYTES = 64 * 1024 * 1024; // 64 MB: e-Pub grande com imagens
const SHARE_TTL_MS = 10 * 60 * 1000;       // 10 min para o cliente buscar

/** Indexa os bytes do corpo pelos delimitadores do multipart/form-data. */
function parseMultipartFile(body, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  let pos = body.indexOf(marker);
  while (pos !== -1) {
    const partStart = pos + marker.length;
    // "--" após o marcador = fim do envelope.
    if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) return null;
    const headerEnd = body.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) return null;
    const rawHeaders = body.toString('utf8', partStart, headerEnd);
    const next = body.indexOf(marker, headerEnd);
    if (next === -1) return null;
    // O CRLF antes do próximo delimitador pertence ao boundary, não ao conteúdo.
    const data = body.subarray(headerEnd + 4, next - 2);
    if (/filename\s*=/i.test(rawHeaders)) {
      const nameMatch = /filename\*?=(?:UTF-8'')?"?([^";\r\n]+)"?/i.exec(rawHeaders);
      const filename = (nameMatch?.[1] || 'compartilhado.epub').replace(/[^\w.\- ]+/g, '_');
      return { filename, data };
    }
    pos = next;
  }
  return null;
}

/** Remove uploads que ninguém buscou (app fechado, cliente caiu). */
function sweepShares() {
  let entries = [];
  try { entries = readdirSync(SHARE_DIR); } catch { return; }
  const now = Date.now();
  for (const name of entries) {
    try {
      if (now - statSync(join(SHARE_DIR, name)).mtimeMs > SHARE_TTL_MS) {
        unlinkSync(join(SHARE_DIR, name));
      }
    } catch { /* já removido */ }
  }
}

/** Valida o id: base32/hexadecimal puro, sem separadores — evita path traversal. */
function shareIdFrom(pathname) {
  const m = /^\/share\/([a-f0-9]{16,64})$/.exec(pathname);
  return m ? m[1] : null;
}

async function handleShareUpload(req, res) {
  const contentType = String(req.headers['content-type'] || '');
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!/multipart\/form-data/i.test(contentType) || !boundary) {
    res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('esperava multipart/form-data');
  }
  const body = await readBody(req, SHARE_MAX_BYTES);
  const file = parseMultipartFile(body, (boundary[1] || boundary[2]).trim());
  if (!file || !file.data.length) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('nenhum arquivo no compartilhamento');
  }
  if (!file.filename.toLowerCase().endsWith('.epub')) {
    res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('apenas .epub');
  }
  sweepShares();
  mkdirSync(SHARE_DIR, { recursive: true });
  const id = randomBytes(12).toString('hex');
  writeFileSync(join(SHARE_DIR, id), file.data);
  // 303: o browser segue para a UI mantendo o método GET.
  res.writeHead(303, { Location: `/?share=${id}`, 'Cache-Control': 'no-store' });
  res.end();
}

async function handleShare(req, res, pathname) {
  const id = shareIdFrom(pathname);
  if (!id) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('não encontrado');
  }
  const file = join(SHARE_DIR, id);
  if (req.method === 'DELETE') {
    try { unlinkSync(file); } catch { /* já descartado */ }
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD, DELETE' });
    return res.end();
  }
  let stat;
  try { stat = statSync(file); } catch {
    res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('compartilhamento expirou');
  }
  res.writeHead(200, {
    'Content-Type': 'application/epub+zip',
    'Content-Length': stat.size,
    'Content-Disposition': 'attachment',
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  return createReadStream(file).pipe(res);
}

/* ------------------------------ Static server ------------------------------ */

/** Corpo máximo aceito nas rotas POST (12 KB de texto já cobre o limite de 4000 chars). */
const MAX_BODY = 64 * 1024;

function tooLarge() {
  return Object.assign(new Error('corpo grande demais'), { statusCode: 413 });
}

/**
 * Lê o corpo com teto de tamanho. Ao estourar, responde 413 de verdade e descarta
 * o resto (não destroy() — isso arriveia a conexão e o cliente não vê o status).
 */
function readBody(req, limit = MAX_BODY) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.reject(tooLarge());
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const bufs = [];
    let size = 0;
    let done = false;
    const finish = (fn, val) => { if (!done) { done = true; fn(val); } };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        bufs.length = 0;
        finish(rejectPromise, tooLarge());
        req.resume(); // drena o resto para não travar o socket
        return;
      }
      bufs.push(c);
    });
    req.on('end', () => finish(resolvePromise, Buffer.concat(bufs)));
    req.on('error', (e) => finish(rejectPromise, e));
    req.on('aborted', () => finish(rejectPromise, Object.assign(new Error('requisição abortada'), { statusCode: 400 })));
  });
}

/** Traduz uma URL em caminho relativo seguro dentro de ROOT (ou null se escapar). */
function safeRelPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // % malformado — antes disso derrubava o processo inteiro
  }
  if (decoded.includes('\0')) return null;
  let rel;
  try {
    rel = normalize(decoded).replace(/^([/\\])+/, '');
  } catch {
    return null;
  }
  const full = resolve(ROOT, rel);
  // ROOT vem de fileURLToPath com barra final; resolve() a remove. Comparar sem
  // normalizar os dois lados rejeitava a própria raiz ("/" → 400).
  const base = ROOT.endsWith(sep) ? ROOT.slice(0, -1) : ROOT;
  // Compara por segmento: evita que "C:\...\Reader-evil" passe no startsWith de "C:\...\Reader"
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS' && url.pathname === '/api/tts') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': corsOrigin(req),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (url.pathname === '/api/tts' && req.method === 'POST') {
    const body = await readBody(req);
    return handleTts(req, res, body.toString('utf8'));
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ts: Date.now() }));
  }

  if (url.pathname === '/' && req.method === 'POST') return handleShareUpload(req, res);
  if (url.pathname.startsWith('/share/')) return handleShare(req, res, url.pathname);

  if (url.pathname === '/favicon.ico') {
    res.writeHead(302, { Location: '/icons/favicon.png' });
    return res.end();
  }

  const filePath = safeRelPath(url.pathname);
  if (!filePath) { res.writeHead(400); return res.end('requisição inválida'); }
  const ROOT_BASE = ROOT.endsWith(sep) ? ROOT.slice(0, -1) : ROOT;
  const path = filePath === ROOT_BASE ? join(ROOT_BASE, 'index.html') : filePath;

  let stat = null;
  try { stat = statSync(path); } catch { /* inexistente */ }
  if (!stat || !stat.isFile()) {
    // Só navegações recebem o shell; qualquer outro recurso 404 real (senão um
    // módulo faltando viraria HTML com 200 e um erro de MIME confuso no browser).
    if (!req.headers['sec-fetch-mode'] || req.headers['sec-fetch-mode'] === 'navigate') {
      const index = join(ROOT_BASE, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return createReadStream(index).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('não encontrado');
  }

  const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
  const immutable = url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/');
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Service-Worker-Allowed': '/',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
  if (type.startsWith('text/html')) {
    headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY;
  }

  const range = parseRange(req.headers.range, stat.size);
  if (range) {
    headers['Content-Length'] = range.end - range.start + 1;
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers['Accept-Ranges'] = 'bytes';
    res.writeHead(206, headers);
    return createReadStream(path, { start: range.start, end: range.end }).pipe(res);
  }
  headers['Accept-Ranges'] = 'bytes';

  if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
  res.writeHead(200, headers);
  createReadStream(path).pipe(res);
}

/** Resolve `Range: bytes=a-b` (uma única faixa). Retorna null se ausente/inválido. */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  let start;
  let end;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

const server = http.createServer((req, res) => {
  // Rede de segurança: sem isto, qualquer exceção num request derrubaria o processo
  // inteiro (já aconteceu com decodeURIComponent('%')).
  handleRequest(req, res).catch((e) => {
    const code = e?.statusCode || 500;
    if (!res.headersSent) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: String(e?.message || e) }));
    if (code >= 500) console.error('erro ao tratar requisição:', e);
  });
});

// Pedidos malformados (linha HTTP inválida, header gigante) não devem derrubar o servidor.
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.on('error', (e) => {
  console.error('erro no servidor:', e.message);
  process.exitCode = 1;
});

// Housekeeping do share target: expira uploads não buscados a cada 5 min.
const sweepTimer = setInterval(sweepShares, 5 * 60 * 1000);
sweepTimer.unref();

server.listen(PORT, () => {
  console.log(`\n  📖 VoxReader rodando em http://localhost:${PORT}\n`);
  console.log('  Bridge /api/tts: ativa (fallback para Edge TTS no browser)');
  console.log('  Dica: para a bridge funcionar em produção local, instale ws:  npm i ws\n');
});
