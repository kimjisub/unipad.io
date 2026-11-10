import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, expectSavedPlaybackPack } from './browser';

const packInput = 'input[data-unipack-import]';
const fixture = path.resolve('e2e/fixtures/basic.uni');
const invalidMessage = 'This is not a UniPack (.zip, .uni) file.';
const invalidFile = { name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('not an archive') };

async function showInvalidImportNotice(page: Page) {
  await page.locator(packInput).setInputFiles(invalidFile);
  const notice = page.getByText(invalidMessage, { exact: true });
  await expect(notice).toBeVisible();
  return notice;
}

async function expectCentered(page: Page, notice: ReturnType<Page['getByText']>) {
  const width = page.viewportSize()!.width;
  // Poll through the entrance animation; its scale keeps the centre where it is. Subpixel
  // layout may leave the centre up to a pixel away; the broken placement was ~100 px off.
  await expect.poll(async () => {
    const box = await notice.boundingBox();
    if (!box) return null;
    return {
      centred: Math.abs(box.x + box.width / 2 - width / 2) <= 1,
      inside: box.x >= 0 && box.x + box.width <= width,
    };
  }).toEqual({ centred: true, inside: true });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 1366 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('the bottom notice is centred on the main screen', async ({ page }) => {
      await page.goto('/play');
      await expectCentered(page, await showInvalidImportNotice(page));
    });

    test('the bottom notice is centred over a playing pack', async ({ page }) => {
      await page.goto('/play');
      await page.locator(packInput).setInputFiles(fixture);
      await expectSavedPlaybackPack(page);
      await expectCentered(page, await showInvalidImportNotice(page));
    });
  });
}
