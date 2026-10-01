/**
 * test/tts.test.js — Formatos de word boundary e idioma do SSML.
 *
 * Regressões cobertas:
 *  - Edge envia Offset/Duration em ticks de 100 ns, mas alignWordTimings só
 *    entende { ms, text } — sem normalizar, o highlight por palavra quebrava.
 *  - A bridge (/api/tts) manda pares [ms, text] no header X-Timings.
 *  - ssmlFor fixava xml:lang='en-US',udsando as vozes pt-BR pronunciationarem errado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ttsEngine.js referencia `window` no topo (sondagem de vozes do Edge).
globalThis.window ??= { speechSynthesis: null };

const { normalizeWordBoundaries, ssml } = await import('../src/services/ttsEngine.js');

/* ---------------- normalizeWordBoundaries ---------------- */

test('converte ticks do Edge (100 ns) para ms', () => {
  const out = normalizeWordBoundaries([
    { offset: 0, duration: 5000000, text: 'A' },
    { offset: 3500000, duration: 500000, text: 'casa' },
  ]);
  assert.deepEqual(out, [{ ms: 0, text: 'A' }, { ms: 350, text: 'casa' }]);
});

test('aceita o formato em pares [ms, text] da bridge', () => {
  const out = normalizeWordBoundaries([[0, 'B'], [120, 'ola'], [400, 'mundo']]);
  assert.deepEqual(out, [{ ms: 0, text: 'B' }, { ms: 120, text: 'ola' }, { ms: 400, text: 'mundo' }]);
});

test('preserva o formato já normalizado { ms, text }', () => {
  const out = normalizeWordBoundaries([{ ms: 250, offset: 99999999, text: 'luz' }]);
  assert.deepEqual(out, [{ ms: 250, text: 'luz' }]);
});

test('descarta entradas sem texto', () => {
  const out = normalizeWordBoundaries([
    { offset: 0, text: '' },
    { offset: 5000000, text: 'ok' }, // 500 ms
    null,
    undefined,
  ]);
  assert.deepEqual(out, [{ ms: 500, text: 'ok' }]);
});

test('entrada vazia/nula → lista vazia', () => {
  assert.deepEqual(normalizeWordBoundaries(null), []);
  assert.deepEqual(normalizeWordBoundaries([]), []);
  assert.deepEqual(normalizeWordBoundaries(undefined), []);
});

test('timings normalizados alimentam alignWordTimings', async () => {
  const { alignWordTimings } = await import('../src/services/textCleaner.js');
  const out = alignWordTimings('casa azul', normalizeWordBoundaries([
    { offset: 0, duration: 5000000, text: 'casa' },
    { offset: 5000000, duration: 5000000, text: 'azul' },
  ]));
  assert.deepEqual(out, [[0, 0, 4], [500, 5, 4]]);
});

/* ---------------- ssml (idioma por voz) ---------------- */

test('xml:lang segue a voz (pt-BR, en-US, es-MX, pt-PT)', () => {
  const cases = [
    ['pt-BR-FranciscaNeural', 'pt-BR'],
    ['en-US-JennyNeural', 'en-US'],
    ['es-MX-DaliaNeural', 'es-MX'],
    ['pt-PT-RaquelNeural', 'pt-PT'],
  ];
  for (const [voice, lang] of cases) {
    assert.match(ssml('ola', voice), new RegExp(`xml:lang='${lang}'`));
  }
});

test('ssml escapa XML no texto e aplica prosody', () => {
  const out = ssml('a < b & c', 'pt-BR-FranciscaNeural', 20, -5);
  assert.match(out, /&lt; b &amp; c/);
  assert.ok(!/a < b/.test(out), 'XML não deve ficar cru no SSML');
  assert.match(out, /rate='\+20%'/);
  assert.match(out, /pitch='-5Hz'/);
});