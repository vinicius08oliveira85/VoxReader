import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TTSRequest, TTSResult, VoiceOption } from '../types';

const GEMINI_VOICES: VoiceOption[] = [
  { id: 'Puck', name: 'Puck (Neutro)', engine: 'gemini', language: 'multi' },
  { id: 'Charon', name: 'Charon (Grave)', engine: 'gemini', language: 'multi' },
  { id: 'Kore', name: 'Kore (Feminina)', engine: 'gemini', language: 'multi' },
  { id: 'Fenrir', name: 'Fenrir (Masculina)', engine: 'gemini', language: 'multi' },
  { id: 'Aoede', name: 'Aoede (Suave)', engine: 'gemini', language: 'multi' }
];

let genAI: GoogleGenerativeAI | null = null;

export function initGemini(apiKey: string): void {
  genAI = new GoogleGenerativeAI(apiKey);
}

export function getGeminiVoices(): VoiceOption[] {
  return GEMINI_VOICES;
}

export async function synthesizeWithGemini(request: TTSRequest): Promise<TTSResult> {
  if (!genAI) {
    throw new Error('Gemini não inicializado. Configure a API Key primeiro.');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const generationConfig = {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: request.voice }
      }
    }
  };

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: request.text }] }],
      generationConfig
    });

    const audioData = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    
    if (!audioData || !audioData.data) {
      throw new Error('Nenhum áudio retornado pelo Gemini');
    }

    const binaryString = atob(audioData.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const mimeType = audioData.mimeType || 'audio/wav';
    const audioBlob = new Blob([bytes], { type: mimeType });
    
    return {
      audioBlob,
      mimeType,
      duration: estimateDuration(request.text)
    };
  } catch (error) {
    console.error('Erro na síntese Gemini:', error);
    throw new Error(`Falha na síntese Gemini: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

export async function synthesizeWithGeminiStreaming(
  request: TTSRequest,
  onChunk: (chunk: Uint8Array) => void
): Promise<TTSResult> {
  if (!genAI) {
    throw new Error('Gemini não inicializado. Configure a API Key primeiro.');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const generationConfig = {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: request.voice }
      }
    }
  };

  const result = await model.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: request.text }] }],
    generationConfig
  });

  const chunks: Uint8Array[] = [];

  for await (const chunk of result.stream) {
    const audioData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (audioData?.data) {
      const binaryString = atob(audioData.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      chunks.push(bytes);
      onChunk(bytes);
    }
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const mimeType = 'audio/wav';
  const audioBlob = new Blob([combined], { type: mimeType });

  return {
    audioBlob,
    mimeType,
    duration: estimateDuration(request.text)
  };
}

function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil((words / 150) * 60);
}

export function isGeminiReady(): boolean {
  return genAI !== null;
}