import { defineConfig } from 'vite';

// relative paths let dist/ be hosted from any folder or subpath
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 900 },
});
