import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect, expectPads } from './browser';

// Newest first: the list sorts by the date a pack was added.
const packs = [
  ['e2e/fixtures/basic.uni', 'Browser Test Pack by UniPad Tests'],
  ['meta/unipack-conformance/chain-release-v1/packs/manual.uni', 'Chain Release v1 manual by UniPad Tests'],
  ['meta/unipack-conformance/chain-release-v1/packs/delayed.uni', 'Chain Release v1 delayed by UniPad Tests'],
] as const;
const [last, middle, first] = packs.map(([, name]) => name);

const list = (page: Page) => page.getByRole('listbox', { name: 'UniPack list' });
const option = (page: Page, name: string) => list(page).getByRole('option', { name, exact: true });

type PackFile = string | { name: string; mimeType: string; buffer: Buffer };

async function openList(page: Page, files: readonly PackFile[]) {
  await test.step('Prepare saved pack list', async () => {
    await page.goto('/play');
    for (const [index, file] of files.entries()) {
      await page.locator('input[type=file][accept=".zip,.uni"]').first().setInputFiles(typeof file === 'string' ? resolve(file) : file);
      await expectPads(page);
      // The import shows the pads before it saves the pack; the URL changes once it is saved.
      await expect(page).toHaveURL(/\/play\?pack=.+/);
      // Setup needs the buttons' actions, not pointer hit testing during their animations.
      // Keep the page alive and return to the list before the next import.
      await page.getByRole('button', { name: 'Open menu', exact: true }).dispatchEvent('click');
      await page.getByRole('button', { name: 'Quit', exact: true }).dispatchEvent('click');
      await expect(list(page).getByRole('option')).toHaveCount(index + 1);
    }
  });
}

const openListWithThreePacks = (page: Page) => openList(page, packs.map(([file]) => file));

// The basic test pack under another title.
async function packTitled(title: string): Promise<PackFile> {
  const zip = await JSZip.loadAsync(readFileSync(resolve(packs[0][0])));
  const info = await zip.file('info')!.async('string');
  zip.file('info', info.replace(/^title=.*$/m, `title=${title}`));
  return { name: 'titled.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
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

test('arrow keys move past a pack whose title has a double quote', async ({ page }) => {
  await openList(page, [packs[2][0], await packTitled('Quote "Pack"'), packs[0][0]]);
  const quoted = 'Quote "Pack" by UniPad Tests';
  await option(page, last).click();

  await page.keyboard.press('ArrowDown');
  await expectActive(page, quoted);
  await page.keyboard.press('ArrowDown');
  await expectActive(page, first);
  await page.keyboard.press('ArrowUp');
  await expectActive(page, quoted);
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
  await expectPads(page);
  await expect(page).toHaveTitle(/^Chain Release v1 manual \|/);
});

test('rows hold no separate controls and the empty search result sits outside the list', async ({ page }) => {
  await openListWithThreePacks(page);
  // The newest pack starts selected, so click another row to open its play strip.
  await option(page, middle).click();
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');
  await expect(list(page).getByRole('button')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Search unipacks' }).fill('no pack has this name');
  await expect(page.getByText('no pack has this name')).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

/**
 * Selects the middle pack, then focuses the theme button as Tab does. Safari's Tab reaches buttons
 * only with its "Press Tab to highlight each item" setting, so the button is focused directly.
 */
async function focusThemeButtonWithPackSelected(page: Page) {
  await option(page, middle).click();
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');

  const theme = page.getByRole('button', { name: 'Theme', exact: true });
  await theme.focus();
  await expect(theme).toBeFocused();
}

/** The main screen is still showing the list with the middle pack selected, and nothing is open over it. */
async function expectListUntouched(page: Page) {
  await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]pack=/);
}

test('Enter on a focused button presses that button and leaves the selected pack closed', async ({ page }) => {
  await openListWithThreePacks(page);
  await focusThemeButtonWithPackSelected(page);

  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await chooser;
  await expectListUntouched(page);

  // Enter on the focused row still plays the selected pack.
  await option(page, middle).focus();
  await page.keyboard.press('Enter');
  await expectPads(page);
  await expect(page).toHaveTitle(/^Chain Release v1 manual \|/);
});

test('Backspace and Delete on a focused button leave the selected pack alone', async ({ page }) => {
  await openListWithThreePacks(page);
  await focusThemeButtonWithPackSelected(page);
  // WebKit's own Backspace on a button goes back a page, which here would reopen an imported pack;
  // a second entry for this page keeps it on the list.
  await page.evaluate(() => history.pushState(null, '', location.href));

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await expectListUntouched(page);

  // On the focused row they still ask to delete the selected pack.
  await option(page, middle).focus();
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('alertdialog')).toBeVisible();
});

test('Enter on the delete confirmation presses the focused button, and deletes from anywhere else', async ({ page }) => {
  await openListWithThreePacks(page);
  const confirmation = page.getByRole('alertdialog', { name: 'Confirm deletion', exact: true });
  const askToDeleteMiddle = async () => {
    // A click on the selected row would clear its selection.
    if (await option(page, middle).getAttribute('aria-selected') !== 'true') await option(page, middle).click();
    await expect(option(page, middle)).toHaveAttribute('aria-selected', 'true');
    await option(page, middle).focus();
    await page.keyboard.press('Delete');
    await expect(confirmation).toBeVisible();
  };

  // The dialog opens on its Delete button; Enter on a focused Cancel only cancels.
  await askToDeleteMiddle();
  await expect(confirmation.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  await expect(list(page).getByRole('option')).toHaveCount(3);

  await askToDeleteMiddle();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(list(page).getByRole('option')).toHaveCount(3);

  // With focus off its buttons, after a click on the question, Enter still deletes.
  await askToDeleteMiddle();
  await confirmation.getByText(`Delete “${middle.replace(/ by .*$/, '')}”?`).click();
  await expect(page.locator('body')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  await expect(option(page, middle)).toHaveCount(0);
  await expect(list(page).getByRole('option')).toHaveCount(2);

  // Enter on the Delete button it opens on deletes that one pack.
  await option(page, last).click();
  await expect(option(page, last)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Delete');
  await expect(confirmation.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  await expect(list(page).getByRole('option')).toHaveCount(1);
  await expect(option(page, first)).toBeVisible();
});
