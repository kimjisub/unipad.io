import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from './browser';

export async function observeConfirmationKeys(page: Page) {
  // Install before the app's capture listener so stopped events can still be observed.
  await page.addInitScript(() => {
    const keys: KeyboardEvent[] = [];
    Object.assign(window, { confirmationKeys: keys });
    window.addEventListener('keydown', event => {
      keys.push(event);
    }, true);
  });
}

/** Exercises the shared confirmation through native keys, including both ends of the tab order. */
export async function expectConfirmationKeyboard(page: Page, dialog: Locator, info: TestInfo) {
  await expect(dialog).toBeVisible();
  await page.keyboard.press('/');
  await info.attach('confirmation-after-slash', { body: await page.screenshot(), contentType: 'image/png' });
  const slash = await page.evaluate(() => (Reflect.get(window, 'confirmationKeys') as KeyboardEvent[]).map(event => ({ key: event.key, prevented: event.defaultPrevented })));
  await info.attach('confirmation-search-default', { body: JSON.stringify(slash), contentType: 'application/json' });
  expect(slash).toContainEqual({ key: '/', prevented: true });
  await expect(dialog.getByRole('button').last()).toBeFocused();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate(element => element.contains(document.activeElement)), `${key} stays in the confirmation`).toBe(true);
    }
  }
  for (const key of ['ArrowDown', 'ArrowUp', '/', 'Control+k', 'Meta+k', 'q', 'Delete']) {
    await page.keyboard.press(key);
    await expect(dialog.getByRole('button').last()).toBeFocused();
  }
  // A title/backdrop can leave a key targeted outside the dialog. Neither window nor row
  // shortcuts may receive it; the bubbling observer below must remain silent.
  const escaped = await page.evaluate(() => {
    const received: string[] = [];
    const record = (event: KeyboardEvent) => received.push(event.key);
    window.addEventListener('keydown', record);
    for (const key of ['ArrowDown', '/', 'q', 'Delete']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    window.removeEventListener('keydown', record);
    return received;
  });
  expect(escaped).toEqual([]);
  // Clicking non-focusable dialog text can leave the next event targeted at the body.
  // Synthetic events measure cancellation without actually refreshing, printing or zooming.
  await dialog.locator('p').click();
  await expect(page.locator('body')).toBeFocused();
  const browserDefaults = await page.evaluate(() => {
    const received: string[] = [];
    const record = (event: KeyboardEvent) => received.push(event.key);
    window.addEventListener('keydown', record);
    const shortcuts = [
      { key: 'r', ctrlKey: true }, { key: 'F5' }, { key: '=', ctrlKey: true },
      { key: '-', ctrlKey: true }, { key: 'c', ctrlKey: true },
      { key: 'c', metaKey: true }, { key: 'p', ctrlKey: true },
    ];
    const allowed = shortcuts.map(shortcut => document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { ...shortcut, bubbles: true, cancelable: true })));
    window.removeEventListener('keydown', record);
    return { allowed, received };
  });
  await info.attach('confirmation-browser-defaults', { body: JSON.stringify(browserDefaults), contentType: 'application/json' });
  expect(browserDefaults).toEqual({ allowed: Array(7).fill(true), received: [] });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
}
