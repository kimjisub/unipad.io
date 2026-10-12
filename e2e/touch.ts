import type { CDPSession, Page } from '@playwright/test';

// /play is played in landscape; in portrait a full-screen "rotate" overlay covers the pads.
export const touchScreens = [
  { name: 'phone', viewport: { width: 844, height: 390 } },
  { name: 'tablet', viewport: { width: 1180, height: 820 } },
];

export const pad = (page: Page, position: string) => page.locator(`[data-pad="${position}"]`);
/** The press light drawn over a held pad. */
export const pressed = (page: Page, position: string) => pad(page, position).locator('img[src="/theme/btn_.png"]');

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
