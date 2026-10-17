import type { Page } from '@playwright/test';
import { test, expect } from './browser';
import { connectStore } from './database';

// The store sorts by download count, most first.
const PACKS = ['First', 'Second', 'Third'].map((title, i) => ({
  code: `keyboard-${i}`,
  title,
  producerName: 'Browser Test',
  isAutoPlay: false,
  isLED: false,
  downloadCount: 30 - i * 10,
  url: `https://unipad-browser-test.invalid/keyboard-${i}.zip`,
}));
const [first, second, third] = PACKS.map((pack) => pack.title);

const store = (page: Page) => page.getByRole('dialog');
const search = (page: Page) => store(page).getByRole('textbox');

async function expectSelected(page: Page, title: string) {
  const selected = store(page).getByRole('listbox').locator('[aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAccessibleName(`${title} by Browser Test`);
}

test('up and down arrows move the store selection and wrap at the ends', async ({ page, context }, testInfo) => {
  const database = await connectStore(context, PACKS.length, Object.fromEntries(PACKS.map((pack) => [pack.code, pack])));
  await page.goto('/play');
  await database.publish(PACKS.length);
  await page.getByRole('button', { name: /^Store/ }).first().click();
  await expect(store(page).getByRole('option')).toHaveCount(PACKS.length, { timeout: 15000 });

  // Arrows typed in the search field move the selection.
  await search(page).click();
  await expectSelected(page, first);
  await page.keyboard.press('ArrowUp');
  await expectSelected(page, third);
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, first);
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, second);
  await expect(search(page)).toBeFocused();

  // Home and End stay with the text caret in the search field.
  await page.keyboard.press('End');
  await expectSelected(page, second);
  await page.keyboard.press('Home');
  await expectSelected(page, second);

  // With the search field left, the arrows still move the selection.
  await page.keyboard.press('Escape');
  await expect(search(page)).not.toBeFocused();
  await expect(store(page)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, third);
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, first);
  await page.keyboard.press('ArrowUp');
  await expectSelected(page, third);
  await page.keyboard.press('ArrowUp');
  await expectSelected(page, second);

  // The details panel swaps in after the previous one leaves; picture it once it has settled.
  await expect(store(page).getByRole('heading', { level: 3 })).toHaveText(second);
  const screenshot = await page.screenshot({ path: testInfo.outputPath('store-arrow-selection.png'), animations: 'disabled' });
  await testInfo.attach('store-arrow-selection', { body: screenshot, contentType: 'image/png' });
});
