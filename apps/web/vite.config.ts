import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The page's Content-Security-Policy lives in nginx.conf.template (M17); `vite preview` sends the
// same header so the e2e run (tests/e2e) fails on anything the policy would block in production.
const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(
  readFileSync(new URL('./nginx.conf.template', import.meta.url), 'utf8'),
)?.[1];
if (!csp) throw new Error('Content-Security-Policy not found in nginx.conf.template');

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
  preview: {
    headers: { 'Content-Security-Policy': csp },
  },
  test: {
    environment: 'jsdom',
  },
});
