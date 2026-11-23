import { test, expect } from './browser';
import type { Page } from '@playwright/test';

// The fragment markup can land separately from the navigation fix. Rewrite
// both server HTML and its hydration data, preserving the real document/tables.
async function preparePackLink(page: Page, locale: string) {
  const title = locale === 'ko' ? '연주할 팩은 어디서 구하나요?' : 'Where do I get packs to play?';
  await page.route(/\/docs\/(?:get-started|guide)(?:\?|$)/, async route => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), 'accept-language': locale === 'ko' ? 'ko-KR' : 'en-US' },
    });
    let body = await response.text();
    if (new URL(route.request().url()).pathname.endsWith('/get-started')) {
      if (!body.includes('href="/docs/guide#packs"')) {
        body = body.replaceAll('/docs/guide#faq', '/docs/guide#packs');
      }
    } else {
      body = body.replace(`<h3>${title}</h3>`, `<h3 id="packs">${title}</h3>`)
        .replace(`\\"h3\\",null,{\\"children\\":\\"${title}\\"}`,
          `\\"h3\\",null,{\\"id\\":\\"packs\\",\\"children\\":\\"${title}\\"}`);
    }
    await route.fulfill({ response, body });
  });
  await page.goto('/docs/get-started');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function settledPackLayout(page: Page) {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Observe the real post-load table reflow, rather than accepting an early
    // visible heading that can disappear on the next rendering update.
    let previous = '';
    let stableSince = performance.now();
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const sample = () => {
        const geometry = JSON.stringify([document.body.scrollHeight,
          ...[...document.querySelectorAll('.prose table')].map(node => node.getBoundingClientRect().height)]);
        const now = performance.now();
        if (geometry !== previous) { previous = geometry; stableSince = now; }
        if (now - stableSince >= 750) return resolve();
        if (now - started > 5000) return reject(new Error('Document layout did not settle'));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
  return page.locator('#packs').evaluate(node => ({
    top: node.getBoundingClientRect().top, scrollY, height: document.body.scrollHeight,
    tables: [...document.querySelectorAll('.prose table')].map(table => table.getBoundingClientRect().height),
  }));
}

const topics = ['skins', 'web', 'launchpad', 'custom-firmware', 'faq'];

for (const locale of ['ko', 'en']) {
  test.describe(`${locale} user guide`, () => {
    test.use({ locale: locale === 'ko' ? 'ko-KR' : 'en-US', reducedMotion: 'reduce' });

    for (const width of [1440, 390]) {
      test(`pack link stays uncovered after layout settles at ${width}px`, async ({ page, checkedPage }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await preparePackLink(page, locale);
        await checkedPage.navigate(() => page.locator('a[href="/docs/guide#packs"]').click());
        await expect(page).toHaveURL('/docs/guide#packs');
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        const initial = await settledPackLayout(page);
        // Response buffering can make native WebKit reflow happen earlier.
        // Also force a later table shrink so an early visible heading cannot
        // let the one-shot implementation pass by chance.
        const shrink = await page.evaluate(() => {
          document.documentElement.style.setProperty('overflow-anchor', 'none');
          const table = document.querySelector<HTMLElement>('.prose table')!;
          const before = table.getBoundingClientRect().height;
          table.style.lineHeight = '12px';
          return { before, after: table.getBoundingClientRect().height };
        });
        expect(shrink.before - shrink.after).toBeGreaterThan(40);
        const layout = await settledPackLayout(page);
        await info.attach('settled-layout', { body: JSON.stringify({ initial, shrink, ...layout }), contentType: 'application/json' });
        await info.attach('pack-link', { body: await page.screenshot(), contentType: 'image/png' });
        expect(layout.top, 'pack heading below the fixed navigation after table reflow').toBeGreaterThanOrEqual(80);
        expect(layout.top).toBeLessThan(900);
      });

      test(`pack link leaves user scroll alone after layout changes at ${width}px`, async ({ page, checkedPage }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await preparePackLink(page, locale);
        await checkedPage.navigate(() => page.locator('a[href="/docs/guide#packs"]').click());
        await settledPackLayout(page);
        const before = await page.evaluate(() => scrollY);
        await page.mouse.wheel(0, -300);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(before - 100);
        // A subsequent height change must reach the observer while its safety
        // window is still open, without browser scroll anchoring hiding a pull.
        const changed = await page.evaluate(() => {
          document.documentElement.style.setProperty('overflow-anchor', 'none');
          const table = document.querySelector<HTMLElement>('.prose table')!;
          const before = { scrollY, height: document.body.scrollHeight };
          table.style.marginBottom = '400px';
          return { before, height: document.body.scrollHeight };
        });
        expect(changed.height).toBeGreaterThan(changed.before.height + 300);
        const after = await settledPackLayout(page);
        await info.attach('user-scroll-layout', { body: JSON.stringify({ changed, after }), contentType: 'application/json' });
        expect(Math.abs(after.scrollY - changed.before.scrollY)).toBeLessThan(2);
      });

      for (const topic of topics) {
        test(`direct #${topic} and language switching at ${width}px`, async ({ page, checkedPage }) => {
          test.setTimeout(90_000);
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`/docs/guide#${topic}`);
          const heading = page.locator(`h2#${topic}`);
          await expect(heading).toBeVisible();
          const uncovered = () => page.evaluate(id => {
            const node = document.getElementById(id);
            if (!node) return false;
            const box = node.getBoundingClientRect();
            return box.top >= 80 && box.top < innerHeight;
          }, topic);
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

      test(`entry points and readable layout at ${width}px`, async ({ page, checkedPage }) => {
        test.setTimeout(90_000);
        const visit = async (path: string) => {
          await page.waitForLoadState('networkidle');
          await page.goto(path);
        };
        await page.setViewportSize({ width, height: 900 });
        await visit('/docs');
        await page.waitForLoadState('networkidle');
        await checkedPage.navigate(() => page.getByRole('link', { name: locale === 'ko' ? '사용 안내' : 'User Guide', exact: true }).click());
        await expect(page).toHaveURL('/docs/guide');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        await expect(page.locator('table code').first()).toHaveText('1');
        expect(await page.locator('table code').first().evaluate(node => getComputedStyle(node, '::before').content)).toMatch(/^(none|normal|"")$/);
        await visit('/docs');
        for (const topic of topics) {
          await page.waitForLoadState('networkidle');
          await checkedPage.navigate(() => page.locator(`a[href="/docs/guide#${topic}"]`).click());
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await visit('/docs');
        }
        await visit('/');
        for (const topic of ['skins', 'launchpad', 'faq']) {
          await page.waitForLoadState('networkidle');
          await checkedPage.navigate(() => page.locator(`a[href="/docs/guide#${topic}"]`).click());
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await visit('/');
        }
        await visit('/docs/get-started');
        await page.waitForLoadState('networkidle');
        await checkedPage.navigate(() => page.locator('a[href="/docs/guide#launchpad"]').click());
        await expect(page).toHaveURL('/docs/guide#launchpad');
        await visit('/docs/get-started');
        await page.waitForLoadState('networkidle');
        await checkedPage.navigate(() => page.locator('a[href="/docs/guide#faq"]').click());
        await expect(page).toHaveURL('/docs/guide#faq');
        await visit('/docs/theme');
        await page.waitForLoadState('networkidle');
        await checkedPage.navigate(() => page.locator('a[href="/docs/guide#skins"]').click());
        await expect(page).toHaveURL('/docs/guide#skins');
        await page.waitForLoadState('networkidle');
        await checkedPage.navigate(() => page.locator('a[href="/docs/theme"]').click());
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
