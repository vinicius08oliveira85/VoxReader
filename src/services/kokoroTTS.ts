import { pipeline } from '@xenova/transformers';
import type { TTSRequest, TTSResult, VoiceOption } from '../types';

const KOKORO_VOICES: VoiceOption[] = [
  { id: 'af_heart', name: 'Heart (Feminina US)', engine: 'kokoro', language: 'en-US' },
  { id: 'af_bella', name: 'Bella (Feminina US)', engine: 'kokoro', language: 'en-US' },
  { id: 'af_nicole', name: 'Nicole (Feminina US)', engine: 'kokoro', language: 'en-US' },
  { id: 'af_sarah', name: 'Sarah (Feminina US)', engine: 'kokoro', language: 'en-US' },
  { id: 'am_michael', name: 'Michael (Masculina US)', engine: 'kokoro', language: 'en-US' },
  { id: 'am_fenrir', name: 'Fenrir (Masculina US)', engine: 'kokoro', language: 'en-US' },
  { id: 'bf_emma', name: 'Emma (Feminina UK)', engine: 'kokoro', language: 'en-GB' },
  { id: 'bf_isabella', name: 'Isabella (Feminina UK)', engine: 'kokoro', language: 'en-GB' },
  { id: 'bm_george', name: 'George (Masculina UK)', engine: 'kokoro', language: 'en-GB' },
  { id: 'pf_dora', name: 'Dora (Feminina PT-BR)', engine: 'kokoro', language: 'pt-BR' },
  { id: 'pm_alex', name: 'Alex (Masculina PT-BR)', engine: 'kokoro', language: 'pt-BR' },
  { id: 'zf_xiaobei', name: 'Xiaobei (Feminina CN)', engine: 'kokoro', language: 'zh-CN' },
  { id: 'zm_yunjian', name: 'Yunjian (Masculina CN)', engine: 'kokoro', language: 'zh-CN' },
  { id: 'jf_alpha', name: 'Alpha (Feminina JP)', engine: 'kokoro', language: 'ja-JP' },
  { id: 'jm_kumo', name: 'Kumo (Masculina JP)', engine: 'kokoro', language: 'ja-JP' }
];

let kokoroPipeline: any = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

export function getKokoroVoices(): VoiceOption[] {
  return KOKORO_VOICES;
}

export async function initKokoro(): Promise<void> {
  if (kokoroPipeline) return;
  if (isInitializing && initPromise) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      kokoroPipeline = await pipeline('text-to-speech', 'Xenova/kokoro-82m-v1.0-ONNX', {
        quantized: true,
        progress_callback: (progress: any) => {
          console.log(`Carregando Kokoro: ${Math.round(progress * 100)}%`);
        }
      });
      console.log('Kokoro TTS inicializado com WebGPU');
    } catch (error) {
      console.error('Falha ao inicializar Kokoro:', error);
      throw new Error('Não foi possível carregar o modelo Kokoro. Verifique suporte a WebGPU/WASM.');
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

export async function synthesizeWithKokoro(request: TTSRequest): Promise<TTSResult> {
  if (!kokoroPipeline) {
    await initKokoro();
  }

  if (!kokoroPipeline) {
    throw new Error('Kokoro não inicializado');
  }

  const voice = request.voice || 'pf_dora';
  const speed = request.rate || 1.0;

  try {
    const output = await kokoroPipeline(request.text, {
      voice,
      speed
    });

    const audioData = output.audio;
    const samplingRate = output.sampling_rate;

    const wavBlob = audioBufferToWav(audioData, samplingRate);

    return {
      audioBlob: wavBlob,
      mimeType: 'audio/wav',
      duration: output.audio.length / samplingRate
    };
  } catch (error) {
    console.error('Erro na síntese Kokoro:', error);
    throw new Error(`Falha na síntese Kokoro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

function audioBufferToWav(audioData: Float32Array, sampleRate: number): Blob {
  const length = audioData.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length * 2, true);

  const dataView = new Int16Array(buffer, 44, length);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]));
    dataView[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function isKokoroReady(): boolean {
  return kokoroPipeline !== null;
}

export function isKokoroInitializing(): boolean {
  return isInitializing;
}

export function getKokoroInitStatus(): 'ready' | 'initializing' | 'not-started' {
  if (kokoroPipeline) return 'ready';
  if (isInitializing) return 'initializing';
  return 'not-started';
}