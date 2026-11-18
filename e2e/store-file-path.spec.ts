import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from './browser';
import { connectStore } from './database';
import { expectSavedPackCount, savedRecords } from './saved-packs';

const STORE_CODE = 'browser-test';
const storeItems = {
  [STORE_CODE]: {
    code: STORE_CODE,
    title: 'Browser Test Pack',
    producerName: 'UniPad Tests',
    downloadCount: 1,
    URL: 'https://unipack.unipad.io/store/browser-test.zip',
  },
};

// The CDN forwards /store-files/ to the file host (next.config.mjs rewrites), so a pack on that
// host must be asked from there: neither the download route, which streams it through a site
// function, nor the file host itself, which sends no CORS headers.
test('a pack on the store file host downloads through the same-origin CDN path', async ({ page }, testInfo) => {
  const database = await connectStore(page.context(), 1, storeItems);
  const pack = await readFile(resolve('e2e/fixtures/basic.uni'));
  const asked: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/store/download') || url.pathname.startsWith('/store-files/') || url.hostname === 'unipack.unipad.io') {
      asked.push(url.hostname === 'unipack.unipad.io' ? url.href : url.pathname);
    }
  });
  await page.route('**/store-files/browser-test.zip', route => route.fulfill({
    body: pack,
    headers: { 'content-type': 'application/zip', 'content-length': String(pack.length) },
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
  expect(asked).toEqual(['/store-files/browser-test.zip']);
});

// Pages opened before the CDN path existed still ask the download route; it must send them on rather than
// stream the pack itself. A redirect the browser follows is not offered to page.route, so the browser's
// next request (to the file host through the CDN path) is left out: the route's own answer is checked here.
test('the download route sends a store file host pack to the CDN path instead of streaming it', async ({ request }) => {
  const upstream = encodeURIComponent('https://unipack.unipad.io/store/browser-test.zip');
  for (const headers of [{}, { range: 'bytes=0-3' }] as Record<string, string>[]) {
    const response = await request.get(`/api/store/download?url=${upstream}`, { headers, maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toBe('/store-files/browser-test.zip');
    expect((await response.body()).length).toBe(0);
  }
});
