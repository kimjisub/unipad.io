import type { BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from './browser';
import { connectStore } from './database';
import { reachable, resize } from './layout';
import { importSavedPack } from './saved-packs';

const viewports = [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 430, height: 932 }];
// Phone widths, then the wider ones where the store number and the language decide when the buttons wrap.
const widths = [
  ...Array.from({ length: 12 }, (_, step) => 320 + step * 10),
  ...Array.from({ length: 11 }, (_, step) => 440 + step * 20),
];

const locales = [
  { locale: 'en-US', search: 'Search unipacks', ascending: 'Sort ascending', descending: 'Sort descending', theme: 'Theme', store: 'Store' },
  { locale: 'ko-KR', search: '유니팩 검색', ascending: '오름차순 정렬', descending: '내림차순 정렬', theme: '테마', store: '스토어' },
] as const;

const packTitle = 'Browser Test Pack';
// Live visitors see this number on the store button, which makes the button row wider.
const storeCount = 128;

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

/** The store answers with a count, as it does for a visitor; a build without a database stops here. */
async function showStoreCount(page: Page, context: BrowserContext, text: (typeof locales)[number], open: () => Promise<void>) {
  const database = await connectStore(context, storeCount);
  await open();
  await database.publish(storeCount);
  await expect(bar(page, text).store).toContainText(String(storeCount));
}

/** The whole control is on screen, a press at its centre reaches it and no two controls touch. */
async function expectAllReachable(controls: Partial<ReturnType<typeof bar>>) {
  const named = Object.entries(controls);
  const [states, boxes] = await Promise.all([
    Promise.all(named.map(([, control]) => reachable(control))),
    Promise.all(named.map(([, control]) => control.boundingBox())),
  ]);
  for (const [index, [name]] of named.entries()) {
    expect(states[index], name).toEqual({ inside: true, pressable: true });
    const box = boxes[index]!;
    for (const [otherIndex, [otherName]] of named.entries()) {
      if (otherIndex <= index) continue;
      const other = boxes[otherIndex]!;
      const overlaps = box.x < other.x + other.width && other.x < box.x + box.width
        && box.y < other.y + other.height && other.y < box.y + box.height;
      expect(overlaps, `${name} overlaps ${otherName}`).toBe(false);
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

    test('every control works on a phone-width screen with no saved packs', async ({ page, context }) => {
      await showStoreCount(page, context, text, async () => { await page.goto('/play'); });
      const { theme, store, import: importButton } = bar(page, text);
      for (const viewport of viewports) {
        await resize(page, viewport);
        await expectAllReachable({ theme, store, import: importButton });
        await expectFileChooser(page, theme);
        await expectStoreOpens(page, store);
        await expectFileChooser(page, importButton);
      }
    });

    test('the bar and the first pack fit a short screen at every narrow width', async ({ page, context }) => {
      test.setTimeout(90_000);
      await showStoreCount(page, context, text, () => importSavedPack(page, '/play'));
      const controls = bar(page, text);
      const row = page.getByRole('option', { name: new RegExp(packTitle) });
      for (const width of widths) {
        await resize(page, { width, height: 568 });
        await expectAllReachable(controls);
        expect((await controls.search.boundingBox())!.width, 'search box width').toBeGreaterThanOrEqual(112);
        await expect(row, `first pack at ${width}px`).toBeInViewport({ ratio: 0.99 });
      }
    });

    test('every control works on a phone-width screen with a saved pack', async ({ page, context }) => {
      test.setTimeout(90_000);
      await showStoreCount(page, context, text, () => importSavedPack(page, '/play'));
      const controls = bar(page, text);
      const row = page.getByRole('option', { name: new RegExp(packTitle) });
      for (const viewport of viewports) {
        await resize(page, viewport);
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

    test('the search box and the first pack stay usable at 320px with 200% text', async ({ page, context }) => {
      await showStoreCount(page, context, text, () => importSavedPack(page, '/play'));
      const controls = bar(page, text);
      const row = page.getByRole('option', { name: new RegExp(packTitle) });
      await expect(row).toBeVisible();
      await resize(page, { width: 320, height: 800 });
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await expectAllReachable(controls);
      expect((await controls.search.boundingBox())!.width, 'search box width').toBeGreaterThanOrEqual(224);
      await expect(row).toBeInViewport({ ratio: 0.99 });
    });
  });
}
