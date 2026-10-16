import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { test, expect } from './browser';

test('non-finite sound coordinates warn about format and the following sound still plays', async ({ page }, info) => {
  const huge = '9'.repeat(400);
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  zip.file('keySound', `1 ${huge} 1 tone.wav 0\n1 1 1 tone.wav 0`);
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({
    name: 'numeric-warning.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(`[1 ${huge} 1 tone.wav 0] format is incorrect`);
  await expect(dialog).toContainText('1 issue');
  await dialog.getByRole('button', { name: 'Show more', exact: true }).click();
  await info.attach('sound-number-warning', { body: await page.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.locator('[data-pad="0,0"]').hover();
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.mouse.up();
});
