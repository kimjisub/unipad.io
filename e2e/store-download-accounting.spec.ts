import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, expectPads } from './browser';
import { connectStore, startEachPageOnSocket } from './database';
import { expectSavedPackCount } from './saved-packs';

const FN = 'http://127.0.0.1:5051/demo-unipad/us-central1/';
const DB = 'http://127.0.0.1:9051';
const KEY = 'unipad:download-reports:v1';
const CODE = 'browser-test';
const URL = 'https://unipack.unipad.io/store/browser-test.zip';
const store = { [CODE]: { code: CODE, title: 'Browser Test Pack', producerName: 'UniPad Tests', downloadCount: 1, URL } };
const realServer = process.env.ACCOUNTING_EMULATOR_TEST === '1';

async function db(path: string, value?: unknown) {
  const response = await fetch(`${DB}/${path}.json?ns=demo-unipad`, value === undefined ? {} : {
    method: 'PUT', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

async function archiveCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('unipad');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('unipacks');
      const count = transaction.objectStore('unipacks').count();
      transaction.oncomplete = () => { database.close(); resolve(count.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

async function setup(page: Page, options: { issue?: 'disabled' | 'fail'; loseReply?: boolean; failure?: 'network' | 'zip' | 'storage' | 'refresh'; staleUrl?: boolean } = {}) {
  await startEachPageOnSocket(page.context());
  const listing = { ...store, [CODE]: { ...store[CODE], URL: options.staleUrl ? '' : URL } };
  const database = await connectStore(page.context(), 1, listing);
  const calls: { url: string; body: Record<string, string>; saved: number }[] = [];
  const forbidden: string[] = [];
  const metadataReads: string[] = [];
  const replies: string[] = [];
  let serial = 0, count = 1, lost = false;
  const counted = new Set<string>();
  if (realServer) {
    await db('store', store);
    await db('downloadAccounting', { config: { enabled: true } });
  }
  page.context().on('request', request => {
    if (/cloudfunctions\.net\/(issueDownloadReceipt|completeDownload|increaseDownloadCount|downloadUniPackLegacy)/.test(request.url())) forbidden.push(request.url());
  });
  await page.context().route(FN + '**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type',
    } });
    const action = route.request().url().slice(FN.length);
    calls.push({ url: action, body: route.request().postDataJSON(), saved: await archiveCount(route.request().frame().page()) });
    if (action === 'issueDownloadReceipt' && options.issue === 'fail') return route.abort('failed');
    let answer: { status: string; receipt?: string; expiresAt?: number };
    if (action === 'issueDownloadReceipt' && options.issue === 'disabled') answer = { status: 'disabled' };
    else if (realServer) {
      const response = await route.fetch();
      answer = await response.json();
    } else if (action === 'issueDownloadReceipt') {
      answer = { status: 'issued', receipt: `000000000001.${(++serial).toString(16).padStart(64, '0')}`, expiresAt: Date.now() + 7 * 86400000 };
    } else {
      const receipt = route.request().postDataJSON().receipt;
      answer = { status: counted.has(receipt) ? 'already_counted' : 'counted' };
      if (!counted.has(receipt)) { count++; counted.add(receipt); }
    }
    replies.push(answer.status);
    if (action === 'completeDownload' && options.loseReply && !lost) { lost = true; return route.abort('failed'); }
    return route.fulfill({ json: answer, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.context().route('**/store.json', route => {
    metadataReads.push(route.request().url());
    return route.fulfill({ json: listing, headers: { 'access-control-allow-origin': '*' } });
  });
  const pack = await readFile(resolve('e2e/fixtures/basic.uni'));
  await page.route(URL, route => options.failure === 'network' ? route.abort('failed') : route.fulfill({
    body: options.failure === 'zip' ? Buffer.from('invalid archive') : pack,
    headers: { 'content-type': 'application/zip', 'access-control-allow-origin': '*' },
  }));
  if (options.failure === 'storage' || options.failure === 'refresh') await page.addInitScript(failure => {
    const put = IDBObjectStore.prototype.put;
    let saved = false;
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args: Parameters<typeof getAll>) {
      if (failure === 'refresh' && saved && this.name === 'unipackMetadata') throw new DOMException('List unavailable', 'UnknownError');
      return Reflect.apply(getAll, this, args);
    };
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'unipacks') {
        if (failure === 'storage') throw new DOMException('Storage full', 'QuotaExceededError');
        this.transaction.addEventListener('complete', () => { saved = true; }, { once: true });
      }
      return Reflect.apply(put, this, args);
    };
  }, options.failure);
  const open = async () => {
    await page.goto('/play'); await database.publish(1);
    await page.getByRole('button', { name: /^Store/ }).first().click();
  };
  await open();
  const row = page.locator(`[data-store-code="${CODE}"]`);
  await expect(row.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  listing[CODE].URL = URL;
  return { calls, forbidden, replies, metadataReads, row, open, count: async () => realServer ? db(`store/${CODE}/downloadCount`) : count };
}

const queue = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), KEY);

test('saving a store pack reports once after commit, preserves the displayed count, and playing does not report again', async ({ page }, info) => {
  const f = await setup(page);
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('Downloaded: Browser Test Pack')).toBeVisible();
  await expect.poll(() => f.calls.filter(c => c.url === 'completeDownload').length).toBe(1);
  expect(f.calls.map(c => c.url)).toEqual(['issueDownloadReceipt', 'completeDownload']);
  expect(f.calls[1].saved).toBe(1);
  expect(f.calls[0].body).toEqual({ code: CODE });
  expect(Object.keys(f.calls[1].body).sort()).toEqual(['code', 'receipt']);
  await expectSavedPackCount(page, 1);
  await expect.poll(f.count).toBe(2);
  await expect.poll(() => queue(page)).toEqual([]);
  await info.attach('downloaded', { body: await page.screenshot(), contentType: 'image/png' });
  await f.row.getByRole('button', { name: 'Play', exact: true }).click(); await expectPads(page);
  expect(f.calls).toHaveLength(2); expect(f.forbidden).toEqual([]);
  await info.attach('requests', { body: JSON.stringify({ calls: f.calls, replies: f.replies, forbidden: f.forbidden }), contentType: 'application/json' });
});

for (const failure of ['network', 'zip', 'storage'] as const) {
  test(`${failure} failure sends no completion and leaves no pending report`, async ({ page }, info) => {
    const f = await setup(page, { failure });
    await f.row.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(f.row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect.poll(() => f.calls.length).toBe(1);
    expect(f.calls[0].url).toBe('issueDownloadReceipt');
    expect(await queue(page)).toEqual([]); expect(await f.count()).toBe(1); expect(f.forbidden).toEqual([]);
    await info.attach('requests', { body: JSON.stringify(f.calls), contentType: 'application/json' });
  });
}

for (const issue of ['disabled', 'fail'] as const) {
  test(`receipt issuance ${issue} does not block saving or playing`, async ({ page }) => {
    const f = await setup(page, { issue });
    await f.row.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByText('Downloaded: Browser Test Pack')).toBeVisible();
    await expectSavedPackCount(page, 1);
    expect(await queue(page)).toEqual([]); expect(await f.count()).toBe(1);
    await f.row.getByRole('button', { name: 'Play', exact: true }).click(); await expectPads(page);
    expect(f.calls.map(c => c.url)).toEqual(['issueDownloadReceipt']); expect(f.forbidden).toEqual([]);
  });
}

test('failed list refresh does not cancel an already saved pack completion', async ({ page }) => {
  const f = await setup(page, { failure: 'refresh' });
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('Downloaded: Browser Test Pack')).toBeVisible();
  await expect.poll(f.count).toBe(2);
  expect(f.calls.find(c => c.url === 'completeDownload')?.saved).toBe(1);
  expect(f.forbidden).toEqual([]);
});

test('lost completion response persists through closing the tab and retries the same receipt once after a minute', async ({ page, context }, info) => {
  const f = await setup(page, { loseReply: true });
  await page.clock.install();
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('Downloaded: Browser Test Pack')).toBeVisible();
  await expect.poll(async () => (await queue(page))[0]?.attempts.length).toBe(1);
  await expect.poll(f.count).toBe(2);
  const pending = await queue(page);
  // Same origin and persistent browser storage, with a new page instance.
  const reopened = await context.newPage();
  await reopened.clock.install({ time: new Date(pending[0].attempts[0] + 60000) });
  await page.close();
  await reopened.goto('/play');
  await expect.poll(() => f.calls.filter(c => c.url === 'completeDownload').length).toBe(2);
  await expect.poll(() => queue(reopened)).toEqual([]);
  const completions = f.calls.filter(c => c.url === 'completeDownload');
  expect(completions[1].body).toEqual(completions[0].body);
  expect(await f.count()).toBe(2); expect(f.replies).toContain('already_counted'); expect(f.forbidden).toEqual([]);
  await info.attach('retry-record', { body: JSON.stringify({ pending, calls: f.calls, replies: f.replies }), contentType: 'application/json' });
});

test('opening a shared link and importing an external file do not request a receipt', async ({ page }) => {
  const f = await setup(page);
  await page.goto(`/play?code=${CODE}`);
  await expect(page.getByRole('alertdialog', { name: 'Confirm install' })).toBeVisible();
  expect(f.calls).toEqual([]);
  await page.goto('/play');
  await page.locator('input[data-unipack-import]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expectPads(page); await expectSavedPackCount(page, 1);
  expect(f.calls).toEqual([]); expect(f.forbidden).toEqual([]);
});

test('canceling a download does not send a completion', async ({ page }) => {
  const f = await setup(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(URL, async route => { await held; await route.abort('failed').catch(() => {}); });
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); release();
  await expect(f.row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(f.calls.map(c => c.url)).toEqual(['issueDownloadReceipt']);
  expect(await queue(page)).toEqual([]); expect(await f.count()).toBe(1); expect(f.forbidden).toEqual([]);
});


test('an old cached item without a file URL refreshes metadata and never uses the legacy counting redirect', async ({ page }) => {
  const f = await setup(page, { staleUrl: true });
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('Downloaded: Browser Test Pack')).toBeVisible();
  await expect.poll(f.count).toBe(2);
  expect(f.metadataReads).toHaveLength(1);
  expect(f.forbidden).toEqual([]);
});


test('a separate new download gets a fresh receipt and adds one more after save', async ({ page }) => {
  const f = await setup(page);
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(f.count).toBe(2);
  await page.getByRole('dialog', { name: 'Store', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  const saved = page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option').first();
  await saved.click(); await saved.focus(); await page.keyboard.press('Delete');
  await page.getByRole('alertdialog', { name: 'Confirm deletion', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expectSavedPackCount(page, 0);
  await page.getByRole('button', { name: /^Store/ }).first().click();
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(f.count).toBe(3);
  const completed = f.calls.filter(c => c.url === 'completeDownload');
  expect(completed).toHaveLength(2);
  expect(completed[0].body.receipt).not.toBe(completed[1].body.receipt);
  expect(f.forbidden).toEqual([]);
});

test('phone-width store information stays unchanged while a saved pack is counted', async ({ page }, info) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const f = await setup(page);
  await expect(f.row.getByText('1 downloads', { exact: true })).toBeVisible();
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('Downloaded: Browser Test Pack')).toBeVisible();
  await expect.poll(f.count).toBe(2);
  await expect(f.row.getByText('1 downloads', { exact: true })).toBeVisible();
  expect(f.forbidden).toEqual([]);
  await info.attach('phone-store', { body: await page.screenshot(), contentType: 'image/png' });
});


test('canceling the metadata refresh leaves no completion report', async ({ page }) => {
  const f = await setup(page, { staleUrl: true });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.context().route('**/store.json', async route => { await held; await route.abort('failed').catch(() => {}); });
  const asked = page.waitForRequest(request => new globalThis.URL(request.url()).pathname === '/store.json');
  await f.row.getByRole('button', { name: 'Download', exact: true }).click();
  await asked;
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); release();
  await expect(f.row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(f.calls.map(c => c.url)).toEqual(['issueDownloadReceipt']);
  expect(await queue(page)).toEqual([]); expect(await f.count()).toBe(1); expect(f.forbidden).toEqual([]);
});
