/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { TRACKERS } from './src/lib/signaling/tracker.ts';

// GitHub Pages can't set HTTP headers, so the CSP ships as a <meta> tag.
// Only in production builds: Vite's dev server injects inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  // Public WebTorrent trackers used only to swap connection codes (6-digit pairing).
  `connect-src 'self' ${TRACKERS.join(' ')}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'theshare-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(({ mode }) => ({
  // Relative base: works on https://<user>.github.io/<any-repo-name>/ and on a custom domain.
  base: './',
  plugins: [
    react(),
    cspMeta(),
    // `npm run dev:https` → self-signed HTTPS so phones on the LAN get a secure context (camera).
    mode === 'https' ? basicSsl() : null,
    VitePWA({
      // "prompt" instead of "autoUpdate": a silent reload mid-transfer would kill the connection.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'theShare — P2P Dosya Paylaşımı',
        short_name: 'theShare',
        description: 'Sunucusuz, cihazdan cihaza dosya paylaşımı (WebRTC + QR).',
        lang: 'tr',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#06060c',
        theme_color: '#06060c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The QR reader wasm (~1 MB) must be precached, otherwise scanning breaks offline.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
}));
