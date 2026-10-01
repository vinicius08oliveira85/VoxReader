/**
 * textCleaner.js — Limpeza de texto e-Pub + pré-processamento opcional com Gemini.
 * Fallback 100% local (regex) caso não haja chave/offline.
 */

const ordinal = (s) => s;

/* ---------------- Limpeza local (sempre aplicada, custo zero) ---------------- */

export function cleanText(raw) {
  let t = raw
    // normalizações básicas
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\u200e\u200f]/g, '')
    // artefatos comuns de e-Pub
    .replace(/\{[^{}]{0,240}?\}/g, ' ')            // {...} resíduos de marcação
    .replace(/\[\s*(\d{1,3}|[a-záéíóúâêôãõç]{1,2})\s*\]/gi, ' ') // notas [12] [a]
    .replace(/\u2014?\s*\d{1,4}\s*\u2014?/g, (m, off, all) => {
      // números soltos isolados em linha = nº de página
      const lineStart = all.lastIndexOf('\n', off);
      const lineEnd = all.indexOf('\n', off);
      const line = all.slice(lineStart + 1, lineEnd < 0 ? undefined : lineEnd).trim();
      return /^[-—]?\d{1,4}[-—]?$/.test(line) ? ' ' : m;
    })
    .replace(/p{1,2}\.\s?\d{1,4}([–-]\d{1,4})?/gi, ' ') // p. 34 / pp. 12-14
    .replace(/^\s*(cap[íi]tulo|chapter)\s+([ivxlcdm]+|\d+)\s*$/gim, (m) => m.toUpperCase())
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[A-Za-zÀ-ÿ])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return t;
}

/* -------------------- Segmentação para TTS (janela segura) -------------------- */

/**
 * Divide em parágrafos e fatia parágrafos longos em segmentos <= maxLen
 * respeitando frases. Segmentos curtos = melhor cache, retry barato,
 * highlight preciso e menos tokens de texto no TTS.
 */
export function segmentText(text, maxLen = 420) {
  const paras = text.split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
  const out = [];
  for (const p of paras) {
    if (p.length <= maxLen) { out.push(p); continue; }
    const sentences = p.match(/[^.!?…]+[.!?…]+["')\]]*|\S[^.!?…]*$/g) || [p];
    let buf = '';
    for (const s of sentences) {
      // Frase gigante (sem pontuação): fatia por palavras
      if (s.length > maxLen) {
        if (buf.trim()) { out.push(buf.trim()); buf = ''; }
        const words = s.split(/\s+/);
        let wbuf = '';
        for (const w of words) {
          if ((wbuf + ' ' + w).trim().length > maxLen && wbuf) { out.push(wbuf.trim()); wbuf = w; }
          else wbuf = (wbuf ? wbuf + ' ' : '') + w;
        }
        if (wbuf.trim()) out.push(wbuf.trim());
        continue;
      }
      if ((buf + ' ' + s).trim().length > maxLen && buf) { out.push(buf.trim()); buf = s; }
      else buf = (buf ? buf + ' ' : '') + s;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter((s) => s.replace(/\s/g, '').length > 0);
}

/* --------------------- Alinhamento de timings por palavra --------------------- */

/**
 * Alinha as palavras vindas do TTS ([{ms, text}]) ao texto exato do segmento.
 * Retorna [[ms, charIndex, len], ...] ou null se nada casar.
 * Exportada para testes unitários.
 */
export function alignWordTimings(segText, wordBoundaries) {
  const out = [];
  let cursor = 0;
  for (const wb of wordBoundaries || []) {
    if (!wb?.text) continue;
    const found = segText.indexOf(wb.text, cursor);
    const charIndex = found >= 0 ? found : cursor;
    if (found >= 0) cursor = found + wb.text.length;
    out.push([wb.ms, charIndex, wb.text.length]);
  }
  return out.length ? out : null;
}

/* ------------------------- Dicionário de pronúncia ------------------------- */

/** Parseia "origem = destino" (um por linha) → Map. Linhas inválidas são ignoradas. */
export function parsePronunciationDict(raw) {
  const map = new Map();
  for (const line of String(raw || '').split('\n')) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const from = line.slice(0, idx).trim();
    const to = line.slice(idx + 1).trim();
    if (from && to) map.set(from, to);
  }
  return map;
}

/* ------------------------- Pré-processamento Gemini ------------------------- */

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const GEMINI_LIST = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Modelos preferidos em ordem (nomes mudam com o tempo — descobrimos quais a chave aceita). */
const MODEL_CANDIDATES = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-1.5-flash'];
let workingModel = null; // memo do modelo que funcionou nesta sessão

/** Lista os modelos disponíveis para a chave (usado p/ validar e escolher o melhor). */
export async function listGeminiModels(apiKey) {
  const res = await fetch(`${GEMINI_LIST}?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''));
}

/** Valida a chave e devolve o melhor modelo disponível. */
export async function validateGeminiKey(apiKey) {
  try {
    const models = await listGeminiModels(apiKey);
    const best =
      MODEL_CANDIDATES.find((c) => models.includes(c)) ||
      models.find((m) => m.includes('flash')) ||
      models[0];
    if (!best) return { ok: false, error: 'nenhum modelo compatível' };
    workingModel = best;
    return { ok: true, model: best, count: models.length };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function resolveModel(apiKey) {
  if (workingModel) return workingModel;
  const v = await validateGeminiKey(apiKey);
  if (!v.ok) throw new Error(v.error || 'Gemini indisponível');
  return v.model;
}

/**
 * Usa o free tier do Gemini para "arrumar" o texto antes da narração:
 * remove notas de rodapé/números de página/cabeçalhos repetidos e insere
 * pausas naturais. Cai no fallback local em qualquer erro.
 */
export async function geminiPreprocess(chapterTitle, paragraphs, apiKey, opts = {}) {
  const model = opts.model || (await resolveModel(apiKey));
  const maxChars = opts.maxChars || 3600;

  const prompt = [
    'Você é um preparador de roteiros de audiobook. Receberá o texto de um capítulo de livro.',
    'Tarefas:',
    '1) Remover números de página, cabeçalhos/rodapés repetidos, referências de notas de rodapé ([1], [a]) e URLs;',
    '2) Corrigir hifenização de quebra de linha (ex.: "pala-\nvra" -> "palavra");',
    '3) Expandir siglas óbvias para leitura natural (ex.: "Sr." -> "Senhor");',
    '4) Manter EXATAMENTE a ordem e a quantidade de parágrafos: uma linha vazia separa parágrafos;',
    '5) NÃO resumir, NÃO traduzir, NÃO comentar, NÃO usar markdown;',
    '6) Para ênfases, permita pausas com vírgulas/pontos — não use tags SSML.',
    `Título do capítulo: "${chapterTitle}".`,
    'Responda SOMENTE com o texto final processado.',
  ].join('\n');

  const chunks = [];
  let buf = [];
  let size = 0;
  for (const p of paragraphs) {
    if (size + p.length > maxChars && buf.length) { chunks.push(buf); buf = []; size = 0; }
    buf.push(p); size += p.length;
  }
  if (buf.length) chunks.push(buf);

  const out = [];
  for (const chunk of chunks) {
    const body = {
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts: [{ text: chunk.join('\n\n') }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    };
    const res = await fetch(`${GEMINI_URL(model)}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    out.push(...txt.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

/** Pipeline: tenta Gemini (se ativado), senão fallback local. */
export async function prepareSegments(rawText, { title, geminiKey, useGemini, maxLen } = {}) {
  const cleaned = cleanText(rawText);
  const paras = cleaned.split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
  let processed = paras;
  if (useGemini && geminiKey) {
    try {
      processed = await geminiPreprocess(title || '', paras, geminiKey);
    } catch {
      processed = paras; // fallback silencioso
    }
  }
  const text = processed.join('\n\n');
  return { text, segments: segmentText(text, maxLen || 420) };
}
