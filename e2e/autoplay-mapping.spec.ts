import { createHash } from 'node:crypto';
import { storedPackRecords, expectSavedPackCount } from './saved-packs';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect, expectPads } from './browser';
import { expectConfirmationKeyboard, observeConfirmationKeys } from './confirm-dialog';

test('auto mapping confirmation contains keyboard focus and restores its opener', async ({ page }, info) => {
  await observeConfirmationKeys(page);
  const imported = await importBasicPack(page);
  await openMenu(page);
  await autoMapping(page).focus();
  await page.keyboard.press('Enter');
  const starts = await page.evaluate(() => window.browserProbe.audio.starts.length);
  await expectConfirmationKeyboard(page, page.getByRole('alertdialog', { name: 'Confirm auto mapping', exact: true }), info);
  await expect(autoMapping(page)).toBeFocused();
  expect(await storedPack(page)).toEqual([imported]);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(starts);
});

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

for (const originalIsCurrent of [false, true]) test(`legacy saved original adopts song-time timing without losing the mapping, originalIsCurrent=${originalIsCurrent}`, async ({ page }, info) => {
  const zip = await JSZip.loadAsync(await readFile(resolve('e2e/fixtures/basic.uni')));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', 'chain=2'));
  zip.file('keySound', '1 1 1 tone.wav 1 2\n1 1 2 tone.wav\n2 1 2 tone.wav');
  zip.file('autoPlay', 'on 1 1\nd 1\ntouch 1 2\nd 199');
  await page.goto('/play');
  await page.locator('input[data-unipack-import]').setInputFiles({ name: 'saved-timing.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page); await expectSavedPackCount(page, 1);
  const imported = (await storedPack(page))[0];
  const first = { type: 'on', x: 0, y: 0, currChain: 0, num: 0 };
  const second = { type: 'on', x: 0, y: 1, currChain: 1, num: 0 };
  const release = { type: 'off', x: 0, y: 1, currChain: 1 };
  const legacy = [first, { type: 'chain', c: 1 }, { type: 'delay', delay: 1 }, second, release, { type: 'delay', delay: 199 }];
  const original = [first, { type: 'delay', delay: 1 }, { ...second, currChain: 0 }, { ...release, currChain: 0 }, { type: 'delay', delay: 99 }, { type: 'chain', c: 1 }, { type: 'delay', delay: 100 }];
  const custom = [{ type: 'delay', delay: 700 }, second, release];
  const saved = originalIsCurrent ? { current: legacy, backup: custom } : { current: custom, backup: legacy };
  await page.evaluate(saved => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('unipad'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('unipackMetadata', 'readwrite'), store = tx.objectStore('unipackMetadata');
      const request = store.getAll(); request.onsuccess = () => store.put({ ...request.result[0], autoPlay: saved });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), saved);
  await reopenPack(page);
  expect(await storedPack(page)).toEqual([{ ...imported, autoPlay: saved }]);
  await openMenu(page); await restore(page).click();
  await confirm(page, 'Confirm restoring the AutoPlay', 'Restore', 'Restored the previous AutoPlay.');
  expect(await storedPack(page)).toEqual([{ ...imported, autoPlay: {
    current: originalIsCurrent ? custom : original, backup: originalIsCurrent ? original : custom, timingVersion: 1,
  } }]);
  await info.attach('legacy-original-restored', { body: await page.screenshot(), contentType: 'image/png' });
  await reopenPack(page); await openMenu(page); await restore(page).click();
  await confirm(page, 'Confirm restoring the AutoPlay', 'Restore', 'Restored the previous AutoPlay.');
  expect(await storedPack(page)).toEqual([{ ...imported, autoPlay: {
    current: originalIsCurrent ? original : custom, backup: originalIsCurrent ? custom : original, timingVersion: 1,
  } }]);
});

interface StoredPack { zipSha256: string; autoPlay?: { current: unknown[]; backup: unknown[]; timingVersion?: 1 } }

/** The one stored pack: a digest of its archive and the autoPlay stored beside it. */
async function storedPack(page: Page): Promise<StoredPack[]> {
  return (await storedPackRecords(page)).map(({ zipData, autoPlay }) => ({
    zipSha256: createHash('sha256').update(new Uint8Array(zipData)).digest('hex'),
    ...(autoPlay ? { autoPlay } : {}),
  }));
}

async function importBasicPack(page: Page): Promise<StoredPack> {
  await page.goto('/play');
  await page.locator('input[data-unipack-import]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expectPads(page);
  await expectSavedPackCount(page, 1);
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
  // Retain a visible toast even if the click response or dialog exit arrives later.
  // Arm this before clicking, but give the action its own time before the usual assertion budget.
  const notice = await page.evaluateHandle(message => {
    const observation = { visible: false, disconnect: () => observer.disconnect() };
    const observer = new MutationObserver(() => {
      observation.visible = Array.from(document.querySelectorAll('*')).some(element => {
        if (element.textContent !== message || getComputedStyle(element).visibility !== 'visible') return false;
        if (Array.from(element.children).some(child => child.textContent === message)) return false;
        if (!element.checkVisibility()) return false;
        const { width, height } = element.getBoundingClientRect();
        return width > 0 && height > 0;
      });
      if (observation.visible) observer.disconnect();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    return observation;
  }, message);
  try {
    await dialog.getByRole('button', { name: action, exact: true }).click();
    await expect.poll(() => notice.evaluate(observation => observation.visible), {
      message: `completion notice was not visible: ${message}`,
    }).toBe(true);
    await expect(dialog).toHaveCount(0);
  } finally {
    // Preserve the action's failure if it already closed or crashed the page.
    await notice.evaluate(observation => observation.disconnect()).catch(() => undefined);
    await notice.dispose().catch(() => undefined);
  }
}

async function mapAndSave(page: Page, imported: StoredPack) {
  await autoMapping(page).click();
  await confirm(page, 'Confirm auto mapping', 'Map', 'Saved the AutoPlay. You can restore the previous one from the menu.');
  expect(await storedPack(page)).toEqual([{ zipSha256: imported.zipSha256, autoPlay: { current: MAPPED, backup: ORIGINAL, timingVersion: 1 } }]);
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
  expect(await storedPack(page)).toEqual([{ zipSha256: imported.zipSha256, autoPlay: { current: MAPPED, backup: ORIGINAL, timingVersion: 1 } }]);
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
  expect(await storedPack(page)).toEqual([{ zipSha256: imported.zipSha256, autoPlay: { current: ORIGINAL, backup: MAPPED, timingVersion: 1 } }]);
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

test('auto mapping saves and reopens a wormhole at its press-relative song time', async ({ page }, info) => {
  const zip = await JSZip.loadAsync(await readFile(resolve('e2e/fixtures/basic.uni')));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', 'chain=2'));
  const originalWav = await zip.file('sounds/tone.wav')!.async('nodebuffer');
  const samples = originalWav.subarray(44);
  const wav = Buffer.concat([originalWav.subarray(0, 44), ...Array.from({ length: 5 }, () => samples)]);
  wav.writeUInt32LE(wav.length - 8, 4); wav.writeUInt32LE(wav.length - 44, 40);
  zip.file('sounds/tone.wav', wav);
  zip.file('keySound', '1 1 1 tone.wav 1 2\n2 1 2 tone.wav');
  zip.file('autoPlay', 'd 1000\ntouch 1 1\nd 500\ntouch 1 2');
  await page.goto('/play');
  await page.locator('input[data-unipack-import]').setInputFiles({ name: 'mapped-wormhole.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page); await expectSavedPackCount(page, 1);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.5]);
  const imported = (await storedPack(page))[0];
  await openMenu(page); await autoMapping(page).click();
  await confirm(page, 'Confirm auto mapping', 'Map', 'Saved the AutoPlay. You can restore the previous one from the menu.');
  const saved = (await storedPack(page))[0];
  expect(saved.zipSha256).toBe(imported.zipSha256);
  const timeline = (elements: unknown[]) => {
    let time = 0;
    return (elements as { type: string; delay?: number; c?: number }[]).flatMap(e => {
      if (e.type === 'delay') { time += e.delay!; return []; }
      return [{ time, ...e }];
    });
  };
  expect(timeline(saved.autoPlay!.current).filter(e => e.type === 'chain')).toEqual([{ time: 1100, type: 'chain', c: 1 }]);
  expect(timeline(saved.autoPlay!.current).filter(e => e.type === 'on').map(e => e.time)).toEqual([1000, 1500]);
  await info.attach('mapped-wormhole-saved', { body: await page.screenshot(), contentType: 'image/png' });
  await page.reload(); await expectPads(page);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.5]);
  expect(await storedPack(page)).toEqual([saved]);
  await openMenu(page); await restore(page).click();
  await confirm(page, 'Confirm restoring the AutoPlay', 'Restore', 'Restored the previous AutoPlay.');
  expect((await storedPack(page))[0].autoPlay).toEqual({ current: saved.autoPlay!.backup, backup: saved.autoPlay!.current, timingVersion: 1 });
});

for (const length of [50, 800]) test(`mapped wormhole playback uses the actual chain after saving and reopening a ${length} ms sound`, async ({ page }, info) => {
  const zip = await JSZip.loadAsync(await readFile(resolve('e2e/fixtures/basic.uni')));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', 'chain=2'));
  const original = await zip.file('sounds/tone.wav')!.async('nodebuffer');
  const wav = (ms: number) => {
    const data = original.subarray(44);
    const size = Math.round(data.length * ms / 100);
    const buffer = Buffer.alloc(44 + size); original.copy(buffer, 0, 0, 44);
    for (let i = 0; i < size; i++) buffer[44 + i] = data[i % data.length];
    buffer.writeUInt32LE(buffer.length - 8, 4); buffer.writeUInt32LE(size, 40);
    return buffer;
  };
  zip.file('sounds/a.wav', wav(length)); zip.file('sounds/b.wav', wav(500));
  zip.remove('sounds/tone.wav');
  zip.file('keySound', '1 1 1 a.wav 1 2\n2 1 2 b.wav');
  zip.file('autoPlay', 'd 1000\ntouch 1 1\nd 500\ntouch 1 2\nd 500\ntouch 1 2');
  await page.goto('/play');
  await page.locator('input[data-unipack-import]').setInputFiles({ name: 'mapped-boundary.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page); await expectSavedPackCount(page, 1);
  const imported = (await storedPack(page))[0];
  await openMenu(page); await autoMapping(page).click();
  await confirm(page, 'Confirm auto mapping', 'Map', 'Saved the AutoPlay. You can restore the previous one from the menu.');
  const saved = (await storedPack(page))[0];
  expect(saved.zipSha256).toBe(imported.zipSha256);
  let time = 0;
  const timeline = (saved.autoPlay!.current as { type: string; delay?: number; currChain?: number; num?: number; c?: number }[]).flatMap(e => {
    if (e.type === 'delay') { time += e.delay!; return []; } return [{ time, ...e }];
  });
  await page.reload(); await expectPads(page);
  expect(await storedPack(page)).toEqual([saved]);
  const before = await page.evaluate(() => window.browserProbe.audio.starts.length);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  await expect.poll(() => page.evaluate(before => window.browserProbe.audio.starts.length - before, before)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Play mode: Auto', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await info.attach('mapped-boundary-replayed', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('mapped-boundary-events', { body: JSON.stringify({ timeline, audio: await page.evaluate(before => window.browserProbe.audio.starts.slice(before), before) }, null, 2), contentType: 'application/json' });
  expect(timeline.filter(e => e.type === 'on').map(e => [e.time, e.currChain, e.num])).toEqual([
    [1000, 0, 0], [1000 + length, length < 100 ? 0 : 1, 0], [1500 + length, 1, length < 100 ? 0 : 1],
  ]);
  expect(timeline.filter(e => e.type === 'chain').map(e => [e.time, e.c])).toEqual([[1100, 1]]);
  await expect.poll(() => page.evaluate(before => window.browserProbe.audio.starts.slice(before).map(s => s.duration), before), { timeout: 6500 })
    .toEqual(length < 100 ? [0.05, 0.5] : [0.8, 0.5, 0.5]);

});

test('mapping preserves consecutive explicit tail selections after saving and reopening', async ({ page }, info) => {
  const zip = await JSZip.loadAsync(await readFile(resolve('e2e/fixtures/basic.uni')));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', 'chain=3'));
  zip.file('keySound', '1 1 1 tone.wav 1 2');
  zip.file('autoPlay', 'd 1000\ntouch 1 1\nd 50\nc 2\nc 3');
  await page.goto('/play');
  await page.locator('input[data-unipack-import]').setInputFiles({ name: 'explicit-tail.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page); await expectSavedPackCount(page, 1);
  const imported = (await storedPack(page))[0];
  await openMenu(page); await autoMapping(page).click();
  await confirm(page, 'Confirm auto mapping', 'Map', 'Saved the AutoPlay. You can restore the previous one from the menu.');
  const saved = (await storedPack(page))[0];
  expect(saved.zipSha256).toBe(imported.zipSha256);
  expect(saved.autoPlay!.current.filter(e => (e as { type: string }).type === 'chain')).toEqual([{ type: 'chain', c: 1 }, { type: 'chain', c: 2 }]);
  await page.reload(); await expectPads(page);
  expect(await storedPack(page)).toEqual([saved]);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await info.attach('explicit-tail-replayed', { body: await page.screenshot(), contentType: 'image/png' });
});
