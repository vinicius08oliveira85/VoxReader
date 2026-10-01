/**
 * test/unit.test.js — Testes unitários (node:test, zero dependências).
 * Cobrem os bugs regressados: limpeza de texto, segmentação,
 * alinhamento de timings e dicionário de pronúncia.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanText, segmentText, alignWordTimings, parsePronunciationDict } from '../src/services/textCleaner.js';

/* ---------------- cleanText ---------------- */

test('cleanText remove notas de rodapé e refs de página', () => {
  const out = cleanText('Texto útil [x]. [12] p. 42\n\nMais texto.');
  assert.ok(!out.includes('[12]'));
  assert.ok(!out.includes('p. 42'));
});

test('cleanText preserva texto normal', () => {
  const src = 'A casa amarela fica na colina.';
  assert.equal(cleanText(src), src);
});

/* ---------------- segmentText ---------------- */

test('segmentText respeita maxLen e não perde palavras', () => {
  const p = Array.from({ length: 50 }, (_, i) => `palavra${i}`).join(' ');
  const segs = segmentText(p, 120);
  assert.ok(segs.length > 1);
  for (const s of segs) assert.ok(s.length <= 130, `segmento longo: ${s.length}`);
  const joined = segs.join(' ').replace(/\s+/g, ' ').trim();
  const orig = p.replace(/\s+/g, ' ').trim();
  assert.equal(joined, orig, 'sem perda de conteúdo');
});

test('segmentText separa parágrafos', () => {
  const segs = segmentText('Para um.\n\nPara dois.', 420);
  assert.deepEqual(segs, ['Para um.', 'Para dois.']);
});

/* ---------------- alignWordTimings ---------------- */

test('alignWordTimings casa palavras na ordem', () => {
  const wb = [{ ms: 0, text: 'sabre' }, { ms: 350, text: 'de' }, { ms: 500, text: 'luz' }];
  const out = alignWordTimings('brace sabre de luz', wb);
  assert.deepEqual(out, [[0, 6, 5], [350, 12, 2], [500, 15, 3]]);
});

test('alignWordTimings tolera palavra ausente (usa cursor)', () => {
  const wb = [{ ms: 0, text: 'foo' }, { ms: 100, text: 'bar' }];
  const out = alignWordTimings('foo xyz', wb);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], [0, 0, 3]);
});

test('alignWordTimings retorna null sem palavras', () => {
  assert.equal(alignWordTimings('texto', []), null);
});

/* ---------------- parsePronunciationDict ---------------- */

test('parsePronunciationDict parseia pares origem = destino', () => {
  const m = parsePronunciationDict('API = A-P-I\n  Python = Paithon  \nlinha inválida\n= sem origem');
  assert.equal(m.size, 2);
  assert.equal(m.get('API'), 'A-P-I');
  assert.equal(m.get('Python'), 'Paithon');
  assert.ok(!m.has('linha inválida'));
});

test('parsePronunciationDict vazio → Map vazio', () => {
  assert.equal(parsePronunciationDict('').size, 0);
  assert.equal(parsePronunciationDict(null).size, 0);
});
