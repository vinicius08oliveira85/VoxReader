import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import type { AudioChunk } from '../types';

export function AudioPlayer() {
  const { state, actions } = useApp();
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const [waveform, setWaveform] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [showEngineSelector, setShowEngineSelector] = useState(false);
  
  const { player, currentBook, currentChapter, chapters, settings, voices, engineStatus } = state;

  useEffect(() => {
    const audio = audioRef.current;
    audio.volume = player.volume;
    audio.playbackRate = player.rate;

    const handleTimeUpdate = () => {
      actions.setPlayerState({ currentTime: audio.currentTime, duration: audio.duration || 0 });
    };

    const handleEnded = async () => {
      if (settings.autoPlayNext && currentChapter) {
        const currentIndex = chapters.findIndex(c => c.id === currentChapter?.id);
        if (currentIndex < chapters.length - 1) {
          const nextChapter = chapters[currentIndex + 1];
          await playChapter(nextChapter);
        } else {
          actions.setPlayerState({ isPlaying: false });
        }
      } else {
        actions.setPlayerState({ isPlaying: false });
      }
    };

    const handleError = () => {
      setIsLoading(false);
      actions.setPlayerState({ isPlaying: false });
    };

    const handleLoadStart = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [player.rate, player.volume, settings.autoPlayNext, currentChapter, chapters]);

  const playChunk = useCallback(async (chunk: AudioChunk) => {
    const audio = audioRef.current;
    const url = URL.createObjectURL(chunk.audioBlob);
    audio.src = url;
    audio.playbackRate = player.rate;
    audio.volume = player.volume;
    
    try {
      await audio.play();
      actions.setPlayerState({ 
        isPlaying: true, 
        currentChunkIndex: chunk.chunkIndex,
        queue: [chunk]
      });
    } catch (error) {
      console.error('Erro ao reproduzir:', error);
    }
  }, [player.rate, player.volume]);

  const playChapter = useCallback(async (chapter: typeof chapters[0]) => {
    if (!currentBook || !chapter.textContent) return;

    const engine = player.engine;
    const voice = player.voice;
    const chunks = await getAudioChunksForChapter(currentBook.id, chapter.id, engine, voice);
    
    if (chunks.length === 0) {
      const result = await synthesizeWithFallback({
        text: chapter.textContent,
        engine,
        voice,
        rate: settings.defaultRate
      });
      
      const chunk = {
        id: `${currentBook.id}::${chapter.id}::0::${engine}::${voice}`,
        bookId: currentBook.id,
        chapterId: chapter.id,
        chunkIndex: 0,
        text: chapter.textContent,
        audioBlob: result.audioBlob,
        mimeType: result.mimeType,
        duration: result.duration,
        engine,
        voice,
        createdAt: Date.now()
      };
      
      await playChunk(chunk);
      actions.setPlayerState({ currentBook, currentChapter: chapter });
      return;
    }

    await playChunk(chunks[0]);
    actions.setPlayerState({ currentBook, currentChapter: chapter });
  }, [currentBook, player.engine, player.voice, settings.defaultRate]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (audio.paused) {
      audio.play().catch(console.error);
      actions.setPlayerState({ isPlaying: true });
    } else {
      audio.pause();
      actions.setPlayerState({ isPlaying: false });
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
  }, []);

  const setRate = useCallback((rate: number) => {
    audioRef.current.playbackRate = rate;
    actions.setPlayerState({ rate });
  }, []);

  const setVolume = useCallback((volume: number) => {
    audioRef.current.volume = volume;
    actions.setPlayerState({ volume });
  }, []);

  const seek = useCallback((time: number) => {
    audioRef.current.currentTime = time;
  }, []);

  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-tertiary border-t border-border-light animate-slide-up">
      <div className="h-1 bg-gradient-to-r from-accent-primary to-accent-tertiary" style={{ width: `${progress}%` }} />
      
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted truncate max-w-xs">
                {currentBook?.title || 'Nenhum livro'}
              </span>
              {currentChapter && (
                <span className="text-xs text-text-muted truncate max-w-md">
                  {currentChapter.title}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => skip(-10)}
              className="p-2 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-primary transition-colors"
              aria-label="Voltar 10s"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 110 12 6 6 0 01-5.7-4.2l-1.9.7A8 8 0 1012 5z"/></svg>
            </button>

            <button 
              onClick={togglePlay}
              className="w-12 h-12 rounded-full bg-accent-primary hover:bg-accent-primary/90 text-bg-primary flex items-center justify-center shadow-lg shadow-accent-primary/30 transition-all active:scale-95"
              aria-label={player.isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {player.isPlaying ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
              ) : (
                <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              )}
            </button>

            <button 
              onClick={() => skip(10)}
              className="p-2 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-primary transition-colors"
              aria-label="Avançar 10s"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 5v14l5-5-5-5zm0 0V1l5 5-5 5z"/></svg>
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <button 
                onClick={() => setShowVoiceSelector(!showVoiceSelector)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-primary text-xs transition-colors"
              >
                <svg className="w-4 h-4 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8M12 4a3 3 0 013 3v4a3 3 0 11-6 0V7a3 3 0 013-3z"/></svg>
                <span className="truncate max-w-[100px]">
                  {voices.find(v => v.id === player.voice)?.name || player.voice}
                </span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
              </button>
              
              {showVoiceSelector && (
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-bg-tertiary border border-border-light rounded-lg shadow-xl overflow-hidden z-50 animate-fade-in">
                  <div className="p-2 border-b border-border-light">
                    <input 
                      type="text" 
                      placeholder="Filtrar vozes..." 
                      className="w-full px-2 py-1 text-xs bg-bg-primary border border-border-light rounded focus:outline-none focus:border-accent-primary"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {voices.map(voice => (
                      <button
                        key={voice.id}
                        onClick={() => {
                          actions.setPlayerState({ voice: voice.id, engine: voice.engine });
                          setShowVoiceSelector(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-xs hover:bg-bg-hover transition-colors ${
                          voice.id === player.voice ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-secondary'
                        } flex items-center gap-2`}
                      >
                        <span className={`w-2 h-2 rounded-full ${voice.engine === 'gemini' ? 'bg-accent-tertiary' : voice.engine === 'kokoro' ? 'bg-accent-secondary' : 'bg-accent-primary'}`} />
                        <span>{voice.name}</span>
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-bg-primary">
                          {voice.engine}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <select
              value={player.rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="px-2 py-1 text-xs bg-bg-secondary border border-border-light rounded focus:outline-none focus:border-accent-primary"
            >
              {[0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map(r => (
                <option key={r} value={r}>{r}x</option>
              ))}
            </select>

            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={player.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-20 accent-accent-primary"
            />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
          <span>{formatTime(player.currentTime)}</span>
          <div className="flex-1 h-1.5 bg-bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-accent-primary rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span>{formatTime(player.duration)}</span>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function getAudioChunksForChapter(bookId: string, chapterId: string, engine: string, voice: string) {
  const { getAudioChunksForChapter } = await import('../services/audioStorage');
  return getAudioChunksForChapter(bookId, chapterId, engine, voice);
}

async function synthesizeWithFallback(request: any) {
  const { synthesizeWithFallback } = await import('../services/ttsEngine');
  return synthesizeWithFallback(request);
}