import type { ElementHandle, Locator, Page } from '@playwright/test';

type Viewport = { width: number; height: number };

interface LayoutWait {
  /** Resize to this size, wait until the page has it, then for two drawn frames. */
  viewport?: Viewport;
  /** Wait for web fonts and the CSS size transitions they start. */
  transitions?: boolean;
}

/**
 * Runs in the page. Every wait happens here rather than in separate browser calls, which a busy machine
 * makes slow; the rectangles and centre hit tests are then read in one turn, so they share one layout.
 */
async function settleAndMeasure({ viewport, transitions, elements }: LayoutWait & { elements: Element[] }) {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  if (viewport) {
    while (innerWidth !== viewport.width || innerHeight !== viewport.height) await frame();
    await frame();
    await frame();
  }
  if (transitions) {
    document.documentElement.getBoundingClientRect();
    await document.fonts.ready;
    document.documentElement.getBoundingClientRect();
    // Wait for actual transitions, not a delay or an assertion retry. The repeating badge keeps running.
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition)
      .map(animation => animation.finished.catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
      })));
  }
  return elements.map(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      inside: box.left >= 0 && box.right <= document.documentElement.clientWidth && box.top >= 0 && box.bottom <= innerHeight,
      pressable: !!hit && element.contains(hit),
    };
  });
}

/** Optionally resizes and waits for the layout, then measures `elements` in that layout. */
export async function measureElements(page: Page, elements: ElementHandle<Element>[], { viewport, transitions }: LayoutWait = {}) {
  if (viewport) await page.setViewportSize(viewport);
  return page.evaluate(settleAndMeasure, { viewport, transitions, elements });
}

// A resized page lays out at once but reaches the screen later; WebKit can drop a wheel sent before
// the new layout is drawn. Wait until the page has the new size, then for two drawn frames.
export async function resize(page: Page, viewport: Viewport) {
  await measureElements(page, [], { viewport });
}

/** Read all rectangles and centre hit tests in one browser turn; without `wait`, measure at once. */
export async function measureReachability(targets: Locator[], wait: LayoutWait = {}) {
  const elements = await Promise.all(targets.map(target => target.elementHandle()));
  try {
    return await measureElements(targets[0].page(), elements, wait);
  } finally {
    await Promise.all(elements.map(element => element.dispose()));
  }
}

/** Whether the whole element is inside the viewport and a press at its centre reaches it. */
export async function reachable(target: Locator) {
  const [{ inside, pressable }] = await measureReachability([target]);
  return { inside, pressable };
}
