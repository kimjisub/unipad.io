import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, stateTimeout } from './browser';
import { connectStore } from './database';

// The store sorts by download count, most first.
const PACKS = ['First', 'Second', 'Third'].map((title, i) => ({
  code: `keyboard-${i}`,
  title,
  producerName: 'Browser Test',
  isAutoPlay: false,
  isLED: i === 1,
  downloadCount: 30 - i * 10,
  url: `https://unipad-browser-test.invalid/keyboard-${i}.zip`,
}));
const [first, second, third] = PACKS.map((pack) => pack.title);

const store = (page: Page) => page.getByRole('dialog');
const search = (page: Page) => store(page).getByRole('textbox');

async function openStore(page: Page, context: BrowserContext) {
  const database = await connectStore(context, PACKS.length, Object.fromEntries(PACKS.map((pack) => [pack.code, pack])));
  await page.goto('/play');
  await database.publish(PACKS.length);
  await page.getByRole('button', { name: /^Store/ }).first().click();
  await expect(store(page).getByRole('option')).toHaveCount(PACKS.length, { timeout: stateTimeout });
}

/** Records every pack download the store starts; each one fails at once, so none blocks the next. */
async function recordDownloads(page: Page) {
  const urls: string[] = [];
  await page.route('**/api/store/download?*', (route) => {
    urls.push(new URL(route.request().url()).searchParams.get('url') ?? '');
    return route.fulfill({ status: 404, body: 'Not Found' });
  });
  return urls;
}

const KEY_CODES: Record<string, number> = { Enter: 13, ArrowDown: 40 };

/**
 * Sends the keydown an input method sends with the key that finishes or moves inside a composed
 * syllable, carrying one of its two marks: `isComposing` (Chrome, Firefox) or only the legacy key
 * code 229 (Safari, which sends that Enter after the composition has ended).
 */
async function pressComposingKey(page: Page, key: string, mark: 'isComposing' | 'keyCode229') {
  await search(page).evaluate((input, { key, keyCode }) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: keyCode !== 229 });
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    input.dispatchEvent(event);
  }, { key, keyCode: mark === 'keyCode229' ? 229 : KEY_CODES[key] });
}

async function expectSelected(page: Page, title: string) {
  const selected = store(page).getByRole('listbox').locator('[aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAccessibleName(`${title} by Browser Test`);
}

test('up and down arrows move the store selection and wrap at the ends', async ({ page, context }, testInfo) => {
  await openStore(page, context);

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

  await expect(store(page).getByRole('heading', { level: 3 })).toHaveText(second);
  const screenshot = await page.screenshot({ path: testInfo.outputPath('store-arrow-selection.png'), animations: 'disabled' });
  await testInfo.attach('store-arrow-selection', { body: screenshot, contentType: 'image/png' });
});

test('Enter that finishes a composed Hangul syllable in the search field does not download', async ({ page, context }) => {
  const downloads = await recordDownloads(page);
  await openStore(page, context);
  await search(page).click();
  await expectSelected(page, first);

  await pressComposingKey(page, 'Enter', 'isComposing');
  await pressComposingKey(page, 'Enter', 'keyCode229');
  // Once a plain arrow has moved the selection, any download those keys started shows its Cancel or Retry button.
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, second);
  await expect(store(page).getByRole('button', { name: /^(Cancel|Retry)$/ })).toHaveCount(0);

  // Enter once the syllable is done still downloads the selected pack.
  await page.keyboard.press('Enter');
  await expect.poll(() => downloads).toEqual([PACKS[1].url]);
});

test('arrows inside a composed Hangul syllable in the search field do not move the selection', async ({ page, context }) => {
  await openStore(page, context);
  await search(page).click();
  await expectSelected(page, first);

  await pressComposingKey(page, 'ArrowDown', 'isComposing');
  await pressComposingKey(page, 'ArrowDown', 'keyCode229');
  // A plain arrow after them moves one step from where the selection started.
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, second);
});

test('Enter on a focused store button presses that button instead of downloading', async ({ page, context }) => {
  const downloads = await recordDownloads(page);
  await openStore(page, context);
  await expectSelected(page, first);

  await store(page).getByRole('button', { name: 'LED', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(store(page).getByRole('option')).toHaveCount(1);

  await store(page).getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(store(page)).toHaveCount(0);
  expect(downloads).toEqual([]);
});

/**
 * Chrome on macOS and Windows sends a Korean input method's Enter twice: once marked as composing,
 * then, after the composition has ended, as a plain Enter. Only the plain one acts, as Enter after
 * Latin text does, so finishing a syllable with Enter downloads the selected pack once.
 */
test('Chrome\'s plain Enter after a finished Hangul syllable downloads the selected pack once', async ({ page, context }) => {
  const downloads = await recordDownloads(page);
  await openStore(page, context);
  await search(page).click();
  await expectSelected(page, first);

  await search(page).evaluate((input) => {
    const keydown = (keyCode: number, isComposing: boolean) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing });
      Object.defineProperty(event, 'keyCode', { get: () => keyCode });
      input.dispatchEvent(event);
    };
    keydown(229, true);
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '\uC544' }));
    keydown(13, false);
  });
  await expect.poll(() => downloads).toEqual([PACKS[0].url]);
});

test('Enter after a mouse press on a row button downloads the pack picked afterwards', async ({ page, context }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { openedUrls: opened });
    window.open = (url) => {
      opened.push(String(url));
      return null;
    };
  });
  const downloads = await recordDownloads(page);
  await openStore(page, context);

  // Chrome leaves focus on a pressed button even though Tab never reaches the row buttons.
  await store(page).getByRole('option', { name: `${first} by Browser Test` }).getByRole('button', { name: 'YT' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { openedUrls: string[] }).openedUrls.length)).toBe(1);
  await page.keyboard.press('ArrowDown');
  await expectSelected(page, second);

  await page.keyboard.press('Enter');
  await expect.poll(() => downloads).toEqual([PACKS[1].url]);
  await expectSelected(page, second);
  expect(await page.evaluate(() => (window as unknown as { openedUrls: string[] }).openedUrls.length)).toBe(1);
});

test('the details panel shows the selected pack after fast arrow presses', async ({ page, context }) => {
  // Thirty rounds of key presses, each followed by a check of the panel.
  test.setTimeout(60_000);
  await openStore(page, context);
  await search(page).click();

  for (let round = 0; round < 30; round++) {
    for (let press = 0; press < 3 + (round % 7); press++) await page.keyboard.press(round % 2 ? 'ArrowUp' : 'ArrowDown');
    const selected = await store(page).getByRole('listbox').locator('[aria-selected="true"]').getAttribute('aria-label');
    await expect(store(page).getByRole('heading', { level: 3 }), `round ${round}`).toHaveText(selected!.replace(' by Browser Test', ''));
  }
});
