import type { Locator, Page } from '@playwright/test';
import { test, expect } from './browser';

test.use({ locale: 'ko-KR' });

/** Sets the browser's default font size to 200%, as the Chrome text size setting does. */
async function useLargeText(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
}

/** Whether the whole element is inside the viewport and a press at its centre reaches it. */
function reachable(target: Locator) {
  return target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      inside: box.left >= 0 && box.right <= document.documentElement.clientWidth && box.top >= 0 && box.bottom <= innerHeight,
      pressable: !!hit && element.contains(hit),
    };
  });
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

/** Waits until the element and the boxes around it have finished fading and sliding in. */
async function waitUntilSettled(target: Locator) {
  await expect.poll(() => target.evaluate(element => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.opacity !== '1' || style.transform !== 'none') return false;
    }
    return true;
  })).toBe(true);
}

/**
 * Waits until the scroll-to-top button has kept its place and full opacity, or stayed away, for several frames.
 * It is placed in the frame after a scroll, and a button that leaves fades out where it was.
 * Polls 'at rest', or what each frame showed (bottom/opacity of every button) so a failure tells why.
 */
async function waitForButtonAtRest(page: Page) {
  await expect.poll(() => page.evaluate(() => new Promise<string>(resolve => {
    const read = () => [...document.querySelectorAll<HTMLElement>('button[aria-label="Scroll to top"]')]
      .map(button => `${button.style.bottom}/${getComputedStyle(button).opacity}`)
      .join(' + ') || 'none';
    const frames: string[] = [];
    const step = () => {
      frames.push(read());
      if (frames.length < 6) return requestAnimationFrame(step);
      const atRest = frames.every(frame => frame === frames[0]) && (frames[0] === 'none' || /^[^+]*\/1$/.test(frames[0]));
      resolve(atRest ? 'at rest' : `scroll ${scrollY}: ${frames.join(' | ')}`);
    };
    requestAnimationFrame(() => requestAnimationFrame(step));
  }))).toBe('at rest');
}

async function scrollToFooter(page: Page) {
  await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight));
  for (const link of installLinks(page)) await waitUntilSettled(link);
}

function installLinks(page: Page) {
  return ['Web', 'Android', 'iOS'].map(name => page.locator('footer').getByRole('link', { name, exact: true }));
}

test.describe('with 200% text', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium can set the default font size');

  for (const width of [320, 390, 680, 768]) {
    test(`the footer web and install links are on screen and pressable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await useLargeText(page);
      await page.goto('/docs');
      await scrollToFooter(page);
      for (const link of installLinks(page)) {
        expect(await reachable(link), await link.innerText()).toEqual({ inside: true, pressable: true });
      }
    });
  }

  test('the top bar items do not overlap and the last menu item can be reached on a short screen', async ({ page }) => {
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
    test(`the notice date and tags do not widen the page at 320px on ${path}`, async ({ page }) => {
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
    await expect(page.getByRole('button', { name: 'Scroll to top' })).toBeVisible();
  });

  const cases = [
    ...[320, 390, 680].flatMap(width => [false, true].map(large => ({ path: '/', width, height: 800, large }))),
    { path: '/en', width: 320, height: 800, large: true },
    { path: '/', width: 390, height: 360, large: true },
  ];

  for (const { path, width, height, large } of cases) {
    test(`covers no start box or footer link and stays below the top bar at ${width}x${height}${large ? ' with 200% text' : ''} on ${path}`, async ({ page, browserName }) => {
      await page.setViewportSize({ width, height });
      if (large) await (browserName === 'chromium' ? useLargeText(page) : useLargeRootText(page));
      await page.goto(path);

      // The start box and the footer slide in once seen; wait until they rest where the button must avoid them.
      const startBox = await page.locator('#cta').evaluate(el => el.getBoundingClientRect().top + scrollY);
      await scrollTo(page, startBox - height / 2);
      for (const target of await page.locator('#cta a').all()) await waitUntilSettled(target);
      await scrollToFooter(page);

      const end = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      let shown = 0;
      for (let y = Math.max(startBox - height, 601); y < end + height / 4; y += height / 4) {
        await scrollTo(page, Math.min(y, end));
        await waitForButtonAtRest(page);
        const placement = await page.evaluate(() => {
          const button = document.querySelector<HTMLElement>('button[aria-label="Scroll to top"]');
          if (!button) return null;
          // offset* leave out the button's own scale-in.
          const box = { left: button.offsetLeft, top: button.offsetTop, right: button.offsetLeft + button.offsetWidth, bottom: button.offsetTop + button.offsetHeight };
          const covered = [...document.querySelectorAll<HTMLElement>('#cta a, footer a, footer button')]
            .filter(target => {
              const other = target.getBoundingClientRect();
              return other.width > 0 && box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom;
            })
            .map(target => target.innerText);
          return { scrollY, top: box.top, barBottom: document.getElementById('navigation')!.offsetHeight, covered };
        });
        if (!placement) continue;
        shown++;
        expect(placement.top, `top at scroll ${placement.scrollY}`).toBeGreaterThanOrEqual(placement.barBottom);
        expect(placement.covered, `covered at scroll ${placement.scrollY}`).toEqual([]);
      }
      expect(shown, 'scroll positions where the button showed').toBeGreaterThan(0);
    });
  }
});
