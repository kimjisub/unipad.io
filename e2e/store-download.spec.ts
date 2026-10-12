import { type BrowserContext } from '@playwright/test';
import { test, expect } from './browser';

const MISSING_PACK = {
  code: 'missing-pack',
  title: 'Missing Pack',
  producerName: 'Browser Test',
  isAutoPlay: false,
  isLED: true,
  downloadCount: 1,
  url: 'https://unipad-browser-test.invalid/missing-pack.zip',
};

// Answers the store list from the realtime database with one pack whose file is gone.
async function serveStoreList(context: BrowserContext) {
  await context.route('**/firebaseremoteconfig.googleapis.com/**', route => route.fulfill({ json: { entries: {}, state: 'NO_CHANGE' } }));
  await context.routeWebSocket(/firebaseio\.com|firebasedatabase\.app/, socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.t !== 'd') return;
      const { r, a, b } = message.d;
      const data = b?.p === '/store' ? { [MISSING_PACK.code]: MISSING_PACK } : null;
      if (a === 'q' && data) socket.send(JSON.stringify({ t: 'd', d: { a: 'd', b: { p: b.p, d: data } } }));
      socket.send(JSON.stringify({ t: 'd', d: { r, b: { s: 'ok', d: a === 'g' ? data : '' } } }));
    });
    socket.send(JSON.stringify({ t: 'c', d: { t: 'h', d: { ts: Date.now(), v: '5', h: new URL(socket.url()).hostname, s: 'browser-test-session' } } }));
  });
}

const locales = [
  { locale: 'ko-KR', store: /^스토어/, notFound: '서버에서 팩을 찾을 수 없습니다.', retry: '다시 시도' },
  { locale: 'en-US', store: /^Store/, notFound: 'Pack not found on server.', retry: 'Retry' },
];

for (const l of locales) {
  test.describe(`${l.locale} store download`, () => {
    test.use({ locale: l.locale });

    test('tells the person in their language when the pack is missing on the server', async ({ page, context }, testInfo) => {
      await serveStoreList(context);
      await page.route('**/api/store/download?*', route => route.fulfill({ status: 404, body: 'Not Found' }));
      await page.goto('/play');
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
