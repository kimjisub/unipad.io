import { type Page } from '@playwright/test';
import { test, expect } from './browser';
import { connectStore } from './database';

const RECORD = 'firebase:previous_websocket_failure';

declare global {
  interface Window { recordAtStart: string | null }
}

// What the next visit's real SDK sees before it picks a way to connect.
async function noteRecordAtPageStart(page: Page) {
  await page.addInitScript(key => { window.recordAtStart = localStorage.getItem(key); }, RECORD);
}

const socketFailureRecord = (page: Page) => page.evaluate(key => localStorage.getItem(key), RECORD);

const expectStoreCount = (page: Page) => expect(page.getByRole('button', { name: /^Store/ })).toContainText('42', { timeout: 15000 });

test('a working socket closed by the page leaving does not slow the next visit', async ({ page, context }) => {
  await connectStore(context);
  await noteRecordAtPageStart(page);
  await page.goto('/play');
  await expectStoreCount(page);
  await expect.poll(() => socketFailureRecord(page), { timeout: 15000 }).toBeNull();

  // Stands for Firefox closing the socket between beforeunload and pagehide, which makes the SDK
  // reconnect and write the record. This listener runs after the app's, which is already in place.
  await page.evaluate(key => {
    window.addEventListener('beforeunload', () => localStorage.setItem(key, 'true'));
  }, RECORD);
  await page.reload();

  expect(await page.evaluate(() => window.recordAtStart)).toBeNull();
  await expectStoreCount(page);
});

test('a socket that hangs is remembered so the next visit starts on long polling', async ({ page, context }) => {
  await context.route('**/firebaseremoteconfig.googleapis.com/**', route => route.fulfill({ json: { entries: {}, state: 'NO_CHANGE' } }));
  // Connects and then never answers, so the SDK's own record is written and never cleared.
  await context.routeWebSocket(/firebaseio\.com|firebasedatabase\.app/, () => {});
  await noteRecordAtPageStart(page);
  await page.goto('/play');
  await expect.poll(() => socketFailureRecord(page), { timeout: 15000 }).toBe('true');

  const longPolls: string[] = [];
  page.on('request', request => { if (/firebaseio\.com\/\.lp\?/.test(request.url())) longPolls.push(request.url()); });
  await page.reload();

  expect(await page.evaluate(() => window.recordAtStart)).toBe('true');
  await expect.poll(() => longPolls.length, { timeout: 15000 }).toBeGreaterThan(0);
});
