// M22 Playwright: screens at 1920×1080, 1366×768 and phone size, against a local stack
// (web preview + api with DEMO_MODE=true) or the staging site via E2E_BASE_URL.
// Never point it at production (tests/e2e/README.md).
import { defineConfig } from '@playwright/test';

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4173';
if (/\/\/noc\.sbc\.lan/.test(baseURL)) throw new Error('e2e must not run against production');

// Chromium of the machine (e.g. a sandbox with a different Playwright build); CI uses the image's.
const executablePath = process.env['PW_CHROMIUM_PATH'];
// WebGL without a GPU: SwiftShader (CI, headless servers). A real TV measures fps on its own GPU.
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: './specs',
  outputDir: './results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one WebGL scene at a time: software rendering is CPU-heavy
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args, ...(executablePath ? { executablePath } : {}) },
  },
  projects: [
    {
      name: 'desktop-1920',
      use: { viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' },
    },
    {
      name: 'laptop-1366',
      use: { viewport: { width: 1366, height: 768 }, colorScheme: 'light' },
    },
    {
      // Chromium with a phone's size, touch and pixel ratio (WebKit is not needed for a LAN NOC)
      name: 'phone-390',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
      },
    },
  ],
  // Local stack: serve the built web; vite preview proxies /api to the api on :3001.
  ...(process.env['E2E_BASE_URL']
    ? {}
    : {
        webServer: {
          command: 'pnpm --filter @sbc-noc/web exec vite preview --port 4173 --strictPort',
          url: 'http://localhost:4173',
          reuseExistingServer: !process.env['CI'],
          timeout: 60_000,
        },
      }),
});
