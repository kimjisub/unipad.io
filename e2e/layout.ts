import type { Locator, Page } from '@playwright/test';

// A resized page lays out at once but reaches the screen later; WebKit can drop a wheel sent before
// the new layout is drawn. Wait until the page has the new size, then for two drawn frames.
export async function resize(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, viewport);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Whether the whole element is inside the viewport and a press at its centre reaches it. */
export function reachable(target: Locator) {
  return target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      inside: box.left >= 0 && box.right <= document.documentElement.clientWidth && box.top >= 0 && box.bottom <= innerHeight,
      pressable: !!hit && element.contains(hit),
    };
  });
}
