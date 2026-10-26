import { test, expect } from './browser';

const locales = [
  {
    browserLocale: 'en-US',
    lang: 'en',
    terms: 'Terms of Use',
    docs: 'Documentation',
    intro: 'Review the privacy policy and the app usage scope.',
    privacy: 'Privacy Policy',
    privacyDescription: 'Review the privacy policy of the UniPad app.',
    effectiveDate: 'Effective date: October 03, 2018',
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
    privacyDescription: 'UniPad 앱의 개인정보 처리방침을 확인하세요.',
    effectiveDate: '시행일: 2018년 10월 3일',
    usage: '앱 사용 범위 고지',
    usageDescription: 'UniPad 앱의 상업적/비상업적 사용 범위를 확인하세요.',
    usageBody: '허용되는 사용 예시',
  },
];

for (const l of locales) {
  test.describe(`${l.lang} terms`, () => {
    test.use({ locale: l.browserLocale });

    test('the terms list, usage scope and privacy pages are in the page language', async ({ page }) => {
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
      await expect(main.getByRole('link', { name: l.terms })).toBeVisible();
    });
  });
}
