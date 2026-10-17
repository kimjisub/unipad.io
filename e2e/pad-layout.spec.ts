import { resolve } from 'node:path';
import { test, expect, expectPads } from './browser';
import { expectLandscapePads, padGrid } from './pad-layout';

test('landscape checks wait for the resized pads even when the old grid is centred', async ({ page }, info) => {
  // Hold real resize notifications after the large layout is ready, then deliver them unchanged.
  await page.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    let hold = false;
    const pending: (() => void)[] = [];
    window.addEventListener('hold-pad-resize', () => { hold = true; });
    window.addEventListener('release-pad-resize', () => {
      hold = false;
      pending.splice(0).forEach(deliver => deliver());
    });
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const deliver = () => callback(entries, observer);
          if (hold) pending.push(deliver);
          else deliver();
        });
      }
    };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
  await expectPads(page);
  await page.keyboard.press('Alt+h');
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await padGrid(page)).heightShare).toBeGreaterThan(0.8);
  await page.evaluate(() => window.dispatchEvent(new Event('hold-pad-resize')));
  await page.setViewportSize({ width: 915, height: 402 });
  const before = await padGrid(page);
  expect(before.offCentre).toBeLessThanOrEqual(1);
  expect(before.heightShare).toBeGreaterThan(1);
  expect(before.wholePixelPads).toBe(true);
  await info.attach('before-resize-delivery', { body: await page.screenshot(), contentType: 'image/png' });
  let settled = false;
  const check = expectLandscapePads(page, '915x402 menu hidden').then(() => { settled = true; });
  // Deliberately keep notifications pending while the assertion has time to sample the old layout.
  await page.waitForTimeout(300);
  const acceptedStaleGrid = settled;
  await page.evaluate(() => window.dispatchEvent(new Event('release-pad-resize')));
  await check;
  const after = await padGrid(page);
  await info.attach('after-resize-delivery', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('resize-measurements', { body: JSON.stringify({ before, after, acceptedStaleGrid }), contentType: 'application/json' });
  expect(acceptedStaleGrid, 'an oversized old grid must not satisfy the layout check').toBe(false);
  expect(after.heightShare).toBeLessThanOrEqual(1);
});
