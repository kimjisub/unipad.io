import type { Locator, Page } from '@playwright/test';
import { test, expect } from './browser';
import { reachable } from './layout';

test.use({ locale: 'ko-KR' });

// Launch settings are worker-scoped: extend only the enlarged-text tests instead
// of changing an option inside describe (which Playwright rejects).
const largeText = test.extend({
  launchOptions: [async ({ launchOptions, browserName }, use) => {
    await use(browserName === 'firefox' ? {
      ...launchOptions,
      firefoxUserPrefs: {
        ...launchOptions.firefoxUserPrefs,
        'font.size.variable.x-western': 32,
        'font.size.monospace.x-western': 26,
        'font.size.variable.ko': 32,
        'font.size.monospace.ko': 26,
      },
    } : launchOptions);
  }, { scope: 'worker' }],
});

/** Firefox receives its default sizes at launch; Chromium supports a per-page setting. */
async function useLargeText(page: Page) {
  if (page.context().browser()!.browserType().name() === 'firefox') return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
}

/**
 * Sets the root font size to 200% where the browser offers no default font size setting.
 * Sizes in rem grow as with the Chrome setting; media queries in em do not.
 */
async function useLargeRootText(page: Page) {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = 'html { font-size: 200% !important; }';
    document.head.append(style);
  }));
}

/** Scrolls without the page's smooth scrolling, which WebKit animates over several frames. */
function scrollTo(page: Page, top: number) {
  return page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), top);
}

/** Waits in the browser so driver round trips do not consume the animation deadline. */
async function waitUntilSettled(target: Locator) {
  await target.evaluateAll(elements => new Promise<void>((resolve, reject) => {
    if (elements.length === 0) {
      reject(new Error('No elements to check for settled animations'));
      return;
    }
    let frame = 0;
    const timeout = setTimeout(() => {
      cancelAnimationFrame(frame);
      reject(new Error(`Elements did not finish fading and sliding: ${elements.map(element => element.textContent).join(', ')}`));
    }, 5_000);
    const step = () => {
      for (const element of elements) {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.opacity !== '1' || style.transform !== 'none') {
            frame = requestAnimationFrame(step);
            return;
          }
        }
      }
      clearTimeout(timeout);
      resolve();
    };
    step();
  }));
}

const scrollButtonSelector = 'button[aria-label="Scroll to top"]';

/**
 * Lets scroll handlers apply placement, then observes an unchanged, fully visible
 * button (or absence) for longer than its 200ms exit animation. At least three
 * samples are required. Samples come from display frames and from a short timer,
 * because a busy machine can stop drawing frames for many seconds; a button that
 * is still moving, or whose animation waits for a frame to start, never counts as
 * at rest. Changes reset the interval, without discarding samples in batches or
 * making repeated driver round trips.
 */
async function waitForButtonAtRest(page: Page, top?: number) {
  return page.evaluate(({ selector, top }) => new Promise<{ signature: string; stableMs: number }>((resolve, reject) => {
    if (top !== undefined) window.scrollTo({ top, behavior: 'instant' });
    const read = () => [...document.querySelectorAll<HTMLElement>(selector)]
      .map(button => {
        const style = getComputedStyle(button);
        const moving = button.getAnimations().some(animation => animation.pending || animation.playState === 'running');
        return `${button.style.bottom}/${style.transform}/${style.opacity}${moving ? '/moving' : ''}`;
      })
      .join(' + ') || 'none';
    const recent: string[] = [];
    let stableSince = 0;
    let samples = 0;
    let drawn = 0;
    let frame = 0;
    let timer = 0;
    const stop = () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    const timeout = setTimeout(() => {
      stop();
      reject(new Error(`Scroll button did not settle at scroll ${scrollY} (${drawn} frames drawn): ${recent.join(' | ')}`));
    }, 15_000);
    /** Returns whether the button is at rest. */
    const sample = () => {
      const current = read();
      const now = performance.now();
      if (current !== recent.at(-1)) {
        stableSince = now;
        samples = 0;
      }
      samples++;
      recent.push(current);
      if (recent.length > 6) recent.shift();
      if (samples >= 3 && now - stableSince >= 250 && (current === 'none' || /^[^+]*\/none\/1$/.test(current))) {
        stop();
        resolve({ signature: current, stableMs: now - stableSince });
        return true;
      }
      return false;
    };
    const onFrame = () => {
      drawn++;
      if (!sample()) frame = requestAnimationFrame(onFrame);
    };
    const onTimer = () => {
      if (!sample()) timer = window.setTimeout(onTimer, 50);
    };
    // The second frame comes after the scroll handlers' own frame callbacks have placed the button.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        onFrame();
        timer = window.setTimeout(onTimer, 50);
      });
    });
  }), { selector: scrollButtonSelector, top });
}

async function scrollToFooter(page: Page) {
  await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight));
  await waitUntilSettled(page.locator('footer a'));
}

function installLinks(page: Page) {
  return ['Web', 'Android', 'iOS'].map(name => page.locator('footer').getByRole('link', { name, exact: true }));
}

test.describe('scroll button settling', () => {
  for (const present of [true, false]) {
    test(`observes a settled ${present ? 'button' : 'absence'} beyond the exit duration`, async ({ page }) => {
      await page.setContent(present ? '<button aria-label="Scroll to top" style="bottom: 24px">Up</button>' : '<p>No button</p>');
      const result = await waitForButtonAtRest(page);
      expect(result.stableMs).toBeGreaterThanOrEqual(250);
      expect(result.signature === 'none').toBe(!present);
    });
  }

  test('settles while the browser has stopped drawing frames', async ({ page }) => {
    await page.setContent('<button aria-label="Scroll to top" style="bottom: 24px">Up</button>');
    await page.evaluate(() => {
      const request = window.requestAnimationFrame.bind(window);
      let requests = 0;
      // As on a busy machine whose browser draws nothing for longer than the settling deadline.
      window.requestAnimationFrame = callback => ++requests <= 2 ? request(callback) : 0;
    });
    const result = await waitForButtonAtRest(page);
    expect(result.signature).toBe('24px/none/1');
    expect(result.stableMs).toBeGreaterThanOrEqual(250);
  });

  test('waits for an animation whose values already look at rest', async ({ page }) => {
    await page.setContent('<button aria-label="Scroll to top" style="bottom: 24px">Up</button>');
    const button = page.getByRole('button', { name: 'Scroll to top' });
    await button.evaluate(el => { el.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 3_000 }); });
    await waitForButtonAtRest(page);
    expect(await button.evaluate(el => el.getAnimations().map(animation => animation.playState))).toEqual([]);
  });

  for (const change of ['exit', 'appearance', 'opaque movement'] as const) {
    test(`waits for a delayed ${change}`, async ({ page }) => {
      await page.setContent(change === 'appearance' ? '<p>No button yet</p>' : '<button aria-label="Scroll to top" style="bottom: 24px">Up</button>');
      await page.evaluate(change => {
        const request = window.requestAnimationFrame.bind(window);
        let frames = 0;
        // Make delayed changes deterministic even when real display frames are far apart.
        Object.defineProperty(performance, 'now', { value: () => frames * 16 });
        window.requestAnimationFrame = callback => request(time => {
          frames++;
          let button = document.querySelector('button');
          if (frames === 5) {
            if (change === 'appearance') {
              button = document.createElement('button');
              button.setAttribute('aria-label', 'Scroll to top');
              button.style.bottom = '24px';
              document.body.append(button);
            } else if (change === 'exit') button!.style.opacity = '0.5';
            else button!.style.bottom = '40px';
          }
          if (frames === 8) {
            if (change === 'exit') button!.remove();
            else button!.style.bottom = '64px';
          }
          document.body.dataset.frames = String(frames);
          callback(time);
        });
      }, change);
      await waitForButtonAtRest(page);
      expect(Number(await page.locator('body').getAttribute('data-frames'))).toBeGreaterThanOrEqual(8 + Math.ceil(250 / 16));
      const button = page.getByRole('button', { name: 'Scroll to top' });
      if (change === 'exit') await expect(button).toHaveCount(0);
      else await expect(button).toHaveCSS('bottom', '64px');
    });
  }
});

largeText.describe('with 200% text', () => {
  largeText.skip(({ browserName }) => browserName === 'webkit', 'WebKit does not expose a browser default font size setting');

  largeText('the browser default grows text and em media queries in Korean and English', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 800 });
    await useLargeText(page);
    for (const lang of ['ko', 'en']) {
      await page.setContent(`<html lang="${lang}"><body>Default text</body></html>`);
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).fontSize), lang).toBe('32px');
      // Root CSS injection cannot change this initial-font-size media query.
      expect(await page.evaluate(() => matchMedia('(min-width: 20em)').matches), lang).toBe(false);
    }
  });

  for (const width of [320, 390, 680, 768]) {
    largeText(`the footer web and install links are on screen and pressable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await useLargeText(page);
      await page.goto('/docs');
      await scrollToFooter(page);
      for (const link of installLinks(page)) {
        expect(await reachable(link), await link.innerText()).toEqual({ inside: true, pressable: true });
      }
    });
  }

  largeText('the top bar items do not overlap and the last menu item can be reached on a short screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 360 });
    await useLargeText(page);
    await page.goto('/docs');
    const bar = page.locator('nav#navigation');
    const boxes = await Promise.all(
      [bar.getByRole('link').first(), bar.getByRole('button', { name: 'Switch to English' }), bar.getByRole('button', { name: '메뉴 열기' })]
        .map(item => item.boundingBox()),
    );
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.x, 'starts after the previous item ends').toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width);
    }

    const menuButton = bar.getByRole('button', { name: '메뉴 열기' });
    await menuButton.focus();
    await page.keyboard.press('Enter');
    const last = page.locator('#topbar-mobile-menu a').last();
    await last.scrollIntoViewIfNeeded();
    expect(await reachable(last)).toEqual({ inside: true, pressable: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('#topbar-mobile-menu')).toHaveCount(0);
    await expect(menuButton).toBeFocused();
  });

  for (const path of ['/notices', '/notices/v4-1-1-update']) {
    largeText(`the notice date and tags do not widen the page at 320px on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await useLargeText(page);
      await page.goto(path);
      await expect(page.locator('main').getByText('v4.1.1').first()).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => {
        const { scrollWidth, clientWidth } = document.documentElement;
        return { scrollWidth, clientWidth };
      });
      expect(scrollWidth, 'page width').toBeLessThanOrEqual(clientWidth);
    });
  }
});

test.describe('with default text', () => {
  for (const width of [640, 660, 680, 1440]) {
    test(`the footer web and install links stay on one line at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/docs');
      await expect(page.locator('html'), 'enlarged-text launch settings stay in their own group').toHaveCSS('font-size', '16px');
      await scrollToFooter(page);
      const boxes = await Promise.all(installLinks(page).map(link => link.boundingBox()));
      expect(new Set(boxes.map(box => Math.round(box!.y))).size, 'rows of links').toBe(1);
      for (const link of installLinks(page)) {
        expect(await reachable(link), await link.innerText()).toEqual({ inside: true, pressable: true });
      }
    });
  }

  test('the scroll-to-top button stays clear of where the install links settle while they slide in', async ({ page }) => {
    await page.setViewportSize({ width: 680, height: 800 });
    // The home page is long enough to show the button; at 680px the iOS link sits in its column.
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Scroll to top' });
    // A scroll made before the page finishes loading can be undone, so repeat it until the button shows.
    await expect(async () => {
      await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight));
      await expect(button).toBeVisible({ timeout: 500 });
    }).toPass();
    await waitForButtonAtRest(page);
    const placed = await button.evaluate((el: HTMLElement) => el.style.bottom);
    await scrollToFooter(page);
    expect(await button.evaluate((el: HTMLElement) => el.style.bottom), 'place after the footer settled').toBe(placed);
    // offset* leave out the button's own scale-in.
    const box = await button.evaluate((el: HTMLElement) => ({ x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }));
    for (const link of installLinks(page)) {
      const other = (await link.boundingBox())!;
      const overlaps = box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height;
      expect(overlaps, await link.innerText()).toBe(false);
    }
  });
});

test.describe('the scroll-to-top button', () => {
  test('shows on a page that is already scrolled down when its scripts start', async ({ page }) => {
    // As when a reload or going back restores the scroll position before the page's scripts run.
    let startScripts = () => {};
    const scriptsHeld = new Promise<void>(resolve => { startScripts = resolve; });
    await page.route('**/_next/static/chunks/**/*.js', async route => { await scriptsHeld; await route.continue(); });
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('footer').waitFor({ state: 'attached' });
    await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(600);
    startScripts();
    // Releasing requests starts downloading and executing the scripts. Keep that
    // preparation out of the button assertion, without scrolling again after hydration.
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => scrollY), 'the pre-script scroll position survives loading').toBeGreaterThan(600);
    await expect(page.getByRole('button', { name: 'Scroll to top' })).toBeVisible();
  });

  const cases = [
    ...[320, 390, 680].flatMap(width => [false, true].map(large => ({ path: '/', width, height: 800, large }))),
    { path: '/en', width: 320, height: 800, large: true },
    { path: '/', width: 390, height: 360, large: true },
  ];

  for (const { path, width, height, large } of cases) {
    // Give viewport/font setup, navigation and content preparation a separate 90s
    // ceiling. The page fixture is created first and still uses the sweep budget.
    const sweep = test.extend<{ prepared: { startBox: number; end: number } }>({
      prepared: [async ({ page, browserName }, use, testInfo) => {
        const started = Date.now();
        await page.setViewportSize({ width, height });
        if (large) await (browserName === 'chromium' ? useLargeText(page) : useLargeRootText(page));
        await page.goto(path);
        const navigated = Date.now();
        const startBox = await page.locator('#cta').evaluate(el => el.getBoundingClientRect().top + scrollY);
        await scrollTo(page, startBox - height / 2);
        await waitUntilSettled(page.locator('#cta a'));
        await scrollToFooter(page);
        const end = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        await testInfo.attach('page preparation', {
          body: JSON.stringify({ navigationMs: navigated - started, contentMs: Date.now() - navigated }),
          contentType: 'application/json',
        });
        await use({ startBox, end });
      }, { timeout: 90_000 }],
    });
    sweep.describe(() => {
      // Allow 90s for short screens and 320px large text, 30s for other sweeps.
      // Each scroll position still has a 15s settling deadline.
      sweep.describe.configure({ timeout: height < 400 || (width === 320 && large) ? 90_000 : 30_000 });
      sweep(`covers no start box or footer link and stays below the top bar at ${width}x${height}${large ? ' with 200% text' : ''} on ${path}`, async ({ page, prepared }) => {
        const { startBox, end } = prepared;
        let shown = 0;
        for (let y = Math.max(startBox - height, 601); y < end + height / 4; y += height / 4) {
          await waitForButtonAtRest(page, Math.min(y, end));
          const placement = await page.evaluate(selector => {
            const button = document.querySelector<HTMLElement>(selector);
            if (!button) return null;
            // offset* leave out the button's own scale-in.
            const box = { left: button.offsetLeft, top: button.offsetTop, right: button.offsetLeft + button.offsetWidth, bottom: button.offsetTop + button.offsetHeight };
            // Touching counts as covering: text in another font can widen a link by a fraction of
            // a pixel, and a press on the shared edge could reach either control.
            const covered = [...document.querySelectorAll<HTMLElement>('#cta a, footer a, footer button')]
              .filter(target => {
                const other = target.getBoundingClientRect();
                return other.width > 0 && box.left <= other.right && other.left <= box.right && box.top <= other.bottom && other.top <= box.bottom;
              })
              .map(target => target.innerText);
            return { scrollY, top: box.top, barBottom: document.getElementById('navigation')!.offsetHeight, covered };
          }, scrollButtonSelector);
          if (!placement) continue;
          shown++;
          expect(placement.top, `top at scroll ${placement.scrollY}`).toBeGreaterThanOrEqual(placement.barBottom);
          expect(placement.covered, `covered at scroll ${placement.scrollY}`).toEqual([]);
        }
        expect(shown, 'scroll positions where the button showed').toBeGreaterThan(0);
      });
    });
  }
});
