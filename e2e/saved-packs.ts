import { readFileSync } from 'node:fs';
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
  await page.locator('input[data-unipack-import]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expectPads(page);
  await expectSavedPackCount(page, 1);
  await page.goto(landing);
}


/** Imports real files in one document, then quits to the saved list without restarting the player. */
export async function importSavedPacks(page: Page, files: string[]) {
  await page.goto('/play');
  const importedIds = new Set<string>();
  for (const [index, file] of files.entries()) {
    await page.locator('input[data-unipack-import]').setInputFiles(file);
    let records: SavedRecord[] = [];
    // The previous pack's 64 pads can remain while the next file's footer is read.
    // Require the newly saved pack's address and pads together within the existing state budget.
    await expect.poll(async () => {
      records = await savedRecords(page);
      const player = await page.evaluate(() => ({
        pack: new URL(location.href).searchParams.get('pack'),
        pads: document.querySelectorAll('[data-pad]').length,
      }));
      return {
        saved: records.length,
        current: records.some(record => record.id === player.pack && !importedIds.has(record.id)),
        pads: player.pads,
      };
    }, { timeout: stateTimeout }).toEqual({ saved: index + 1, current: true, pads: 64 });
    records.forEach(record => importedIds.add(record.id));
  }
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Quit', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(files.length);
}

/** Metadata of a saved pack as the list reads it; `seedSavedPacks` fills the rest from the basic fixture. */
export interface SeededPack { id: string; title: string; producerName: string; addedAt: number; bookmark?: boolean }

/**
 * Writes saved packs straight into the app's own database, each with the basic fixture as its
 * archive, so a list test skips importing and playing a pack. Waits for the app to create the
 * database first: opening it here before then would create an empty one at the wrong version.
 */
export async function seedSavedPacks(page: Page, packs: readonly SeededPack[]) {
  const archive = Array.from(readFileSync(resolve('e2e/fixtures/basic.uni')));
  await expect.poll(() => page.evaluate(({ archive, packs }) => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('unipad');
    open.onupgradeneeded = () => open.transaction!.abort();
    open.onerror = event => { event.preventDefault(); resolve(false); };
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('unipackChunks')) { db.close(); resolve(false); return; }
      const transaction = db.transaction(['unipacks', 'unipackMetadata', 'unipackChunks'], 'readwrite');
      const data = new Uint8Array(archive).buffer;
      for (const { id, title, producerName, addedAt, bookmark = false } of packs) {
        transaction.objectStore('unipacks').put({ id, format: 'chunks-v1', byteLength: data.byteLength, chunkCount: 1 });
        transaction.objectStore('unipackChunks').put({ packId: id, index: 0, data });
        transaction.objectStore('unipackMetadata').put({
          id, title, fileName: 'basic', producerName, buttonX: 8, buttonY: 8, chain: 1,
          keyLedExist: true, autoPlayExist: true, soundCount: 2, ledCount: 2, openCount: 0,
          bookmark, addedAt, lastOpenedAt: addedAt,
        });
      }
      transaction.oncomplete = () => { db.close(); resolve(true); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), { archive, packs }), { timeout: stateTimeout }).toBe(true);
}
