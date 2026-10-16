import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './browser';

// Sources in start order: 1 the player's endless loop (pad 1,0 held with Q), 2 autoPlay's endless
// loop (pad 0,0), 3 autoPlay's sound repeated three times (pad 2,0), whose end is scheduled as it starts.
const PLAYER_LOOP = 1;
const AUTO_LOOP = 2;
const AUTO_REPEAT = 3;

const audio = (page: Page) => page.evaluate(() => window.browserProbe.audio);
const mode = (page: Page, name: string) => page.getByRole('button', { name: `Play mode: ${name}`, exact: true });

async function holdPlayerLoopAndStartAutoPlay(page: Page) {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/autoplay-hold.uni'));
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).decoded).toEqual([0.1]);
  await page.keyboard.down('q');
  await expect.poll(async () => (await audio(page)).starts.length).toBe(1);
  await mode(page, 'Auto').click();
  await expect.poll(async () => (await audio(page)).starts.map((s) => s.loop)).toEqual([true, true, true]);
  expect((await audio(page)).stops).toEqual([AUTO_REPEAT]);
}

test('turning autoPlay off stops the loop it held and keeps the one the player holds', async ({ page }) => {
  await holdPlayerLoopAndStartAutoPlay(page);
  await mode(page, 'Auto').click();
  await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await audio(page)).stops).toEqual([AUTO_REPEAT, AUTO_LOOP]);
  await page.waitForTimeout(500);
  expect((await audio(page)).stops).toEqual([AUTO_REPEAT, AUTO_LOOP]);
  await page.keyboard.up('q');
  await expect.poll(async () => (await audio(page)).stops).toEqual([AUTO_REPEAT, AUTO_LOOP, PLAYER_LOOP]);
});

test('switching from autoPlay to guide stops the loop autoPlay held and keeps the player\'s', async ({ page }) => {
  await holdPlayerLoopAndStartAutoPlay(page);
  await mode(page, 'Guide').click();
  await expect(mode(page, 'Guide')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await audio(page)).stops).toEqual([AUTO_REPEAT, AUTO_LOOP]);
  await page.waitForTimeout(500);
  expect((await audio(page)).stops).toEqual([AUTO_REPEAT, AUTO_LOOP]);
  await page.keyboard.up('q');
  await expect.poll(async () => (await audio(page)).stops).toEqual([AUTO_REPEAT, AUTO_LOOP, PLAYER_LOOP]);
});

// A controller that goes away sends no release for the pads it held; the play screen releases them
// itself, or autoPlay's endless loop on such a pad would outlive autoPlay.
const controllerGoesAway: Record<string, (page: Page) => Promise<void>> = {
  'is disconnected': async (page) => {
    await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
    await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(dialog).toContainText('Disconnected');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  },
  'is unplugged': page => page.evaluate(() => window.browserProbe.midi.unplug()),
  // The fourth top-row button opens the option panel, which takes the launchpad's pads, and closes it.
  'opens its option panel': async (page) => {
    const panel = page.getByRole('dialog', { name: 'Menu', exact: true });
    await page.evaluate(() => window.browserProbe.midi.emit([0xb0, 94, 127]));
    await expect(panel).toBeVisible();
    await page.evaluate(() => window.browserProbe.midi.emit([0xb0, 94, 127]));
    await expect(panel).toHaveCount(0);
  },
};

for (const [name, goAway] of Object.entries(controllerGoesAway)) {
  test(`a pad held on a controller that ${name} no longer keeps autoPlay's loop there`, async ({ page }) => {
    await page.goto('/play');
    test.skip(!await page.evaluate(() => window.browserProbe.midi.supported), 'Not applicable: this browser has no native Web MIDI API');
    await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/autoplay-hold.uni'));
    await expect(page.locator('[data-pad]')).toHaveCount(64);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x0e, 1, 0xf7]);
    // Pad 0,0, the one autoPlay presses with an endless loop.
    await page.evaluate(() => window.browserProbe.midi.emit([0x90, 81, 127]));
    await expect.poll(async () => (await audio(page)).starts.length).toBe(1);
    await goAway(page);
    await expect.poll(async () => (await audio(page)).stops).toEqual([1]);
    await mode(page, 'Auto').click();
    await expect.poll(async () => (await audio(page)).starts.length).toBe(3);
    await mode(page, 'Auto').click();
    await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await audio(page)).stops).toEqual([1, 3, 2]);
  });
}
