import { readFileSync } from 'node:fs';
import { type BrowserContext, type Page } from '@playwright/test';
import { undecodablePack } from './basic-pack';
import { test, expect, expectPads } from './browser';
import { recordStoreTransitions } from './store-transition-probe';
import { corruptSoundArchive } from '../src/lib/unipack/corruptArchive.testUtils.mjs';
import { seedSavedPacks, storedPackRecords } from './saved-packs';
import { expectConfirmationKeyboard, observeConfirmationKeys } from './confirm-dialog';

test('shared install confirmation contains keyboard focus and restores its opener', async ({ page, context }, info) => {
  await observeConfirmationKeys(page);
  await connectStore(context);
  await openConnectedSharedLink(page);
  const dialog = page.getByRole('alertdialog', { name: 'Confirm install', exact: true });
  // This confirmation opens from navigation, so its previous focus is the document body.
  await expectConfirmationKeyboard(page, dialog, info);
  await expect(page.locator('body')).toBeFocused();
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  expect(await storedPackRecords(page)).toEqual([]);
});

for (const answer of ['Enter', 'Escape']) test(`overlapping confirmations give only the shared install dialog ${answer}`, async ({ page, context }, info) => {
  const database = await connectStore(context);
  await context.route('**/api/store/download?*', route => route.fulfill({ body: readFileSync('e2e/fixtures/basic.uni'), contentType: 'application/octet-stream' }));
  await verifyDatabase(page);
  await seedSavedPacks(page, [{ id: 'saved-before-link', title: 'Saved before link', producerName: 'Tests', addedAt: 1 }]);
  database.holdReplies();
  await page.goto('/play?code=browser-pack');
  const opener = page.getByRole('option', { name: 'Saved before link by Tests', exact: true });
  // Select through the keyboard without waiting for the row's entrance animation.
  await opener.press('Space');
  await page.keyboard.press('Delete');
  const deletion = page.getByRole('alertdialog', { name: 'Confirm deletion', exact: true });
  const lowerCancel = deletion.getByRole('button', { name: 'Cancel', exact: true });
  await expect(deletion).toBeVisible();
  await lowerCancel.focus();
  await database.releaseReplies();
  const installation = page.getByRole('alertdialog', { name: 'Confirm install', exact: true });
  await expect(installation).toBeVisible();
  await info.attach('overlapping-confirmations', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(installation.getByRole('button', { name: 'Install', exact: true })).toBeFocused();
  for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await installation.evaluate(element => element.contains(document.activeElement)), `${key} stays in the upper dialog`).toBe(true);
  }
  await page.keyboard.press(answer);
  if (answer === 'Enter') {
    await expectPads(page);
    await expect.poll(async () => (await storedPackRecords(page)).length).toBe(2);
  } else {
    await expect(installation).toHaveCount(0);
    await expect(lowerCancel).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(deletion).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.getByRole('option')).toHaveCount(1);
  }
  expect((await storedPackRecords(page)).some(pack => pack.id === 'saved-before-link')).toBe(true);
  await info.attach('overlapping-after-answer', { body: await page.screenshot(), contentType: 'image/png' });
});

for (const answer of ['Enter', 'Escape']) test(`connection help and shared confirmation share focus and visible order on ${answer}`, async ({ page, context, checkedPage }, info) => {
  const database = await connectStore(context);
  await context.route('**/api/store/download?*', route => route.fulfill({ body: readFileSync('e2e/fixtures/basic.uni'), contentType: 'application/octet-stream' }));
  await verifyDatabase(page);
  await seedSavedPacks(page, [{ id: 'saved-before-link', title: 'Saved before link', producerName: 'Tests', addedAt: 1 }]);
  database.holdReplies();
  await page.goto('/play?code=browser-pack');
  // Act on each rendered setup button in the document, without a browser round trip between
  // renders. The real five-second lookup clock still runs; no app state or timers are replaced.
  await page.evaluate(() => new Promise<void>(resolve => {
    let step = 0;
    const observer = new MutationObserver(advance);
    observer.observe(document, { childList: true, subtree: true });
    function advance() {
      if (step === 0) {
        const row = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(row => row.textContent?.includes('Saved before link'));
        if (!row) return;
        step++;
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      } else if (step === 1) {
        const menu = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
        if (!menu) return;
        step++;
        menu.click();
      } else if (step === 2) {
        const settings = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Menu"] button')).find(button => button.textContent?.startsWith('Launchpad Settings'));
        if (!settings) return;
        step++;
        settings.click();
      } else if (step === 3) {
        const help = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Launchpad Settings"] button')).find(button => button.textContent === 'Connection and light help');
        if (!help) return;
        step++;
        help.click();
      } else {
        const close = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Close help');
        const region = close?.closest('[role="dialog"]')?.querySelector<HTMLElement>('[role="region"]');
        if (!region) return;
        region.focus();
        observer.disconnect();
        resolve();
      }
    }
    advance();
  }));
  const help = page.getByRole('dialog', { name: 'Connection and light help', exact: true });
  const previous = help.getByRole('region');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await database.releaseReplies();
  const confirmation = page.getByRole('alertdialog', { name: 'Confirm install', exact: true });
  await expect(confirmation).toBeVisible();
  // Record errors and focus before assertions so the old implementation's focus loop is preserved.
  await page.keyboard.press('Tab');
  await info.attach('mixed-dialog-errors-and-focus', {
    body: JSON.stringify({ errors: checkedPage.errors, focus: await page.evaluate(() => document.activeElement?.textContent) }),
    contentType: 'application/json',
  });
  await info.attach('mixed-dialogs', { body: await page.screenshot(), contentType: 'image/png' });
  expect(checkedPage.errors).toEqual([]);
  expect(await confirmation.evaluate(element => element.contains(document.activeElement))).toBe(true);
  for (const key of ['Shift+Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await confirmation.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  // A centre hit must land on the same dialog that receives keys, above the help and settings.
  expect(await confirmation.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await confirmation.getByRole('button', { name: 'Install', exact: true }).focus();
  await page.keyboard.press(answer);
  await expect(confirmation).toHaveCount(0);
  if (answer === 'Enter') {
    // Loading another pack unmounts the old player's help. The install must run only once.
    await expect.poll(async () => (await storedPackRecords(page)).length).toBe(2);
    await expectPads(page);
  } else {
    await expect(previous).toBeFocused();
    expect((await storedPackRecords(page)).length).toBe(1);
    await page.keyboard.press('Tab');
    expect(await help.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connection and light help', exact: true })).toBeFocused();
  }
});

const storeItem = {
  code: 'browser-pack', title: 'Browser Test Pack', producerName: 'UniPad Tests',
  isAutoPlay: true, isLED: true, downloadCount: 42,
};

// Keep the real Firebase SDK; only the network peer is local.
// A stalled peer keeps its handshake but drops database replies. This lets the
// retry test restore that same connection without faking the SDK's HTTP fallback.
async function connectStore(context: BrowserContext, firstHandshakeDelayMs = 0) {
  let firstConnection = true;
  let connected = true;
  let liveItem = storeItem;
  let blockedStoreRequests = 0;
  let heldReplies: (() => void)[] | null = null;
  await context.route('**/firebaseremoteconfig.googleapis.com/**', route => route.fulfill({ json: { entries: {}, state: 'NO_CHANGE' } }));
  await context.routeWebSocket(/firebaseio\.com|firebasedatabase\.app/, async socket => {
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
    const delay = firstConnection ? firstHandshakeDelayMs : 0;
    firstConnection = false;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
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

async function openConnectedSharedLink(page: Page) {
  // Route registration alone does not put the SDK online. Warm it before the
  // link's bounded lookup so a slow first connection is not an outage test.
  await verifyDatabase(page);
  await page.goto('/play?code=browser-pack');
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

for (const firstHandshakeDelayMs of [0, 6000]) {
  test(`a connected shared link still asks before installing and plays the downloaded pack (first handshake delay: ${firstHandshakeDelayMs}ms)`, async ({ page, context }) => {
    await connectStore(context, firstHandshakeDelayMs);
    await context.route('**/api/store/download?*', route => route.fulfill({ body: readFileSync('e2e/fixtures/basic.uni'), contentType: 'application/octet-stream' }));
    await openConnectedSharedLink(page);
    // Observe the late database reply before checking which view the link chose.
    await expect(page.getByRole('button', { name: /^Store/ })).toContainText('42', { timeout: 15000 });
    const confirmation = page.getByRole('alertdialog', { name: 'Confirm install', exact: true });
    await expect(confirmation).toBeVisible();
    await expect(page.locator('[data-pad]')).toHaveCount(0);
    await confirmation.getByRole('button', { name: 'Install', exact: true }).click();
    await expectPads(page);
  });
}

test('a store download with damaged compressed audio stays unsaved and offers a working retry', async ({ page, context }, testInfo) => {
  await connectStore(context);
  const damaged = Buffer.from(await corruptSoundArchive());
  let broken = true;
  await context.route('**/api/store/download?*', route => route.fulfill({
    body: broken ? damaged : readFileSync('e2e/fixtures/basic.uni'), contentType: 'application/octet-stream',
  }));
  await verifyDatabase(page);
  await page.getByRole('button', { name: /^Store/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Store', exact: true });
  const row = dialog.locator('[data-store-code="browser-pack"]');
  await row.getByRole('button', { name: 'Download', exact: true }).click();
  try {
    await expect(row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    expect(await storedPackRecords(page)).toEqual([]);
    await expect(dialog.getByRole('button', { name: 'Play Downloaded Pack' })).toHaveCount(0);
  } finally {
    await testInfo.attach('damaged-download', { body: await page.screenshot(), contentType: 'image/png' });
  }
  broken = false;
  await row.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Play Downloaded Pack' })).toBeVisible();
  const saved = await storedPackRecords(page);
  expect(saved).toHaveLength(1);
  expect(saved[0].zipData).toEqual([...readFileSync('e2e/fixtures/basic.uni')]);
  await dialog.getByRole('button', { name: 'Play Downloaded Pack' }).click();
  await expectPads(page);
});

test('a shared pack that cannot open leaves the link out of the address', async ({ page, context }, testInfo) => {
  await connectStore(context);
  const pack = await undecodablePack();
  await context.route('**/api/store/download?*', route => route.fulfill({ body: pack.buffer, contentType: 'application/octet-stream' }));
  let failures = 0;
  page.on('console', message => { if (message.text().includes('Failed to load UniPack')) failures += 1; });
  const error = page.getByRole('alertdialog', { name: 'Cannot open this pack’s sounds', exact: true });
  const packs = page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option');
  // Left in the address, the link would open the pack again and count another play on every reload.
  const expectNoReopen = async (opened: number) => {
    await expect(page).not.toHaveURL(/[?&](code|pack)=/);
    await page.reload();
    await expect(packs).toHaveCount(1);
    // Give a link restore time to open the pack.
    await page.waitForTimeout(1000);
    await expect(error).toHaveCount(0);
    expect(failures).toBe(opened);
  };

  await openConnectedSharedLink(page);
  await page.getByRole('alertdialog', { name: 'Confirm install', exact: true }).getByRole('button', { name: 'Install', exact: true }).click();
  try {
    await expect(error).toContainText('1 sound file cannot be read');
  } finally {
    await testInfo.attach('shared-pack-failed', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await expectNoReopen(1);

  // The same link again finds the pack already downloaded and opens it without asking.
  await openConnectedSharedLink(page);
  await expect(error).toContainText('1 sound file cannot be read');
  await expectNoReopen(2);
});

test('Enter on the shared link confirmation\'s Cancel button installs nothing', async ({ page, context }) => {
  await connectStore(context);
  let downloads = 0;
  await context.route('**/api/store/download?*', route => {
    downloads += 1;
    return route.fulfill({ body: readFileSync('e2e/fixtures/basic.uni'), contentType: 'application/octet-stream' });
  });
  await openConnectedSharedLink(page);
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
  await openConnectedSharedLink(page);
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
