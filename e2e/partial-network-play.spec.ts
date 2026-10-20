import { type Page, type Request, type Route, type TestInfo } from '@playwright/test';
import { test, expect, expectPads } from './browser';
import { connectStore } from './database';
import { importSavedPack } from './saved-packs';
import { playFirstPad } from './basic-pack';

// The saved list, opening a saved pack and quitting back to the list read only browser storage.
// Each case blocks external services or holds their replies, and walks that path.

const PACK_NAME = 'Browser Test Pack by UniPad Tests';
const DATABASE_HOST = /firebaseio\.com|firebasedatabase\.app/;
const ANALYTICS_HOST = /(^|\.)(googletagmanager|google-analytics)\.com$/;

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ path: testInfo.outputPath(`${name}.png`) }), contentType: 'image/png' });
}

/** Destroys the import/home document before installing network observers for the reopened list. */
async function prepareSavedPack(page: Page) {
  await importSavedPack(page);
  await page.goto('about:blank');
  expect(page.url(), 'network observation starts after the previous document is gone').toBe('about:blank');
}

/** Opens the saved list, plays the saved pack's first pad, then quits from the menu back to the list. */
async function playSavedPackAndQuit(page: Page, testInfo: TestInfo) {
  const saved = page.getByRole('option', { name: PACK_NAME, exact: true });
  await page.goto('/play', { waitUntil: 'domcontentloaded' });
  try {
    await expect(saved).toBeVisible({ timeout: 5000 });
  } finally {
    await capture(page, testInfo, '1-saved-list');
  }
  await saved.press('Enter');
  await expectPads(page);
  await capture(page, testInfo, '2-pack-opened');
  await playFirstPad(page);
  await testInfo.attach('audio-calls', {
    body: JSON.stringify(await page.evaluate(() => {
      const { decoded, starts, stops } = window.browserProbe.audio;
      return { decoded, starts, stops };
    }), null, 2),
    contentType: 'application/json',
  });
  await capture(page, testInfo, '3-first-pad-played');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Quit', exact: true }).click();
  await expectPads(page, 0);
  await expect(saved).toBeVisible();
  await capture(page, testInfo, '4-back-to-saved-list');
}

/**
 * The database requests the page makes. After a socket fails the SDK reconnects over HTTP long
 * polling on the next page load, so both ways of reaching it are recorded.
 */
function watchDatabase(page: Page) {
  const contacts: string[] = [];
  page.on('request', request => { if (DATABASE_HOST.test(request.url())) contacts.push(request.url()); });
  page.on('websocket', socket => { if (DATABASE_HOST.test(socket.url())) contacts.push(socket.url()); });
  return contacts;
}

test('plays a saved pack and quits to the list when only the store database fails', async ({ page }, testInfo) => {
  await prepareSavedPack(page);
  const database = watchDatabase(page);
  await playSavedPackAndQuit(page, testInfo);
  // The build has a database to reach, so the store really failed rather than never being tried.
  await expect.poll(() => database.length).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /^Store/ })).toHaveText('Store');
  await testInfo.attach('database-requests', { body: JSON.stringify(database, null, 2), contentType: 'application/json' });
});

test('plays a saved pack and quits to the list when only analytics fails', async ({ page, context }, testInfo) => {
  const database = await connectStore(context);
  await page.goto('/play');
  await database.publish(42);
  const store = page.getByRole('button', { name: /^Store/ });
  await expect(store).toContainText('42');
  await prepareSavedPack(page);

  const observed = new Set<Request>();
  const failed: string[] = [];
  const delivered: string[] = [];
  page.on('request', request => {
    if (ANALYTICS_HOST.test(new URL(request.url()).hostname)) observed.add(request);
  });
  // Ignore late completion events for requests started by an earlier document.
  page.on('requestfailed', request => {
    if (observed.has(request)) failed.push(request.url());
  });
  page.on('requestfinished', request => {
    if (observed.has(request)) delivered.push(request.url());
  });
  // The shared fixture already aborts both analytics hosts.

  await playSavedPackAndQuit(page, testInfo);
  // The database still answers on the reopened page.
  await database.publish(43);
  await expect(store).toContainText('43');
  await expect.poll(() => failed.some(url => new URL(url).hostname === 'www.googletagmanager.com')).toBe(true);
  expect(delivered).toEqual([]);
  await testInfo.attach('failed-analytics-requests', { body: JSON.stringify(failed, null, 2), contentType: 'application/json' });
});

test('plays a saved pack and quits to the list when external service responses stall', async ({ page, context, baseURL }, testInfo) => {
  test.slow(); // Import, playback and stalled-service observation share this budget.
  await prepareSavedPack(page);

  const held: Route[] = [];
  // The shared setup's fake installation token lets the SDK go on to its configuration requests,
  // which are then held; every other external request is held from the start.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL || url.hostname === 'firebaseinstallations.googleapis.com') return route.fallback();
    held.push(route);
  });
  // Accepted and left silent: no handshake ever arrives.
  await context.routeWebSocket(/.*/, () => {});
  const database = watchDatabase(page);

  await playSavedPackAndQuit(page, testInfo);
  const heldUrls = () => held.map(route => route.request().url());
  // The configuration request is still unanswered after every step above.
  await expect.poll(() => heldUrls().some(url => new URL(url).hostname === 'firebaseremoteconfig.googleapis.com')).toBe(true);
  // Store subscription waits for Remote Config initialization, so its transport need not have
  // started while configuration is held. Keep any database contacts as diagnostics only.
  await expect(page.getByRole('button', { name: /^Store/ })).toHaveText('Store');
  await testInfo.attach('held-requests', { body: JSON.stringify(heldUrls(), null, 2), contentType: 'application/json' });
  await testInfo.attach('database-requests', { body: JSON.stringify(database, null, 2), contentType: 'application/json' });
});
