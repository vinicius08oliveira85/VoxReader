import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'ePub Audiobook - IA Neural',
        short_name: 'Audiobook IA',
        description: 'Converta e-Pubs em audiobooks com vozes neurais hiper-realistas (Gemini, Kokoro, Edge)',
        theme_color: '#1e1e2e',
        background_color: '#0f0f1a',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-72.png', sizes: '72x72', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-152.png', sizes: '152x152', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ],
        categories: ['books', 'education', 'productivity'],
        screenshots: [],
        shortcuts: [
          { name: 'Novo Livro', url: '/?action=import', description: 'Importar novo e-Pub' },
          { name: 'Biblioteca', url: '/?view=library', description: 'Ver biblioteca' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,mp3,wav}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/generativelanguage\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gemini-api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
              networkTimeoutSeconds: 30
            }
          },
          {
            urlPattern: /^https:\/\/speech\.platform\.bing\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'edge-tts-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          {
            urlPattern: /\.(?:mp3|wav|ogg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 },
              rangeRequests: true
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-epub': ['epubjs'],
          'vendor-ai': ['@google/generative-ai', '@xenova/transformers'],
          'vendor-storage': ['localforage', 'idb']
        }
      }
    }
  },
  worker: {
    format: 'es'
  }
});