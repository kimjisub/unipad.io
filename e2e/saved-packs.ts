import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type JSHandle, type Page } from '@playwright/test';
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


/** Runs against an initialized schema without ever creating an empty database. */
async function withExistingPackDatabase<T>(page: Page, stores: string[], action: (database: JSHandle<IDBDatabase | null>) => Promise<T>): Promise<T> {
  const database = await page.evaluateHandle(stores => new Promise<IDBDatabase | null>(resolve => {
    const open = indexedDB.open('unipad');
    open.onupgradeneeded = () => open.transaction!.abort();
    open.onerror = event => { event.preventDefault(); resolve(null); };
    open.onsuccess = () => {
      const db = open.result;
      if (stores.some(store => !db.objectStoreNames.contains(store))) { db.close(); resolve(null); return; }
      resolve(db);
    };
  }), stores);
  try {
    return await action(database);
  } finally {
    await database.evaluate(db => db?.close());
    await database.dispose();
  }
}

export type PackFile = string | { name: string; mimeType: string; buffer: Buffer };
interface ImportOptions {
  afterInput?: () => Promise<void>;
  beforeSavedUrl?: () => Promise<void>;
}

/** Imports an 8x8 fixture and returns to the list after its save completes. */
export async function importSavedPackAndQuit(page: Page, file: PackFile, count: number, options: ImportOptions = {}) {
  await page.locator('input[data-unipack-import]').first().setInputFiles(typeof file === 'string' ? resolve(file) : file);
  await options.afterInput?.();
  // Preserve separate state budgets for decoding/rendering and persistence.
  await expectPads(page);
  // Finish controlled-delay setup before starting the saved URL assertion's clock.
  await options.beforeSavedUrl?.();
  await expect.poll(() => withExistingPackDatabase(page, ['unipackMetadata'], database => database.evaluate(db => {
    if (!db) return { saved: 0, current: false };
    return new Promise<{ saved: number; current: boolean }>((resolve, reject) => {
      const transaction = db.transaction('unipackMetadata');
      // The saved count and address need keys, not copies of every archive and sound.
      const keys = transaction.objectStore('unipackMetadata').getAllKeys();
      transaction.oncomplete = () => {
        const pack = new URL(location.href).searchParams.get('pack');
        resolve({ saved: keys.result.length, current: pack !== null && keys.result.includes(pack) });
      };
      transaction.onabort = () => reject(transaction.error);
    });
  })), { timeout: stateTimeout }).toEqual({ saved: count, current: true });
  // Setup needs the buttons' actions, not pointer hit testing during their animations.
  await page.getByRole('button', { name: 'Open menu', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Quit', exact: true }).dispatchEvent('click');
  await expect(page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option')).toHaveCount(count);
}

/** Imports distinct 8x8 fixtures into an empty library, keeping one document alive. */
export async function importSavedPacks(page: Page, files: readonly PackFile[], options: ImportOptions = {}) {
  await page.goto('/play');
  for (const [index, file] of files.entries()) {
    // Returning to the list removes old pads before the next readiness check.
    await importSavedPackAndQuit(page, file, index + 1, options);
  }
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
  await expect.poll(() => withExistingPackDatabase(page, ['unipacks', 'unipackMetadata', 'unipackChunks'], database => database.evaluate((db, { archive, packs }) => {
    if (!db) return false;
    return new Promise<boolean>((resolve, reject) => {
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
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = () => reject(transaction.error);
    });
  }, { archive, packs })), { timeout: stateTimeout }).toBe(true);
}
