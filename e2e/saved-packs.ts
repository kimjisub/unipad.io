import { resolve } from 'node:path';
import { type Page } from '@playwright/test';
import { expect, expectPads, stateTimeout } from './browser';

export interface SavedRecord { id: string; storeCode?: string; zipBytes: number }

/** Reads the logical record across archive and metadata stores for browser assertions. */
export function storedPackRecords(page: Page) {
  return page.evaluate(() => new Promise<(Omit<import('../src/lib/unipack/storage').StoredUniPack, 'zipData'> & { zipData: number[] })[]>((resolve, reject) => {
    const open = indexedDB.open('unipad');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(['unipacks', 'unipackMetadata', ...(db.objectStoreNames.contains('unipackChunks') ? ['unipackChunks'] : [])]);
      const archives = transaction.objectStore('unipacks').getAll();
      const metadata = transaction.objectStore('unipackMetadata').getAll();
      const chunks = db.objectStoreNames.contains('unipackChunks') ? transaction.objectStore('unipackChunks').getAll() : undefined;
      transaction.onabort = () => { db.close(); reject(transaction.error); };
      transaction.oncomplete = () => {
        db.close();
        resolve(metadata.result.map(record => ({
          ...record,
          zipData: (() => {
            const archive = archives.result.find(archive => archive.id === record.id);
            if (archive.zipData) return Array.from(new Uint8Array(archive.zipData));
            const bytes = new Uint8Array(archive.byteLength);
            for (const chunk of chunks?.result ?? []) {
              if (chunk.packId === record.id) bytes.set(new Uint8Array(chunk.data), chunk.index * 8 * 1024 * 1024);
            }
            return Array.from(bytes);
          })(),
        })));
      };
    };
  }));
}

/** The packs in browser storage. The import shows the pads before it saves the pack. */
export async function savedRecords(page: Page): Promise<SavedRecord[]> {
  return (await storedPackRecords(page)).map(({ id, storeCode, zipData }) => ({ id, storeCode, zipBytes: zipData.length }));
}

/** Waits for an import to reach browser storage before leaving or inspecting its records. */
export async function expectSavedPackCount(page: Page, count: number) {
  await expect.poll(async () => (await savedRecords(page)).length, { timeout: stateTimeout }).toBe(count);
}

/** Imports the fixture pack through the normal file input, waits until it is saved and opens `landing`. */
export async function importSavedPack(page: Page, landing = '/') {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expectPads(page);
  await expectSavedPackCount(page, 1);
  await page.goto(landing);
}

