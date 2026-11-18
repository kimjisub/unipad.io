import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './browser';

// The copy on the second host must read exactly like the site: same title, date line and body text.
let mirror = '';

test.beforeAll(() => {
  mirror = mkdtempSync(join(tmpdir(), 'terms-mirror-e2e-'));
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/terms-mirror.mts', mirror], { stdio: 'pipe' });
});

test.afterAll(() => {
  if (mirror) rmSync(mirror, { recursive: true, force: true });
});

async function readDocument(page: Page, root: string, body: string) {
  const scope = page.locator(root);
  const subtitle = scope.locator('h1 + p');
  return {
    title: (await scope.locator('h1').innerText()).trim(),
    subtitle: (await subtitle.count()) ? (await subtitle.innerText()).trim() : '',
    body: (await scope.locator(body).innerText()).replace(/\s+/g, ' ').trim(),
  };
}

const cases = [
  { browserLocale: 'en-US', lang: 'en', prefix: '' },
  { browserLocale: 'ko-KR', lang: 'ko', prefix: 'ko/' },
];

for (const c of cases) {
  test.describe(`${c.lang} terms copy`, () => {
    test.use({ locale: c.browserLocale });

    for (const doc of ['privacy', 'usage']) {
      test(`the ${doc} copy matches the site page`, async ({ page }) => {
        await page.goto(`/docs/terms/${doc}`);
        await expect(page.locator('html')).toHaveAttribute('lang', c.lang);
        const site = await readDocument(page, 'main', '.prose');

        // The test browser only reaches the site's own server, so the copied page is loaded as content.
        await page.setContent(readFileSync(join(mirror, `${c.prefix}docs/terms/${doc}/index.html`), 'utf8'));
        await expect(page.locator('html')).toHaveAttribute('lang', c.lang);
        const copy = await readDocument(page, 'main', 'article');

        expect(site.body.length).toBeGreaterThan(100);
        expect(copy).toEqual(site);
      });
    }
  });
}
