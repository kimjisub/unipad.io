import { resolve } from 'node:path';
import { test, expect, expectPads } from './browser';
import { importSavedPack, savedRecords } from './saved-packs';

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
