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

async function scrollToFooter(page: Page) {
  const install = page.locator('footer').getByRole('link', { name: 'iOS' });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // The footer fades and slides in; its final place is known once the animation ends.
  await expect(install).toHaveCSS('opacity', '1');
  await page.waitForTimeout(600);
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

  test('the scroll-to-top button appears clear of where the install links settle', async ({ page }) => {
    await page.setViewportSize({ width: 680, height: 800 });
    // The home page is long enough to show the button; at 680px the iOS link sits in its column.
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Scroll to top' });
    // A scroll made before the page finishes loading can be undone, so repeat it until the button shows.
    await expect(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(button).toBeVisible({ timeout: 500 });
    }).toPass();
    // Where the button is placed while the footer is still sliding in, without its own scale-in.
    const first = await button.evaluate((el: HTMLElement) => ({ x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }));
    await scrollToFooter(page);
    for (const link of installLinks(page)) {
      const box = (await link.boundingBox())!;
      const overlaps = first.x < box.x + box.width && box.x < first.x + first.width && first.y < box.y + box.height && box.y < first.y + first.height;
      expect(overlaps, await link.innerText()).toBe(false);
    }
  });
});
