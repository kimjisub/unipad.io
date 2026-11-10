import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, expectSavedPlaybackPack } from './browser';
import { openBasicWith } from './basic-pack';

const packInput = 'input[data-unipack-import]';
const fixture = path.resolve('e2e/fixtures/basic.uni');
const invalidMessage = 'This is not a UniPack (.zip, .uni) file.';
const playMessages = (locale: string) => JSON.parse(readFileSync(path.resolve(`src/i18n/messages/${locale}.json`), 'utf8')).play;
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

// The menu is a sheet on the right edge whose last row is Quit; a notice raised from the menu
// (here: MIDI unsupported) stays in the space left of it so Quit stays visible and pressable.
for (const locale of ['en', 'ko']) for (const viewport of [{ width: 820, height: 1180 }, { width: 844, height: 390 }]) {
  test(`${locale} ${viewport.width}x${viewport.height}: a notice raised from the menu leaves Quit uncovered`, async ({ page, baseURL }, info) => {
    const t = playMessages(locale);
    await page.setViewportSize(viewport);
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
    await page.goto('/play');
    await page.evaluate(() => {
      delete (navigator as Partial<Navigator>).requestMIDIAccess;
      delete (Navigator.prototype as Partial<Navigator>).requestMIDIAccess;
      window.browserProbe.midi.supported = false;
    });
    await page.locator(packInput).setInputFiles(fixture);
    await expectSavedPlaybackPack(page);

    await page.getByRole('button', { name: t.control.openMenu, exact: true }).click();
    const menu = page.getByRole('dialog', { name: t.menu.ariaLabel, exact: true });
    await menu.getByRole('button', { name: t.menu.midiConnect, exact: true }).click();
    const notice = page.getByText(t.toast.midiUnsupported, { exact: true });
    await expect(notice).toBeVisible();
    const quit = menu.getByRole('button', { name: t.menu.quit, exact: true });

    await expect.poll(async () => {
      const [box, quitBox, menuBox] = await Promise.all([notice.boundingBox(), quit.boundingBox(), menu.boundingBox()]);
      if (!box || !quitBox || !menuBox) return null;
      return {
        clearOfQuit: box.x + box.width <= quitBox.x || box.y + box.height <= quitBox.y || box.y >= quitBox.y + quitBox.height,
        clearOfMenu: box.x + box.width <= menuBox.x,
        centredBesideMenu: Math.abs(box.x + box.width / 2 - menuBox.x / 2) <= 1,
        onScreen: box.x >= 0,
      };
    }).toEqual({ clearOfQuit: true, clearOfMenu: true, centredBesideMenu: true, onScreen: true });
    await info.attach('notice-beside-menu', { body: await page.screenshot(), contentType: 'image/png' });
    // The icon side of Quit is the part the notice used to cover.
    await quit.click({ position: { x: 34, y: 20 }, trial: true });
  });
}

// The notice has nothing to press: while it is shown, the pads under it still play.
const everyPadSounds = Array.from({ length: 64 }, (_, i) => `1 ${Math.floor(i / 8) + 1} ${(i % 8) + 1} tone.wav 0`).join('\n');
for (const viewport of [{ width: 1280, height: 800 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}x${viewport.height}: a pad under the bottom notice still plays`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openBasicWith(page, { keySound: everyPadSounds });
    await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
    const notice = await showInvalidImportNotice(page);

    // The middle of the overlap between the notice and a pad it covers, once the entrance settles.
    let point: { x: number; y: number } | null = null;
    await expect.poll(async () => {
      const box = await notice.boundingBox();
      point = !box ? null : await page.evaluate(box => {
        for (const pad of document.querySelectorAll('[data-pad]')) {
          const rect = pad.getBoundingClientRect();
          const left = Math.max(rect.left, box.x), right = Math.min(rect.right, box.x + box.width);
          const top = Math.max(rect.top, box.y), bottom = Math.min(rect.bottom, box.y + box.height);
          if (right - left >= 4 && bottom - top >= 4) return { x: (left + right) / 2, y: (top + bottom) / 2 };
        }
        return null;
      }, box);
      return point;
    }, { message: 'the notice covers a pad at this size' }).not.toBeNull();

    await page.mouse.move(point!.x, point!.y);
    await page.mouse.down();
    await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
    await page.mouse.up();
    await expect(notice).toBeVisible();
  });
}
