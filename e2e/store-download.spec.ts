import { test, expect } from './browser';
import { connectStore } from './database';

const MISSING_PACK = {
  code: 'missing-pack',
  title: 'Missing Pack',
  producerName: 'Browser Test',
  isAutoPlay: false,
  isLED: true,
  downloadCount: 1,
  url: 'https://unipad-browser-test.invalid/missing-pack.zip',
};

const locales = [
  { locale: 'ko-KR', store: /^스토어/, notFound: '서버에서 팩을 찾을 수 없습니다.', retry: '다시 시도' },
  { locale: 'en-US', store: /^Store/, notFound: 'Pack not found on server.', retry: 'Retry' },
];

for (const l of locales) {
  test.describe(`${l.locale} store download`, () => {
    test.use({ locale: l.locale });

    test('tells the person in their language when the pack is missing on the server', async ({ page, context }, testInfo) => {
      const database = await connectStore(context, 1, { [MISSING_PACK.code]: MISSING_PACK });
      await page.route('**/api/store/download?*', route => route.fulfill({ status: 404, body: 'Not Found' }));
      await page.goto('/play');
      await database.publish(1);
      await page.getByRole('button', { name: l.store }).first().click();
      const store = page.getByRole('dialog');
      await expect(store.getByText(MISSING_PACK.title).first()).toBeVisible({ timeout: 15000 });
      await store.getByRole('button', { name: /^(다운로드|Download)$/ }).click();

      await expect(page.getByText(l.notFound)).toBeVisible();
      await testInfo.attach(`${l.locale}-pack-not-found`, { body: await page.screenshot({ path: testInfo.outputPath(`${l.locale}-pack-not-found.png`) }), contentType: 'image/png' });
      await expect(store.getByRole('button', { name: l.retry })).toBeVisible();
    });
  });
}
