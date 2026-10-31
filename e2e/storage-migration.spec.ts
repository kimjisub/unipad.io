import ts from 'typescript';
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


/** Runs the production storage module against each browser's real IndexedDB. */
async function openStorageModule(page: Page) {
  const source = await readFile('src/lib/unipack/storage.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  await page.route('**/storage-module.mjs', route => route.fulfill({ contentType: 'text/javascript', body: outputText }));
  await page.route('**/storage-test', route => route.fulfill({ contentType: 'text/html', body: '<p>Archive storage test</p>' }));
  await page.goto('/storage-test');
}

test('large archives use bounded writes, reopen byte for byte and remove every chunk', async ({ page }) => {
  await openStorageModule(page);
  const result = await page.evaluate(async () => {
    const path = '/storage-module.mjs';
    const api = await import(path) as typeof import('../src/lib/unipack/storage');
    const put = IDBObjectStore.prototype.put;
    const sizes: number[] = [];
    let pending = 0;
    let maxPending = 0;
    IDBObjectStore.prototype.put = function (value, key) {
      const data = value.zipData ?? value.data;
      if (data instanceof ArrayBuffer) {
        sizes.push(data.byteLength);
        if (data.byteLength > 8 * 1024 * 1024) throw new DOMException('Single value is too large.', 'QuotaExceededError');
      }
      const request = put.call(this, value, key);
      if (data instanceof ArrayBuffer) {
        maxPending = Math.max(maxPending, ++pending);
        request.addEventListener('success', () => pending--, { once: true });
      }
      return request;
    };
    const bytes = new Uint8Array(16 * 1024 * 1024 + 7).fill(37);
    bytes[bytes.length - 1] = 91;
    const info = { title: 'Bounded archive', producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1 };
    const id = await api.saveUniPack(bytes.buffer, info);
    const pack = await api.getUniPack(id);
    const restored = pack && new Uint8Array(pack.zipData);
    const identical = restored && bytes.length === restored.length && bytes.every((byte, i) => restored[i] === byte);
    await api.deleteUniPack(id);
    const absent = await api.getUniPack(id) === undefined;
    const counts = await new Promise<number[]>((resolve, reject) => {
      const open = indexedDB.open('unipad');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(Array.from(db.objectStoreNames));
        const requests = ['unipacks', 'unipackMetadata', 'unipackChunks'].map(name => tx.objectStore(name).count());
        tx.oncomplete = () => { db.close(); resolve(requests.map(r => r.result)); };
        tx.onabort = () => reject(tx.error);
      };
    });
    return { identical, absent, sizes, counts, maxPending };
  });
  expect(result).toEqual({ identical: true, absent: true, sizes: [8388608, 8388608, 7], counts: [0, 0, 0], maxPending: 1 });
});

for (const saving of ['import', 'store'] as const) {
  for (const failure of ['quota', 'abort', 'exception'] as const) {
    test(`${saving} keeps the previous archive when the second chunk fails with ${failure}`, async ({ page }) => {
      await openStorageModule(page);
      const result = await page.evaluate(async ({ saving, failure }) => {
        const path = '/storage-module.mjs';
        const api = await import(path) as typeof import('../src/lib/unipack/storage');
        const info = { title: 'Existing archive', producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1, storeCode: 'test-store' };
        const oldId = await api.saveStoreUniPack(new Uint8Array([1, 2, 3]).buffer, info);
        await api.toggleUniPackBookmark(oldId);
        const previous = await api.getUniPack(oldId);
        const put = IDBObjectStore.prototype.put;
        let chunks = 0;
        IDBObjectStore.prototype.put = function (value, key) {
          if (this.name === 'unipackChunks' && chunks === 1) {
            chunks++;
            if (failure !== 'abort') throw new DOMException('Injected storage failure.', failure === 'quota' ? 'QuotaExceededError' : 'DataCloneError');
            const request = put.call(this, value, key);
            request.addEventListener('success', () => this.transaction.abort(), { once: true });
            return request;
          }
          const request = put.call(this, value, key);
          if (this.name === 'unipackChunks') chunks++;
          return request;
        };
        let error = '';
        try {
          const bytes = new Uint8Array(16 * 1024 * 1024 + 7).buffer;
          if (saving === 'store') await api.saveStoreUniPack(bytes, info);
          else await api.saveUniPack(bytes, info);
        } catch (cause) { error = (cause as Error).name; }
        const after = await api.getUniPack(oldId);
        const records = await api.listUniPacks();
        const sameBytes = after && Array.from(new Uint8Array(after.zipData));
        return { error, chunks, sameBytes, unchanged: JSON.stringify(previous) === JSON.stringify(after), ids: records.map(r => r.id), oldId };
      }, { saving, failure });
      expect(result.error).toBe(failure === 'quota' ? 'QuotaExceededError' : failure === 'exception' ? 'DataCloneError' : 'AbortError');
      expect(result.chunks).toBe(2);
      expect(result.sameBytes).toEqual([1, 2, 3]);
      expect(result.unchanged).toBe(true);
      expect(result.ids).toEqual([result.oldId]);
    });
  }
}

for (const damage of ['missing', 'short'] as const) {
  test(`an archive with a ${damage} chunk rejects the read`, async ({ page }) => {
    await openStorageModule(page);
    const result = await page.evaluate(async damage => {
      const path = '/storage-module.mjs';
      const api = await import(path) as typeof import('../src/lib/unipack/storage');
      const id = await api.saveUniPack(new Uint8Array(8 * 1024 * 1024 + 7).buffer,
        { title: 'Incomplete archive', producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1 });
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('unipad');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('unipackChunks', 'readwrite');
          const store = tx.objectStore('unipackChunks');
          if (damage === 'missing') store.delete([id, 1]);
          else store.put({ packId: id, index: 1, data: new Uint8Array(6).buffer });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onabort = () => reject(tx.error);
        };
      });
      try { await api.getUniPack(id); return 'unexpected success'; }
      catch (error) { return (error as Error).message; }
    }, damage);
    expect(result).toBe('Missing or incomplete archive chunk.');
  });
}

test('store replacement commits the new bytes and removes the earlier chunks', async ({ page }) => {
  await openStorageModule(page);
  const result = await page.evaluate(async () => {
    const path = '/storage-module.mjs';
    const api = await import(path) as typeof import('../src/lib/unipack/storage');
    const info = { title: 'Store archive', producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1, storeCode: 'test-store' };
    const oldId = await api.saveStoreUniPack(new Uint8Array(8 * 1024 * 1024 + 7).buffer, info);
    const id = await api.saveStoreUniPack(new Uint8Array([4, 5, 6, 7]).buffer, info);
    const current = await api.getUniPack(id);
    const old = await api.getUniPack(oldId);
    const chunks = await new Promise<{ packId: string }[]>((resolve, reject) => {
      const open = indexedDB.open('unipad');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('unipackChunks');
        const all = tx.objectStore('unipackChunks').getAll();
        tx.oncomplete = () => { db.close(); resolve(all.result); };
        tx.onabort = () => reject(tx.error);
      };
    });
    return { bytes: current && Array.from(new Uint8Array(current.zipData)), oldAbsent: old === undefined,
      ids: (await api.listUniPacks()).map(pack => pack.id), chunkIds: chunks.map(chunk => chunk.packId), id };
  });
  expect(result.bytes).toEqual([4, 5, 6, 7]);
  expect(result.oldAbsent).toBe(true);
  expect(result.ids).toEqual([result.id]);
  expect(result.chunkIds).toEqual([result.id]);
});

for (const saving of ['import', 'store'] as const) {
  test(`${saving} reclaims old chunks when the archive id is reused`, async ({ page }) => {
    await openStorageModule(page);
    const result = await page.evaluate(async saving => {
      const path = '/storage-module.mjs';
      const api = await import(path) as typeof import('../src/lib/unipack/storage');
      Date.now = () => 123;
      const info = { title: 'Same archive id', producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1, storeCode: 'same-store' };
      const save = saving === 'store' ? api.saveStoreUniPack : api.saveUniPack;
      const oldId = await save(new Uint8Array(16 * 1024 * 1024 + 7).buffer, info);
      const id = await save(new Uint8Array([1, 2, 3]).buffer, info);
      const record = await api.getUniPack(id);
      const count = await new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('unipad');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('unipackChunks');
          const count = tx.objectStore('unipackChunks').count();
          tx.oncomplete = () => { db.close(); resolve(count.result); };
          tx.onabort = () => reject(tx.error);
        };
      });
      return { sameId: id === oldId, bytes: record && Array.from(new Uint8Array(record.zipData)), count };
    }, saving);
    expect(result).toEqual({ sameId: true, bytes: [1, 2, 3], count: 1 });
  });
}
