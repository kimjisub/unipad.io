import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from './browser';
import { connectStore } from './database';
import { expectSavedPackCount, savedRecords } from './saved-packs';

const STORE_CODE = 'browser-test';
const PACK_URL = 'https://unipack.unipad.io/store/browser-test.zip';
const storeItems = {
  [STORE_CODE]: {
    code: STORE_CODE,
    title: 'Browser Test Pack',
    producerName: 'UniPad Tests',
    downloadCount: 1,
    URL: PACK_URL,
  },
};

// The file host serves CORS headers, so the browser downloads a pack from it directly. The site
// (the download route, or the old /store-files/ path) must not be asked: every byte through it
// counts against the hosting plan's small data allowance.
test('a store pack downloads straight from the file host', async ({ page }, testInfo) => {
  const database = await connectStore(page.context(), 1, storeItems);
  const pack = await readFile(resolve('e2e/fixtures/basic.uni'));
  const asked: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/store/download') || url.pathname.startsWith('/store-files/') || url.hostname === 'unipack.unipad.io') {
      asked.push(url.hostname === 'unipack.unipad.io' ? url.href : url.pathname);
    }
  });
  await page.route(PACK_URL, route => route.fulfill({
    body: pack,
    headers: { 'content-type': 'application/zip', 'content-length': String(pack.length), 'access-control-allow-origin': '*' },
  }));
  await page.goto('/play');
  await database.publish(1);
  await page.getByRole('button', { name: /^Store/ }).first().click();
  const row = page.locator(`[data-store-code="${STORE_CODE}"]`);
  await row.getByRole('button', { name: 'Download', exact: true }).click();

  await expect(page.getByText('Downloaded: Browser Test Pack')).toBeVisible();
  await testInfo.attach('downloaded', { body: await page.screenshot({ path: testInfo.outputPath('downloaded.png') }), contentType: 'image/png' });
  await expectSavedPackCount(page, 1);
  expect((await savedRecords(page))[0]).toMatchObject({ storeCode: STORE_CODE, zipBytes: pack.length });
  expect(asked).toEqual([PACK_URL]);
});

// Pages opened before this change still ask the download route or /store-files/. Both send the browser
// to the file host instead of answering with the pack; only their own answers are checked here. (A
// next.config redirect carries the target address as its body, never the pack.)
test('the download route and the old store file path redirect to the file host without a body', async ({ request }) => {
  const route = `/api/store/download?url=${encodeURIComponent(PACK_URL)}`;
  for (const [path, status] of [[route, 302], ['/store-files/browser-test.zip', 307]] as const) {
    for (const headers of [{}, { range: 'bytes=0-3' }] as Record<string, string>[]) {
      const response = await request.get(path, { headers, maxRedirects: 0 });
      expect(response.status(), path).toBe(status);
      expect(response.headers()['location'], path).toBe(PACK_URL);
      expect((await response.body()).length, path).toBeLessThan(100);
    }
  }
  const refused = await request.get(`/api/store/download?url=${encodeURIComponent('https://example.com/a.zip')}`, { maxRedirects: 0 });
  expect(refused.status()).toBe(403);
});
