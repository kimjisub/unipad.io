import type { Page, Request } from '@playwright/test';
import { test, expect } from './browser';

const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.kimjisub.launchpad';
const APP_STORE_URL = 'https://apps.apple.com/app/id6760479102';

const locales = [
  { locale: 'ko', path: '/', title: '어디서든 켜지는 나만의 Launchpad', play: '웹에서 바로 플레이', guide: '처음이신가요? 시작 안내 보기', menu: '메뉴 열기', closeMenu: '메뉴 닫기', guideHeading: 'UniPad 받기' },
  { locale: 'en', path: '/en', title: 'Your Launchpad, anywhere.', play: 'Play on Web', guide: 'New here? Read the getting-started guide', menu: 'Open menu', closeMenu: 'Close menu', guideHeading: 'Get UniPad' },
] as const;

/** Phone sizes come from the design measurements; 768 and 820 are the common tablet widths. */
const sizes = [
  { width: 320, height: 568, aboveFold: true, guideAboveFold: false },
  { width: 390, height: 844, aboveFold: true, guideAboveFold: true },
  { width: 430, height: 932, aboveFold: true, guideAboveFold: true },
  { width: 768, height: 1024, aboveFold: false, guideAboveFold: false },
  { width: 820, height: 1180, aboveFold: false, guideAboveFold: false },
  { width: 1440, height: 900, aboveFold: true, guideAboveFold: true },
] as const;

function heroControls(page: Page, l: (typeof locales)[number]) {
  const hero = page.locator('#hero');
  return {
    hero,
    title: hero.getByRole('heading', { level: 1 }),
    play: hero.getByRole('link', { name: l.play }),
    googlePlay: hero.getByRole('link', { name: /Google Play/ }),
    appStore: hero.getByRole('link', { name: /App Store/ }),
    guide: hero.getByRole('link', { name: l.guide }),
  };
}

/** Elements whose content is wider than their box (cut off), plus the page's own sideways overflow. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const clipped = [...document.querySelectorAll('#hero h1, #hero p, #hero a, #hero li')]
      .filter(el => el.scrollWidth > el.clientWidth + 1)
      .map(el => el.textContent?.trim());
    return { page: root.scrollWidth - root.clientWidth, clipped };
  });
}

/**
 * Waits until no request has been in flight for half a second. Links prefetch their pages when they
 * come into view, also after a resize; navigating away cancels such a prefetch, which Linux WebKit
 * reports as an uncaught "access control checks" error. Playwright's networkidle cannot be reused
 * here because it resolves at once after the page has been idle once.
 */
function networkSettled(page: Page) {
  const inFlight = new Set<Request>();
  let changedAt = Date.now();
  const ended = (request: Request) => { inFlight.delete(request); changedAt = Date.now(); };
  page.on('request', request => { inFlight.add(request); changedAt = Date.now(); });
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  return () => expect.poll(() => inFlight.size === 0 && Date.now() - changedAt >= 500, { intervals: [100] }).toBe(true);
}

for (const l of locales) {
  test.describe(`${l.locale} home`, () => {
    test.use({ locale: l.locale === 'ko' ? 'ko-KR' : 'en-US' });

    for (const bigText of [false, true]) {
      test(`title, description and the three start buttons fit every width${bigText ? ' at 200% text' : ''}`, async ({ page }) => {
        const settled = networkSettled(page);
        for (const size of sizes) {
          await page.setViewportSize({ width: size.width, height: size.height });
          await settled();
          await page.goto(l.path);
          // A larger default font size scales everything set in rem, as the browser setting does.
          if (bigText) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
          const c = heroControls(page, l);
          const at = `${size.width}px`;

          expect((await c.title.innerText()).replace(/\s+/g, ' '), at).toContain(l.title);
          for (const control of [c.title, c.play, c.googlePlay, c.appStore, c.guide]) {
            await expect(control, at).toBeVisible();
            const box = (await control.boundingBox())!;
            expect(box.x, at).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width, at).toBeLessThanOrEqual(size.width + 0.5);
          }
          expect(await overflow(page), at).toEqual({ page: 0, clipped: [] });

          if (!bigText && size.aboveFold) {
            const fold = [c.play, c.googlePlay, c.appStore, ...(size.guideAboveFold ? [c.guide] : [])];
            for (const control of fold) {
              const box = (await control.boundingBox())!;
              expect(box.y + box.height, `${at}: above the fold`).toBeLessThanOrEqual(size.height);
            }
          }

          if (!bigText) {
            const smallText = await c.hero.evaluate(hero =>
              [...hero.querySelectorAll('*')]
                .filter(el => [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()))
                .filter(el => !el.closest('.sr-only') && parseFloat(getComputedStyle(el).fontSize) < 12)
                .map(el => el.textContent));
            expect(smallText, `${at}: text under 12px`).toEqual([]);
          }
        }
      });
    }

    test('start buttons and the guide go to their destinations', async ({ page }) => {
      await page.goto(l.path);
      const c = heroControls(page, l);
      await expect(c.play).toHaveAttribute('href', '/play');
      await expect(c.googlePlay).toHaveAttribute('href', GOOGLE_PLAY_URL);
      await expect(c.appStore).toHaveAttribute('href', APP_STORE_URL);
      for (const store of [c.googlePlay, c.appStore]) await expect(store).toHaveAttribute('target', '_blank');

      const cta = page.locator('#cta');
      await expect(cta.getByRole('link', { name: /Google Play/ })).toHaveAttribute('href', GOOGLE_PLAY_URL);
      await expect(cta.getByRole('link', { name: /App Store/ })).toHaveAttribute('href', APP_STORE_URL);
      await expect(page.getByText(/Coming Soon|출시 예정|개발 중/)).toHaveCount(0);

      await c.guide.click();
      await expect(page).toHaveURL('/docs/get-started');
      await expect(page.getByRole('heading', { level: 2, name: l.guideHeading })).toBeVisible();
    });

    test('keyboard reaches play, Google Play, App Store and the guide in order with a visible focus ring', async ({ page, browserName }) => {
      // Safari moves focus to links only with Option+Tab unless the user changes a setting.
      const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
      await page.goto(l.path);
      const c = heroControls(page, l);
      await page.keyboard.press(tab);
      await expect(page.locator(':focus')).toHaveAttribute('href', '#main-content');
      for (let i = 0; i < 20; i++) {
        if (await c.play.evaluate(el => el === document.activeElement)) break;
        await page.keyboard.press(tab);
      }
      for (const [index, control] of [c.play, c.googlePlay, c.appStore, c.guide].entries()) {
        if (index > 0) await page.keyboard.press(tab);
        await expect(control).toBeFocused();
        const ring = await control.evaluate(el => {
          const style = getComputedStyle(el);
          return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
        });
        expect(ring.style).not.toBe('none');
        expect(ring.width).toBeGreaterThan(0);
      }
    });

    test('phone menu opens with both app stores and closes', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(l.path);
      const open = page.getByRole('button', { name: l.menu });
      await expect(open).toBeInViewport({ ratio: 1 });
      await open.click();
      const close = page.getByRole('button', { name: l.closeMenu });
      await expect(close).toHaveAttribute('aria-expanded', 'true');
      const menu = page.locator(`#${await close.getAttribute('aria-controls')}`);
      await expect(menu.locator(`a[href="${APP_STORE_URL}"]`)).toBeVisible();
      await expect(menu.locator(`a[href="${GOOGLE_PLAY_URL}"]`)).toBeVisible();
      await close.click();
      await expect(page.getByRole('button', { name: l.menu })).toHaveAttribute('aria-expanded', 'false');
      await expect(menu.locator(`a[href="${APP_STORE_URL}"]`)).toBeHidden();
    });
  });
}

/** Pads lit by the demo, and frame requests made in the next second. */
async function motion(page: Page) {
  return page.evaluate(async () => {
    const lit = [...document.querySelectorAll<HTMLElement>('#hero [data-pad]')].filter(pad => pad.style.backgroundColor).length;
    let frames = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { frames++; return original(callback); };
    await new Promise(resolve => setTimeout(resolve, 1000));
    window.requestAnimationFrame = original;
    const running = document.getElementById('main-content')!.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length;
    return { lit, frames, running };
  });
}

test('the pad picture lights by itself at first and everything rests within five seconds', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect.poll(() => page.locator('#hero [data-pad][style*="background-color"]').count()).toBeGreaterThan(0);
  await page.waitForTimeout(5000);
  expect(await motion(page)).toEqual({ lit: 0, frames: 0, running: 0 });

  await page.locator('#hero [data-pad]').nth(27).dispatchEvent('pointerdown');
  await expect.poll(() => page.locator('#hero [data-pad][style*="background-color"]').count()).toBeGreaterThan(0);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing moves by itself', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#hero [data-pad]')).toHaveCount(64);
    await page.waitForTimeout(300);
    expect(await motion(page)).toEqual({ lit: 0, frames: 0, running: 0 });
  });
});

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false, locale: 'ko-KR' });

  test('the title, three start buttons, guide and lower sections are shown', async ({ page }) => {
    await page.goto('/');
    const c = heroControls(page, locales[0]);
    for (const control of [c.title, c.play, c.googlePlay, c.appStore, c.guide]) await expect(control).toBeVisible();
    await expect(page.locator('#cta').getByRole('link', { name: /App Store/ })).toBeVisible();
    await expect(page.locator('#faq').getByRole('heading', { level: 2 })).toBeVisible();
  });
});
