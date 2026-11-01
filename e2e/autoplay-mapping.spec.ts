import { createHash } from 'node:crypto';
import { storedPackRecords } from './saved-packs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, expectPads } from './browser';

// basic.uni plays its 100 ms tone on pads (0,0), (1,0), (0,0) with 3.2 s between them. Auto mapping
// starts 1 s in and waits one tone length between presses, each press followed by its release.
const ORIGINAL = [
  { type: 'delay', delay: 1000 },
  { type: 'on', x: 0, y: 0, currChain: 0, num: 0 }, { type: 'delay', delay: 200 }, { type: 'off', x: 0, y: 0, currChain: 0 },
  { type: 'delay', delay: 3000 },
  { type: 'on', x: 1, y: 0, currChain: 0, num: 0 }, { type: 'delay', delay: 200 }, { type: 'off', x: 1, y: 0, currChain: 0 },
  { type: 'delay', delay: 3000 },
  { type: 'on', x: 0, y: 0, currChain: 0, num: 1 }, { type: 'delay', delay: 200 }, { type: 'off', x: 0, y: 0, currChain: 0 },
];
const MAPPED = [
  { type: 'delay', delay: 1000 },
  { type: 'on', x: 0, y: 0, currChain: 0, num: 0 }, { type: 'off', x: 0, y: 0, currChain: 0 },
  { type: 'delay', delay: 100 },
  { type: 'on', x: 1, y: 0, currChain: 0, num: 0 }, { type: 'off', x: 1, y: 0, currChain: 0 },
  { type: 'delay', delay: 100 },
  { type: 'on', x: 0, y: 0, currChain: 0, num: 1 }, { type: 'off', x: 0, y: 0, currChain: 0 },
];

interface StoredPack { zipSha256: string; autoPlay?: { current: unknown[]; backup: unknown[] } }

/** The one stored pack: a digest of its archive and the autoPlay stored beside it. */
async function storedPack(page: Page): Promise<StoredPack[]> {
  return (await storedPackRecords(page)).map(({ zipData, autoPlay }) => ({
    zipSha256: createHash('sha256').update(new Uint8Array(zipData)).digest('hex'),
    ...(autoPlay ? { autoPlay } : {}),
  }));
}

async function importBasicPack(page: Page): Promise<StoredPack> {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expectPads(page);
  await expect.poll(async () => (await storedPack(page)).length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  return (await storedPack(page))[0];
}

const menu = (page: Page) => page.getByRole('dialog', { name: 'Menu', exact: true });
const autoMapping = (page: Page) => menu(page).getByRole('button', { name: 'Auto Mapping', exact: true });
const restore = (page: Page) => menu(page).getByRole('button', { name: /^Restore previous AutoPlay/ });

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(menu(page)).toBeVisible();
}

async function confirm(page: Page, dialogName: string, action: string, message: string) {
  const dialog = page.getByRole('alertdialog', { name: dialogName, exact: true });
  await expect(dialog).toBeVisible();
  // The toast lasts 2 s; observe it while clicking, before waiting for the dialog's exit.
  await Promise.all([
    expect(page.getByText(message, { exact: true })).toBeVisible(),
    dialog.getByRole('button', { name: action, exact: true }).click(),
  ]);
  await expect(dialog).toHaveCount(0);
}

async function mapAndSave(page: Page, imported: StoredPack) {
  await autoMapping(page).click();
  await confirm(page, 'Confirm auto mapping', 'Map', 'Saved the AutoPlay. You can restore the previous one from the menu.');
  expect(await storedPack(page)).toEqual([{ zipSha256: imported.zipSha256, autoPlay: { current: MAPPED, backup: ORIGINAL } }]);
  await expect(restore(page)).toBeEnabled();
}

async function reopenPack(page: Page) {
  await page.reload();
  await expectPads(page);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
}

/** Plays autoPlay from the start and waits for its three presses; the archive's takes over 7 s. */
async function expectMappedTiming(page: Page) {
  const before = await page.evaluate(() => window.browserProbe.audio.starts.length);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.browserProbe.audio.starts.length)) - before, { timeout: 6500 }).toBe(3);
}

// Each lifecycle starts with a fresh pack instead of sharing cancellation, playback and restore's budget.
test('cancelling auto mapping leaves the archive and stored autoPlay untouched', async ({ page }, testInfo) => {
  const imported = await importBasicPack(page);
  await openMenu(page);
  await expect(restore(page)).toBeDisabled();
  await expect(restore(page)).toContainText('No saved backup');

  await autoMapping(page).click();
  const question = page.getByRole('alertdialog', { name: 'Confirm auto mapping', exact: true });
  await expect(question).toContainText('Map the AutoPlay? Waits become the length of each sound.');
  await testInfo.attach('confirm-auto-mapping', { body: await page.screenshot(), contentType: 'image/png' });
  await question.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(question).toHaveCount(0);
  expect(await storedPack(page)).toEqual([imported]);
  await expect(restore(page)).toBeDisabled();
  // Cancelling must also leave the next mapping usable.
  await mapAndSave(page, imported);
});

test('auto mapping saves its result beside the untouched archive and plays it after a reload', async ({ page }, testInfo) => {
  const imported = await importBasicPack(page);
  await openMenu(page);
  await mapAndSave(page, imported);
  await testInfo.attach('auto-mapping-saved', { body: await page.screenshot(), contentType: 'image/png' });

  await reopenPack(page);
  await expectMappedTiming(page);
  expect(await storedPack(page)).toEqual([{ zipSha256: imported.zipSha256, autoPlay: { current: MAPPED, backup: ORIGINAL } }]);
});

test('restoring autoPlay after a reload swaps the saved mapping and backup without changing the archive', async ({ page }) => {
  const imported = await importBasicPack(page);
  await openMenu(page);
  await mapAndSave(page, imported);
  await reopenPack(page);
  await openMenu(page);
  await expect(restore(page)).toBeEnabled();
  await restore(page).click();
  await confirm(page, 'Confirm restoring the AutoPlay', 'Restore', 'Restored the previous AutoPlay.');
  expect(await storedPack(page)).toEqual([{ zipSha256: imported.zipSha256, autoPlay: { current: ORIGINAL, backup: MAPPED } }]);
  // Restoring swaps the two, so the mapped autoPlay can be brought back.
  await expect(restore(page)).toBeEnabled();
});

test('a failed save keeps the stored autoPlay and does not report success', async ({ page }, testInfo) => {
  const imported = await importBasicPack(page);
  // Full storage aborts the write transaction after its requests were accepted.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      if ((value as { autoPlay?: unknown }).autoPlay) request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
  });
  await openMenu(page);
  await autoMapping(page).click();
  await confirm(page, 'Confirm auto mapping', 'Map', 'Couldn’t save. The AutoPlay is unchanged.');
  await testInfo.attach('auto-mapping-failed', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(page.getByText('Saved the AutoPlay. You can restore the previous one from the menu.')).toHaveCount(0);
  expect(await storedPack(page)).toEqual([imported]);
  await expect(restore(page)).toBeDisabled();
  await expect(autoMapping(page)).toBeEnabled();
});
