import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Page } from '@playwright/test';
import { test, expect } from './browser';
import { connectStore } from './database';

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

interface SavedRecord { id: string; storeCode?: string; zipBytes: number }

function savedRecords(page: Page): Promise<SavedRecord[]> {
  return page.evaluate(() => new Promise<SavedRecord[]>((resolve, reject) => {
    const open = indexedDB.open('unipad');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('unipacks').objectStore('unipacks').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        resolve(request.result.map(({ id, storeCode, zipData }) => ({ id, storeCode, zipBytes: zipData.byteLength })));
      };
    };
  }));
}

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
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  // The import shows the pads before it saves the pack.
  await expect.poll(async () => (await savedRecords(page)).length).toBe(1);
  await page.goto('/play');
  await expect(page.getByRole('option', { name: PACK_NAME, exact: true })).toBeVisible();
  await page.evaluate(storeCode => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('unipad');
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('unipacks', 'readwrite');
      const store = transaction.objectStore('unipacks');
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
  // Browsers report full storage by aborting the write transaction.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      if ((value as { storeCode?: string }).storeCode) this.transaction.abort();
      return request;
    };
  });
  const row = page.locator(`[data-store-code="${STORE_CODE}"]`);
  await row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await testInfo.attach('failed-save', { body: await page.screenshot({ path: testInfo.outputPath('failed-save.png') }), contentType: 'image/png' });
  expect(await savedRecords(page)).toEqual([copy]);

  await page.goto('/play');
  await page.getByRole('option', { name: PACK_NAME, exact: true }).press('Enter');
  await expect(page.locator('[data-pad]')).toHaveCount(64);
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
