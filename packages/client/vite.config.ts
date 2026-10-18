import { defineConfig } from 'vite';

export default defineConfig({
  // Относительные пути - сборка работает и на GitHub Pages (/avi-town/), и локально
  base: './',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
