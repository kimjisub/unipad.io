import { resolve } from 'node:path';
import { test, expect, expectPads } from './browser';
import { importSavedPack, savedRecords } from './saved-packs';
import { reachable, resize } from './layout';

for (const name of ['Play', 'Delete UniPack']) {
  test(`switching packs with arrow keys preserves focus on ${name}`, async ({ page }, testInfo) => {
    await importSavedPack(page, '/play');
    await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('meta/unipack-conformance/chain-release-v1/packs/manual.uni'));
    await expectPads(page);
    await expect.poll(async () => (await savedRecords(page)).length).toBe(2);
    await page.goto('/play');
    await expect(page.getByRole('option', { name: 'Chain Release v1 manual by UniPad Tests', exact: true })).toHaveAttribute('aria-selected', 'true');
    const button = page.getByRole('button', { name, exact: true });
    await button.focus();
    await expect(button).toBeFocused();
    for (const [key, selected] of [['ArrowDown', 'Browser Test Pack by UniPad Tests'], ['ArrowUp', 'Chain Release v1 manual by UniPad Tests']]) {
      await page.keyboard.press(key);
      await expect(page.getByRole('option', { name: selected, exact: true })).toHaveAttribute('aria-selected', 'true');
      await testInfo.attach(`focus-after-${key}`, {
        body: JSON.stringify(await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          label: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 80),
        }))),
        contentType: 'application/json',
      });
      await testInfo.attach(`screen-after-${key}`, { body: await page.screenshot(), contentType: 'image/png' });
      await expect(button).toBeFocused();
    }
  });
}

test.describe('focused details on a short landscape screen', () => {
  test.use({ reducedMotion: 'reduce' });

  test('switching packs keeps the tabbed YouTube link visible at 640x360', async ({ page, browserName }, testInfo) => {
    await importSavedPack(page, '/play');
    await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('meta/unipack-conformance/chain-release-v1/packs/manual.uni'));
    await expectPads(page);
    await expect.poll(async () => (await savedRecords(page)).length).toBe(2);
    await page.goto('/play');
    await resize(page, { width: 640, height: 360 });
    const link = page.getByRole('link', { name: 'Search on YouTube', exact: true });
    const play = page.getByRole('button', { name: 'Play', exact: true });
    const details = page.locator('div.overflow-y-auto').filter({ has: play });
    await play.focus();
    // WebKit includes links in keyboard navigation with Alt+Tab on macOS.
    const tabKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (let tab = 0; tab < 3; tab++) await page.keyboard.press(tabKey);
    await expect(link).toBeFocused();
    expect(await reachable(link)).toEqual({ inside: true, pressable: true });
    await testInfo.attach('tabbed-link', { body: await page.screenshot(), contentType: 'image/png' });

    for (const [key, selected] of [['ArrowDown', 'Browser Test Pack by UniPad Tests'], ['ArrowUp', 'Chain Release v1 manual by UniPad Tests']]) {
      await page.keyboard.press(key);
      await expect(page.getByRole('option', { name: selected, exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(link).toBeFocused();
      const geometry = await details.evaluate(panel => {
        const panelBox = panel.getBoundingClientRect();
        const focusedBox = document.activeElement!.getBoundingClientRect();
        return { panelTop: panelBox.top, panelBottom: panelBox.bottom, focusedTop: focusedBox.top, focusedBottom: focusedBox.bottom };
      });
      await testInfo.attach(`link-after-${key}`, { body: JSON.stringify(geometry), contentType: 'application/json' });
      await testInfo.attach(`screen-after-${key}`, { body: await page.screenshot(), contentType: 'image/png' });
      expect(geometry.focusedTop).toBeGreaterThanOrEqual(geometry.panelTop);
      expect(geometry.focusedBottom).toBeLessThanOrEqual(geometry.panelBottom);
      expect(await reachable(link)).toEqual({ inside: true, pressable: true });
    }
  });
});
