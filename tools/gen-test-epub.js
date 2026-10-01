#!/usr/bin/env node
/**
 * Gera um e-PUB 3 válido de teste (zero deps) para validar o app.
 * Uso: node tools/gen-test-epub.js  →  test/sample.epub
 */
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

/* -------- ZIP mínimo (store + deflate, sem libs) -------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = ~0; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
const dosTime = (() => { const d = new Date(); return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; })();

function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nb = Buffer.from(name, 'utf8');
    const db = Buffer.from(data, 'utf8');
    // spec EPUB: "mimetype" deve ser o 1º arquivo e SEM compressão (method 0)
    const store = name === 'mimetype';
    const comp = store ? db : deflateRawSync(db, { level: 9 });
    const method = store ? 0 : 8;
    const crc = crc32(db);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(dosTime.t, 10); lh.writeUInt16LE(dosTime.d, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(db.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(dosTime.t, 12); ch.writeUInt16LE(dosTime.d, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(db.length, 24);
    ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nb);
    offset += lh.length + nb.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

/* -------- Conteúdo do livro -------- */
const lorem = (n) => Array.from({ length: n }, (_, i) =>
  `Parágrafo ${i + 1}: Era uma vez uma história de teste para o VoxReader. ` +
  `Este parágrafo existe para validar a segmentação de texto, a síntese de voz neural ` +
  `e o destaque sincronizado palavra por palavra na interface de leitura. ` +
  `Se você está ouvindo esta frase, o motor TTS funcionou e o áudio foi cacheado no IndexedDB.`
).join('\n\n');

const chapter = (num, title) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="pt-BR">
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
${lorem(8).split('\n\n').map((p) => `<p>${p}</p>`).join('\n')}
<p><span class="footnote">[1]</span> Esta é uma nota de rodapé que o limpador de texto deve remover. p. 42</p>
</body></html>`;

const chapters = [
  ['ch1.xhtml', 'Capítulo 1 — O Começo'],
  ['ch2.xhtml', 'Capítulo 2 — O Meio'],
  ['ch3.xhtml', 'Capítulo 3 — O Fim'],
];

const files = {
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:voxreader-test-001</dc:identifier>
<dc:title>Livro de Teste VoxReader</dc:title><dc:creator>Autor de Teste</dc:creator>
<dc:language>pt-BR</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${chapters.map(([f], i) => `<item id="c${i}" href="${f}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">${chapters.map(([f], i) => `<itemref idref="c${i}"/>`).join('\n')}</spine>
</package>`,
  'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>TOC</title></head>
<body><nav epub:type="toc"><ol>${chapters.map(([f, t]) => `<li><a href="${f}">${t}</a></li>`).join('')}</ol></nav></body></html>`,
  'OEBPS/toc.ncx': `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:voxreader-test-001"/></head>
<docTitle><text>Livro de Teste VoxReader</text></docTitle>
<navMap>${chapters.map(([f, t], i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${t}</text></navLabel><content src="${f}"/></navPoint>`).join('')}</navMap></ncx>`,
  ...Object.fromEntries(chapters.map(([f, t]) => [`OEBPS/${f}`, chapter(0, t)])),
};

mkdirSync('test', { recursive: true });
writeFileSync('test/sample.epub', zip(files));
console.log('OK: test/sample.epub gerado');
