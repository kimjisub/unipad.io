import { withGuidepup } from '@guidepup/playwright';
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

const dry = process.env.VOICEOVER_DRY === '1';

// VoiceOver checks: macOS with VoiceOver prepared by `@guidepup/setup` (.github/workflows/voiceover.yml).
// One screen reader drives the whole machine, so withGuidepup runs one test at a time in a shown browser.
// A dry run walks the same steps headless, without a screen reader.
const config = defineConfig({
  ...base,
  testMatch: '*.voiceover.spec.ts',
  testIgnore: [],
  timeout: 5 * 60_000,
  // VoiceOver sometimes misses its first command after starting.
  retries: dry ? 0 : 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});

export default dry ? config : withGuidepup(config);
