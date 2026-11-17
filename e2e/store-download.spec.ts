import { createServer } from 'node:http';
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

// The other store tests replace /api/store/download in the page, so only this one goes through the
// real server, where Next.js drops content-length from route responses. The progress bar needs the
// length, so it must arrive under the route's own header. The server allows 127.0.0.1 for this file host.
test('the download route tells the browser how large the pack is', async ({ request }) => {
  const pack = Buffer.alloc(3_000_000, 7);
  const host = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': pack.length });
    res.end(pack);
  });
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  try {
    const address = host.address();
    if (!address || typeof address === 'string') throw new Error('file host did not bind');
    const url = `http://127.0.0.1:${address.port}/pack.zip`;
    const response = await request.get(`/api/store/download?url=${encodeURIComponent(url)}`);

    expect(response.status()).toBe(200);
    expect(response.headers()['x-content-length']).toBe(String(pack.length));
    expect((await response.body()).length).toBe(pack.length);
  } finally {
    await new Promise<void>((resolve, reject) => host.close(error => error ? reject(error) : resolve()));
  }
});
