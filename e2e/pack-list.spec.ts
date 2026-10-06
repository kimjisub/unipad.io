import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './browser';

// Newest first: the list sorts by the date a pack was added.
const packs = [
  ['e2e/fixtures/basic.uni', 'Browser Test Pack by UniPad Tests'],
  ['meta/unipack-conformance/chain-release-v1/packs/manual.uni', 'Chain Release v1 manual by UniPad Tests'],
  ['meta/unipack-conformance/chain-release-v1/packs/delayed.uni', 'Chain Release v1 delayed by UniPad Tests'],
] as const;
const [last, middle, first] = packs.map(([, name]) => name);

const list = (page: Page) => page.getByRole('listbox', { name: 'UniPack list' });
const option = (page: Page, name: string) => list(page).getByRole('option', { name, exact: true });

async function openListWithThreePacks(page: Page) {
  for (const [file] of packs) {
    await page.goto('/play');
    await page.locator('input[type=file][accept=".zip,.uni"]').first().setInputFiles(resolve(file));
    await expect(page.locator('[data-pad]')).toHaveCount(64);
  }
  await page.goto('/play');
  await expect(list(page).getByRole('option')).toHaveCount(3);
}

async function expectActive(page: Page, name: string) {
  await expect(option(page, name)).toBeFocused();
  await expect(option(page, name)).toHaveAttribute('aria-selected', 'true');
  await expect(list(page).locator('[aria-selected="true"]')).toHaveCount(1);
}

test('the pack list is one Tab stop and arrow, Home and End keys move focus and selection', async ({ page }) => {
  await openListWithThreePacks(page);
  await expect(list(page).locator('[tabindex="0"]')).toHaveCount(1);
  await option(page, middle).click();

  // Tab enters the list on the selected row, not on the first one.
  await page.getByRole('button', { name: '+ Import', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expectActive(page, middle);

  await page.keyboard.press('ArrowUp');
  await expectActive(page, first);
  await page.keyboard.press('ArrowDown');
  await expectActive(page, middle);
  await page.keyboard.press('End');
  await expectActive(page, last);
  await page.keyboard.press('ArrowDown');
  await expectActive(page, first);
  await page.keyboard.press('ArrowUp');
  await expectActive(page, last);
  await page.keyboard.press('Home');
  await expectActive(page, first);
  await expect(list(page).locator('[tabindex="0"]')).toHaveCount(1);

  // Tab leaves the list instead of walking through every row.
  await page.keyboard.press('Tab');
  await expect(list(page).getByRole('option').and(page.locator(':focus'))).toHaveCount(0);
  await page.keyboard.press('Shift+Tab');
  await expect(option(page, first)).toBeFocused();
});

test('Space selects the focused pack and Enter plays it', async ({ page }) => {
  await openListWithThreePacks(page);
  await option(page, middle).click();
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');
  // A second click clears the selection; focus stays on the row.
  await option(page, middle).click();
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'false');
  await expect(option(page, middle)).toBeFocused();

  await page.keyboard.press(' ');
  await expectActive(page, middle);
  await expect(page.locator('[data-pad]')).toHaveCount(0);

  await page.keyboard.press('Enter');
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect(page).toHaveTitle(/^Chain Release v1 manual \|/);
});

test('rows hold no separate controls and the empty search result sits outside the list', async ({ page }) => {
  await openListWithThreePacks(page);
  await option(page, first).click();
  await expect(list(page).getByRole('button')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Search unipacks' }).fill('no pack has this name');
  await expect(page.getByText('no pack has this name')).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});
