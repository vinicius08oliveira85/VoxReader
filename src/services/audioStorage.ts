import localforage from 'localforage';
import type { AudioChunk, StorageStats, BookMetadata, Chapter, AudioChunk as AudioChunkType } from '../types';
import { getChunkKey } from '../utils/textChunker';

const AUDIO_STORE = 'audiobook-audio';
const METADATA_STORE = 'audiobook-metadata';
const CHAPTERS_STORE = 'audiobook-chapters';
const SETTINGS_STORE = 'audiobook-settings';

localforage.config({
  name: 'EpubAudiobook',
  storeName: AUDIO_STORE,
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE]
});

const audioDB = localforage.createInstance({
  name: 'EpubAudiobook',
  storeName: AUDIO_STORE
});

const metadataDB = localforage.createInstance({
  name: 'EpubAudiobook',
  storeName: METADATA_STORE
});

const chaptersDB = localforage.createInstance({
  name: 'EpubAudiobook',
  storeName: CHAPTERS_STORE
});

const settingsDB = localforage.createInstance({
  name: 'EpubAudiobook',
  storeName: SETTINGS_STORE
});

export async function initStorage(): Promise<void> {
  await Promise.all([
    audioDB.ready(),
    metadataDB.ready(),
    chaptersDB.ready(),
    settingsDB.ready()
  ]);
}

export async function saveBookMetadata(book: BookMetadata): Promise<void> {
  await metadataDB.setItem(book.id, book);
}

export async function getBookMetadata(bookId: string): Promise<BookMetadata | null> {
  return metadataDB.getItem(bookId);
}

export async function getAllBooks(): Promise<BookMetadata[]> {
  const books: BookMetadata[] = [];
  await metadataDB.iterate((value: BookMetadata) => {
    books.push(value);
  });
  return books.sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
}

export async function updateBookProgress(bookId: string, chapter: number, position: number): Promise<void> {
  const book = await getBookMetadata(bookId);
  if (book) {
    book.currentChapter = chapter;
    book.currentPosition = position;
    book.lastReadAt = Date.now();
    await saveBookMetadata(book);
  }
}

export async function deleteBook(bookId: string): Promise<void> {
  await metadataDB.removeItem(bookId);
  const keysToDelete: string[] = [];
  await audioDB.iterate((_, key: string) => {
    if (key.startsWith(`${bookId}::`)) {
      keysToDelete.push(key);
    }
  });
  await Promise.all(keysToDelete.map(key => audioDB.removeItem(key)));
  await chaptersDB.removeItem(bookId);
}

export async function saveChapters(bookId: string, chapters: Chapter[]): Promise<void> {
  await chaptersDB.setItem(bookId, chapters);
}

export async function getChapters(bookId: string): Promise<Chapter[] | null> {
  return chaptersDB.getItem(bookId);
}

export async function saveAudioChunk(chunk: AudioChunkType): Promise<void> {
  const key = getChunkKey(chunk.bookId, chunk.chapterId, chunk.chunkIndex, chunk.engine, chunk.voice);
  await audioDB.setItem(key, chunk);
}

export async function getAudioChunk(
  bookId: string,
  chapterId: string,
  chunkIndex: number,
  engine: string,
  voice: string
): Promise<AudioChunkType | null> {
  const key = getChunkKey(bookId, chapterId, chunkIndex, engine, voice);
  return audioDB.getItem(key);
}

export async function hasAudioChunk(
  bookId: string,
  chapterId: string,
  chunkIndex: number,
  engine: string,
  voice: string
): Promise<boolean> {
  const key = getChunkKey(bookId, chapterId, chunkIndex, engine, voice);
  const item = await audioDB.getItem(key);
  return item !== null;
}

export async function getAudioChunksForChapter(
  bookId: string,
  chapterId: string,
  engine: string,
  voice: string
): Promise<AudioChunkType[]> {
  const prefix = `${bookId}::${chapterId}::`;
  const chunks: AudioChunkType[] = [];
  
  await audioDB.iterate((value: AudioChunkType, key: string) => {
    if (key.startsWith(prefix) && value.engine === engine && value.voice === voice) {
      chunks.push(value);
    }
  });
  
  return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

export async function deleteAudioChapters(bookId: string, chapterIds: string[]): Promise<void> {
  const keysToDelete: string[] = [];
  await audioDB.iterate((_, key: string) => {
    if (key.startsWith(`${bookId}::`)) {
      const parts = key.split('::');
      if (chapterIds.includes(parts[1])) {
        keysToDelete.push(key);
      }
    }
  });
  await Promise.all(keysToDelete.map(key => audioDB.removeItem(key)));
}

export async function getStorageStats(): Promise<StorageStats> {
  const stats: StorageStats = {
    totalBooks: 0,
    totalChunks: 0,
    totalSize: 0,
    byEngine: {
      gemini: { chunks: 0, size: 0 },
      kokoro: { chunks: 0, size: 0 },
      edge: { chunks: 0, size: 0 }
    }
  };

  const books = await getAllBooks();
  stats.totalBooks = books.length;

  await audioDB.iterate((chunk: AudioChunkType) => {
    stats.totalChunks++;
    const size = chunk.audioBlob?.size || 0;
    stats.totalSize += size;
    if (stats.byEngine[chunk.engine]) {
      stats.byEngine[chunk.engine].chunks++;
      stats.byEngine[chunk.engine].size += size;
    }
  });

  return stats;
}

export async function clearAllAudio(): Promise<void> {
  await audioDB.clear();
}

export async function clearEngineAudio(engine: string): Promise<void> {
  const keysToDelete: string[] = [];
  await audioDB.iterate((chunk: AudioChunkType, key: string) => {
    if (chunk.engine === engine) {
      keysToDelete.push(key);
    }
  });
  await Promise.all(keysToDelete.map(key => audioDB.removeItem(key)));
}

export async function getSettings(): Promise<Record<string, unknown>> {
  const settings: Record<string, unknown> = {};
  await settingsDB.iterate((value: unknown, key: string) => {
    settings[key] = value;
  });
  return settings;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await settingsDB.setItem(key, value);
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const value = await settingsDB.getItem(key);
  return (value as T) ?? defaultValue;
}

export async function exportBookData(bookId: string): Promise<string> {
  const metadata = await getBookMetadata(bookId);
  const chapters = await getChapters(bookId);
  const audioChunks: AudioChunkType[] = [];
  
  await audioDB.iterate((chunk: AudioChunkType, key: string) => {
    if (key.startsWith(`${bookId}::`)) {
      const chunk = { ...chunk, audioBlob: undefined } as AudioChunkType & { audioBlob?: undefined };
      chunk.audioBlob = undefined;
      audioChunks.push(chunk);
    }
  });

  const data = {
    metadata,
    chapters,
    audioChunks: audioChunks.map(c => ({
      ...c,
      audioBlob: undefined,
      blobUrl: undefined
    }))
  };

  return JSON.stringify(data, null, 2);
}

export async function importBookData(jsonData: string): Promise<string> {
  const data = JSON.parse(jsonData);
  const bookId = data.metadata.id;
  
  await saveBookMetadata(data.metadata);
  if (data.chapters) await saveChapters(bookId, data.chapters);
  
  return bookId;
}