import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const CARTO = ['https://*.basemaps.cartocdn.com', 'https://basemaps.cartocdn.com'];

/**
 * Content-Security-Policy as a <meta> tag. Production allows only the app itself, hosted
 * Supabase and the CARTO basemap. Local Supabase (and, in dev, Vite's inline React-refresh
 * preamble and HMR socket) are added only when serving or building against a local stack.
 */
function csp(command: 'serve' | 'build', supabaseUrl: string | undefined): Plugin {
  const dev = command === 'serve';
  const local = dev || /^http:\/\/(127\.0\.0\.1|localhost)/.test(supabaseUrl ?? '');
  const localApi = local ? ['http://127.0.0.1:54321', 'ws://127.0.0.1:54321', 'http://localhost:54321', 'ws://localhost:54321'] : [];
  const policy = [
    "default-src 'self'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
    "font-src 'self'",
    ['connect-src', "'self'", 'https://*.supabase.co', 'wss://*.supabase.co', ...localApi, ...CARTO, ...(dev ? ['ws:'] : [])].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
  return {
    name: 'territorios-csp',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(({ mode, command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    csp(command, loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL),
    // The native shell (mode 'capacitor') ships its assets in the APK/IPA: no service worker.
    VitePWA({
      disable: mode === 'capacitor',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Territorios · Norte Villa Diego',
        short_name: 'Territorios',
        lang: 'es-AR',
        display: 'standalone',
        start_url: '/salidas',
        scope: '/',
        theme_color: '#ffffff',
        background_color: '#eef1f4',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + self-hosted fonts. Lazy route chunks are precached too so every screen
        // opens offline; pdf.js (editors only) is left to the network.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,kml}'],
        globIgnores: ['**/pdf-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Supabase is deliberately not cached here: the persisted query cache holds the data.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/([a-z0-9-]+\.)*basemaps\.cartocdn\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'carto-basemap',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  base: mode === 'capacitor' ? './' : '/',
  build: { manifest: true, target: 'es2022', sourcemap: false },
}));
