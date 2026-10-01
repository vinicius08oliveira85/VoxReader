import { useState, useEffect, useRef, useCallback } from 'react';

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }, []);

  const loadSrc = useCallback((src: string, options?: { autoplay?: boolean }) => {
    const audio = initAudio();
    audio.src = src;
    audio.preload = 'auto';
    
    if (options?.autoplay) {
      audio.play().catch(setError);
    }

    return new Promise<{ duration: number }>((resolve, reject) => {
      audio.onloadedmetadata = () => {
        setDuration(audio.duration);
        setLoaded(true);
        resolve({ duration: audio.duration });
      };
      audio.onerror = () => reject(new Error('Erro ao carregar áudio'));
    });
  }, [initAudio]);

  const play = useCallback(async () => {
    const audio = initAudio();
    try {
      await audio.play();
      setIsPlaying(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao reproduzir');
    }
  }, [initAudio]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(duration, time));
      setCurrentTime(time);
    }
  }, [duration]);

  const setRate = useCallback((rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volume));
    }
  }, []);

  useEffect(() => {
    const audio = initAudio();
    
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [initAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    const handleVisibilityChange = () => {
      if (document.hidden && audio?.paused === false) {
        audio.pause();
        setIsPlaying(false);
      } else if (document.visibilityState === 'visible' && audio && audio.src) {
        audio.play().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    loaded,
    error,
    loadSrc,
    play,
    pause,
    stop,
    seek,
    setRate,
    setVolume,
    setIsPlaying,
    setCurrentTime
  };
}

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      try {
        window.localStorage.setItem(key, JSON.stringify(newValue));
      } catch {
        console.warn(`Failed to set localStorage key "${key}"`);
      }
      return newValue;
    });
  }, [key]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          setStoredValue(JSON.parse(e.newValue));
        } catch {
          setStoredValue(initialValue);
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [key, initialValue]);

  return [storedValue, setValue] as const;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    
    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);
    
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export function useKeyPress(key: string, modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === key && (!modifiers.ctrl || e.ctrlKey) && (!modifiers.shift || e.shiftKey) && (!modifiers.alt || e.altKey)) {
        setPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === key) setPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [key, modifiers]);

  return pressed;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export function useObjectURL(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (blob) {
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setUrl(null);
    }
  }, [blob]);

  return url;
}