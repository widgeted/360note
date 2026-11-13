import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const versionFiles = [
  'package.json',
  'public/favicon.svg',
  'public/favicon.ico',
  'public/icons/apple-touch-icon.png',
  'public/icons/apple-touch-icon-152.png',
  'public/icons/apple-touch-icon-167.png',
];
const hash = crypto.createHash('sha256');
for (const file of versionFiles) {
  try {
    hash.update(fs.readFileSync(path.resolve(__dirname, file)));
  } catch {
    hash.update(file);
  }
  hash.update('\n');
}
const assetVersion = hash.digest('hex').slice(0, 10);
const appVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version as string;
// Build identity must change on every deploy so the PWA update prompt can
// distinguish a stale waiting worker from a genuinely newer build.
const buildId = `${appVersion}-${crypto.randomBytes(6).toString('hex')}`;

export default defineConfig({
  plugins: [
    {
      name: 'asset-version',
      transformIndexHtml(html) {
        return html
          .replaceAll('__ASSET_VERSION__', assetVersion)
          .replace('</head>', `  <meta name="app-build" content="${buildId}" />\n  <meta name="app-version" content="${appVersion}" />\n  </head>`);
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: appVersion, build: buildId }),
        });
      },
    },
    {
      name: 'offline-shell',
      writeBundle(options) {
        const outDir = options.dir ?? path.resolve(__dirname, 'dist');
        const index = path.join(outDir, 'index.html');
        if (fs.existsSync(index)) fs.copyFileSync(index, path.join(outDir, 'offline.html'));
      },
    },
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.png', 'favicon.ico', 'icons/apple-touch-icon.png', 'icons/apple-touch-icon-152.png', 'icons/apple-touch-icon-167.png'],
      manifest: {
        name: '360note · 360笔记',
        short_name: '360note',
        description: '360note / 360笔记 — a calm, local-first notebook for ideas and knowledge.',
        theme_color: '#17865b',
        background_color: '#F8F6F1',
        id: '/',
        lang: 'zh-CN',
        dir: 'ltr',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        prefer_related_applications: false,
        start_url: '/app',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: '快速记录', short_name: '新建笔记', url: '/new', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: '搜索', short_name: '搜索', url: '/search', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }
        ],
        share_target: {
          action: '/clip',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: { title: 'title', text: 'text', url: 'url' }
        }
      },
      workbox: {
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        skipWaiting: false,
        clientsClaim: true,
        // Serve navigations from the network first so the server-side <head>
        // (verification meta + admin analytics code) is always current. The
        // precached shell is only a fallback when the network is unavailable.
        navigateFallback: undefined,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Keep index.html out of the precache: Workbox's precache route treats
        // it as the directory index and would serve a stale head without the
        // admin's verification/analytics code. offline.html is a build copy
        // used only when the network is unavailable.
        globIgnores: ['**/index.html'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-navigations',
              networkTimeoutSeconds: 3,
              precacheFallback: { fallbackURL: 'offline.html' }
            }
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly'
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@tiptap')) return 'tiptap';
          if (id.includes('prosemirror')) return 'prosemirror';
          if (id.includes('lowlight') || id.includes('highlight.js')) return 'highlight';
          if (id.includes('lucide-react')) return 'icons';
          return undefined;
        },
      },
    },
  }
});
