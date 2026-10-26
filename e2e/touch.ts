import { expect, type CDPSession, type Page } from '@playwright/test';

// /play is played in landscape; in portrait a full-screen "rotate" overlay covers the pads.
export const touchScreens = [
  { name: 'phone', viewport: { width: 844, height: 390 } },
  { name: 'tablet', viewport: { width: 1180, height: 820 } },
];

export const pad = (page: Page, position: string) => page.locator(`[data-pad="${position}"]`);
/** The press light drawn over a held pad. */
export const pressed = (page: Page, position: string) => pad(page, position).locator('img[src="/theme/btn_.png"]');
/** Every pad showing the press light, in position order. */
export const lit = (page: Page) => page.locator('[data-pad]:has(img[src="/theme/btn_.png"])')
  .evaluateAll(pads => pads.map(p => (p as HTMLElement).dataset.pad!).sort());
// The right strip uses circle slots 9/10 for pack chains 1/2 (offset 8).
export const chain2 = (page: Page) => page.getByRole('button', { name: 'Chain 10', exact: true });

export async function point(page: Page, position: string, id: number) {
  const box = await pad(page, position).boundingBox();
  if (!box) throw new Error('Missing pad');
  return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
export type Contact = Awaited<ReturnType<typeof point>>;

/**
 * Real touch input through CDP: the browser turns it into the pointer events PadGrid listens to.
 * touchStart/touchMove list every contact on the screen; touchEnd lists the contacts lifted
 * ([] lifts all of them); touchCancel cancels every contact.
 */
export async function touch(session: CDPSession, type: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel', touchPoints: Contact[]) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints });
}

/** Turns on "Slide across pads" in the play menu. It is off unless the player chooses it. */
export async function slideAcrossPads(page: Page) {
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const option = page.getByRole('button', { name: 'Slide across pads', exact: true });
  await expect(option.locator('div.absolute')).toHaveCSS('left', '2px');
  await option.click();
  await expect(option.locator('div.absolute')).toHaveCSS('left', '18px');
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).toHaveCount(0);
}
