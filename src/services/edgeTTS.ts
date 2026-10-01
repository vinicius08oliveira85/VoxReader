import type { TTSRequest, TTSResult, VoiceOption } from '../types';

const EDGE_VOICES: VoiceOption[] = [
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'female' },
  { id: 'pt-BR-AntonioNeural', name: 'Antonio (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'male' },
  { id: 'pt-BR-ThalitaNeural', name: 'Thalita (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'female' },
  { id: 'pt-BR-BrendaNeural', name: 'Brenda (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'female' },
  { id: 'pt-BR-ElzaNeural', name: 'Elza (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'female' },
  { id: 'pt-BR-GiovannaNeural', name: 'Giovanna (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'female' },
  { id: 'pt-BR-LeticiaNeural', name: 'Letícia (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'female' },
  { id: 'pt-BR-ManuelaNeural', name: 'Manuela (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'female' },
  { id: 'pt-BR-NicolauNeural', name: 'Nicolau (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'male' },
  { id: 'pt-BR-ValerioNeural', name: 'Valério (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'male' },
  { id: 'pt-BR-YaraNeural', name: 'Yara (PT-BR)', engine: 'edge', language: 'pt-BR', gender: 'female' },
  { id: 'en-US-AriaNeural', name: 'Aria (EN-US)', engine: 'edge', language: 'en-US', gender: 'female' },
  { id: 'en-US-DavisNeural', name: 'Davis (EN-US)', engine: 'edge', language: 'en-US', gender: 'male' },
  { id: 'en-US-JennyNeural', name: 'Jenny (EN-US)', engine: 'edge', language: 'en-US', gender: 'female' },
  { id: 'en-US-GuyNeural', name: 'Guy (EN-US)', engine: 'edge', language: 'en-US', gender: 'male' },
  { id: 'es-ES-ElviraNeural', name: 'Elvira (ES-ES)', engine: 'edge', language: 'es-ES', gender: 'female' },
  { id: 'es-ES-AlvaroNeural', name: 'Álvaro (ES-ES)', engine: 'edge', language: 'es-ES', gender: 'male' },
  { id: 'fr-FR-DeniseNeural', name: 'Denise (FR-FR)', engine: 'edge', language: 'fr-FR', gender: 'female' },
  { id: 'fr-FR-HenriNeural', name: 'Henri (FR-FR)', engine: 'edge', language: 'fr-FR', gender: 'male' }
];

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600;
const CHROMIUM_VERSION = '120.0.0.0';

function generateSecMsGec(): string {
  let ticks = BigInt(Math.floor(Date.now() / 1000));
  ticks += BigInt(WIN_EPOCH);
  ticks -= ticks % 300n;
  ticks *= 10_000_000n;
  const crypto = window.crypto || window.msCrypto;
  const array = new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
  const hash = crypto.subtle.digest('SHA-256', array);
  return hash.then((buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  });
}

async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, b => b.toString(16).padStart(2, '0')).join('');
}

export function getEdgeVoices(): VoiceOption[] {
  return EDGE_VOICES;
}

export function getEdgeVoicesByLanguage(lang: string): VoiceOption[] {
  return EDGE_VOICES.filter(v => v.language.startsWith(lang.split('-')[0]));
}

export async function synthesizeWithEdge(request: TTSRequest): Promise<TTSResult> {
  const voice = request.voice || 'pt-BR-FranciscaNeural';
  const rate = request.rate || 1.0;
  const pitch = request.pitch || 1.0;
  const volume = request.volume || 1.0;

  const ratePct = Math.round((rate - 1) * 100);
  const pitchHz = Math.round((pitch - 1) * 50);

  const gec = await sha256Hex(
    `${BigInt(Math.floor(Date.now() / 1000) + WIN_EPOCH - (BigInt(Math.floor(Date.now() / 1000)) + WIN_EPOCH) % 300n) * 10_000_000n}${TRUSTED_CLIENT_TOKEN}`
  );

  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${gec}` +
    `&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;

  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(new Error('Falha ao conectar WebSocket Edge TTS'));
      return;
    }

    const audioChunks: Uint8Array[] = [];
    const wordBoundaries: Array<{ offset: number; text: string }> = [];
    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout na síntese Edge TTS (30s)'));
    }, 30000);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const timestamp = new Date().toISOString();
      const configMsg = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataOptions: {
                sentenceBoundaryEnabled: 'false',
                wordBoundaryEnabled: 'true'
              },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
            }
          }
        }
      });
      ws.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${configMsg}`);

      const ssml = buildSSML(request.text, voice, ratePct, pitchHz);
      const requestId = crypto.randomUUID().replace(/-/g, '');
      ws.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:audio.metadata')) {
          try {
            const jsonStart = event.data.indexOf('{');
            const meta = JSON.parse(event.data.slice(jsonStart));
            for (const m of meta.Metadata || []) {
              if (m.Type === 'WordBoundary' && m.Data) {
                wordBoundaries.push({
                  offset: Math.round((m.Data.Offset || 0) / 10000),
                  text: m.Data.Text || ''
                });
              }
            }
          } catch { }
        }
        if (event.data.includes('Path:turn.end')) {
          cleanup();
          const audioBlob = new Blob(audioChunks, { type: 'audio/mpeg' });
          resolve({
            audioBlob,
            mimeType: 'audio/mpeg',
            duration: estimateDuration(request.text),
            timing: wordBoundaries.map(w => ({ word: w.text, startTime: w.offset, endTime: w.offset + 100 }))
          });
        }
        return;
      }

      const arrayBuffer = event.data as ArrayBuffer;
      if (arrayBuffer.byteLength < 2) return;

      const view = new DataView(arrayBuffer);
      const headerLength = view.getUint16(0, false);
      const header = new TextDecoder().decode(arrayBuffer.slice(2, 2 + headerLength));

      if (header.includes('Path:audio')) {
        const audioData = arrayBuffer.slice(2 + headerLength);
        audioChunks.push(new Uint8Array(audioData));
      }
    };

    ws.onerror = (err) => {
      cleanup();
      reject(new Error('Erro no WebSocket Edge TTS'));
    };

    ws.onclose = (event) => {
      cleanup();
      if (audioChunks.length === 0) {
        reject(new Error(`Conexão fechada sem áudio (código: ${event.code})`));
      }
    };
  });
}

function buildSSML(text: string, voice: string, ratePct: number, pitchHz: number): string {
  const escapedText = text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');

  const rateStr = `${ratePct >= 0 ? '+' : ''}${ratePct}%`;
  const pitchStr = `${pitchHz >= 0 ? '+' : ''}${pitchHz}Hz`;

  const langMatch = voice.match(/^([a-z]{2})-([A-Z]{2})/);
  const lang = langMatch ? `${langMatch[1]}-${langMatch[2]}` : 'pt-BR';

  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>
    <voice name='${voice}'>
      <prosody rate='${rateStr}' pitch='${pitchStr}' volume='${request.volume || 1.0}'>
        ${escapedText}
      </prosody>
    </voice>
  </speak>`;
}

function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil((words / 150) * 60);
}

export function getEdgeVoicesByGender(gender: 'male' | 'female'): VoiceOption[] {
  return EDGE_VOICES.filter(v => v.gender === gender);
}

export function getEdgeVoicesList(): VoiceOption[] {
  return EDGE_VOICES;
}