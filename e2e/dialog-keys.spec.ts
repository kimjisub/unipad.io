import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, expectPads } from './browser';

// A dialog over the player owns the keyboard: Space (auto-play), pad keys, chain keys and the
// Alt shortcuts must not act behind it, wherever focus sits after a click on its title or text.

const messages = (locale: string) => JSON.parse(readFileSync(resolve(`src/i18n/messages/${locale}.json`), 'utf8')).play;
const probe = (page: Page) => page.evaluate(() => ({
  starts: window.browserProbe.audio.starts.length,
  stops: window.browserProbe.audio.stops.length,
  midi: window.browserProbe.midi.messages.length,
}));

async function load(page: Page, baseURL: string | undefined, locale: string, pack: string) {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve(pack));
  await expectPads(page);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.requests.length)).toBe(1);
}

/** Presses every kind of player key; none may play, light, switch chain or start auto-play. */
async function pressPlayerKeys(page: Page, chainButton?: string) {
  const before = await probe(page);
  for (const key of [' ', '1', 'q', 'Shift+KeyQ', 'F2', 'Alt+a', 'Alt+f', 'Alt+h']) await page.keyboard.press(key);
  await page.keyboard.down('1');
  // Cross auto-play's first note and the next LED frame.
  await page.waitForTimeout(600);
  await page.keyboard.up('1');
  expect(await probe(page)).toEqual(before);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  if (chainButton) await expect(page.getByRole('button', { name: chainButton, exact: true }).locator('div[style*="background-color"]')).toHaveCount(0);
}

for (const locale of ['en', 'ko']) for (const [width, height] of [[1440, 900], [844, 390]]) {
  test.describe(`${locale} ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });
    const t = messages(locale);
    const settingsButton = (page: Page) => page.getByRole('button', { name: t.player.launchpadSettings, exact: true });
    const settings = (page: Page) => page.getByRole('dialog', { name: t.launchpad.title, exact: true });

    test('player keys stay off behind Launchpad settings and its help, and return after closing', async ({ page, baseURL }) => {
      test.slow(); // Six 600 ms quiet windows and a 1.2 s LED wait: about 8 s idle, over 30 s on a busy machine.
      await load(page, baseURL, locale, 'e2e/fixtures/basic.uni');

      // A pad held while the settings open is released, not left sounding.
      const pressed = await page.evaluate(() => window.browserProbe.midi.messages.length);
      await page.keyboard.down('1');
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
      await settingsButton(page).click();
      await expect(settings(page)).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      await page.keyboard.up('1');
      // Its key LED animation runs on after the release and turns pad 0,1 off 1.2 s after the press;
      // wait for that note-off on the device so it is not counted as a key acting behind the dialog.
      await expect.poll(() => page.evaluate((from) => window.browserProbe.midi.messages.slice(from), pressed), { timeout: 5000 }).toContainEqual([0x80, 82, 0]);

      await settings(page).getByRole('heading', { name: t.launchpad.title }).click();
      await expect(page.locator('body')).toBeFocused();
      await pressPlayerKeys(page);
      await settings(page).getByText(t.launchpad.typeHint).click();
      await pressPlayerKeys(page);

      // The help keeps its own guard; title, model line and backdrop clicks stay inert too.
      await settings(page).getByRole('button', { name: t.launchpad.help.title, exact: true }).click();
      const help = page.getByRole('dialog', { name: t.launchpad.help.title, exact: true });
      await expect(help).toBeVisible();
      await help.getByRole('heading', { name: t.launchpad.help.title, exact: true }).click();
      await pressPlayerKeys(page);
      await help.getByText(t.launchpad.help.common).click();
      await pressPlayerKeys(page);
      await page.mouse.click(4, height - 4);
      await pressPlayerKeys(page);
      await page.keyboard.press('Escape');
      await expect(help).toHaveCount(0);
      await expect(settings(page).getByRole('button', { name: t.launchpad.help.title, exact: true })).toBeFocused();

      // Buttons in the settings still take Space; it closes the dialog without starting auto-play.
      const before = await probe(page);
      await settings(page).getByRole('button', { name: t.common.close, exact: true }).focus();
      await page.keyboard.press(' ');
      await expect(settings(page)).toHaveCount(0);
      await page.waitForTimeout(600);
      expect((await probe(page)).starts).toBe(before.starts);
      await expect(page.getByRole('progressbar')).toHaveCount(0);

      // Escape closes the reopened settings and the player keys work again.
      await settingsButton(page).click();
      await settings(page).getByRole('heading', { name: t.launchpad.title }).click();
      await page.keyboard.press('Escape');
      await expect(settings(page)).toHaveCount(0);
      const closed = await probe(page);
      await page.keyboard.press('1');
      await expect.poll(async () => (await probe(page)).starts).toBe(closed.starts + 1);
      await page.keyboard.press(' ');
      await expect(page.getByRole('progressbar')).toBeVisible();
    });

    test('chain keys stay off behind Launchpad settings and return after closing', async ({ page, baseURL }) => {
      await load(page, baseURL, locale, 'meta/unipack-conformance/chain-release-v1/packs/manual.uni');
      await settingsButton(page).click();
      await settings(page).getByRole('heading', { name: t.launchpad.title }).click();
      await pressPlayerKeys(page, 'Chain 10');
      await page.keyboard.press('Escape');
      await expect(settings(page)).toHaveCount(0);
      await page.keyboard.press('F2');
      await expect(page.getByRole('button', { name: 'Chain 10', exact: true }).locator('div[style*="background-color"]')).toHaveCount(1);
    });
  });
}
