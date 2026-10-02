import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    // `pnpm --filter @sbc-noc/web dev` proxies to a local api (`pnpm --filter @sbc-noc/api dev`).
    proxy: {
      '/api': { target: 'http://localhost:3001', rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
