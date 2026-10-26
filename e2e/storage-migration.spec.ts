import { readFile } from 'node:fs/promises';
import { test, expect, expectPads } from './browser';
import type { Page } from '@playwright/test';
import { storedPackRecords } from './saved-packs';

async function seedLegacyPacks(page: Page) {
  const bytes = Array.from(await readFile('e2e/fixtures/basic.uni'));
  await page.route('**/storage-seed', route => route.fulfill({ contentType: 'text/html', body: '<p>Storage fixture</p>' }));
  await page.goto('/storage-seed');
  await page.evaluate(bytes => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('unipad', 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      const packs = db.createObjectStore('unipacks', { keyPath: 'id' });
      packs.createIndex('lastOpenedAt', 'lastOpenedAt');
      for (const [id, title, lastOpenedAt] of [['legacy-a', 'Legacy A', 20], ['legacy-b', 'Legacy B', 10]] as const) {
        packs.put({ id, title, producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1, zipData: new Uint8Array(bytes).buffer,
          addedAt: 1, lastOpenedAt, openCount: 3, bookmark: true,
          autoPlay: { current: [{ type: 'delay', delay: 100 }], backup: [{ type: 'delay', delay: 200 }] } });
      }
      db.createObjectStore('themes', { keyPath: 'id' }).put({ id: 'theme', name: 'Existing theme', author: 'Tests', zipData: new Uint8Array([4, 5]).buffer, addedAt: 1 });
      db.createObjectStore('settings', { keyPath: 'key' }).put({ key: 'existing-setting', value: 'keep' });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { open.result.close(); resolve(); };
  }), bytes);
  return bytes;
}

for (const failure of ['none', 'quota', 'abort'] as const) {
  test(`legacy pack metadata upgrade preserves archives after ${failure}`, async ({ page }, info) => {
    const bytes = await seedLegacyPacks(page);
    if (failure !== 'none') {
      await page.addInitScript(failure => {
        // Keep every concurrent upgrade failing until a reload removes the injected fault.
        if (sessionStorage.getItem('upgrade-failed')) return;
        const put = IDBObjectStore.prototype.put;
        const writes = new WeakMap<IDBTransaction, number>();
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name !== 'unipackMetadata') return put.apply(this, args);
          const count = (writes.get(this.transaction) ?? 0) + 1;
          writes.set(this.transaction, count);
          if (count !== 2) return put.apply(this, args);
          sessionStorage.setItem('upgrade-failed', failure);
          document.documentElement.dataset.interruptedUpgrade = failure;
          if (failure === 'quota') throw new DOMException('Storage is full.', 'QuotaExceededError');
          const request = put.apply(this, args);
          request.addEventListener('success', () => this.transaction.abort(), { once: true });
          return request;
        };
      }, failure);
    }
    await page.goto('/play');
    if (failure !== 'none') {
      await expect(page.locator('html')).toHaveAttribute('data-interrupted-upgrade', failure);
      const preserved = await page.evaluate(() => new Promise<{ version: number; stores: string[]; packs: { id: string; bytes: number[]; openCount: number }[] }>((resolve, reject) => {
        // Reading without requesting a newer version must still find the original database.
        const open = indexedDB.open('unipad');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('unipacks').objectStore('unipacks').getAll();
          read.onsuccess = () => {
            resolve({ version: db.version, stores: Array.from(db.objectStoreNames), packs: read.result.map(record => ({ id: record.id, bytes: Array.from(new Uint8Array(record.zipData)), openCount: record.openCount })) });
            db.close();
          };
          read.onerror = () => reject(read.error);
        };
      }));
      await info.attach('rolled-back-upgrade', { body: JSON.stringify(preserved), contentType: 'application/json' });
      expect(preserved.version).toBe(1);
      expect(preserved.stores).not.toContain('unipackMetadata');
      expect(preserved.packs).toEqual(['legacy-a', 'legacy-b'].map(id => ({ id, bytes, openCount: 3 })));
      await page.reload();
    }
    await expect(page.getByRole('option', { name: 'Legacy A by Tests', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Legacy B by Tests', exact: true })).toBeVisible();
    const records = await storedPackRecords(page);
    for (const record of records) {
      expect(record.zipData).toEqual(bytes);
      expect(record).toMatchObject({ bookmark: true, openCount: 3, autoPlay: { current: [{ type: 'delay', delay: 100 }], backup: [{ type: 'delay', delay: 200 }] } });
    }
    const untouched = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open('unipad');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['themes', 'settings']);
        const theme = tx.objectStore('themes').get('theme');
        const setting = tx.objectStore('settings').get('existing-setting');
        tx.oncomplete = () => { db.close(); resolve({ theme: { ...theme.result, zipData: Array.from(new Uint8Array(theme.result.zipData)) }, setting: setting.result }); };
      };
    }));
    expect(untouched).toEqual({ theme: { id: 'theme', name: 'Existing theme', author: 'Tests', zipData: [4, 5], addedAt: 1 }, setting: { key: 'existing-setting', value: 'keep' } });
    await page.getByRole('option', { name: 'Legacy A by Tests', exact: true }).press('Enter');
    await expectPads(page);
    await expect.poll(async () => (await storedPackRecords(page)).find(pack => pack.id === 'legacy-a')?.openCount).toBe(4);
    await info.attach('legacy-pack-opened', { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('listing and bookmarking saved packs never access archive records', async ({ page }, info) => {
  await seedLegacyPacks(page);
  await page.addInitScript(() => {
    const objectStore = IDBTransaction.prototype.objectStore;
    IDBTransaction.prototype.objectStore = function (name) {
      if (name === 'unipacks' && this.mode !== 'versionchange') {
        document.documentElement.dataset.unexpectedArchiveAccess = 'true';
        throw new Error('Listing or bookmarking must not access an archive.');
      }
      return objectStore.call(this, name);
    };
  });
  await page.goto('/play');
  await page.getByRole('option', { name: 'Legacy A by Tests', exact: true }).click();
  await page.getByRole('button', { name: 'Remove bookmark', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove bookmark', exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-unexpected-archive-access');
  await info.attach('metadata-only-list', { body: await page.screenshot(), contentType: 'image/png' });
});
