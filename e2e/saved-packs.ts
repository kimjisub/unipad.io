import { resolve } from 'node:path';
import { type Page } from '@playwright/test';
import { expect } from './browser';

export interface SavedRecord { id: string; storeCode?: string; zipBytes: number }

/** The packs in browser storage. The import shows the pads before it saves the pack. */
export function savedRecords(page: Page): Promise<SavedRecord[]> {
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

/** Imports the fixture pack through the normal file input and waits until it is saved. */
export async function importSavedPack(page: Page) {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect.poll(async () => (await savedRecords(page)).length).toBe(1);
  await page.goto('/');
}

/** Presses and releases the fixture pack's first pad; its sound must start once and stop on release. */
export async function playFirstPad(page: Page) {
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  await page.locator('[data-pad="0,0"]').hover();
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
}
