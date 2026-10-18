import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const LOCAL_API = ['http://127.0.0.1:54321', 'ws://127.0.0.1:54321', 'http://localhost:54321', 'ws://localhost:54321'];

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

/** The production policy: the `Content-Security-Policy` header of vercel.json. */
function headerPolicy(): string {
  const config = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as VercelConfig;
  const value = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value;
  if (!value) throw new Error('vercel.json has no Content-Security-Policy header.');
  return value;
}

/**
 * Content-Security-Policy. In production it is an HTTP header in vercel.json, the single
 * source of truth: a header also covers the service worker and every non-HTML response, and
 * it can carry frame-ancestors. Its Supabase origins are pinned by hand to the hosted project
 * (ref rvugytajoghzqsnclbyf, https + wss) and its CARTO hosts to the ones the basemap style
 * actually uses, so the build fails if VITE_SUPABASE_URL points at another hosted project.
 *
 * Where no Vercel header applies the same policy is injected as a <meta> tag, minus
 * frame-ancestors (ignored in a meta): the native shell (mode 'capacitor'), `vite` dev and
 * builds against local Supabase. The local variant also allows the local API (and, in dev,
 * Vite's inline React-refresh preamble and HMR socket) and drops upgrade-insecure-requests.
 */
function csp(command: 'serve' | 'build', mode: string, supabaseUrl: string | undefined): Plugin {
  const policy = headerPolicy();
  const dev = command === 'serve';
  const local = dev || /^http:\/\/(127\.0\.0\.1|localhost)/.test(supabaseUrl ?? '');
  if (!local && supabaseUrl && !policy.split(/[\s;]+/).includes(new URL(supabaseUrl).origin)) {
    throw new Error(`The vercel.json CSP does not allow ${new URL(supabaseUrl).origin}: update its pinned Supabase origins.`);
  }
  if (!local && mode !== 'capacitor') return { name: 'territorios-csp' };
  const meta = policy
    .split(';')
    .map((d) => d.trim())
    .filter((d) => !d.startsWith('frame-ancestors') && !(local && d === 'upgrade-insecure-requests'))
    .map((d) => {
      if (!local) return d;
      if (d.startsWith('connect-src ')) return [d, ...LOCAL_API, ...(dev ? ['ws:'] : [])].join(' ');
      if (d.startsWith('script-src ') && dev) return `${d} 'unsafe-inline'`;
      return d;
    })
    .join('; ');
  return {
    name: 'territorios-csp',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: meta }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(({ mode, command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    csp(command, mode, loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL),
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
        // Push + notificationclick handlers for the "Mis asignaciones" reminders.
        importScripts: ['push-sw.js'],
        // App shell + self-hosted fonts. Lazy route chunks are precached too so every screen
        // opens offline; pdf.js (editors only) is left to the network.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,kml}'],
        globIgnores: ['**/pdf-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Files that must reach the network as files, never the app shell.
        navigateFallbackDenylist: [/^\/api\//, /\.apk$/, /^\/\.well-known\//],
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
