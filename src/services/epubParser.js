/**
 * epubParser.js — Extração de metadados, TOC, capítulos e texto limpo via epub.js.
 */

/* ePub vem de <script> global (vendor/epub.min.js) */
const { ePub } = window;

/** Timeout defensivo: epub.js pode deixar promessas pendentes em arquivos inválidos. */
const withTimeout = (promise, ms, msg) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
  ]);

/** Texto visível do documento, preservando parágrafos (p, li, h1-h6, blockquote). */
function extractText(doc, title = '') {
  if (!doc) return '';
  const root = doc.body || doc;
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,nav,aside,figure,header,footer').forEach((n) => n.remove());

  const blocks = clone.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre');
  const parts = [];
  if (!blocks.length) {
    const t = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  blocks.forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  });

  let text = parts.join('\n\n');
  const head = (title || '').trim();
  if (head && !text.toLowerCase().startsWith(head.toLowerCase().slice(0, 20))) {
    text = head + '\n\n' + text;
  }
  return text.trim();
}

/** Carrega um item do spine e devolve { text } via request do próprio epub.js. */
async function spineItemText(item) {
  await item.load(bookLoadRef);
  const doc = item.document;
  return extractText(doc, '');
}

// referência setada em parseEpub (epub.js exige o book.load)
let bookLoadRef = null;

/**
 * Abre o arquivo .epub e devolve { book, meta, cover, toc, chapters }.
 * chapters: [{ index, href, title, text }]
 */
export async function parseEpub(file) {
  const buf = await file.arrayBuffer();
  const book = ePub(buf);
  await withTimeout(book.ready, 15000, 'Não foi possível abrir o arquivo (e-Pub inválido ou não suportado).');
  await withTimeout(book.loaded.navigation, 10000, 'Índice do e-Pub não pôde ser lido.');
  bookLoadRef = book.load.bind(book);

  const meta = book.packaging?.metadata || {};
  const title = (meta.title || file.name.replace(/\.epub$/i, '')).trim();
  const author = (meta.creator || 'Autor desconhecido').trim();

  const toc = (book.navigation?.toc || [])
    .map((t) => ({ label: (t.label || '').trim(), href: t.href }))
    .filter((t) => t.label);

  // Mapa href -> spine item
  const byHref = new Map();
  for (const si of book.spine.spineItems || []) {
    const href = String(si.href || '').split('/').pop();
    if (href) byHref.set(href, si);
  }

  const chapters = [];
  const seen = new Set();

  const pushChapter = async (label, href) => {
    const cleanHref = String(href || '').split('#')[0].split('/').pop();
    const item = byHref.get(cleanHref);
    if (!item || seen.has(cleanHref)) return;
    seen.add(cleanHref);
    try {
      await withTimeout(item.load(bookLoadRef), 10000, 'capítulo');
      const text = extractText(item.document, label);
      item.unload();
      if (text && text.length > 40) {
        chapters.push({ index: chapters.length, href: cleanHref, title: label || `Seção ${chapters.length + 1}`, text });
      }
    } catch { /* pula seção quebrada */ }
  };

  if (toc.length) {
    for (const t of toc) await pushChapter(t.label, t.href);
  }
  // Fallback: spine inteiro (TOC incompleto ou vazio)
  if (!chapters.length) {
    for (const si of book.spine.spineItems || []) {
      await pushChapter('', si.href);
    }
  }

  // Capa (cap para falhas silenciosas)
  let cover = null;
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const res = await fetch(coverUrl);
      cover = await res.blob();
      URL.revokeObjectURL(coverUrl);
    }
  } catch { cover = null; }

  return {
    book,
    meta: { title, author, language: meta.language || 'pt-BR', description: meta.description || '' },
    cover,
    toc,
    chapters,
  };
}

/** Libera memória do livro aberto. */
export function destroyEpub(parsed) {
  try { parsed?.book?.destroy(); } catch { /* noop */ }
}
