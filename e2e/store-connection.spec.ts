import { readFileSync } from 'node:fs';
import { type BrowserContext, type Page } from '@playwright/test';
import { test, expect, expectPads } from './browser';
import { recordStoreTransitions } from './store-transition-probe';

const storeItem = {
  code: 'browser-pack', title: 'Browser Test Pack', producerName: 'UniPad Tests',
  isAutoPlay: true, isLED: true, downloadCount: 42,
};

// Keep the real Firebase SDK; only the network peer is local.
// A stalled peer keeps its handshake but drops database replies. This lets the
// retry test restore that same connection without faking the SDK's HTTP fallback.
async function connectStore(context: BrowserContext) {
  let connected = true;
  let liveItem = storeItem;
  let blockedStoreRequests = 0;
  let heldReplies: (() => void)[] | null = null;
  await context.route('**/firebaseremoteconfig.googleapis.com/**', route => route.fulfill({ json: { entries: {}, state: 'NO_CHANGE' } }));
  await context.routeWebSocket(/firebaseio\.com|firebasedatabase\.app/, socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.t !== 'd') return;
      const { r, a, b } = message.d;
      if (!connected) {
        if (a === 'g' && b.p === '/store') blockedStoreRequests++;
        return;
      }
      const data = b.p === '/storeCount' ? 42 : { 'browser-pack': liveItem };
      const respond = () => {
        if (a === 'q') socket.send(JSON.stringify({ t: 'd', d: { a: 'd', b: { p: b.p, d: data } } }));
        socket.send(JSON.stringify({ t: 'd', d: { r, b: { s: 'ok', d: a === 'g' ? data : '' } } }));
      };
      if (heldReplies && b.p === '/store') {
        heldReplies.push(respond);
        return;
      }
      respond();
    });
    socket.send(JSON.stringify({ t: 'c', d: { t: 'h', d: { ts: Date.now(), v: '5', h: new URL(socket.url()).hostname, s: 'store-test-session' } } }));
  });
  return {
    block() { connected = false; blockedStoreRequests = 0; },
    reconnect(item = storeItem) { liveItem = item; connected = true; },
    holdReplies() { heldReplies = []; },
    async releaseReplies() {
      await expect.poll(() => heldReplies?.length ?? 0).toBeGreaterThan(0);
      const replies = heldReplies!;
      heldReplies = null;
      replies.forEach(reply => reply());
    },
    async waitForBlockedStoreRequest() {
      await expect.poll(() => blockedStoreRequests, { timeout: 15000 }).toBeGreaterThan(0);
    },
  };
}

async function verifyDatabase(page: Page) {
  await page.goto('/play');
  await expect(page.getByRole('button', { name: /^Store/ })).toContainText('42', {
    timeout: 15000,
  });
}

test.afterEach(async ({ page }, testInfo) => {
  if (!testInfo.tags.includes('@store-transitions')) return;
  await testInfo.attach('store-transitions', {
    body: JSON.stringify(await page.evaluate(() => Reflect.get(window, 'storeTransitions')), null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('store-screen', { body: await page.screenshot(), contentType: 'image/png' });
});

test('shows store results even if the outgoing loading animation cannot finish', { tag: '@store-transitions' }, async ({ page, context }) => {
  await recordStoreTransitions(page, true);
  const database = await connectStore(context);
  await verifyDatabase(page);
  database.holdReplies();
  await page.getByRole('button', { name: /^Store/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Store', exact: true });
  await expect.poll(() => dialog.getByText('Loading store...').evaluate(message => {
    const view = message.parentElement!;
    return getComputedStyle(view).opacity === '1' && view.getAnimations().length === 0;
  })).toBe(true);
  await database.releaseReplies();
  await Promise.all([
    expect(dialog.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled({ timeout: 6500 }),
    expect(dialog.getByRole('option', { name: /Browser Test Pack/ })).toBeVisible({ timeout: 6500 }),
    expect(dialog.getByText('Loading store...')).toHaveCount(0, { timeout: 6500 }),
  ]);
});

for (const cached of [false, true]) {
  test(`ends blocked store loading and retries after reconnecting (cached: ${cached})`, { tag: '@store-transitions' }, async ({ page, context }) => {
    await recordStoreTransitions(page);
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
    // Start the deadline check only after the SDK has sent the stalled request.
    await database.waitForBlockedStoreRequest();
    await expect.poll(() => dialog.getByText(/Cannot connect to the store/).evaluateAll(messages =>
      messages.some(message => message.checkVisibility({ opacityProperty: true, visibilityProperty: true }))),
    { timeout: 6500, intervals: [100], message: 'store connection message is painted' }).toBe(true);
    await expect(dialog.getByText('Loading store...')).toHaveCount(0);
    if (cached) await expect(dialog.getByRole('option', { name: /Browser Test Pack/ })).toBeVisible();
    database.reconnect({ ...storeItem, title: 'Reconnected Test Pack' });
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    // Observe request completion and the resulting view within the same deadline.
    await Promise.all([
      expect(dialog.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled({ timeout: 6500 }),
      expect(dialog.getByRole('option', { name: /Reconnected Test Pack/ })).toBeVisible({ timeout: 6500 }),
      expect(dialog.getByText(/Cannot connect to the store/)).toHaveCount(0, { timeout: 6500 }),
    ]);
  });
}

test('offers a retry for a shared link when Firebase is blocked', async ({ page, context }, testInfo) => {
  const database = await connectStore(context);
  await verifyDatabase(page);
  database.block();
  await page.goto('/play?code=browser-pack');
  // Shared lookup starts after local storage restoration, when the list appears.
  await expect(page.getByRole('button', { name: /^Store/ })).toBeVisible();
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
  await expectPads(page);
});

test('Enter on the shared link confirmation\'s Cancel button installs nothing', async ({ page, context }) => {
  await connectStore(context);
  let downloads = 0;
  await context.route('**/api/store/download?*', route => {
    downloads += 1;
    return route.fulfill({ body: readFileSync('e2e/fixtures/basic.uni'), contentType: 'application/octet-stream' });
  });
  await page.goto('/play?code=browser-pack');
  const confirmation = page.getByRole('alertdialog', { name: 'Confirm install', exact: true });
  await expect(confirmation.getByRole('button', { name: 'Install', exact: true })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  // Give a started install time to reach the download and open the pack.
  await page.waitForTimeout(1000);
  expect(downloads).toBe(0);
  await expect(page.locator('[data-pad]')).toHaveCount(0);
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
  const row = page.getByRole('dialog', { name: 'Store', exact: true }).locator('[data-store-code="browser-pack"]');
  try {
    await expect(page.getByText(/Cannot connect to the download/)).toBeVisible({ timeout: 6500 });
    await expect(row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  } finally {
    await testInfo.attach('stalled-shared-download', { body: await page.screenshot(), contentType: 'image/png' });
  }
  stalled = false;
  await row.getByRole('button', { name: 'Retry', exact: true }).click();
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
