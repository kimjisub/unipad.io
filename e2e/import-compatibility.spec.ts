import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, expectPads } from './browser';
import { expectSavedPackCount, storedPackRecords } from './saved-packs';

async function fixture(edit: (zip: JSZip) => Promise<void> | void) {
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  await edit(zip);
  return { name: 'compatibility.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

async function importPack(page: Page, file: Awaited<ReturnType<typeof fixture>>) {
  await page.goto('/play');
  await page.locator('input[data-unipack-import]').setInputFiles(file);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await info.attach(`${name}-screen`, { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach(`${name}-audio-requests`, { body: JSON.stringify(await page.evaluate(() => window.browserProbe.audio)), contentType: 'application/json' });
}

test('canonically equivalent sound names import without warnings and play', async ({ page }, info) => {
  const file = await fixture(async zip => {
    const sound = Object.values(zip.files).find(f => f.name.startsWith('sounds/') && !f.dir)!;
    const data = await sound.async('uint8array');
    const mapping = await zip.file('keySound')!.async('string');
    zip.remove(sound.name);
    zip.file(`sounds/${'소리.wav'.normalize('NFD')}`, data);
    zip.file('keySound', mapping.replaceAll(sound.name.slice('sounds/'.length), '소리.wav'));
  });
  await importPack(page, file);
  await expectPads(page);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.locator('[data-pad="0,0"]').click();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await capture(page, info, 'played');
});

test('Windows archive separators preserve sounds and lights', async ({ page }, info) => {
  const file = await fixture(async zip => {
    const entries = await Promise.all(Object.values(zip.files).filter(f => !f.dir).map(async f => [f.name, await f.async('uint8array')] as const));
    for (const name of Object.keys(zip.files)) zip.remove(name);
    for (const [name, data] of entries) zip.file(`Pack\\${name.replaceAll('/', '\\')}`, data);
  });
  await importPack(page, file);
  await expectPads(page);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.locator('[data-pad="0,0"]').hover();
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await expect(page.locator('[data-pad="0,1"] div[style*="background-color"]')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await capture(page, info, 'playing');
  await page.mouse.up();
});

test('a root pack opens instead of an earlier backup', async ({ page }, info) => {
  const file = await fixture(async zip => {
    const original = await zip.file('info')!.async('string');
    zip.remove('info');
    zip.file('backup/info', original.replace('Browser Test Pack', 'Backup'));
    zip.file('backup/keySound', '');
    zip.file('info', original);
  });
  await importPack(page, file);
  await expectPads(page);
  await expect(page).toHaveTitle(/^Browser Test Pack \|/);
  await capture(page, info, 'root-pack');
});

for (const [name, edit, reason] of [
  ['multiple packs', async (zip: JSZip) => {
    const original = await zip.file('info')!.async('string');
    zip.remove('info'); zip.remove('keySound');
    for (const prefix of ['A', 'B']) { zip.file(`${prefix}/info`, original); zip.file(`${prefix}/keySound`, ''); }
  }, /multiple packs/i],
  ['missing grid size', async (zip: JSZip) => zip.file('info', (await zip.file('info')!.async('string')).replace(/^buttonX=.*\n/m, '')), /buttonX.*missing/],
  ['invalid chain count', async (zip: JSZip) => zip.file('info', (await zip.file('info')!.async('string')).replace(/chain=\d+/, 'chain=25')), /chain out of range/],
] as const) {
  test(`explains why it refuses ${name}`, async ({ page }, info) => {
    await importPack(page, await fixture(async zip => { await edit(zip); }));
    await expect(page.getByRole('alertdialog', { name: 'Error', exact: true })).toContainText(reason);
    await expect(page.locator('[data-pad]')).toHaveCount(0);
    await capture(page, info, 'refused');
    await page.getByRole('button', { name: 'Quit', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText('No UniPacks installed', { exact: true })).toBeVisible();
    await page.locator('input[data-unipack-import]').setInputFiles(await fixture(() => {}));
    await expectPads(page);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await capture(page, info, 'recovered');
  });
}

for (const [website, href] of [['unipad.io', 'https://unipad.io/'], ['https:unipad.io', 'https://unipad.io/'], ['javascript:alert(1)', null]] as const) {
  test(`uses a safe absolute website link for ${website}`, async ({ page }, info) => {
    await importPack(page, await fixture(async zip => { zip.file('info', `${await zip.file('info')!.async('string')}\nwebsite=${website}`); }));
    await expectPads(page);
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle pack info', exact: true }).click();
    const link = page.getByRole('link', { name: 'Website', exact: true });
    if (href) await expect(link).toHaveAttribute('href', href);
    else await expect(link).toHaveCount(0);
    await capture(page, info, 'website');
  });
}

// setInputFiles checks import processing; the native iPadOS picker needs a device check.
for (const entry of ['library', 'player'] as const) {
  for (const extension of ['uni', 'zip']) {
    test(`imports .${extension} from the ${entry} and reopens its saved bytes`, async ({ page }, info) => {
      const buffer = await readFile('e2e/fixtures/basic.uni');
      await page.goto('/play');
      if (entry === 'player') {
        await page.locator('input[data-unipack-import]').setInputFiles({ name: 'initial.uni', mimeType: 'application/octet-stream', buffer });
        await expectPads(page);
        await expectSavedPackCount(page, 1);
      }
      await page.locator('input[data-unipack-import]').setInputFiles({ name: `browser-basic.${extension}`, mimeType: 'application/octet-stream', buffer });
      await expectPads(page);
      await expectSavedPackCount(page, entry === 'player' ? 2 : 1);
      await expect(page).toHaveURL(/\/play\?pack=.+/);
      const saved = await storedPackRecords(page);
      expect(saved.every(record => Buffer.from(record.zipData).equals(buffer))).toBe(true);
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.getByRole('button', { name: 'Quit', exact: true }).click();
      await page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option').first().dblclick();
      await expectPads(page);
      await page.reload();
      await expectPads(page);
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await capture(page, info, 'reopened');
    });
  }

  test(`a non-archive from the ${entry} is not saved and the next valid import works`, async ({ page }, info) => {
    const buffer = await readFile('e2e/fixtures/basic.uni');
    await page.goto('/play');
    if (entry === 'player') {
      await page.locator('input[data-unipack-import]').setInputFiles({ name: 'initial.uni', mimeType: 'application/octet-stream', buffer });
      await expectPads(page);
      await expectSavedPackCount(page, 1);
    }
    const before = await storedPackRecords(page);
    await page.locator('input[data-unipack-import]').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('This is not a UniPack archive.') });
    await expect(page.getByRole('alertdialog', { name: 'Error', exact: true })).toBeVisible();
    await expect(page.locator('[data-pad]')).toHaveCount(0);
    expect((await storedPackRecords(page)).map(record => record.id)).toEqual(before.map(record => record.id));
    await capture(page, info, 'non-archive-refused');
    await page.getByRole('button', { name: 'Quit', exact: true }).click();
    await page.locator('input[data-unipack-import]').setInputFiles({ name: 'browser-basic.uni', mimeType: 'application/octet-stream', buffer });
    await expectPads(page);
    await expectSavedPackCount(page, before.length + 1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await capture(page, info, 'next-import-recovered');
  });
}
