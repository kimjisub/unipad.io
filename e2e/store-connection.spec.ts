import { readFileSync } from 'node:fs';
import { type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from './browser';

const storeItem = {
  code: 'browser-pack', title: 'Browser Test Pack', producerName: 'UniPad Tests',
  isAutoPlay: true, isLED: true, downloadCount: 42,
};

// Keep the real Firebase SDK; only the network peer is local.
// A stalled peer keeps its handshake but drops database replies. This lets the
// retry test restore that same connection without faking the SDK's HTTP fallback.
async function connectStore(context: BrowserContext) {
  let connected = true;
  await context.route('**/firebaseremoteconfig.googleapis.com/**', route => route.fulfill({ json: { entries: {}, state: 'NO_CHANGE' } }));
  await context.routeWebSocket(/firebaseio\.com|firebasedatabase\.app/, socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.t !== 'd' || !connected) return;
      const { r, a, b } = message.d;
      const data = b.p === '/storeCount' ? 42 : { 'browser-pack': storeItem };
      if (a === 'q') socket.send(JSON.stringify({ t: 'd', d: { a: 'd', b: { p: b.p, d: data } } }));
      socket.send(JSON.stringify({ t: 'd', d: { r, b: { s: 'ok', d: a === 'g' ? data : '' } } }));
    });
    socket.send(JSON.stringify({ t: 'c', d: { t: 'h', d: { ts: Date.now(), v: '5', h: new URL(socket.url()).hostname, s: 'store-test-session' } } }));
  });
  return { block() { connected = false; }, reconnect() { connected = true; } };
}

async function verifyDatabase(page: Page) {
  await page.goto('/play');
  await expect(page.getByRole('button', { name: /^Store/ })).toContainText('42', {
    timeout: 15000,
  });
}

for (const cached of [false, true]) {
  test(`ends blocked store loading and retries after reconnecting (cached: ${cached})`, async ({ page, context }, testInfo) => {
    const database = await connectStore(context);
    await verifyDatabase(page);
    if (cached) {
      await page.getByRole('button', { name: /^Store/ }).click();
      await expect(page.getByRole('option', { name: /Browser Test Pack/ })).toBeVisible();
    }
    database.block();
    await page.reload();
    await page.getByRole('button', { name: /^Store/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Store', exact: true });
    try {
      await expect(dialog.getByText(/Cannot connect to the store/)).toBeVisible({ timeout: 6500 });
      await expect(dialog.getByText('Loading store...')).toHaveCount(0);
      if (cached) await expect(dialog.getByRole('option', { name: /Browser Test Pack/ })).toBeVisible();
    } finally {
      await testInfo.attach('blocked-store', { body: await page.screenshot(), contentType: 'image/png' });
    }
    database.reconnect();
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(dialog.getByRole('option', { name: /Browser Test Pack/ })).toBeVisible({ timeout: 6500 });
    await expect(dialog.getByText(/Cannot connect to the store/)).toHaveCount(0, { timeout: 6500 });
  });
}

test('offers a retry for a shared link when Firebase is blocked', async ({ page, context }, testInfo) => {
  const database = await connectStore(context);
  await verifyDatabase(page);
  database.block();
  await page.goto('/play?code=browser-pack');
  try {
    await expect(page.getByText(/Cannot connect to the store/)).toBeVisible({ timeout: 6500 });
    await expect(page.getByText('Shared pack not found in store.')).toHaveCount(0);
  } finally {
    await testInfo.attach('blocked-shared-link', { body: await page.screenshot(), contentType: 'image/png' });
  }
  database.reconnect();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('option', { name: /Browser Test Pack/ })).toBeVisible({ timeout: 6500 });
});

test('a connected shared link still asks before installing and plays the downloaded pack', async ({ page, context }) => {
  await connectStore(context);
  await context.route('**/api/store/download?*', route => route.fulfill({ body: readFileSync('e2e/fixtures/basic.uni'), contentType: 'application/octet-stream' }));
  await page.goto('/play?code=browser-pack');
  const confirmation = page.getByRole('alertdialog', { name: 'Confirm install', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  await confirmation.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.locator('[data-pad]')).toHaveCount(64);
});

test('ends a stalled shared pack download and retries it', async ({ page, context }, testInfo) => {
  await connectStore(context);
  let stalled = true;
  await context.route('**/api/store/download?*', route => {
    if (stalled) return;
    return route.fulfill({ body: readFileSync('e2e/fixtures/basic.uni'), contentType: 'application/octet-stream' });
  });
  await page.goto('/play?code=browser-pack');
  await page.getByRole('alertdialog', { name: 'Confirm install', exact: true }).getByRole('button', { name: 'Install', exact: true }).click();
  try {
    await expect(page.getByRole('dialog', { name: 'Store', exact: true }).getByText(/Cannot connect to the download/)).toBeVisible({ timeout: 6500 });
  } finally {
    await testInfo.attach('stalled-shared-download', { body: await page.screenshot(), contentType: 'image/png' });
  }
  stalled = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: /Play Downloaded Pack/ })).toBeVisible();
});


test('ends store loading while Firebase initialization is blocked', async ({ page, context }, testInfo) => {
  const database = await connectStore(context);
  await verifyDatabase(page);
  database.block();
  // Close the old SDK handles, then remove its persisted remote-config cache
  // before the next document initializes Firebase. Keep the new request pending.
  await page.goto('about:blank');
  await context.addInitScript(() => { indexedDB.deleteDatabase('firebase_remote_config'); });
  let pendingConfigurationRequests = 0;
  await context.route('**/firebaseremoteconfig.googleapis.com/**', route => {
    if (route.request().url().includes('/namespaces/firebase:fetch')) {
      pendingConfigurationRequests++;
      return;
    }
    return route.fulfill({ json: { entries: {}, state: 'NO_CHANGE' } });
  });
  await page.goto('/play');
  await page.getByRole('button', { name: /^Store/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Store', exact: true });
  try {
    await expect(dialog.getByText(/Cannot connect to the store/)).toBeVisible({ timeout: 6500 });
    await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    expect(pendingConfigurationRequests).toBeGreaterThan(0);
  } finally {
    await testInfo.attach('blocked-firebase-initialization', { body: await page.screenshot(), contentType: 'image/png' });
  }
});


test('ends store loading when Firebase HTTP and WebSockets are refused', async ({ page, context, baseURL }, testInfo) => {
  await connectStore(context);
  await verifyDatabase(page);
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === baseURL
    ? route.continue() : route.abort('blockedbyclient'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Store/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Store', exact: true });
  try {
    await expect(dialog.getByText(/Cannot connect to the store/)).toBeVisible({ timeout: 6500 });
    await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  } finally {
    await testInfo.attach('refused-firebase', { body: await page.screenshot(), contentType: 'image/png' });
  }
});
