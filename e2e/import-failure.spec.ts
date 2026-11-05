import { open, mkdir, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, expectSavedPlaybackPack } from './browser';

const packInput = 'input[data-unipack-import]';
const themeInput = 'input[type=file][accept=".zip"]';
const fixture = path.resolve('e2e/fixtures/basic.uni');
const invalidMessage = 'This is not a UniPack (.zip, .uni) file.';
const themeMessage = 'This is not a theme (.zip) file.';
const readMessage = 'Could not read the file. Download it to your device, then choose it again.';

async function counts(page: Page) {
  return page.evaluate(() => new Promise<number[]>((resolve, reject) => {
    const request = indexedDB.open('unipad');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['unipacks', 'themes'], 'readonly');
      const packs = transaction.objectStore('unipacks').count();
      const themes = transaction.objectStore('themes').count();
      transaction.oncomplete = () => { resolve([packs.result, themes.result]); db.close(); };
    };
  }));
}

async function themeFile(name = 'Test theme') {
  const zip = new JSZip();
  zip.file('theme.json', JSON.stringify({ name, author: 'Test' }));
  zip.file('colors.json', JSON.stringify({ checkbox: '#ff0000' }));
  return { name: 'theme.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

async function themeSetting(page: Page) {
  return page.evaluate(() => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open('unipad');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('settings').objectStore('settings').get('lastThemeId');
      read.onsuccess = () => { resolve(read.result?.value ?? null); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }));
}

async function start(page: Page, kind: 'pack' | 'theme' = 'pack') {
  await page.goto('/play');
  await page.locator(packInput).setInputFiles(fixture);
  await expectSavedPlaybackPack(page);
  if (kind === 'theme') {
    await page.locator(themeInput).setInputFiles(await themeFile('Original theme'));
    await expect.poll(() => counts(page)).toEqual([1, 1]);
  }
}

async function retryImport(page: Page, kind: 'pack' | 'theme', before: number[]) {
  await page.locator(kind === 'pack' ? packInput : themeInput).setInputFiles(kind === 'pack' ? fixture : await themeFile('Next theme'));
  await expectSavedPlaybackPack(page);
  await expect.poll(() => counts(page)).toEqual([before[0] + (kind === 'pack' ? 1 : 0), before[1] + (kind === 'theme' ? 1 : 0)]);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

for (const kind of ['pack', 'theme'] as const) {
  test(`${kind}: a large non-archive preserves playback without reading the whole file`, async ({ page }, info) => {
    await start(page, kind);
    const originalTheme = await themeSetting(page);
    const before = await counts(page);
    const url = page.url();
    await page.locator('[data-pad="0,0"]').hover();
    await page.mouse.down();
    await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBeGreaterThan(0);
    const stops = await page.evaluate(() => window.browserProbe.audio.stops.length);
    await page.evaluate(() => {
      const original = Blob.prototype.arrayBuffer;
      const reads: number[] = [];
      Object.assign(window, { importReads: reads });
      Blob.prototype.arrayBuffer = function () { reads.push(this.size); return original.call(this); };
    });
    const folder = info.outputPath('input');
    await mkdir(folder, { recursive: true });
    const filename = path.join(folder, 'not-an-archive.zip');
    const file = await open(filename, 'w');
    await file.truncate(256 * 1024 * 1024);
    await file.close();
    try {
      await page.locator(kind === 'pack' ? packInput : themeInput).setInputFiles(filename);
      // Attach the actual screen even when the old implementation fails the assertions below.
      await expect(page.getByText(kind === 'pack' ? invalidMessage : themeMessage, { exact: true })).toBeVisible()
        .finally(() => capture(page, info, 'non-archive'));
      await expect(page.locator('[data-pad]')).toHaveCount(64);
      expect(page.url()).toBe(url);
      expect(await counts(page)).toEqual(before);
      expect(await themeSetting(page)).toBe(originalTheme);
      expect(await page.evaluate(() => window.browserProbe.audio.stops.length)).toBe(stops);
      expect(await page.evaluate(() => (window as unknown as { importReads: number[] }).importReads)).toEqual([66_000]);
      await page.mouse.up();
      await retryImport(page, kind, before);
    } finally { await file.close().catch(() => {}); await unlink(filename); }
  });

  for (const stage of ['tail', 'full'] as const) {
    test(`${kind}: a ${stage} read rejection is explained and the next import succeeds`, async ({ page }, info) => {
      await start(page, kind);
      const originalTheme = await themeSetting(page);
      const before = await counts(page);
      await page.evaluate(stage => {
        const original = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = function () {
          if (stage === 'tail' || this instanceof File) {
            Blob.prototype.arrayBuffer = original;
            return Promise.reject(new DOMException('The file is no longer readable', 'NotReadableError'));
          }
          return original.call(this);
        };
      }, stage);
      await page.locator(kind === 'pack' ? packInput : themeInput).setInputFiles(kind === 'pack' ? fixture : await themeFile());
      await expect(page.getByText(readMessage, { exact: true })).toBeVisible()
        .finally(() => capture(page, info, 'read-refused'));
      expect(await counts(page)).toEqual(before);
      expect(await themeSetting(page)).toBe(originalTheme);
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(page.locator('[data-pad]')).toHaveCount(kind === 'pack' && stage === 'full' ? 0 : 64);
      await retryImport(page, kind, before);
    });
  }
}

test('a pack with bytes before its archive still opens and is saved', async ({ page }) => {
  const bytes = Buffer.concat([Buffer.from('self-extracting prefix\n'), await readFile(fixture)]);
  await page.goto('/play');
  await page.locator(packInput).setInputFiles({ name: 'prefixed.uni', mimeType: 'application/zip', buffer: bytes });
  await expectSavedPlaybackPack(page);
  expect(await counts(page)).toEqual([1, 0]);
});

test('an incidental end signature still reaches the existing archive error dialog', async ({ page }) => {
  await start(page);
  const before = await counts(page);
  await page.locator(packInput).setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from([0x50, 0x4b, 0x05, 0x06]) });
  await expect(page.getByRole('alertdialog', { name: 'Error', exact: true })).toBeVisible();
  expect(await counts(page)).toEqual(before);
});

test('a theme archive imports after the tail check', async ({ page }) => {
  await start(page);
  const zip = new JSZip();
  zip.file('theme.json', JSON.stringify({ name: 'Test theme', author: 'Test' }));
  await page.locator(themeInput).setInputFiles({ name: 'theme.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expect.poll(() => counts(page)).toEqual([1, 1]);
});
