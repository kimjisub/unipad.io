import { defineConfig } from '@playwright/test';
import { serverCommand, serverReady } from './e2e/server';

const portableTests = ['docs.spec.ts', 'home.spec.ts', 'large-text.spec.ts', 'rectangular-pad-layout.spec.ts', 'play.spec.ts', 'input-boundaries.spec.ts', 'store-keyboard.spec.ts'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    // Set in the test workers from the started server's output (webServer.wait below).
    baseURL: process.env.E2E_SERVER_URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // iPhone Safari draws pages with WebKit; only WebKit shows Hangul without a font as missing-glyph boxes.
    { name: 'webkit', testMatch: portableTests, use: { browserName: 'webkit' } },
    // Scales only the device stream after the Web Audio graph, so the analyser still measures the signal.
    { name: 'firefox', timeout: 90_000, testMatch: ['play.spec.ts'], use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0' } } } },
    // The Windows runner supplies these installed channels; local Macs still run all three engines.
    ...(process.platform === 'win32' ? [
      { name: 'chrome', testMatch: 'play.spec.ts', use: { browserName: 'chromium' as const, channel: 'chrome' } },
      { name: 'msedge', testMatch: 'play.spec.ts', use: { browserName: 'chromium' as const, channel: 'msedge' } },
    ] : []),
  ],
  webServer: {
    // E2E_PORT pins the port when needed; by default each run gets a free one.
    command: serverCommand(process.env.E2E_PORT || undefined),
    wait: { stdout: serverReady },
    reuseExistingServer: false,
  },
});
