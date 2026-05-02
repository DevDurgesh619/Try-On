import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.json' with { type: 'json' };

export const viteConfig = defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
  },
});

export default viteConfig;
