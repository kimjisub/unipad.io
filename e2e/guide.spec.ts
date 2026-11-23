import { test, expect } from './browser';

const topics = ['skins', 'web', 'launchpad', 'custom-firmware', 'faq'];

for (const locale of ['ko', 'en']) {
  test.describe(`${locale} user guide`, () => {
    test.use({ locale: locale === 'ko' ? 'ko-KR' : 'en-US', reducedMotion: 'reduce' });

    for (const width of [1440, 390]) {
      for (const topic of topics) {
        test(`direct #${topic} and language switching at ${width}px`, async ({ page, checkedPage }) => {
          test.setTimeout(90_000);
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`/docs/guide#${topic}`);
          const heading = page.locator(`h2#${topic}`);
          await expect(heading).toBeVisible();
          const uncovered = () => heading.evaluate(node => {
            const box = node.getBoundingClientRect();
            return box.top >= 80 && box.top < innerHeight;
          });
          await expect.poll(uncovered).toBe(true);
          const switchToOther = page.getByRole('button', { name: locale === 'ko' ? 'Switch to English' : '한국어로 전환' });
          await switchToOther.focus();
          await checkedPage.navigate(() => switchToOther.press('Enter'));
          await page.waitForLoadState();
          await expect(page.locator('html')).toHaveAttribute('lang', locale === 'ko' ? 'en' : 'ko');
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await expect.poll(uncovered).toBe(true);
          const switchBack = page.getByRole('button', { name: locale === 'ko' ? '한국어로 전환' : 'Switch to English' });
          await switchBack.focus();
          await checkedPage.navigate(() => switchBack.press('Enter'));
          await page.waitForLoadState();
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await expect.poll(uncovered).toBe(true);
        });
      }

      test(`entry points and readable layout at ${width}px`, async ({ page }) => {
        test.setTimeout(90_000);
        const visit = async (path: string) => {
          await page.waitForLoadState('networkidle');
          await page.goto(path);
        };
        await page.setViewportSize({ width, height: 900 });
        await visit('/docs');
        await page.waitForLoadState('networkidle');
        await page.getByRole('link', { name: locale === 'ko' ? '사용 안내' : 'User Guide', exact: true }).click();
        await expect(page).toHaveURL('/docs/guide');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        await expect(page.locator('table code').first()).toHaveText('1');
        expect(await page.locator('table code').first().evaluate(node => getComputedStyle(node, '::before').content)).toMatch(/^(none|normal|"")$/);
        await visit('/docs');
        for (const topic of topics) {
          await page.waitForLoadState('networkidle');
          await page.locator(`a[href="/docs/guide#${topic}"]`).click();
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await visit('/docs');
        }
        await visit('/');
        for (const topic of ['skins', 'launchpad', 'faq']) {
          await page.waitForLoadState('networkidle');
          await page.locator(`a[href="/docs/guide#${topic}"]`).click();
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await visit('/');
        }
        await visit('/docs/get-started');
        await page.waitForLoadState('networkidle');
        await page.locator('a[href="/docs/guide#launchpad"]').click();
        await expect(page).toHaveURL('/docs/guide#launchpad');
        await visit('/docs/get-started');
        await page.waitForLoadState('networkidle');
        await page.locator('a[href="/docs/guide#faq"]').click();
        await expect(page).toHaveURL('/docs/guide#faq');
        await visit('/docs/theme');
        await page.waitForLoadState('networkidle');
        await page.locator('a[href="/docs/guide#skins"]').click();
        await expect(page).toHaveURL('/docs/guide#skins');
        await page.waitForLoadState('networkidle');
        await page.locator('a[href="/docs/theme"]').click();
        await expect(page).toHaveURL('/docs/theme');
      });
    }


    for (const path of [
      '/docs/guide', '/docs/get-started', '/docs/theme',
      '/docs/unipack/info', '/docs/unipack/key-sound', '/docs/unipack/key-led',
      '/docs/unipack/sounds', '/docs/unipack/auto-play',
    ]) {
      test(`table words stay intact at 390px in ${path}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 900 });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const tables = page.locator('.prose table');
        expect(await tables.count()).toBeGreaterThan(0);
        const measured = await tables.evaluateAll(tables => {
          const broken: { word: string; cell: string }[] = [];
          let words = 0;
          for (const table of tables) {
            for (const cell of table.querySelectorAll('th, td')) {
              const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                // Spaces, punctuation and hyphens are valid wrap points. Latin words and
                // identifiers must not break inside a token, including in Korean prose.
                const matches = node.textContent?.matchAll(/[A-Za-z0-9_]+/g) ?? [];
                for (const match of matches) {
                  if (match[0].length < 2) continue;
                  words++;
                  const range = document.createRange();
                  range.setStart(node, match.index!);
                  range.setEnd(node, match.index! + match[0].length);
                  const lines = new Set([...range.getClientRects()]
                    .filter(rect => rect.width > 0 && rect.height > 0)
                    .map(rect => Math.round(rect.top)));
                  if (lines.size > 1) broken.push({ word: match[0], cell: cell.textContent!.trim() });
                }
              }
            }
          }
          return {
            words, broken,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            tableOverflow: tables.map(table => Math.max(0, table.getBoundingClientRect().right - innerWidth)),
          };
        });
        await testInfo.attach('table-layout', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
        await testInfo.attach('first-table', { body: await tables.first().screenshot(), contentType: 'image/png' });
        if (path === '/docs/guide') {
          await testInfo.attach('model-table', { body: await tables.nth(1).screenshot(), contentType: 'image/png' });
        }
        expect(measured.words, 'table word geometry was measured').toBeGreaterThan(0);
        expect(measured.broken, 'words and identifiers split across lines').toEqual([]);
        expect(measured.pageOverflow, 'page horizontal overflow').toBe(0);
        expect(measured.tableOverflow, 'tables beyond the viewport').toEqual(measured.tableOverflow.map(() => 0));
      });
    }

    test('keyboard keys and callout links are readable in existing docs', async ({ page }) => {
      await page.goto('/docs/get-started');
      const code = page.locator('table code').first();
      expect(await code.evaluate(node => getComputedStyle(node, '::before').content)).toMatch(/^(none|normal|"")$/);
      const link = page.locator('.not-prose a').first();
      expect(await link.evaluate(node => getComputedStyle(node).textDecorationLine)).toContain('underline');
    });
  });
}

test('the sitemap includes the user guide', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(await response.text()).toContain('https://unipad.io/docs/guide');
});
