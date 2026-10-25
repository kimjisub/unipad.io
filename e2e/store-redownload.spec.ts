import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Page } from '@playwright/test';
import { test, expect, expectPads } from './browser';
import { connectStore } from './database';
import { savedRecords, type SavedRecord } from './saved-packs';

const STORE_CODE = 'browser-test';
const PACK_NAME = 'Browser Test Pack by UniPad Tests';
const storeItems = {
  [STORE_CODE]: {
    code: STORE_CODE,
    title: 'Browser Test Pack',
    producerName: 'UniPad Tests',
    downloadCount: 1,
    url: 'https://packs.unipad.test/browser-test.zip',
  },
};

/**
 * Leaves a downloaded copy of the store pack in browser storage that the open page has not
 * listed yet, as when it was downloaded in another tab. The store then offers it for download again.
 */
async function openStoreWithUnlistedCopy(page: Page): Promise<SavedRecord> {
  const database = await connectStore(page.context(), 1, storeItems);
  const pack = await readFile(resolve('e2e/fixtures/basic.uni'));
  await page.route('**/api/store/download?**', route => route.fulfill({ body: pack, contentType: 'application/zip' }));
  await page.goto('/play');
  await database.publish(1);
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expectPads(page);
  await expect.poll(async () => (await savedRecords(page)).length).toBe(1);
  await page.goto('/play');
  await expect(page.getByRole('option', { name: PACK_NAME, exact: true })).toBeVisible();
  await page.evaluate(storeCode => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('unipad');
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('unipackMetadata', 'readwrite');
      const store = transaction.objectStore('unipackMetadata');
      const request = store.getAll();
      request.onsuccess = () => request.result.forEach(record => store.put({ ...record, storeCode }));
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => reject(transaction.error);
    };
  }), STORE_CODE);
  const [copy] = await savedRecords(page);
  await page.getByRole('button', { name: /^Store/ }).click();
  return copy;
}

test('keeps the downloaded copy when saving the store pack again fails', async ({ page }, testInfo) => {
  const copy = await openStoreWithUnlistedCopy(page);
  // Full storage aborts the write transaction after its requests were accepted.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      if ((value as { storeCode?: string }).storeCode) {
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    };
  });
  const row = page.locator(`[data-store-code="${STORE_CODE}"]`);
  await row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText(/^(Download canceled\.|Downloaded: Browser Test Pack)$/)).toBeVisible();
  await testInfo.attach('failed-save', { body: await page.screenshot({ path: testInfo.outputPath('failed-save.png') }), contentType: 'image/png' });
  expect(await savedRecords(page)).toEqual([copy]);
  await expect(row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();

  await page.goto('/play');
  await page.getByRole('option', { name: PACK_NAME, exact: true }).press('Enter');
  await expectPads(page);
});

test('keeps a single copy after downloading the store pack again', async ({ page }, testInfo) => {
  const copy = await openStoreWithUnlistedCopy(page);
  const row = page.locator(`[data-store-code="${STORE_CODE}"]`);
  await row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('Downloaded: Browser Test Pack')).toBeVisible();
  await testInfo.attach('saved-again', { body: await page.screenshot({ path: testInfo.outputPath('saved-again.png') }), contentType: 'image/png' });
  const records = await savedRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ storeCode: STORE_CODE, zipBytes: copy.zipBytes });
  expect(records[0].id).not.toBe(copy.id);
});
