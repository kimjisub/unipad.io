import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3184',
    headless: true,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--mute-audio'] } } },
    // iPhone Safari draws pages with WebKit; only WebKit shows Hangul without a font as missing-glyph boxes.
    { name: 'webkit', testMatch: ['docs.spec.ts', 'home.spec.ts', 'large-text.spec.ts'], use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'pnpm exec next start --hostname localhost --port 3184',
    url: 'http://localhost:3184/play',
    reuseExistingServer: false,
  },
});
