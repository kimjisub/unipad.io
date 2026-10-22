import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, expectPads } from './browser';

async function fixture(edit: (zip: JSZip) => Promise<void> | void) {
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  await edit(zip);
  return { name: 'compatibility.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

async function importPack(page: Page, file: Awaited<ReturnType<typeof fixture>>) {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(file);
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
    await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(await fixture(() => {}));
    await expectPads(page);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await capture(page, info, 'recovered');
  });
}

for (const website of ['unipad.io', 'javascript:alert(1)']) {
  test(`uses a safe absolute website link for ${website}`, async ({ page }, info) => {
    await importPack(page, await fixture(async zip => { zip.file('info', `${await zip.file('info')!.async('string')}\nwebsite=${website}`); }));
    await expectPads(page);
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle pack info', exact: true }).click();
    const link = page.getByRole('link', { name: 'Website', exact: true });
    if (website === 'unipad.io') await expect(link).toHaveAttribute('href', 'https://unipad.io');
    else await expect(link).toHaveCount(0);
    await capture(page, info, 'website');
  });
}
