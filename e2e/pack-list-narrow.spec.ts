import type { Locator, Page } from '@playwright/test';
import { test, expect } from './browser';
import { importSavedPack } from './saved-packs';

const viewports = [[320, 568], [375, 667], [430, 932]] as const;
const widths = Array.from({ length: 12 }, (_, step) => 320 + step * 10);

const locales = [
  { locale: 'en-US', search: 'Search unipacks', ascending: 'Sort ascending', descending: 'Sort descending', theme: 'Theme', store: 'Store' },
  { locale: 'ko-KR', search: '유니팩 검색', ascending: '오름차순 정렬', descending: '내림차순 정렬', theme: '테마', store: '스토어' },
] as const;

const packTitle = 'Browser Test Pack';

/** Every control in the bar, in reading order. */
function bar(page: Page, text: (typeof locales)[number]) {
  return {
    sort: page.getByRole('button', { name: /^(Title|Producer|Date)$/ }),
    direction: page.getByRole('button', { name: new RegExp(`^(${text.ascending}|${text.descending})$`) }),
    search: page.getByRole('textbox', { name: text.search, exact: true }),
    theme: page.getByRole('button', { name: text.theme, exact: true }),
    // The empty list shows its own store button further down the page.
    store: page.getByRole('button', { name: new RegExp(`^${text.store}`) }).first(),
    import: page.getByRole('button', { name: '+ Import', exact: true }),
  };
}

function resize(page: Page, width: number, height: number) {
  return test.step(`${width}x${height}`, async () => {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width, height });
  });
}

/** A press at the centre of the control reaches it, the whole control is on screen and no two controls touch. */
async function expectAllReachable(controls: Locator[]) {
  const boxes = await Promise.all(controls.map(control => control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      name: element.getAttribute('aria-label') ?? element.textContent,
      left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      onScreen: box.left >= 0 && box.right <= document.documentElement.clientWidth && box.top >= 0 && box.bottom <= innerHeight,
      pressable: !!hit && element.contains(hit),
    };
  })));
  for (const [index, box] of boxes.entries()) {
    expect({ name: box.name, onScreen: box.onScreen, pressable: box.pressable }).toEqual({ name: box.name, onScreen: true, pressable: true });
    for (const other of boxes.slice(index + 1)) {
      const overlaps = box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom;
      expect(overlaps, `${box.name} overlaps ${other.name}`).toBe(false);
    }
  }
}

async function expectFileChooser(page: Page, control: Locator) {
  const chooser = page.waitForEvent('filechooser');
  await control.click();
  await chooser;
}

async function expectStoreOpens(page: Page, control: Locator) {
  await control.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

for (const text of locales) {
  test.describe(text.locale, () => {
    test.use({ locale: text.locale });

    test('every control works on a phone-width screen with no saved packs', async ({ page }) => {
      await page.goto('/play');
      const { theme, store, import: importButton } = bar(page, text);
      await expect(importButton).toBeVisible();
      for (const [width, height] of viewports) {
        await resize(page, width, height);
        await expectAllReachable([theme, store, importButton]);
        await expectFileChooser(page, theme);
        await expectStoreOpens(page, store);
        await expectFileChooser(page, importButton);
      }
    });

    test('every control works on a phone-width screen with a saved pack', async ({ page }) => {
      test.setTimeout(90_000);
      await importSavedPack(page, '/play');
      const controls = bar(page, text);
      const row = page.getByRole('option', { name: new RegExp(packTitle) });
      await expect(row).toBeVisible();
      for (const width of widths) {
        await resize(page, width, 844);
        await expectAllReachable(Object.values(controls));
        expect((await controls.search.boundingBox())!.width, 'search box width').toBeGreaterThanOrEqual(112);
      }
      for (const [width, height] of viewports) {
        await resize(page, width, height);
        await expect(row).toBeInViewport({ ratio: 0.99 });

        await controls.search.click();
        await page.keyboard.type('no such pack');
        await expect(controls.search).toHaveValue('no such pack');
        await expect(row).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(row).toBeVisible();

        await controls.sort.click();
        await page.getByRole('button', { name: 'Title', exact: true }).last().click();
        const direction = await controls.direction.getAttribute('aria-label');
        await controls.direction.click();
        await expect(controls.direction).not.toHaveAttribute('aria-label', direction!);
        await controls.sort.click();
        await page.getByRole('button', { name: 'Date', exact: true }).last().click();

        await expectFileChooser(page, controls.theme);
        await expectStoreOpens(page, controls.store);
        await expectFileChooser(page, controls.import);
      }
    });
  });
}

test('the search box stays usable at 320px with 200% text', async ({ page }) => {
  await importSavedPack(page, '/play');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const { search, ...buttons } = bar(page, locales[0]);
  await expectAllReachable([search, ...Object.values(buttons)]);
  expect((await search.boundingBox())!.width, 'search box width').toBeGreaterThanOrEqual(224);
});
