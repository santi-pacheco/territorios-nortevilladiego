import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Capacitor loads from capacitor://localhost / https://localhost, so assets must be relative.
  base: mode === 'capacitor' ? './' : '/',
  build: { manifest: true, target: 'es2022', sourcemap: false },
}));
