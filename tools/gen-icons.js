#!/usr/bin/env node
/**
 * Gera os ícones PNG do PWA (zero dependências — encoder PNG nativo em JS).
 * Uso: node tools/gen-icons.js
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* ---------- Encoder PNG mínimo (RGBA 8-bit) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
const buildPng = (w, h, rgba) => {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/* ---------- Desenho: fone de ouvido sobre círculo com gradiente ---------- */
function renderIcon(size) {
  const W = size;
  const img = Buffer.alloc(W * W * 4);
  const s = W / 256; // escala relativa ao espaço de design 256x256
  const cx = 128 * s, cy = 128 * s;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / W;

      // fundo: círculo com gradiente diagonal indigo -> fúcsia
      const r = Math.hypot(u - 0.5, v - 0.5);
      const aBg = Math.min(1, Math.max(0, (0.495 - r) / 0.015));
      const t = Math.min(1, Math.max(0, (u + v - 0.35) / 0.9));
      const bgR = 70 + 85 * t, bgG = 80 + 40 * t, bgB = 240 - 25 * t;

      // arco da Bandeirinha do fone (semicírculo superior, espessura gaussiana)
      const dx = (x - cx) / s, dy = (y - cy) / s;
      const rad = 62, bw = 11;
      const dArc = Math.abs(Math.hypot(dx, dy) - rad);
      let band = Math.exp(-((dArc / bw) ** 2)) * (dy < 4 ? 1 : 0);

      // conchas (earcups): retângulos arredondados nos extremos do arco
      const earcup = (ex, ey) => {
        const rx = Math.abs(dx - ex) - 26, ry = Math.abs(dy - ey) - 20;
        const ox = Math.max(rx, 0), oy = Math.max(ry, 0);
        const dist = Math.hypot(ox, oy) + Math.min(Math.max(rx, ry), 0);
        return Math.min(1, Math.max(0, (2.5 - dist) / 2.5));
      };
      const lx = -rad, rx2 = rad, eyy = 8;
      const glyph = Math.min(1, band + earcup(lx, eyy) + earcup(rx2, eyy));

      const onBg = aBg > 0;
      const R = glyph ? 255 : bgR;
      const G = glyph ? 255 : bgG;
      const B = glyph ? 255 : bgB;
      const alpha = Math.max(onBg ? aBg : 0, glyph);
      const i = (y * W + x) * 4;
      img[i] = Math.round(R);
      img[i + 1] = Math.round(G);
      img[i + 2] = Math.round(B);
      img[i + 3] = Math.round(alpha * 255);
    }
  }
  return buildPng(W, W, img);
}

// A raiz do app é a raiz do servidor: os ícones ficam em /icons/ (referenciados
// por index.html, manifest.json, sw.js e pelo redirect de favicon).
mkdirSync('icons', { recursive: true });
for (const size of [64, 96, 128, 152, 167, 180, 192, 256, 384, 512]) {
  writeFileSync(join('icons', `icon-${size}.png`), renderIcon(size));
}
writeFileSync(join('icons/favicon.png'), renderIcon(32));
console.log('OK: ícones gerados em icons/');
