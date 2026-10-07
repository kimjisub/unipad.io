import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { test as checkedTest, installBrowserProbe } from './browser';

async function seedSavedPack(page: Page) {
  await page.goto('/');
  const bytes = Array.from(await readFile('e2e/fixtures/basic.uni'));
  await page.evaluate(async (bytes) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('unipad', 1);
      request.onupgradeneeded = () => {
        const packs = request.result.createObjectStore('unipacks', { keyPath: 'id' });
        packs.createIndex('lastOpenedAt', 'lastOpenedAt');
        request.result.createObjectStore('themes', { keyPath: 'id' });
        request.result.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('unipacks', 'readwrite');
      tx.objectStore('unipacks').put({
        id: 'saved-browser-pack', title: 'Browser Test Pack', producerName: 'Browser Tests',
        buttonX: 8, buttonY: 8, chain: 1, zipData: new Uint8Array(bytes).buffer,
        addedAt: 1, lastOpenedAt: 1,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, bytes);
}

for (const cachedCount of [0, 17]) {
  test(`opens and plays a saved pack with Firebase blocked and cached count ${cachedCount}`, async ({ page, context, baseURL }, testInfo) => {
    await installBrowserProbe(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Block analytics initialization too; its SDK may report a fetch rejection.
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.route('**/*', route => new URL(route.request().url()).origin === baseURL
      ? route.continue() : route.abort('blockedbyclient'));
    await seedSavedPack(page);
    if (cachedCount) await page.evaluate(count => localStorage.setItem('store_count_cache_v1', String(count)), cachedCount);
    const openedAt = Date.now();
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    try {
      await expect(page.getByText('Browser Test Pack', { exact: true })).toBeVisible({ timeout: 5000 });
      await testInfo.attach('restore-time', { body: JSON.stringify({ elapsedMs: Date.now() - openedAt }), contentType: 'application/json' });
    } finally {
      await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
      await testInfo.attach('saved-list', { body: await page.screenshot({ path: testInfo.outputPath('saved-list.png') }), contentType: 'image/png' });
    }
    const store = page.getByRole('button', { name: /^Store/ });
    if (cachedCount) await expect(store).toContainText(String(cachedCount));
    else await expect(store).toHaveText('Store');
    await page.getByRole('option', { name: 'Browser Test Pack by Browser Tests', exact: true }).click();
    await page.getByRole('button', { name: 'Play Browser Test Pack', exact: true }).click();
    await expect(page.locator('[data-pad]')).toHaveCount(64);
    await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
    await page.locator('[data-pad="0,0"]').hover();
    await page.mouse.down();
    await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
    await testInfo.attach('saved-pack-playing', { body: await page.screenshot({ path: testInfo.outputPath('saved-pack-playing.png') }), contentType: 'image/png' });
    // Reject other runtime errors; retain the SDK's known blocked-fetch failures as evidence.
    expect(errors.filter(message => message !== 'Failed to fetch')).toEqual([]);
  });
}

checkedTest('updates the cached store badge when the realtime database connects', async ({ page, context }) => {
  await context.route('**/firebaseremoteconfig.googleapis.com/**', route => route.fulfill({ json: { entries: {}, state: 'NO_CHANGE' } }));
  let publishCount: ((count: number) => void) | undefined;
  await context.routeWebSocket(/firebaseio\.com|firebasedatabase\.app|unipad-ci\.invalid/, socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.t !== 'd') return;
      const { r, a, b } = message.d;
      if (a === 'q' && b.p === '/storeCount') {
        publishCount = count => socket.send(JSON.stringify({ t: 'd', d: { a: 'd', b: { p: '/storeCount', d: count } } }));
        publishCount(42);
      }
      socket.send(JSON.stringify({ t: 'd', d: { r, b: { s: 'ok', d: a === 'g' ? 42 : '' } } }));
    });
    socket.send(JSON.stringify({ t: 'c', d: { t: 'h', d: { ts: Date.now(), v: '5', h: new URL(socket.url()).hostname, s: 'browser-test-session' } } }));
  });
  await seedSavedPack(page);
  await page.evaluate(() => localStorage.setItem('store_count_cache_v1', '17'));
  await page.goto('/play');
  await expect(page.getByText('Browser Test Pack', { exact: true })).toBeVisible({ timeout: 5000 });
  const store = page.getByRole('button', { name: /^Store/ });
  await expect(store).toContainText('42', { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('store_count_cache_v1'))).toBe('42');
  publishCount!(43);
  await expect(store).toContainText('43');
});
