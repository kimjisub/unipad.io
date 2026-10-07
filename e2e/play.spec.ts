import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './browser';

const pack = resolve('e2e/fixtures/basic.uni');
const pad = (page: Page, position: string) => page.locator(`[data-pad="${position}"]`);
const led = (page: Page, position: string) => pad(page, position).locator('div[style*="background-color"]');
const pressed = (page: Page, position: string) => pad(page, position).locator('img[src="/theme/btn_.png"]');
const starts = (page: Page) => page.evaluate(() => window.browserProbe.audio.starts.length);

async function loadPack(page: Page) {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(pack);
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect(page.getByRole('button', { name: 'Play mode: Auto', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page).toHaveTitle(/^Browser Test Pack \|/);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.requests)).toEqual([{ sysex: true }]);
}

test('imports a local pack and restores the saved pack after reload', async ({ page }) => {
  await loadPack(page);
  await expect(page).toHaveURL(/\/play\?pack=.+/);
  await expect.poll(() => starts(page)).toBe(0);
  await page.reload();
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  expect(await starts(page)).toBe(0);
});

test('pointer press/release plays/stops a loop and runs keyLed on another pad', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  expect(await page.evaluate(() => window.browserProbe.audio.starts[0])).toEqual({ id: 1, duration: 0.1, loop: true });
  await expect(led(page, '0,1')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await page.mouse.up();
  await expect(pressed(page, '0,0')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  await expect(led(page, '0,1')).toHaveCount(0);
});

test('keyboard down/up reaches the mapped pad and ignores repeated keydown', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.keyboard.down('q');
  await expect(pressed(page, '1,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  await expect(led(page, '1,1')).toHaveCSS('background-color', 'rgb(0, 206, 60)');
  await page.keyboard.down('q');
  expect(await starts(page)).toBe(1);
  await page.keyboard.up('q');
  await expect(pressed(page, '1,0')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
});

test('auto-play starts, pauses without advancing, resumes, and stops', async ({ page }) => {
  await loadPack(page);
  const auto = page.getByRole('button', { name: 'Play mode: Auto', exact: true });
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => starts(page)).toBe(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const progress = await page.getByRole('progressbar').getAttribute('aria-valuenow');
  // Cross the next note deadline: a paused/stopped runner must emit nothing.
  await page.waitForTimeout(3500);
  expect(await starts(page)).toBe(1);
  expect(await page.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(progress);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => starts(page)).toBe(2);
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  // Cross the next note deadline: a paused/stopped runner must emit nothing.
  await page.waitForTimeout(3500);
  expect(await starts(page)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 2]);
});

test('Web MIDI discovers devices, receives notes, emits LED bytes and disconnects', async ({ page }) => {
  test.slow(); // Pack import plus repeated connection changes can exhaust a short test's setup budget.
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x0e, 1, 0xf7]);
  await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
  await expect(dialog).toContainText('Input: Launchpad X Test Input');
  await expect(dialog).toContainText('Output: Launchpad X Test Output');
  await expect(dialog).toContainText('Resolved Type: launchpad_x');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; window.browserProbe.midi.emit([0x90, 81, 127]); });
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  await expect(led(page, '0,1')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0x90, 82, 5]);
  await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
  await expect(pressed(page, '0,0')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0x80, 82, 0]);
  await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(dialog).toContainText('Disconnected');
  await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.requests.length)).toBe(2);
});

// Android 4.1.7 drew the pads off-centre (unipad-android#75); the web centred them in the space
// right of the menu, 61 px right of the screen's centre line on every landscape screen, and with
// the menu hidden it centred the pads together with the chain column, half a column to the left,
// and drew them at zero size, then at fractional sizes with seams between them.
const padGrid = (page: Page) => page.evaluate(() => {
  const pads = [...document.querySelectorAll('[data-pad]')].map(pad => pad.getBoundingClientRect());
  const left = Math.min(...pads.map(pad => pad.left));
  const right = Math.max(...pads.map(pad => pad.right));
  const top = Math.min(...pads.map(pad => pad.top));
  const bottom = Math.max(...pads.map(pad => pad.bottom));
  return {
    offCentre: Math.abs((left + right) / 2 - window.innerWidth / 2),
    heightShare: (bottom - top) / window.innerHeight,
    // Pads of a fractional width leave thin seams between neighbours.
    wholePixelPads: pads.every(pad => Number.isInteger(pad.width) && Number.isInteger(pad.height)),
  };
});

for (const [name, file] of [
  ['without a chain column', pack],
  ['with a chain column', resolve('meta/unipack-conformance/chain-release-v1/packs/manual.uni')],
]) {
  test(`pad grid sits on the screen centre line in landscape, ${name}`, async ({ page }) => {
    await page.goto('/play');
    await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(file);
    await expect(page.locator('[data-pad]')).toHaveCount(64);
    for (const hideUI of [false, true]) {
      if (hideUI) await page.keyboard.press('Alt+h');
      await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toHaveCount(hideUI ? 0 : 1);
      for (const [width, height] of [[915, 402], [844, 390], [1280, 720], [1920, 1080]]) {
        await page.setViewportSize({ width, height });
        const screen = `${width}x${height}${hideUI ? ' menu hidden' : ''}`;
        await expect.poll(async () => (await padGrid(page)).offCentre, screen).toBeLessThanOrEqual(1);
        await expect.poll(async () => (await padGrid(page)).heightShare, screen).toBeGreaterThan(0.8);
        await expect.poll(async () => (await padGrid(page)).wholePixelPads, screen).toBe(true);
      }
    }
  });
}
