/**
 * test/storage.test.js — Regressões de contabilidade no IndexedDB.
 *
 * Cobre o que quebrava silenciosamente:
 *  - saveAudioSegment somava o tamanho total a cada regeração, então o contador
 *    de uso do app crescia sem parar e o painel de Armazenamento mentia.
 *  - deleteBook deixava listen::/done:: para trás: os minutos e capítulos do
 *    livro removido continuavam somando para sempre.
 *  - getListenStats aceitava bookId e ignorava: a lateral do leitor mostrava o
 *    total global como se fosse do livro aberto.
 *
 * localforage é carregado de ../vendor/localforage.min.js; em Node ele cai no
 * driver de memória, o que basta para exercitar a camada de chaves e contadores.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * O Node não tem IndexedDB nem localStorage, então o localforage não acha driver
 * e toda operação morre com "No available storage method found".
 *
 * Duas coisas são fornecidas aqui, nesta ordem:
 *  1. `window` apontando para globalThis — o bundle é UMD e, sem module/exports,
 *     se anexa em `window`.
 *  2. um `localStorage` Map-backed — o driver localStorageWrapper do localforage
 *     passa no autodetect. Ele serializa via o serializer padrão do localforage,
 *     que sabe codificar Blob, então o áudio continua sendo salvo como Blob.
 */
if (typeof globalThis.localforage === 'undefined') {
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;

  if (typeof globalThis.localStorage === 'undefined') {
    const ls = new Map();
    globalThis.localStorage = {
      get length() { return ls.size; },
      key: (i) => [...ls.keys()][i] ?? null,
      getItem: (k) => (ls.has(String(k)) ? ls.get(String(k)) : null),
      setItem: (k, v) => { ls.set(String(k), String(v)); },
      removeItem: (k) => { ls.delete(String(k)); },
      clear: () => ls.clear(),
    };
  }

  // O serializer do localforage codifica Blob via FileReader, que o Node não tem.
  // Só as duas leituras usadas por ele são implementadas.
  if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class FileReader {
      readAsArrayBuffer(blob) {
        blob.arrayBuffer().then(
          (buf) => { this.result = buf; this.onload?.({ target: this }); this.onloadend?.({ target: this }); },
          (err) => this.onerror?.(err),
        );
      }
      readAsBinaryString(blob) {
        blob.arrayBuffer().then(
          (buf) => { this.result = Buffer.from(buf).toString('binary'); this.onload?.({ target: this }); this.onloadend?.({ target: this }); },
          (err) => this.onerror?.(err),
        );
      }
    };
  }

  const src = readFileSync(join(ROOT, 'vendor', 'localforage.min.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'define', src)(undefined, undefined, undefined);
}

before(async () => {
  assert.ok(globalThis.localforage, 'localforage não carregou do vendor');
  await globalThis.localforage.ready();
  assert.equal(globalThis.localforage.driver(), 'localStorageWrapper', 'o polyfill de localStorage não foi detectado');
});

const {
  saveAudioSegment,
  estimateBookUsage,
  addListenSeconds,
  getListenStats,
  putBook,
  deleteBook,
} = await import('../src/services/storage.js');

const saveBookMeta = (meta) => putBook(meta);

/**
 * Blob de áudio com MIME type. O tipo não é decoração: o serializer do
 * localforage 1.10 só consegue reidratar Blob cujo `type` é não-vazio — com
 * type="" o cabeçalho base64 não casa e volta com tamanho adulterado. O áudio
 * real do Edge TTS sempre chega tipado, então os testes devem refletir isso.
 */
const audioBlob = (bytes) => new Blob([new Uint8Array(bytes)], { type: 'audio/webm' });

const BOOK = 'book-test-1';

test('saveAudioSegment conta só a diferença ao sobrescrever', async () => {
  await saveBookMeta({ id: BOOK, title: 'T', author: 'A', chapterCount: 1 });

  await saveAudioSegment(BOOK, 0, 'pt-BR-FranciscaNeural', 0, audioBlob(1000));
  const first = await estimateBookUsage(BOOK);
  assert.equal(first.bytes, 1000);
  assert.equal(first.segments, 1);

  // Mesmo tamanho: contador não pode andar.
  await saveAudioSegment(BOOK, 0, 'pt-BR-FranciscaNeural', 0, audioBlob(1000));
  const same = await estimateBookUsage(BOOK);
  assert.equal(same.bytes, 1000, 'sobrescrever mesmo tamanho não soma');
  assert.equal(same.segments, 1, 'sobrescrever não cria segmento novo');

  // Mesmo segmento, tamanho maior: soma a diferença (2000 - 1000).
  await saveAudioSegment(BOOK, 0, 'pt-BR-FranciscaNeural', 0, audioBlob(2000));
  const bigger = await estimateBookUsage(BOOK);
  assert.equal(bigger.bytes, 2000, 'deve refletir o tamanho real do blob');

  // Novo segmento soma integralmente.
  await saveAudioSegment(BOOK, 0, 'pt-BR-FranciscaNeural', 1, audioBlob(500));
  const two = await estimateBookUsage(BOOK);
  assert.equal(two.bytes, 2500);
  assert.equal(two.segments, 2);
});

test('getListenStats filtra por bookId', async () => {
  const A = 'book-stats-a';
  const B = 'book-stats-b';
  await saveBookMeta({ id: A, title: 'A', author: 'x', chapterCount: 1 });
  await saveBookMeta({ id: B, title: 'B', author: 'y', chapterCount: 1 });

  await addListenSeconds(A, 120);
  await addListenSeconds(B, 600);

  const all = await getListenStats();
  assert.equal(all.listenedMin, Math.round(720 / 60), 'sem bookId agrega tudo');

  const onlyA = await getListenStats(A);
  assert.equal(onlyA.listenedMin, 2, 'com bookId devolve só o livro pedido');

  const onlyB = await getListenStats(B);
  assert.equal(onlyB.listenedMin, 10);
});

test('deleteBook apaga usage e o estado por livro (listen/done)', async () => {
  const C = 'book-delete-c';
  await saveBookMeta({ id: C, title: 'C', author: 'z', chapterCount: 1 });
  await saveAudioSegment(C, 0, 'voz', 0, audioBlob(3000));
  await addListenSeconds(C, 300);

  const before_ = await estimateBookUsage(C);
  assert.equal(before_.bytes, 3000);
  assert.equal((await getListenStats(C)).listenedMin, 5);

  await deleteBook(C);

  assert.equal((await estimateBookUsage(C)).bytes, 0, 'uso zerado');
  assert.equal((await getListenStats(C)).listenedMin, 0, 'minutos não podem sobrar');
  assert.deepEqual(await getListenStats(), { listenedMin: 12, chaptersDone: 0 }, 'restam só os outros livros');
});