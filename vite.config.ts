import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error - plain ESM dev plugin, no types needed
import { githubProxy } from './scripts/gh-proxy-plugin.mjs';

export default defineConfig({
  base: './',
  plugins: [react(), githubProxy()],
  server: { port: 5180, open: false },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
});
