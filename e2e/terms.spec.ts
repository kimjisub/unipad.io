import { test, expect } from './browser';

const locales = [
  {
    browserLocale: 'en-US',
    lang: 'en',
    terms: 'Terms of Use',
    docs: 'Documentation',
    intro: 'Review the privacy policy and the app usage scope.',
    privacy: 'Privacy Policy',
    privacyBody: 'In short',
    tableHeaders: ['Data', 'What it is', 'Why'],
    privacyDescription: 'Review the privacy policy of the UniPad app.',
    effectiveDate: 'Effective date: November 21, 2026',
    usage: 'App Usage Scope Notice',
    usageDescription: 'Review the commercial and non-commercial usage scope of the UniPad app.',
    usageBody: 'Permitted Usage Examples',
  },
  {
    browserLocale: 'ko-KR',
    lang: 'ko',
    terms: '이용약관',
    docs: '문서',
    intro: '개인정보 처리방침 및 앱 사용 범위를 확인할 수 있습니다.',
    privacy: '개인정보 처리방침',
    privacyBody: '요약',
    tableHeaders: ['정보', '내용', '쓰는 곳'],
    privacyDescription: 'UniPad 앱의 개인정보 처리방침을 확인하세요.',
    effectiveDate: '시행일: 2026년 11월 21일',
    usage: '앱 사용 범위 고지',
    usageDescription: 'UniPad 앱의 상업적/비상업적 사용 범위를 확인하세요.',
    usageBody: '허용되는 사용 예시',
  },
];

for (const l of locales) {
  test.describe(`${l.lang} terms`, () => {
    test.use({ locale: l.browserLocale });

    test('the terms list, usage scope and privacy pages are in the page language', async ({ page }, testInfo) => {
      await page.goto('/docs/terms');
      await expect(page.locator('html')).toHaveAttribute('lang', l.lang);
      const main = page.locator('main');
      await expect(main.getByRole('link', { name: l.docs })).toBeVisible();
      await expect(main.getByRole('heading', { level: 1, name: l.terms })).toBeVisible();
      await expect(main.getByText(l.intro)).toBeVisible();
      await expect(main.getByRole('heading', { level: 2, name: l.privacy })).toBeVisible();
      await expect(main.getByText(l.privacyDescription)).toBeVisible();
      await expect(main.getByRole('heading', { level: 2, name: l.usage })).toBeVisible();
      await expect(main.getByText(l.usageDescription)).toBeVisible();

      await main.getByRole('link', { name: l.usage }).click();
      await expect(page).toHaveURL(/\/docs\/terms\/usage$/);
      await expect(main.getByRole('heading', { level: 1, name: l.usage })).toBeVisible();
      await expect(main.getByRole('heading', { level: 2, name: l.usageBody })).toBeVisible();
      await main.getByRole('link', { name: l.terms }).click();
      await expect(page).toHaveURL(/\/docs\/terms$/);

      await main.getByRole('link', { name: l.privacy }).click();
      await expect(page).toHaveURL(/\/docs\/terms\/privacy$/);
      await expect(main.getByRole('heading', { level: 1, name: l.privacy })).toBeVisible();
      await expect(main.getByText(l.effectiveDate)).toBeVisible();
      await expect(main.getByRole('heading', { level: 2, name: l.privacyBody, exact: true })).toBeVisible();
      const body = main.locator('.prose');
      await expect(body.getByRole('table')).toHaveCount(1);
      await expect(body.getByRole('columnheader')).toHaveText(l.tableHeaders);
      await expect(body.getByRole('row')).toHaveCount(6);
      await expect(body).not.toContainText('##');
      const links = body.getByRole('link');
      const hrefs = await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      expect(hrefs.filter(href => href === 'mailto:0226unipad@gmail.com')).toHaveLength(2);
      expect(hrefs.some(href => href?.startsWith('https://policies.google.com/privacy'))).toBe(true);
      expect(hrefs).toContain('https://vercel.com/legal/privacy-policy');
      // Exercise real clicks without opening a mail client or leaving the local page.
      for (const link of await links.all()) {
        await link.evaluate(node => {
          node.addEventListener('click', event => {
            event.preventDefault();
            node.setAttribute('data-clicked', 'true');
          }, { once: true });
        });
        await link.click();
        await expect(link).toHaveAttribute('data-clicked', 'true');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await testInfo.attach(`${l.lang}-privacy`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await expect(main.getByRole('link', { name: l.terms })).toBeVisible();
    });
  });
}
