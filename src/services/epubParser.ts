import { Book, Rendition } from 'epubjs';
import type { EpubParseResult, BookMetadata, Chapter, TableOfContentsItem } from '../types';

export async function parseEpub(file: File): Promise<EpubParseResult> {
  const arrayBuffer = await file.arrayBuffer();
  const book = new Book(arrayBuffer, { openAs: 'binary' });
  
  await book.ready;
  
  const metadata = await extractMetadata(book, file);
  const chapters = await extractChapters(book);
  const toc = await extractTOC(book);
  const cover = await extractCover(book);
  
  book.destroy();
  
  return {
    metadata,
    chapters,
    toc,
    cover
  };
}

async function extractMetadata(book: Book, file: File): Promise<BookMetadata> {
  const packageData = await book.loaded.metadata;
  const spine = book.spine;
  
  return {
    id: generateBookId(file.name),
    title: packageData.title || file.name.replace('.epub', ''),
    author: packageData.creator || 'Autor desconhecido',
    cover: undefined,
    language: packageData.language || 'pt-BR',
    chapterCount: spine?.length || 0,
    fileName: file.name,
    fileSize: file.size,
    addedAt: Date.now()
  };
}

async function extractChapters(book: Book): Promise<Chapter[]> {
  const spine = book.spine;
  const chapters: Chapter[] = [];
  
  for (let i = 0; i < spine.length; i++) {
    const item = spine.get(i);
    if (!item) continue;
    
    const chapter: Chapter = {
      id: `chapter-${i}`,
      title: item.title || `Capítulo ${i + 1}`,
      href: item.href,
      order: i,
      wordCount: 0,
      estimatedDuration: 0
    };
    
    try {
      const content = await book.loaded.bindings.getContent(item.href);
      if (content) {
        const textContent = extractTextFromHtml(content);
        chapter.textContent = textContent;
        chapter.wordCount = textContent.trim().split(/\s+/).length;
        chapter.estimatedDuration = Math.ceil(chapter.wordCount / 150 * 60);
      }
    } catch (e) {
      console.warn(`Failed to load chapter ${i}:`, e);
    }
    
    chapters.push(chapter);
  }
  
  return chapters;
}

async function extractTOC(book: Book): Promise<TableOfContentsItem[]> {
  const toc = await book.loaded.navigation.getToc();
  
  function processTocItem(item: any, level = 0): TableOfContentsItem {
    return {
      id: item.id || `toc-${Math.random().toString(36).slice(2)}`,
      label: item.label || item.title || 'Sem título',
      href: item.href || '',
      level,
      children: item.subitems?.map((sub: any) => processTocItem(sub, level + 1)) || []
    };
  }
  
  return toc.map((item: any) => processTocItem(item));
}

async function extractCover(book: Book): Promise<Blob | undefined> {
  try {
    const coverUrl = book.coverUrl();
    if (coverUrl) {
      const response = await fetch(coverUrl);
      if (response.ok) {
        return response.blob();
      }
    }
  } catch (e) {
    console.warn('Could not extract cover:', e);
  }
  return undefined;
}

function extractTextFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  doc.querySelectorAll('script, style, nav, header, footer, .page-number').forEach(el => el.remove());
  
  const text = doc.body?.innerText || doc.documentElement?.innerText || '';
  
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

function generateBookId(fileName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const cleanName = fileName.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
  return `${cleanName}-${timestamp}-${random}`;
}

export async function getChapterContent(book: Book, href: string): Promise<string> {
  try {
    const content = await book.loaded.bindings.getContent(href);
    return extractTextFromHtml(content || '');
  } catch (e) {
    console.error('Error loading chapter content:', e);
    return '';
  }
}

export function createRendition(book: Book, element: HTMLElement): Rendition {
  return book.renderTo(element, {
    width: '100%',
    height: '100%',
    spread: 'auto',
    minSpreadWidth: 800,
    flow: 'scrolled-doc',
    manager: 'continuous'
  });
}