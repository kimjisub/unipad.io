import { test, expect } from './browser';
import { connectStore } from './database';
import { importSavedPack, playFirstPad } from './saved-packs';

for (const cachedCount of [0, 17]) {
  test(`opens and plays a saved pack with Firebase blocked and cached count ${cachedCount}`, async ({ page, context, baseURL }, testInfo) => {
    test.slow(); // Database connection, import, navigation and offline restore share this budget.
    const database = await connectStore(context);
    // Verify a working SDK before blocking it, so an invalid build cannot pass as offline.
    await page.goto('/play');
    await database.publish(42);
    await expect(page.getByRole('button', { name: /^Store/ })).toContainText('42');
    await importSavedPack(page);
    await page.evaluate(count => {
      localStorage.setItem('store_count_cache_v1', String(count));
    }, cachedCount);
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.route('**/*', route => new URL(route.request().url()).origin === baseURL
      ? route.continue() : route.abort('blockedbyclient'));
    const openedAt = Date.now();
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    try {
      await expect(page.getByRole('option', { name: 'Browser Test Pack by UniPad Tests', exact: true })).toBeVisible({ timeout: 5000 });
      await testInfo.attach('restore-time', { body: JSON.stringify({ elapsedMs: Date.now() - openedAt }), contentType: 'application/json' });
    } finally {
      await testInfo.attach('saved-list', { body: await page.screenshot({ path: testInfo.outputPath('saved-list.png') }), contentType: 'image/png' });
    }
    const store = page.getByRole('button', { name: /^Store/ });
    if (cachedCount) await expect(store).toContainText(String(cachedCount));
    else await expect(store).toHaveText('Store');
    await page.getByRole('option', { name: 'Browser Test Pack by UniPad Tests', exact: true }).press('Enter');
    await expect(page.locator('[data-pad]')).toHaveCount(64);
    await playFirstPad(page);
    await testInfo.attach('saved-pack-playing', { body: await page.screenshot({ path: testInfo.outputPath('saved-pack-playing.png') }), contentType: 'image/png' });
  });
}

test('updates the cached store badge when the realtime database connects', async ({ page, context }) => {
  const database = await connectStore(context);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('store_count_cache_v1', '17'));
  await page.goto('/play');
  await database.publish(42);
  const store = page.getByRole('button', { name: /^Store/ });
  await expect(store).toContainText('42');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('store_count_cache_v1'))).toBe('42');
  await database.publish(43);
  await expect(store).toContainText('43');
});

test('does not announce old items when the first live count arrives after visiting the store', async ({ page, context }, testInfo) => {
  const database = await connectStore(context, null);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('store_count_cache_v1', '17'));
  await page.goto('/play');
  const store = page.getByRole('button', { name: /^Store/ });
  const dot = store.locator('span.bg-emerald-400');
  await expect(store).toContainText('17');
  await store.click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dot).toHaveCount(0);
  await database.publish(20);
  await expect(store).toContainText('20');
  try {
    await expect(dot).toHaveCount(0);
  } finally {
    await testInfo.attach('first-live-count-after-store', { body: await page.screenshot({ path: testInfo.outputPath('first-live-count.png') }), contentType: 'image/png' });
  }
  // A later increase is genuinely new and must still notify the user.
  await database.publish(21);
  await expect(store).toContainText('21');
  await expect(dot).toHaveCount(1);
});
