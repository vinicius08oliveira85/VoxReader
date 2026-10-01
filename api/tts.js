import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const crypto = require('crypto');

const WIN_EPOCH = 11644473600n;
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '130.0.0.0';

async function sha256HexUpper(data) {
  return crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
}

async function generateSecMsGec(skew = 0) {
  let ticks = BigInt(Math.floor(Date.now() / 1000 + skew));
  ticks += WIN_EPOCH;
  ticks -= ticks % 300n;
  ticks *= 10_000_000n;
  return sha256HexUpper(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
}

async function getWebSocketCtor() {
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
  const esc = (s) => s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  const rp = `${ratePct >= 0 ? '+' : ''}${Math.round(ratePct)}%`;
  const ph = `${pitchHz >= 0 ? '+' : ''}${Math.round(pitchHz)}Hz`;
  const lang = (String(voice).match(/^([a-z]{2})-([A-Za-z]{2})-/) || [])[0];
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang || 'pt-BR'}'>` +
    `<voice name='${voice}'><prosody rate='${rp}' pitch='${ph}'>${esc(text)}</prosody></voice></speak>`;
  const chunks = [];
  const words = [];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 25000);
    ws.on('open', () => {
      const ts = new Date().toString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }));
      ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const s = String(data);
        if (s.includes('Path:audio.metadata')) {
          try {
            const meta = JSON.parse(s.slice(s.indexOf('{')));
            for (const m of meta?.Metadata || []) {
              if (m?.Type === 'WordBoundary' && m?.Data) {
                words.push({ ms: Math.round((m.Data.Offset || 0) / 10000), text: m.Data.text?.Text || '' });
              }
            }
          } catch { }
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
        } catch { }
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

function corsHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'X-Timings',
    'Vary': 'Origin',
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...corsHeaders(req), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  let payload;
  try { payload = JSON.parse(body); } catch { res.writeHead(400, { ...corsHeaders(req), 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'json inválido' })); }

  const { text = '', voice = 'pt-BR-FranciscaNeural', rate = 1, ratePct, pitchHz = 0 } = payload;
  if (!text.trim()) { res.writeHead(400, { ...corsHeaders(req), 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'texto vazio' })); }

  const effectiveRatePct = ratePct != null ? Number(ratePct) : (Number(rate) - 1) * 100;

  try {
    const { mp3, words } = await edgeTtsWebSocket(String(text).slice(0, 4000), voice, effectiveRatePct, Number(pitchHz) || 0);

    const headers = {
      ...corsHeaders(req),
      'Content-Type': 'audio/mpeg',
      'Content-Length': mp3.length,
      'Cache-Control': 'no-store',
    };
    try {
      const payload = JSON.stringify(words.map((w) => [w.ms, w.text]));
      const b64 = Buffer.from(payload, 'utf8').toString('base64');
      if (b64.length <= 6000) headers['X-Timings'] = b64;
    } catch { }

    res.writeHead(200, headers);
    res.end(mp3);
  } catch (e) {
    res.writeHead(502, { ...corsHeaders(req), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}