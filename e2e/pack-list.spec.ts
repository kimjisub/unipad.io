import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import type { Locator, Page } from '@playwright/test';
import { test, expect, expectPads, stateTimeout } from './browser';
import { resize } from './layout';
import { storedPackRecords } from './saved-packs';
import { duration, loadInputPack } from './input-fixture';
import { rotatePrompt, showsRotatePrompt } from './touch';

// Newest first: the list sorts by the date a pack was added.
const packs = [
  ['e2e/fixtures/basic.uni', 'Browser Test Pack by UniPad Tests'],
  ['meta/unipack-conformance/chain-release-v1/packs/manual.uni', 'Chain Release v1 manual by UniPad Tests'],
  ['meta/unipack-conformance/chain-release-v1/packs/delayed.uni', 'Chain Release v1 delayed by UniPad Tests'],
] as const;
const [last, middle, first] = packs.map(([, name]) => name);

const list = (page: Page) => page.getByRole('listbox', { name: 'UniPack list' });
const option = (page: Page, name: string) => list(page).getByRole('option', { name, exact: true });

type PackFile = string | { name: string; mimeType: string; buffer: Buffer };

async function openList(page: Page, files: readonly PackFile[]) {
  await test.step('Prepare saved pack list', async () => {
    await page.goto('/play');
    for (const [index, file] of files.entries()) {
      await page.locator('input[type=file][accept=".zip,.uni"]').first().setInputFiles(typeof file === 'string' ? resolve(file) : file);
      await expectPads(page);
      // The import shows the pads before it saves the pack; the URL changes once it is saved.
      await expect(page).toHaveURL(/\/play\?pack=.+/, { timeout: stateTimeout });
      // Setup needs the buttons' actions, not pointer hit testing during their animations.
      // Keep the page alive and return to the list before the next import.
      await page.getByRole('button', { name: 'Open menu', exact: true }).dispatchEvent('click');
      await page.getByRole('button', { name: 'Quit', exact: true }).dispatchEvent('click');
      await expect(list(page).getByRole('option')).toHaveCount(index + 1);
    }
  });
}

const openListWithThreePacks = (page: Page) => openList(page, packs.map(([file]) => file));

const sortCases = [
  ['Title', true, ['Favorite', 'Alpha', 'Bravo', 'Charlie']],
  ['Title', false, ['Favorite', 'Charlie', 'Bravo', 'Alpha']],
  ['Producer', true, ['Favorite', 'Bravo', 'Charlie', 'Alpha']],
  ['Producer', false, ['Favorite', 'Alpha', 'Charlie', 'Bravo']],
  ['Date', true, ['Favorite', 'Charlie', 'Alpha', 'Bravo']],
  ['Date', false, ['Favorite', 'Bravo', 'Alpha', 'Charlie']],
] as const;

for (const [method, ascending, titles] of sortCases) {
  test(`saved ${method}/${ascending} sorting survives reload and list reentry`, async ({ page }, testInfo) => {
    await openListWithThreePacks(page);
    // Keep the real imported ZIP data; give the saved rows distinct, hand-checked sort keys.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('unipad');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['unipacks', 'unipackMetadata', 'unipackChunks'], 'readwrite');
        const store = tx.objectStore('unipackMetadata');
        const archive = tx.objectStore('unipacks').getAll();
        const chunks = tx.objectStore('unipackChunks').getAll();
        const request = store.getAll();
        request.onsuccess = () => {
          const records = request.result;
          const keys = [['Alpha', 'Charlie', 20], ['Bravo', 'Alpha', 30], ['Charlie', 'Bravo', 10]] as const;
          records.forEach((record, index) => store.put({ ...record, title: keys[index][0], producerName: keys[index][1], addedAt: keys[index][2] }));
          tx.objectStore('unipacks').put({ ...archive.result[0], id: 'favorite' });
          for (const chunk of chunks.result.filter(chunk => chunk.packId === archive.result[0].id)) {
            tx.objectStore('unipackChunks').put({ ...chunk, packId: 'favorite' });
          }
          store.put({ ...records[0], id: 'favorite', title: 'Favorite', producerName: 'Zulu', addedAt: 40, bookmark: true });
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await expect(list(page).getByRole('option')).toHaveCount(4);
    await page.getByRole('button', { name: /^(Title|Producer|Date)$/ }).click();
    await page.getByRole('button', { name: method, exact: true }).last().click();
    if (ascending === (method === 'Date')) {
      await page.getByRole('button', { name: /^Sort (ascending|descending)$/ }).click();
    }
    const expectedRows = titles.map(title => `${title} by ${{ Favorite: 'Zulu', Alpha: 'Charlie', Bravo: 'Alpha', Charlie: 'Bravo' }[title]}`);
    const readSettings = () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('unipad');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const values = await new Promise<Record<string, string>>((resolve, reject) => {
        const request = db.transaction('settings').objectStore('settings').getAll();
        request.onsuccess = () => resolve(Object.fromEntries(request.result.map(({ key, value }) => [key, value])));
        request.onerror = () => reject(request.error);
      });
      db.close();
      return { sortMethod: values.sortMethod, sortOrder: values.sortOrder };
    });
    const expectedSettings = { sortMethod: method.toLowerCase(), sortOrder: String(ascending) };
    await expect.poll(readSettings).toEqual(expectedSettings);
    for (const step of ['reload', 'reentry']) {
      if (step === 'reload') await page.reload();
      else { await page.goto('about:blank'); await page.goto('/play'); }
      await expect(list(page).getByRole('option')).toHaveCount(4);
      await testInfo.attach(`${step}-list`, { body: await page.screenshot(), contentType: 'image/png' });
      await testInfo.attach(`${step}-settings`, { body: JSON.stringify(await readSettings()), contentType: 'application/json' });
      await expect(page.getByRole('button', { name: method, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: ascending ? 'Sort ascending' : 'Sort descending', exact: true })).toBeVisible();
      await expect.poll(() => list(page).getByRole('option').evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')))).toEqual(expectedRows);
      await expect.poll(readSettings).toEqual(expectedSettings);
    }
  });
}

// The basic test pack under another title.
async function packTitled(title: string): Promise<PackFile> {
  const zip = await JSZip.loadAsync(readFileSync(resolve(packs[0][0])));
  const info = await zip.file('info')!.async('string');
  zip.file('info', info.replace(/^title=.*$/m, `title=${title}`));
  return { name: 'titled.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

async function expectActive(page: Page, name: string) {
  await expect(option(page, name)).toBeFocused();
  await expect(option(page, name)).toHaveAttribute('aria-selected', 'true');
  await expect(list(page).locator('[aria-selected="true"]')).toHaveCount(1);
}

test('a short pack list is one Tab stop and arrow, Home and End keys move focus and selection', async ({ page }) => {
  await openListWithThreePacks(page);
  await expect(list(page).locator('[tabindex="0"]')).toHaveCount(1);
  await option(page, middle).click();

  // Tab enters the list on the selected row, not on the first one.
  await page.getByRole('button', { name: '+ Import', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expectActive(page, middle);

  await page.keyboard.press('ArrowUp');
  await expectActive(page, first);
  await page.keyboard.press('ArrowDown');
  await expectActive(page, middle);
  await page.keyboard.press('End');
  await expectActive(page, last);
  await page.keyboard.press('ArrowDown');
  await expectActive(page, first);
  await page.keyboard.press('ArrowUp');
  await expectActive(page, last);
  await page.keyboard.press('Home');
  await expectActive(page, first);
  await expect(list(page).locator('[tabindex="0"]')).toHaveCount(1);

  // Test the list's Tab order within the page. Headless Firefox keeps the last element
  // focused when Tab would enter browser chrome, so provide an explicit next stop.
  await page.evaluate(() => {
    const next = document.createElement('button');
    next.id = 'after-pack-list';
    // WebKit's default Tab navigation requires buttons to opt in explicitly.
    next.tabIndex = 0;
    next.textContent = 'After pack list';
    document.body.append(next);
  });
  // Tab leaves the list instead of walking through every row.
  await page.keyboard.press('Tab');
  await expect(page.locator('#after-pack-list')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(option(page, first)).toBeFocused();
});

test('arrow keys move past a pack whose title has a double quote', async ({ page }) => {
  await openList(page, [packs[2][0], await packTitled('Quote "Pack"'), packs[0][0]]);
  const quoted = 'Quote "Pack" by UniPad Tests';
  await option(page, last).click();

  await page.keyboard.press('ArrowDown');
  await expectActive(page, quoted);
  await page.keyboard.press('ArrowDown');
  await expectActive(page, first);
  await page.keyboard.press('ArrowUp');
  await expectActive(page, quoted);
});

test('Space selects the focused pack and Enter plays it', async ({ page }) => {
  await openListWithThreePacks(page);
  await option(page, middle).click();
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');
  // A second click clears the selection; focus stays on the row.
  await option(page, middle).click();
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'false');
  await expect(option(page, middle)).toBeFocused();

  await page.keyboard.press(' ');
  await expectActive(page, middle);
  await expect(page.locator('[data-pad]')).toHaveCount(0);

  await page.keyboard.press('Enter');
  await expectPads(page);
  await expect(page).toHaveTitle(/^Chain Release v1 manual \|/);
});

test('rows hold no separate controls and the empty search result sits outside the list', async ({ page }) => {
  await openListWithThreePacks(page);
  // The newest pack starts selected, so click another row to open its play strip.
  await option(page, middle).click();
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');
  await expect(list(page).getByRole('button')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Search unipacks' }).fill('no pack has this name');
  await expect(page.getByText('no pack has this name')).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

/**
 * Selects the middle pack, then focuses the theme button as Tab does. Safari's Tab reaches buttons
 * only with its "Press Tab to highlight each item" setting, so the button is focused directly.
 */
async function focusThemeButtonWithPackSelected(page: Page) {
  await option(page, middle).click();
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');

  const theme = page.getByRole('button', { name: 'Theme', exact: true });
  await theme.focus();
  await expect(theme).toBeFocused();
}

/** The main screen is still showing the list with the middle pack selected, and nothing is open over it. */
async function expectListUntouched(page: Page) {
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]pack=/);
}

test('Enter on a focused button presses that button and leaves the selected pack closed', async ({ page }) => {
  await openListWithThreePacks(page);
  await focusThemeButtonWithPackSelected(page);

  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await chooser;
  await expectListUntouched(page);

  // Enter on the focused row still plays the selected pack.
  await option(page, middle).focus();
  await page.keyboard.press('Enter');
  await expectPads(page);
  await expect(page).toHaveTitle(/^Chain Release v1 manual \|/);
});

test('Backspace and Delete on a focused button leave the selected pack alone', async ({ page }) => {
  await openListWithThreePacks(page);
  await focusThemeButtonWithPackSelected(page);
  // WebKit's own Backspace on a button goes back a page, which here would reopen an imported pack;
  // a second entry for this page keeps it on the list.
  await page.evaluate(() => history.pushState(null, '', location.href));

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await expectListUntouched(page);

  // On the focused row they still ask to delete the selected pack.
  await option(page, middle).focus();
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('alertdialog')).toBeVisible();
});

test('Enter on the delete confirmation presses the focused button, and deletes from anywhere else', async ({ page }) => {
  await openListWithThreePacks(page);
  const confirmation = page.getByRole('alertdialog', { name: 'Confirm deletion', exact: true });
  const askToDeleteMiddle = async () => {
    // A click on the selected row would clear its selection.
    if (await option(page, middle).getAttribute('aria-selected') !== 'true') await option(page, middle).click();
    await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');
    await option(page, middle).focus();
    await page.keyboard.press('Delete');
    await expect(confirmation).toBeVisible();
  };

  // The dialog opens on its Delete button; Enter on a focused Cancel only cancels.
  await askToDeleteMiddle();
  await expect(confirmation.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  await expect(list(page).getByRole('option')).toHaveCount(3);

  await askToDeleteMiddle();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(list(page).getByRole('option')).toHaveCount(3);

  // With focus off its buttons, after a click on the question, Enter still deletes.
  await askToDeleteMiddle();
  await confirmation.getByText(`Delete “${middle.replace(/ by .*$/, '')}”?`).click();
  await expect(page.locator('body')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  await expect(option(page, middle)).toHaveCount(0);
  await expect(list(page).getByRole('option')).toHaveCount(2);

  // Enter on the Delete button it opens on deletes that one pack.
  await option(page, last).click();
  await expect(option(page, last)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Delete');
  await expect(confirmation.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  await expect(list(page).getByRole('option')).toHaveCount(1);
  await expect(option(page, first)).toBeVisible();
});

// Import a real two-chain pack, then duplicate only its persisted metadata, as a long saved list.
async function openLongList(page: Page, square: boolean) {
  await loadInputPack(page, 8, 8, square);
  await expect(page).toHaveURL(/pack=/, { timeout: stateTimeout });
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('unipad');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['unipacks', 'unipackMetadata', 'unipackChunks'], 'readwrite');
      const store = transaction.objectStore('unipackMetadata');
      const archive = transaction.objectStore('unipacks').getAll();
      const chunks = transaction.objectStore('unipackChunks').getAll();
      const request = store.getAll();
      request.onsuccess = () => {
        const template = request.result[0];
        if (!template) {
          transaction.abort();
          reject(new Error('The imported pack must be saved before cloning its metadata'));
          return;
        }
        for (let index = 0; index < 12; index++) {
          transaction.objectStore('unipacks').put({ ...archive.result[0], id: `local-${index}` });
          for (const chunk of chunks.result.filter(chunk => chunk.packId === archive.result[0].id)) {
            transaction.objectStore('unipackChunks').put({ ...chunk, packId: `local-${index}` });
          }
          store.put({ ...template, id: `local-${index}`, title: `Local pack ${index}`, addedAt: index });
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  });
  await page.goto('/play');
  await expect(list(page).getByRole('option')).toHaveCount(13);
}

// Use actual wheel input; never scroll a hidden target into view through DOM methods.
async function wheelTo(page: Page, target: Locator) {
  const readScroll = () => target.evaluate(element => {
    const targetRect = element.getBoundingClientRect();
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === 'auto' && parent.scrollHeight > parent.clientHeight) {
        const rect = parent.getBoundingClientRect();
        // Stop within the final assertion's existing 0.99 ratio: integer scroll offsets can
        // leave a fractional sliver clipped at the end of a fractional-height scrollport.
        const tolerance = targetRect.height * 0.01;
        const direction = targetRect.top < rect.top - tolerance ? -1 : targetRect.bottom > rect.bottom + tolerance ? 1 : 0;
        if (direction) return {
          x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
          top: parent.scrollTop, delta: direction * 2000,
          // Bound the gesture sequence by the content size, including one partial final step.
          steps: Math.ceil(parent.scrollHeight / (parent.clientHeight / 2)) + 1,
        };
      }
    }
    return null;
  });
  const initial = await readScroll();
  // Firefox limits a large wheel event to less than one scrollport. Send a sequence of
  // wheel gestures and require movement after each one, rather than assuming deltaY
  // equals the distance scrolled or silently retrying the final visibility assertion.
  for (let remaining = initial?.steps ?? 0; remaining > 0; remaining--) {
    const scroll = await readScroll();
    if (!scroll) break;
    await page.mouse.move(scroll.x, scroll.y);
    await page.mouse.wheel(0, scroll.delta);
    await expect.poll(async () => {
      const next = await readScroll();
      return !next || next.top !== scroll.top;
    }, { message: 'Wheel input must move the target scroll container' }).toBe(true);
  }
  // Fractional scroll offsets can leave less than one CSS pixel clipped.
  await expect(target).toBeInViewport({ ratio: 0.99 });
}

async function playAndReturn(page: Page, viewport: { width: number; height: number }) {
  await expect(page).toHaveURL(/[?&]pack=local-0(?:&|$)/, { timeout: stateTimeout });
  await expectPads(page);
  if (showsRotatePrompt(viewport)) {
    await expect(rotatePrompt(page)).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
  }
  const pad = page.locator('[data-pad="7,7"]');
  const starts = await page.evaluate(() => window.browserProbe.audio.starts.length);
  // Wait for the grid's resized layout before sending real pointer input to this pad.
  await pad.hover();
  await page.mouse.down();
  try {
    await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(starts + 1);
    const source = await page.evaluate(() => window.browserProbe.audio.starts.at(-1)!);
    expect(source.loop).toBe(true);
    expect(source.duration).toBeCloseTo(duration(8, 8, '7,7'), 4);
    expect(await page.evaluate(() => window.browserProbe.audio.stops)).not.toContain(source.id);
  } finally {
    await page.mouse.up();
  }
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.filter(
    source => source.loop && !window.browserProbe.audio.stops.includes(source.id),
  ).length)).toBe(0);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Quit', exact: true }).click();
  // The list is back before the resize, so the drawn frames below include its new layout.
  await expect(list(page).getByRole('option')).toHaveCount(13);
  await resize(page, viewport);
}

function holdNextPackSetting() {
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    if (this.name === 'settings' && args[0].key === 'lastUniPackId') {
      // Finish the native write but hold the Promise that gates the pack URL.
      request.addEventListener('success', event => {
        event.stopImmediatePropagation();
        document.documentElement.dataset.heldPackSetting = 'true';
        window.addEventListener('release-pack-setting', () => request.onsuccess?.call(request, event), { once: true });
      }, { once: true });
      IDBObjectStore.prototype.put = put;
    }
    return request;
  };
}

test('saved pack import waits for delayed settings completion', async ({ page }, info) => {
  test.setTimeout(Math.max(info.project.timeout, 60_000));
  await page.addInitScript(holdNextPackSetting);
  const imported = openList(page, [packs[0][0]]).catch(error => error);
  await page.waitForURL(/\/play$/);
  await expectPads(page);
  await expect(page.locator('html')).toHaveAttribute('data-held-pack-setting', 'true', { timeout: stateTimeout });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.dispatchEvent(new Event('release-pack-setting')));
  expect(await imported).toBeUndefined();
});

test('saved pack playback waits for delayed settings completion', async ({ page }, info) => {
  test.setTimeout(Math.max(info.project.timeout, 60_000));
  await openLongList(page, true);
  await option(page, 'Local pack 0 by UniPad Tests').click();
  await page.evaluate(holdNextPackSetting);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expectPads(page);
  await expect(page.locator('html')).toHaveAttribute('data-held-pack-setting', 'true');
  const playback = playAndReturn(page, { width: 1280, height: 800 }).catch(error => error);
  // Keep this response pending beyond the default five-second URL assertion.
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.dispatchEvent(new Event('release-pack-setting')));
  expect(await playback).toBeUndefined();
});

for (const square of [true, false]) {
  for (const [width, height] of [[594, 368], [594, 406], [385, 571], [385, 609], [669, 867], [669, 902], [768, 800], [834, 1210], [1280, 800]]) {
    test(`saved pack tail ${square ? 'square' : 'rectangular'} ${width}x${height}`, async ({ page }, info) => {
      test.setTimeout(Math.max(info.project.timeout, 60_000));
      expect(info.timeout, 'Long-list setup must retain the browser project timeout').toBeGreaterThanOrEqual(info.project.timeout);
      await openLongList(page, square);
      const viewport = { width, height };
      await resize(page, viewport);
      await info.attach('list-before-scroll', { body: await page.screenshot(), contentType: 'image/png' });
      const tail = option(page, 'Local pack 0 by UniPad Tests');
      await wheelTo(page, tail);
      await info.attach('list-tail-after-wheel', { body: await page.screenshot(), contentType: 'image/png' });
      await tail.click();
      await expect(tail).toHaveAttribute('aria-selected', 'true');
      const detailPlay = page.getByRole('button', { name: 'Play', exact: true });
      await wheelTo(page, detailPlay);
      await info.attach('detail-play-reachable', { body: await page.screenshot(), contentType: 'image/png' });
      await detailPlay.click();
      await playAndReturn(page, viewport);
      await wheelTo(page, tail);
      await expect(tail).toHaveAttribute('aria-selected', 'true');
      await tail.locator(':scope > [aria-hidden="true"]').click();
      await playAndReturn(page, viewport);
    });
  }
}

test('a single saved pack keeps detail playback visible in a tall phone viewport', async ({ page }, info) => {
  await openList(page, [packs[0][0]]);
  await page.setViewportSize({ width: 390, height: 844 });
  // Returning from playback restores this pack's selection.
  const row = option(page, last);
  await expect(row).toHaveAttribute('aria-selected', 'true');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await info.attach('tall-phone-selected-pack', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(play).toBeInViewport({ ratio: 0.99 });
  await play.click();
  await expectPads(page);
});

for (const action of ['opening', 'bookmarking'] as const) {
  test(`saved pack ${action} handles an aborted metadata write`, async ({ page }, info) => {
    await openList(page, [packs[0][0]]);
    const before = await storedPackRecords(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.name === 'unipackMetadata') {
          request.addEventListener('success', () => {
            // Native rollback after put succeeds, before its transaction commits.
            this.transaction.abort();
            document.documentElement.dataset.abortedPackWrite = 'true';
          }, { once: true });
        }
        return request;
      };
    });
    await info.attach('before-aborted-write', { body: await page.screenshot(), contentType: 'image/png' });
    try {
      if (action === 'opening') {
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await expectPads(page);
        await expect(page).toHaveURL(/\/play\?pack=.+/, { timeout: stateTimeout });
        const starts = await page.evaluate(() => window.browserProbe.audio.starts.length);
        await page.locator('[data-pad="0,0"]').click();
        await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(starts + 1);
      } else {
        const bookmark = page.getByRole('button', { name: 'Add bookmark', exact: true });
        await bookmark.click();
        await expect(bookmark).toBeVisible();
        await expect(page.getByRole('button', { name: 'Remove bookmark', exact: true })).toHaveCount(0);
      }
      await expect(page.locator('html')).toHaveAttribute('data-aborted-pack-write', 'true');
      const after = await storedPackRecords(page);
      expect(after).toEqual(before);
    } finally {
      await info.attach('after-aborted-write', { body: await page.screenshot(), contentType: 'image/png' });
    }
  });
}
