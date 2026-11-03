import type { Locator, Page } from '@playwright/test';

// A resized page lays out at once but reaches the screen later; WebKit can drop a wheel sent before
// the new layout is drawn. Wait until the page has the new size, then for two drawn frames.
export async function resize(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, viewport);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Read all rectangles and centre hit tests in one browser turn, without waiting for animations. */
export async function measureReachability(targets: Locator[]) {
  const elements = await Promise.all(targets.map(target => target.elementHandle()));
  try {
    return await targets[0].page().evaluate(elements => elements.map(element => {
      const box = element!.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        inside: box.left >= 0 && box.right <= document.documentElement.clientWidth && box.top >= 0 && box.bottom <= innerHeight,
        pressable: !!hit && element!.contains(hit),
      };
    }), elements);
  } finally {
    await Promise.all(elements.map(element => element?.dispose()));
  }
}

/** Whether the whole element is inside the viewport and a press at its centre reaches it. */
export async function reachable(target: Locator) {
  const [{ inside, pressable }] = await measureReachability([target]);
  return { inside, pressable };
}
