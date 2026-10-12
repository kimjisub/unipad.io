import { defineConfig } from '@playwright/test';

const portableTests = ['docs.spec.ts', 'home.spec.ts', 'large-text.spec.ts', 'rectangular-pad-layout.spec.ts', 'play.spec.ts'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://localhost:3184',
    headless: true,
    // Chromium also adds this flag by default in headless mode.
    launchOptions: { ignoreDefaultArgs: ['--mute-audio'] },
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // iPhone Safari draws pages with WebKit; only WebKit shows Hangul without a font as missing-glyph boxes.
    { name: 'webkit', testMatch: portableTests, use: { browserName: 'webkit' } },
    { name: 'firefox', timeout: 90_000, testMatch: ['play.spec.ts'], use: { browserName: 'firefox' } },
    // The Windows runner supplies these installed channels; local Macs still run all three engines.
    ...(process.platform === 'win32' ? [
      { name: 'chrome', testMatch: 'play.spec.ts', use: { browserName: 'chromium' as const, channel: 'chrome' } },
      { name: 'msedge', testMatch: 'play.spec.ts', use: { browserName: 'chromium' as const, channel: 'msedge' } },
    ] : []),
  ],
  webServer: {
    command: 'node node_modules/next/dist/bin/next start --hostname localhost --port 3184',
    url: 'http://localhost:3184/play',
    reuseExistingServer: false,
  },
});
