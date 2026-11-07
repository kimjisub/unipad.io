import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { BASIC_PACK } from './basic-pack';
import { test, expect } from './browser';
import { importSavedPackAndQuit, storedPackRecords } from './saved-packs';

const list = (page: Page) => page.getByRole('listbox', { name: 'UniPack list' });

/** basic.uni whose info has neither a title nor a producer. */
async function untitledPack(name: string) {
  const zip = await JSZip.loadAsync(await readFile(BASIC_PACK));
  zip.file('info', 'buttonX=8\nbuttonY=8\nchain=1\nsquareButton=true\n');
  return { name, mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

async function importAndQuit(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, count: number, untitled: boolean) {
  await importSavedPackAndQuit(page, file, count, {
    afterInput: untitled ? async () => {
      const warning = page.getByRole('alertdialog');
      await expect(warning).toContainText('title was missing');
      await warning.getByRole('button', { name: 'OK', exact: true }).click();
    } : undefined,
  });
}

test('packs without a title show the name of their file in the list and details', async ({ page }) => {
  await page.goto('/play');
  await importAndQuit(page, { name: 'basic.uni', mimeType: 'application/zip', buffer: await readFile(BASIC_PACK) }, 1, false);
  await importAndQuit(page, await untitledPack('INF-008.zip'), 2, true);
  await importAndQuit(page, await untitledPack('INF-008-copy.ZIP'), 3, true);

  // Newest first. The pack's own title stays empty; only what is shown changes.
  const rows = list(page).getByRole('option');
  await expect(rows.nth(0)).toContainText('INF-008-copy');
  await expect(rows.nth(1)).toContainText('INF-008');
  await expect(rows.nth(1)).not.toContainText('copy');
  await expect(rows.nth(2)).toContainText('Browser Test Pack');
  const records = await storedPackRecords(page);
  expect(records.map(({ title, fileName }) => ({ title, fileName })).sort((a, b) => (a.fileName ?? '').localeCompare(b.fileName ?? ''))).toEqual([
    { title: 'Browser Test Pack', fileName: 'basic' },
    { title: '', fileName: 'INF-008' },
    { title: '', fileName: 'INF-008-copy' },
  ]);

  // The selected pack's name appears twice: in its row and as the details title.
  for (const [index, name, other] of [[1, 'INF-008', 'INF-008-copy'], [0, 'INF-008-copy', 'INF-008']] as const) {
    await rows.nth(index).click();
    await expect(rows.nth(index)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(name, { exact: true })).toHaveCount(2);
    await expect(page.getByText(other, { exact: true })).toHaveCount(1);
  }
  await rows.nth(2).click();
  await expect(page.getByText('Browser Test Pack', { exact: true })).toHaveCount(2);
});

test('packs without a title are named by their file in the delete prompt and to screen readers', async ({ page }) => {
  await page.goto('/play');
  await importAndQuit(page, { name: 'basic.uni', mimeType: 'application/zip', buffer: await readFile(BASIC_PACK) }, 1, false);
  await importAndQuit(page, await untitledPack('INF-008.zip'), 2, true);

  // The untitled pack has no producer either, so it is read by its file name alone.
  const untitled = list(page).getByRole('option', { name: 'INF-008', exact: true });
  const titled = list(page).getByRole('option', { name: 'Browser Test Pack by UniPad Tests', exact: true });
  await expect(untitled).toHaveCount(1);
  await expect(titled).toHaveCount(1);

  const confirmation = page.getByRole('alertdialog', { name: 'Confirm deletion', exact: true });
  for (const [row, name] of [[untitled, 'INF-008'], [titled, 'Browser Test Pack']] as const) {
    // A click on the selected row would clear its selection.
    if (await row.getAttribute('aria-selected') !== 'true') await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await row.focus();
    await page.keyboard.press('Delete');
    await expect(confirmation).toContainText(`Delete “${name}”?`);
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
  }
  await expect(list(page).getByRole('option')).toHaveCount(2);
});
