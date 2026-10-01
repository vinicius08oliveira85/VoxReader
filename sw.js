/* VoxReader — Service Worker (JS nativo, padrão precache + cache-first) */
const VERSION = 'v1.4.0';
const SHELL_CACHE = `voxreader-shell-${VERSION}`;
const RUNTIME_CACHE = `voxreader-runtime-${VERSION}`;

/** Caminhos do shell — cache-first; qualquer outro same-origin é network-first. */
const SHELL_PATHS = new Set([
  '/', '/index.html', '/manifest.json', '/sw.js',
]);
const SHELL_PREFIXES = ['/src/', '/vendor/', '/icons/'];

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './src/app.js',
  './src/services/epubParser.js',
  './src/services/ttsEngine.js',
  './src/services/storage.js',
  './src/services/textCleaner.js',
  './src/services/player.js',
  './src/services/ui.js',
  './vendor/epub.min.js',
  './vendor/jszip.min.js',
  './vendor/localforage.min.js',
  './vendor/tailwind.js',
  './icons/favicon.png',
  './icons/icon-64.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll falha se 1 URL falhar; adicionamos uma a uma para resiliência
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Teto de entradas do RUNTIME_CACHE — mesmo limite implícito do shell, explícito aqui. */
const RUNTIME_MAX_ENTRIES = 120;

/**
 * O RUNTIME_CACHE guarda respostas network-first e, sem poda, só cresce até o
 * navegador despejar tudo no storage pressure. Como as entradas são cacheadas
 * na ordem da inserção, remover as mais antigas (FIFO) é o suficiente.
 */
async function trimRuntimeCache() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  if (keys.length <= RUNTIME_MAX_ENTRIES) return;
  for (const key of keys.slice(0, keys.length - RUNTIME_MAX_ENTRIES)) {
    await cache.delete(key);
  }
}

/**
 * Estratégias:
 *  - Navegações e shell      -> cache-first (com fallback para index.html)
 *  - Vetores/imagens do app  -> cache-first
 *  - API de TTS (/api/tts)   -> network-only (áudio é cacheado no IndexedDB pelo app)
 *  - Demais cross-origin     -> network-first com fallback ao cache
 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca interceptar a API local de TTS (sem cache HTTP; IndexedDB cuida do cache)
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/tts')) {
    event.respondWith(fetch(req));
    return;
  }

  // Compartilhamentos são one-shot e expiram no servidor: guardar no RUNTIME_CACHE
  // faria o app reimportar o mesmo arquivo depois de já descartado no backend.
  if (url.origin === self.location.origin && url.pathname.startsWith('/share/')) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(req)) ||
            (await cache.match('./index.html')) ||
            new Response('<h1>Offline</h1><p>Reabra após reconectar.</p>', {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin) {
    const isShell = SHELL_PATHS.has(url.pathname) || SHELL_PREFIXES.some((p) => url.pathname.startsWith(p));
    event.respondWith(
      (async () => {
        // Arquivos do shell (precache): cache-first — rápidos e offline-first
        if (isShell) {
          const cache = await caches.open(SHELL_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
        }
        // Demais arquivos same-origin: network-first (auto-atualizável), cache como fallback offline
        try {
          const fresh = await fetch(req);
          if (fresh.ok && req.method === 'GET') {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, fresh.clone());
            trimRuntimeCache();
          }
          return fresh;
        } catch {
          const cache = await caches.open(RUNTIME_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          const shell = await caches.open(SHELL_CACHE);
          return (await shell.match(req)) || new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // Demais cross-origin: só o que a app realmente consome (vozes do Edge).
  // Cachear tudo deixava respostas de terceiros (imagens, beacons) no device.
  const CROSS_ORIGIN_ALLOW = ['speech.platform.bing.com', 'generativelanguage.googleapis.com'];
  if (!CROSS_ORIGIN_ALLOW.includes(url.hostname)) return;

  // Cross-origin: network-first, fallback cache
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        trimRuntimeCache();
        return fresh;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error('offline');
      }
    })()
  );
});
