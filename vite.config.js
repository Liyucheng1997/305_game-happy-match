import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // three.js 本身约 600 kB，单包即可
  build: { chunkSizeWarningLimit: 800 },
});
