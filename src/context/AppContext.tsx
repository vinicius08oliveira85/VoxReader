import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import type { BookMetadata, Chapter, PlayerState, AppSettings, AudioChunk, TTSEngine, VoiceOption, GenerationTask } from '../types';
import { 
  initStorage, 
  getAllBooks, 
  saveBookMetadata, 
  getBookMetadata,
  updateBookProgress,
  deleteBook,
  saveChapters,
  getChapters,
  getAudioChunk,
  hasAudioChunk,
  getAudioChunksForChapter,
  getStorageStats,
  getSettings as getStoredSettings,
  saveSetting as saveStoredSetting,
  clearAllAudio,
  clearEngineAudio
} from '../services/audioStorage';
import { 
  initAllEngines, 
  synthesizeWithFallback, 
  getAllVoices, 
  getVoicesForEngine,
  getEngineStatus,
  preloadEngine,
  setPreferredEngine,
  setPreferredVoice,
  setGeminiApiKey,
  getGeminiApiKey
} from '../services/ttsEngine';
import { parseEpub } from '../services/epubParser';
import { chunkText } from '../utils/textChunker';

interface AppState {
  books: BookMetadata[];
  currentBook: BookMetadata | null;
  chapters: Chapter[];
  player: PlayerState;
  settings: AppSettings;
  voices: VoiceOption[];
  engineStatus: EngineStatus;
  generationTasks: GenerationTask[];
  isLoading: boolean;
  error: string | null;
  view: 'library' | 'reader' | 'settings' | 'player';
}

type AppAction =
  | { type: 'SET_BOOKS'; payload: BookMetadata[] }
  | { type: 'ADD_BOOK'; payload: BookMetadata }
  | { type: 'REMOVE_BOOK'; payload: string }
  | { type: 'SET_CURRENT_BOOK'; payload: BookMetadata | null }
  | { type: 'SET_CHAPTERS'; payload: Chapter[] }
  | { type: 'SET_PLAYER'; payload: Partial<PlayerState> }
  | { type: 'SET_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'SET_VOICES'; payload: VoiceOption[] }
  | { type: 'SET_ENGINE_STATUS'; payload: EngineStatus }
  | { type: 'ADD_GENERATION_TASK'; payload: GenerationTask }
  | { type: 'UPDATE_GENERATION_TASK'; payload: { id: string; updates: Partial<GenerationTask> } }
  | { type: 'REMOVE_GENERATION_TASK'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_VIEW'; payload: AppState['view'] }
  | { type: 'INIT_COMPLETE' };

const initialState: AppState = {
  books: [],
  currentBook: null,
  chapters: [],
  player: {
    isPlaying: false,
    currentBook: null,
    currentChapter: null,
    currentChunkIndex: 0,
    currentTime: 0,
    duration: 0,
    rate: 1,
    volume: 1,
    engine: 'edge',
    voice: 'pt-BR-FranciscaNeural',
    queue: []
  },
  settings: {
    geminiApiKey: '',
    preferredEngine: 'edge',
    preferredVoice: 'pt-BR-FranciscaNeural',
    defaultRate: 1,
    autoPlayNext: true,
    highlightSync: true,
    offlineMode: false,
    chunkSize: 400
  },
  voices: [],
  engineStatus: {
    gemini: { ready: false, voices: 0 },
    kokoro: { ready: false, status: 'not-started', voices: 0 },
    edge: { ready: true, voices: 0 }
  },
  generationTasks: [],
  isLoading: true,
  error: null,
  view: 'library'
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_BOOKS':
      return { ...state, books: action.payload };
    case 'ADD_BOOK':
      return { ...state, books: [action.payload, ...state.books.filter(b => b.id !== action.payload.id)] };
    case 'REMOVE_BOOK':
      return { 
        ...state, 
        books: state.books.filter(b => b.id !== action.payload),
        currentBook: state.currentBook?.id === action.payload ? null : state.currentBook
      };
    case 'SET_CURRENT_BOOK':
      return { ...state, currentBook: action.payload };
    case 'SET_CHAPTERS':
      return { ...state, chapters: action.payload };
    case 'SET_PLAYER':
      return { ...state, player: { ...state.player, ...action.payload } };
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'SET_VOICES':
      return { ...state, voices: action.payload };
    case 'SET_ENGINE_STATUS':
      return { ...state, engineStatus: action.payload };
    case 'ADD_GENERATION_TASK':
      return { ...state, generationTasks: [...state.generationTasks, action.payload] };
    case 'UPDATE_GENERATION_TASK':
      return {
        ...state,
        generationTasks: state.generationTasks.map(t => 
          t.id === action.payload.id ? { ...t, ...action.payload.updates } : t
        )
      };
    case 'REMOVE_GENERATION_TASK':
      return { ...state, generationTasks: state.generationTasks.filter(t => t.id !== action.payload.id) };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_VIEW':
      return { ...state, view: action.payload };
    case 'INIT_COMPLETE':
      return { ...state, isLoading: false };
    default:
      return state;
  }
}

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<AppAction> } | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const loadInitialData = useCallback(async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      await initStorage();
      await initAllEngines();

      const [books, settings, voices, engineStatus] = await Promise.all([
        getAllBooks(),
        getStoredSettings(),
        getAllVoices(),
        Promise.resolve(getEngineStatus())
      ]);

      dispatch({ type: 'SET_BOOKS', payload: books });
      dispatch({ type: 'SET_SETTINGS', payload: settings as any });
      dispatch({ type: 'SET_VOICES', payload: voices });
      dispatch({ type: 'SET_ENGINE_STATUS', payload: engineStatus });

      const savedApiKey = await getGeminiApiKey();
      if (savedApiKey) {
        dispatch({ type: 'SET_SETTINGS', payload: { geminiApiKey: savedApiKey } });
      }

      dispatch({ type: 'INIT_COMPLETE' });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Erro ao inicializar' });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const actions = {
    addBook: async (file: File) => {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        const result = await parseEpub(file);
        await saveBookMetadata(result.metadata);
        await saveChapters(result.metadata.id, result.chapters);
        
        const books = await getAllBooks();
        dispatch({ type: 'SET_BOOKS', payload: books });
        dispatch({ type: 'SET_CURRENT_BOOK', payload: result.metadata });
        dispatch({ type: 'SET_CHAPTERS', payload: result.chapters });
        dispatch({ type: 'SET_VIEW', payload: 'reader' });
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Erro ao importar livro' });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    },

    removeBook: async (bookId: string) => {
      await deleteBook(bookId);
      const books = await getAllBooks();
      dispatch({ type: 'REMOVE_BOOK', payload: bookId });
    },

    openBook: async (bookId: string) => {
      const book = await getBookMetadata(bookId);
      const chapters = await getChapters(bookId);
      if (book && chapters) {
        dispatch({ type: 'SET_CURRENT_BOOK', payload: book });
        dispatch({ type: 'SET_CHAPTERS', payload: chapters });
        dispatch({ type: 'SET_VIEW', payload: 'reader' });
      }
    },

    setPlayerState: (updates: Partial<PlayerState>) => {
      dispatch({ type: 'SET_PLAYER', payload: updates });
    },

    updateSettings: async (updates: Partial<AppSettings>) => {
      const newSettings = { ...state.settings, ...updates };
      for (const [key, value] of Object.entries(updates)) {
        await saveStoredSetting(key, value);
      }
      if (updates.geminiApiKey) {
        await setGeminiApiKey(updates.geminiApiKey);
      }
      if (updates.preferredEngine) {
        await setPreferredEngine(updates.preferredEngine);
      }
      if (updates.preferredVoice) {
        await setPreferredVoice(updates.preferredVoice);
      }
      dispatch({ type: 'SET_SETTINGS', payload: updates });
    },

    generateAudio: async (bookId: string, chapterId: string, engine?: TTSEngine, voice?: string) => {
      const chapter = state.chapters.find(c => c.id === chapterId);
      if (!chapter || !chapter.textContent) return;

      const taskId = `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const task: GenerationTask = {
        id: taskId,
        bookId,
        chapterId,
        chunks: [],
        engine: engine || state.settings.preferredEngine,
        voice: voice || state.settings.preferredVoice,
        status: 'pending',
        progress: 0,
        completedChunks: 0,
        totalChunks: 0,
        startedAt: Date.now()
      };

      dispatch({ type: 'ADD_GENERATION_TASK', payload: task });

      try {
        const text = chapter.textContent!;
        const chunks = chunkText(text, { maxChars: state.settings.chunkSize });
        
        const engineToUse = engine || state.settings.preferredEngine;
        const voiceToUse = voice || state.settings.preferredVoice;

        dispatch({ type: 'UPDATE_GENERATION_TASK', payload: { 
          id: taskId, 
          updates: { 
            chunks: chunks.map(c => c.text),
            totalChunks: chunks.length,
            status: 'processing',
            engine: engineToUse,
            voice: voiceToUse
          } 
        });

        let completed = 0;
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          
          const exists = await hasAudioChunk(bookId, chapterId, i, engineToUse, voiceToUse);
          if (exists) {
            completed++;
            dispatch({ type: 'UPDATE_GENERATION_TASK', payload: { 
              id: taskId, 
              updates: { progress: Math.round((completed / chunks.length) * 100), completedChunks: completed } 
            });
            continue;
          }

          const result = await synthesizeWithFallback({
            text: chunk.text,
            engine: engineToUse,
            voice: voiceToUse,
            rate: state.settings.defaultRate
          });

          const audioChunk = {
            id: `${bookId}::${chapterId}::${i}::${engineToUse}::${voiceToUse}`,
            bookId,
            chapterId,
            chunkIndex: i,
            text: chunk.text,
            audioBlob: result.audioBlob,
            mimeType: result.mimeType,
            duration: result.duration,
            engine: engineToUse,
            voice: voiceToUse,
            createdAt: Date.now()
          };

          await saveStoredSetting(`audio-${bookId}::${chapterId}::${i}::${engineToUse}::${voiceToUse}`, audioChunk);
          
          completed++;
          dispatch({ type: 'UPDATE_GENERATION_TASK', payload: { 
            id: taskId, 
            updates: { progress: Math.round((completed / chunks.length) * 100), completedChunks: completed } 
          });
        }

        dispatch({ type: 'UPDATE_GENERATION_TASK', payload: { 
          id: taskId, 
          updates: { status: 'completed', progress: 100, completedAt: Date.now() } 
        });
      } catch (error) {
        dispatch({ type: 'UPDATE_GENERATION_TASK', payload: { 
          id: taskId, 
          updates: { status: 'failed', error: error instanceof Error ? error.message : 'Erro desconhecido' } 
        });
      }
    },

    generateFullBook: async (bookId: string, engine?: TTSEngine, voice?: string) => {
      for (const chapter of state.chapters) {
        await actions.generateAudio(bookId, chapter.id, engine, voice);
      }
    },

    preloadEngine: async (engine: TTSEngine) => {
      await preloadEngine(engine);
      dispatch({ type: 'SET_ENGINE_STATUS', payload: getEngineStatus() });
    },

    clearAudioCache: async (engine?: TTSEngine) => {
      if (engine) {
        await clearEngineAudio(engine);
      } else {
        await clearAllAudio();
      }
    },

    setView: (view: AppState['view']) => {
      dispatch({ type: 'SET_VIEW', payload: view });
    }
  };

  return (
    <AppContext.Provider value={{ state, dispatch, actions }}>
      {children}
    </AppContext.Provider>
  );
}