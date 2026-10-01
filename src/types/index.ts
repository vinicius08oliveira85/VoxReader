export interface BookMetadata {
  id: string;
  title: string;
  author: string;
  cover?: string;
  language: string;
  chapterCount: number;
  fileName: string;
  fileSize: number;
  addedAt: number;
  lastReadAt?: number;
  currentChapter?: number;
  currentPosition?: number;
}

export interface Chapter {
  id: string;
  title: string;
  href: string;
  order: number;
  content?: string;
  textContent?: string;
  wordCount: number;
  estimatedDuration: number;
}

export interface AudioChunk {
  id: string;
  bookId: string;
  chapterId: string;
  chunkIndex: number;
  text: string;
  audioBlob: Blob;
  mimeType: string;
  duration: number;
  engine: TTSEngine;
  voice: string;
  createdAt: number;
}

export type TTSEngine = 'gemini' | 'kokoro' | 'edge';

export interface VoiceOption {
  id: string;
  name: string;
  engine: TTSEngine;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  previewUrl?: string;
}

export interface TTSRequest {
  text: string;
  voice: string;
  engine: TTSEngine;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface TTSResult {
  audioBlob: Blob;
  mimeType: string;
  duration: number;
  timing?: WordTiming[];
}

export interface WordTiming {
  word: string;
  startTime: number;
  endTime: number;
}

export interface PlayerState {
  isPlaying: boolean;
  currentBook: BookMetadata | null;
  currentChapter: Chapter | null;
  currentChunkIndex: number;
  currentTime: number;
  duration: number;
  rate: number;
  volume: number;
  engine: TTSEngine;
  voice: string;
  queue: AudioChunk[];
}

export interface StorageStats {
  totalBooks: number;
  totalChunks: number;
  totalSize: number;
  byEngine: Record<TTSEngine, { chunks: number; size: number }>;
}

export interface AppSettings {
  geminiApiKey: string;
  preferredEngine: TTSEngine;
  preferredVoice: string;
  defaultRate: number;
  autoPlayNext: boolean;
  highlightSync: boolean;
  offlineMode: boolean;
  chunkSize: number;
}

export interface GenerationTask {
  id: string;
  bookId: string;
  chapterId: string;
  chunks: TextChunk[];
  engine: TTSEngine;
  voice: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  completedChunks: number;
  totalChunks: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface TextChunk {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface EpubParseResult {
  metadata: BookMetadata;
  chapters: Chapter[];
  cover?: Blob;
  toc: TableOfContentsItem[];
}

export interface TableOfContentsItem {
  id: string;
  label: string;
  href: string;
  level: number;
  children?: TableOfContentsItem[];
}