import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // three.js (M19) is one lazily loaded chunk of ~630 kB (160 kB gzip); the page itself stays small
  build: { chunkSizeWarningLimit: 700 },
  server: {
    // `pnpm --filter @sbc-noc/web dev` proxies to a local api (`pnpm --filter @sbc-noc/api dev`).
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        ws: true, // live status WebSocket (M16)
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
