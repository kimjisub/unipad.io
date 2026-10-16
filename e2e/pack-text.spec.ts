import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect } from './browser';
import { pad } from './touch';

const litPads = (page: Page) => page.locator('[data-pad] div[style*="background-color"]');
/** The dark square practice draws over the pad to press next. */
const guide = (page: Page, position: string) => pad(page, position).locator('div[style*="background-color: rgba(0, 0, 0, 0.87)"]');
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

// Pad (1, 1) moves to chain 40 of a two-chain pack; the second autoPlay press is on chain 2.
test('step practice through a keySound move past the last chain plays to the end', async ({ page }) => {
  await loadBasicWith(page, {
    info: 'title=Browser Test Pack\nproducerName=UniPad Tests\nbuttonX=8\nbuttonY=8\nchain=2\nsquareButton=true',
    keySound: '1 1 1 tone.wav 1 40\n2 2 1 tone.wav 1\n',
    autoPlay: 'd 1000\no 1 1\nd 200\nf 1 1\nd 3000\no 2 1\nd 200\nf 2 1',
  });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('[1 1 1 tone.wav 1 40] wormhole is incorrect');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();

  const step = page.getByRole('button', { name: 'Play mode: Step', exact: true });
  await step.click();
  for (const [position, presses] of [['0,0', 1], ['1,0', 2]] as const) {
    await expect(guide(page, position)).toBeVisible();
    await pad(page, position).hover();
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => starts(page)).toBe(presses);
  }
  await expect(step).toHaveAttribute('aria-pressed', 'false');
});
