import type { TextChunk } from '../types';

export interface ChunkingOptions {
  maxChars: number;
  minChars: number;
  overlapChars: number;
  respectSentences: boolean;
  respectParagraphs: boolean;
}

const DEFAULT_OPTIONS: ChunkingOptions = {
  maxChars: 400,
  minChars: 100,
  overlapChars: 50,
  respectSentences: true,
  respectParagraphs: true
};

const SENTENCE_ENDINGS = /[.!?][\s\n]+/g;
const PARAGRAPH_BREAK = /\n\s*\n/;

export function chunkText(text: string, options: Partial<ChunkingOptions> = {}): TextChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: TextChunk[] = [];
  let currentIndex = 0;

  if (opts.respectParagraphs) {
    const paragraphs = text.split(PARAGRAPH_BREAK).filter(p => p.trim().length > 0);
    let paragraphStart = 0;

    for (const paragraph of paragraphs) {
      const paragraphText = paragraph.trim();
      if (paragraphText.length === 0) continue;

      const paragraphChunks = chunkParagraph(paragraphText, paragraphStart, opts);
      chunks.push(...paragraphChunks);
      paragraphStart += paragraph.length + 2; // +2 for \n\n
    }
  } else {
    const paragraphChunks = chunkParagraph(text.trim(), 0, opts);
    chunks.push(...paragraphChunks);
  }

  return chunks;
}

function chunkParagraph(text: string, baseOffset: number, opts: ChunkingOptions): TextChunk[] {
  const chunks: TextChunk[] = [];
  const len = text.length;

  if (len <= opts.maxChars) {
    chunks.push({
      index: 0,
      text: text.trim(),
      startOffset: baseOffset,
      endOffset: baseOffset + len
    });
    return chunks;
  }

  if (opts.respectSentences) {
    const sentences = splitIntoSentences(text);
    let currentChunk = '';
    let chunkStart = 0;
    let chunkIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceStart = text.indexOf(sentence, chunkStart);
      const sentenceEnd = sentenceStart + sentence.length;

      if (currentChunk.length + sentence.length > opts.maxChars && currentChunk.length >= opts.minChars) {
        chunks.push({
          index: chunkIndex++,
          text: currentChunk.trim(),
          startOffset: baseOffset + chunkStart,
          endOffset: baseOffset + sentenceStart
        });

        const overlapStart = Math.max(0, currentChunk.length - opts.overlapChars);
        currentChunk = currentChunk.slice(overlapStart) + ' ' + sentence;
        chunkStart = sentenceStart - (currentChunk.length - sentence.length - 1);
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push({
        index: chunkIndex,
        text: currentChunk.trim(),
        startOffset: baseOffset + chunkStart,
        endOffset: baseOffset + len
      });
    }
  } else {
    let pos = 0;
    let chunkIndex = 0;

    while (pos < len) {
      const end = Math.min(pos + opts.maxChars, len);
      let actualEnd = end;

      if (end < len) {
        const lastSpace = text.lastIndexOf(' ', end);
        if (lastSpace > pos + opts.minChars) {
          actualEnd = lastSpace;
        }
      }

      chunks.push({
        index: chunkIndex++,
        text: text.slice(pos, actualEnd).trim(),
        startOffset: baseOffset + pos,
        endOffset: baseOffset + actualEnd
      });

      pos = actualEnd;
      if (pos < len) pos = Math.max(pos - opts.overlapChars, 0);
    }
  }

  return chunks;
}

function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SENTENCE_ENDINGS.exec(text)) !== null) {
    const endIndex = match.index + match[0].length;
    const sentence = text.slice(lastIndex, endIndex).trim();
    if (sentence.length > 0) sentences.push(sentence);
    lastIndex = endIndex;
  }

  const remaining = text.slice(lastIndex).trim();
  if (remaining.length > 0) sentences.push(remaining);

  return sentences;
}

export function estimateDuration(text: string, wordsPerMinute: number = 150): number {
  const words = text.trim().split(/\s+/).length;
  return (words / wordsPerMinute) * 60;
}

export function getChunkKey(bookId: string, chapterId: string, chunkIndex: number, engine: string, voice: string): string {
  return `${bookId}::${chapterId}::${chunkIndex}::${engine}::${voice}`;
}