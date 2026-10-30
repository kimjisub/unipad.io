import { resolve } from 'node:path';
import { type Page } from '@playwright/test';
import { expect, expectPads } from './browser';

export interface SavedRecord { id: string; storeCode?: string; zipBytes: number }

/** Reads the logical record across archive and metadata stores for browser assertions. */
export function storedPackRecords(page: Page) {
  return page.evaluate(() => new Promise<(Omit<import('../src/lib/unipack/storage').StoredUniPack, 'zipData'> & { zipData: number[] })[]>((resolve, reject) => {
    const open = indexedDB.open('unipad');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(['unipacks', 'unipackMetadata']);
      const archives = transaction.objectStore('unipacks').getAll();
      const metadata = transaction.objectStore('unipackMetadata').getAll();
      transaction.onabort = () => { db.close(); reject(transaction.error); };
      transaction.oncomplete = () => {
        db.close();
        resolve(metadata.result.map(record => ({
          ...record,
          zipData: Array.from(new Uint8Array(archives.result.find(archive => archive.id === record.id).zipData)),
        })));
      };
    };
  }));
}

/** The packs in browser storage. The import shows the pads before it saves the pack. */
export async function savedRecords(page: Page): Promise<SavedRecord[]> {
  return (await storedPackRecords(page)).map(({ id, storeCode, zipData }) => ({ id, storeCode, zipBytes: zipData.length }));
}

/** Imports the fixture pack through the normal file input, waits until it is saved and opens `landing`. */
export async function importSavedPack(page: Page, landing = '/') {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expectPads(page);
  await expect.poll(async () => (await savedRecords(page)).length).toBe(1);
  await page.goto(landing);
}

