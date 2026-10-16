import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect } from './browser';
import { pad } from './touch';

const litPads = (page: Page) => page.locator('[data-pad] div[style*="background-color"]');
const starts = (page: Page) => page.evaluate(() => window.browserProbe.audio.starts.length);

/** basic.uni with some of its files replaced. */
async function loadBasicWith(page: Page, files: Record<string, string | Uint8Array>) {
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  const date = new Date('2020-01-01T00:00:00Z');
  for (const [path, content] of Object.entries(files)) zip.file(path, content, { date });
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({
    name: 'pack.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect(page).toHaveTitle(/^Browser Test Pack \|/);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
}

async function pressAndHold(page: Page, position: string) {
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await pad(page, position).hover();
  await page.mouse.down();
}

/** What Windows Notepad writes for "Unicode" (little-endian) and "Unicode big endian". */
function utf16(text: string, order: 'le' | 'be'): Uint8Array {
  const le = Buffer.from(`\uFEFF${text}`, 'utf16le');
  return new Uint8Array(order === 'le' ? le : le.swap16());
}

for (const order of ['le', 'be'] as const) {
  test(`a keySound saved as UTF-16 ${order.toUpperCase()} with a byte order mark plays`, async ({ page }) => {
    await loadBasicWith(page, { keySound: utf16('1 1 1 tone.wav 0\r\n1 2 1 tone.wav 0\r\n', order) });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    await pressAndHold(page, '0,0');
    await expect.poll(() => starts(page)).toBe(1);
    await page.mouse.up();
  });
}

test('lights outside the pad grid open without warnings and light nothing', async ({ page }) => {
  await loadBasicWith(page, { 'keyLED/1 1 1 1': 'o 9 9 a 5\no 1 9 a 5\no 9 1 a 5\no 1 2 a 5\nd 5000\nf 9 9\nf 1 2' });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /warning/i })).toHaveCount(0);

  await pressAndHold(page, '0,0');
  await expect(pad(page, '0,1').locator('div[style*="background-color"]')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await expect(litPads(page)).toHaveCount(1);
  await page.mouse.up();
});
