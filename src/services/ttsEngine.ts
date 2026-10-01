import type { TTSRequest, TTSResult, VoiceOption, TTSEngine } from '../types';
import { synthesizeWithGemini, initGemini, getGeminiVoices, isGeminiReady } from './geminiAudio';
import { synthesizeWithKokoro, initKokoro, getKokoroVoices, isKokoroReady, getKokoroInitStatus } from './kokoroTTS';
import { synthesizeWithEdge, getEdgeVoices, getEdgeVoicesByLanguage } from './edgeTTS';
import { getSetting, saveSetting } from './audioStorage';

export interface EngineStatus {
  gemini: { ready: boolean; voices: number };
  kokoro: { ready: boolean; status: 'ready' | 'initializing' | 'not-started'; voices: number };
  edge: { ready: boolean; voices: number };
}

export async function initAllEngines(): Promise<void> {
  const apiKey = await getSetting<string>('geminiApiKey', '');
  if (apiKey) {
    initGemini(apiKey);
  }

  try {
    await initKokoro();
  } catch (e) {
    console.warn('Kokoro não pôde ser inicializado:', e);
  }
}

export function getEngineStatus(): EngineStatus {
  return {
    gemini: { ready: isGeminiReady(), voices: getGeminiVoices().length },
    kokoro: { 
      ready: isKokoroReady(), 
      status: getKokoroInitStatus(),
      voices: getKokoroVoices().length 
    },
    edge: { ready: true, voices: getEdgeVoices().length }
  };
}

export async function getAllVoices(): Promise<VoiceOption[]> {
  const status = getEngineStatus();
  const voices: VoiceOption[] = [];

  if (status.gemini.ready) voices.push(...getGeminiVoices());
  if (status.kokoro.ready) voices.push(...getKokoroVoices());
  voices.push(...getEdgeVoices());

  return voices;
}

export async function getVoicesForEngine(engine: TTSEngine): Promise<VoiceOption[]> {
  switch (engine) {
    case 'gemini': return getGeminiVoices();
    case 'kokoro': return getKokoroVoices();
    case 'edge': return getEdgeVoices();
    default: return [];
  }
}

export async function getVoicesForLanguage(language: string): Promise<VoiceOption[]> {
  const allVoices = await getAllVoices();
  const langPrefix = language.split('-')[0];
  return allVoices.filter(v => v.language.startsWith(langPrefix));
}

export async function synthesize(request: TTSRequest): Promise<TTSResult> {
  const engine = request.engine || (await getSetting<TTSEngine>('preferredEngine', 'edge'));
  const voice = request.voice || (await getSetting<string>('preferredVoice', getDefaultVoice(engine)));

  const finalRequest: TTSRequest = {
    ...request,
    engine,
    voice
  };

  switch (engine) {
    case 'gemini':
      if (!isGeminiReady()) {
        const apiKey = await getSetting<string>('geminiApiKey', '');
        if (!apiKey) throw new Error('API Key do Gemini não configurada');
        initGemini(apiKey);
      }
      return synthesizeWithGemini(finalRequest);

    case 'kokoro':
      return synthesizeWithKokoro(finalRequest);

    case 'edge':
      return synthesizeWithEdge(finalRequest);

    default:
      throw new Error(`Engine desconhecido: ${engine}`);
  }
}

export async function synthesizeWithFallback(request: TTSRequest): Promise<TTSResult> {
  const primaryEngine = request.engine || (await getSetting<TTSEngine>('preferredEngine', 'edge'));
  const engines: TTSEngine[] = [primaryEngine, 'edge', 'kokoro', 'gemini'].filter((e, i, a) => a.indexOf(e) === i);

  let lastError: Error | null = null;

  for (const engine of engines) {
    try {
      if (engine === 'gemini' && !isGeminiReady()) {
        const apiKey = await getSetting<string>('geminiApiKey', '');
        if (!apiKey) continue;
        initGemini(apiKey);
      }
      if (engine === 'kokoro' && !isKokoroReady()) {
        try {
          await initKokoro();
        } catch { continue; }
      }

      const result = await synthesize({ ...request, engine });
      if (engine !== primaryEngine) {
        console.log(`Fallback para engine: ${engine}`);
      }
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Engine ${engine} falhou:`, lastError.message);
      continue;
    }
  }

  throw lastError || new Error('Todos os engines de TTS falharam');
}

export async function setPreferredEngine(engine: TTSEngine): Promise<void> {
  await saveSetting('preferredEngine', engine);
}

export async function setPreferredVoice(voice: string): Promise<void> {
  await saveSetting('preferredVoice', voice);
}

export async function setGeminiApiKey(apiKey: string): Promise<void> {
  await saveSetting('geminiApiKey', apiKey);
  initGemini(apiKey);
}

export async function getGeminiApiKey(): Promise<string> {
  return getSetting<string>('geminiApiKey', '');
}

function getDefaultVoice(engine: TTSEngine): string {
  switch (engine) {
    case 'gemini': return 'Puck';
    case 'kokoro': return 'pf_dora';
    case 'edge': return 'pt-BR-FranciscaNeural';
    default: return 'pt-BR-FranciscaNeural';
  }
}

export async function preloadEngine(engine: TTSEngine): Promise<void> {
  switch (engine) {
    case 'gemini':
      const apiKey = await getSetting<string>('geminiApiKey', '');
      if (apiKey) initGemini(apiKey);
      break;
    case 'kokoro':
      if (!isKokoroReady() && getKokoroInitStatus() !== 'initializing') {
        await initKokoro();
      }
      break;
    case 'edge':
      break;
  }
}

export function estimateDuration(text: string, wpm: number = 150): number {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil((words / wpm) * 60);
}