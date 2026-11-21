import { test, expect } from './browser';

const topics = ['skins', 'web', 'launchpad', 'custom-firmware', 'faq'];

for (const locale of ['ko', 'en']) {
  test.describe(`${locale} user guide`, () => {
    test.use({ locale: locale === 'ko' ? 'ko-KR' : 'en-US', reducedMotion: 'reduce' });

    for (const width of [1440, 390]) {
      test(`entry points, anchors and language switching at ${width}px`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/docs');
        await page.getByRole('link', { name: locale === 'ko' ? '사용 안내' : 'User Guide', exact: true }).click();
        await expect(page).toHaveURL('/docs/guide');
        for (const topic of topics) {
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
          await switchToOther.press('Enter');
          await expect(page.locator('html')).toHaveAttribute('lang', locale === 'ko' ? 'en' : 'ko');
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await expect.poll(uncovered).toBe(true);
          const switchBack = page.getByRole('button', { name: locale === 'ko' ? '한국어로 전환' : 'Switch to English' });
          await switchBack.focus();
          await switchBack.press('Enter');
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
        await expect(page.locator('table code').first()).toHaveText('1');
        expect(await page.locator('table code').first().evaluate(node => getComputedStyle(node, '::before').content)).toMatch(/^(none|normal|"")$/);
        await page.goto('/docs');
        for (const topic of topics) {
          await page.locator(`a[href="/docs/guide#${topic}"]`).click();
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await page.goto('/docs');
        }
        await page.goto('/');
        for (const topic of ['skins', 'launchpad', 'faq']) {
          await page.locator(`a[href="/docs/guide#${topic}"]`).click();
          await expect(page).toHaveURL(`/docs/guide#${topic}`);
          await page.goto('/');
        }
        await page.goto('/docs/get-started');
        await page.locator('a[href="/docs/guide#launchpad"]').click();
        await expect(page).toHaveURL('/docs/guide#launchpad');
        await page.goto('/docs/get-started');
        await page.locator('a[href="/docs/guide#faq"]').click();
        await expect(page).toHaveURL('/docs/guide#faq');
        await page.goto('/docs/theme');
        await page.locator('a[href="/docs/guide#skins"]').click();
        await expect(page).toHaveURL('/docs/guide#skins');
        await page.locator('a[href="/docs/theme"]').click();
        await expect(page).toHaveURL('/docs/theme');
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
