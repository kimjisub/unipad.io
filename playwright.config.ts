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
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: 'pnpm exec next start --hostname localhost --port 3184',
    url: 'http://localhost:3184/play',
    reuseExistingServer: false,
  },
});
