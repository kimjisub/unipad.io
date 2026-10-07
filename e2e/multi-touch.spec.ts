import { resolve } from 'node:path';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { test, expect } from './browser';
import { pad, point, touch, touchScreens, type Contact } from './touch';

// Multi-touch items A-I. Item H (a loop held while another finger changes chain) is
// covered by the CR tests in chain-release.spec.ts, which run on the same two screens.
// Every pad of the pack loops until released, so a held finger is a started-not-stopped sound.

test.use({ hasTouch: true });

const starts = (page: Page) => page.evaluate(() => window.browserProbe.audio.starts.length);
const stops = (page: Page) => page.evaluate(() => window.browserProbe.audio.stops);
const sortedStops = async (page: Page) => (await stops(page)).sort((a, b) => a - b);
/** Every pad showing the press light, in position order. */
const lit = (page: Page) => page.locator('[data-pad]:has(img[src="/theme/btn_.png"])')
  .evaluateAll(pads => pads.map(p => (p as HTMLElement).dataset.pad!).sort());

async function load(page: Page) {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/multi-touch.uni'));
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded.length)).toBe(1);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

async function contacts(page: Page, positions: string[]) {
  return Promise.all(positions.map((position, i) => point(page, position, i + 1)));
}

/** The same contact moved onto another pad. */
const moved = (page: Page, contact: Contact, position: string) => point(page, position, contact.id);

async function expectHeld(page: Page, positions: string[], soundsStarted: number) {
  await expect.poll(() => lit(page)).toEqual([...positions].sort());
  await expect.poll(() => starts(page)).toBe(soundsStarted);
}

async function evidence(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach(`${name}-audio`, {
    body: JSON.stringify(await page.evaluate(() => window.browserProbe.audio), null, 2),
    contentType: 'application/json',
  });
}

async function session(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

for (const screen of touchScreens) {
  test.describe(`${screen.name}: multi-touch`, () => {
    test.use({ viewport: screen.viewport });

    test('A two pads pressed together both sound and light', async ({ page }) => {
      await load(page);
      const input = await session(page);
      const fingers = await contacts(page, ['2,2', '5,5']);
      await touch(input, 'touchStart', fingers);
      await expectHeld(page, ['2,2', '5,5'], 2);
      expect(await stops(page)).toEqual([]);
      await touch(input, 'touchEnd', []);
      await expectHeld(page, [], 2);
      expect(await sortedStops(page)).toEqual([1, 2]);
    });

    test('B five pads pressed together all sound and light', async ({ page }) => {
      await load(page);
      const input = await session(page);
      const positions = ['0,0', '0,7', '3,4', '7,0', '7,7'];
      await touch(input, 'touchStart', await contacts(page, positions));
      await expectHeld(page, positions, 5);
      expect(await stops(page)).toEqual([]);
      await touch(input, 'touchEnd', []);
      await expectHeld(page, [], 5);
      expect(await sortedStops(page)).toEqual([1, 2, 3, 4, 5]);
    });

    test('C repeated taps beside a held pad sound each time and keep the held pad lit', async ({ page }) => {
      await load(page);
      const input = await session(page);
      const [held, tapper] = await contacts(page, ['3,3', '3,5']);
      await touch(input, 'touchStart', [held]);
      await expectHeld(page, ['3,3'], 1);
      for (let tap = 1; tap <= 3; tap++) {
        await touch(input, 'touchStart', [held, tapper]);
        await expectHeld(page, ['3,3', '3,5'], 1 + tap);
        await touch(input, 'touchEnd', [tapper]);
        await expectHeld(page, ['3,3'], 1 + tap);
      }
      expect(await stops(page)).toEqual([2, 3, 4]);
      await touch(input, 'touchEnd', []);
      await expectHeld(page, [], 4);
      expect(await stops(page)).toEqual([2, 3, 4, 1]);
    });

    test('D dragging onto the next pad turns the old pad off and sounds the new one', async ({ page }) => {
      await load(page);
      const input = await session(page);
      const [finger] = await contacts(page, ['4,2']);
      await touch(input, 'touchStart', [finger]);
      await expectHeld(page, ['4,2'], 1);
      const box = (await pad(page, '4,2').boundingBox())!;
      await touch(input, 'touchMove', [{ ...finger, x: box.x + box.width * 0.8 }]);
      await expectHeld(page, ['4,2'], 1);
      await touch(input, 'touchMove', [await moved(page, finger, '4,3')]);
      await expectHeld(page, ['4,3'], 2);
      expect(await stops(page)).toEqual([1]);
      await touch(input, 'touchMove', [await moved(page, finger, '5,3')]);
      await expectHeld(page, ['5,3'], 3);
      expect(await stops(page)).toEqual([1, 2]);
      await touch(input, 'touchEnd', []);
      await expectHeld(page, [], 3);
      expect(await stops(page)).toEqual([1, 2, 3]);
    });

    test('E two fingers dragged at once are each followed', async ({ page }) => {
      await load(page);
      const input = await session(page);
      const [a, b] = await contacts(page, ['1,1', '6,6']);
      await touch(input, 'touchStart', [a, b]);
      await expectHeld(page, ['1,1', '6,6'], 2);
      const b2 = await moved(page, b, '6,5');
      await touch(input, 'touchMove', [await moved(page, a, '1,2'), b2]);
      await expectHeld(page, ['1,2', '6,5'], 4);
      expect(await sortedStops(page)).toEqual([1, 2]);
      // Only the first finger moves on; the second stays on its pad and keeps sounding.
      await touch(input, 'touchMove', [await moved(page, a, '2,2'), b2]);
      await expectHeld(page, ['2,2', '6,5'], 5);
      expect(await stops(page)).toHaveLength(3);
      await touch(input, 'touchEnd', []);
      await expectHeld(page, [], 5);
      expect(await sortedStops(page)).toEqual([1, 2, 3, 4, 5]);
    });

    test('F lifting one of two held fingers turns off only its pad', async ({ page }) => {
      await load(page);
      const input = await session(page);
      const [a, b] = await contacts(page, ['2,6', '5,1']);
      await touch(input, 'touchStart', [a, b]);
      await expectHeld(page, ['2,6', '5,1'], 2);
      await touch(input, 'touchEnd', [b]);
      await expectHeld(page, ['2,6'], 2);
      expect(await stops(page)).toEqual([2]);
      await touch(input, 'touchEnd', []);
      await expectHeld(page, [], 2);
      expect(await stops(page)).toEqual([2, 1]);
    });

    // Headless Chromium never hides the tab or blurs the window itself (minimising the window
    // and bringing another tab forward were tried), so the hide and blur steps send the same
    // events a browser sends when the notification shade or another app takes over.
    test('G a canceled touch, a hidden tab and a lost window focus stop held loops and lights', async ({ page }, info) => {
      await load(page);
      const input = await session(page);
      const fingers = await contacts(page, ['1,3', '6,4']);
      let started = 0;
      const holdBoth = async () => {
        await touch(input, 'touchStart', fingers);
        started += 2;
        await expectHeld(page, ['1,3', '6,4'], started);
      };
      const expectReleasedAndPlayable = async () => {
        await expectHeld(page, [], started);
        expect(await sortedStops(page)).toEqual(Array.from({ length: started }, (_, i) => i + 1));
        // The fingers that were still down lift afterwards: nothing is stopped twice, and the
        // next press plays normally.
        await touch(input, 'touchEnd', []);
        await touch(input, 'touchStart', [fingers[0]]);
        started += 1;
        await expectHeld(page, ['1,3'], started);
        await touch(input, 'touchEnd', []);
        await expectHeld(page, [], started);
        expect(await sortedStops(page)).toEqual(Array.from({ length: started }, (_, i) => i + 1));
      };

      await test.step('touch canceled', async () => {
        await holdBoth();
        await touch(input, 'touchCancel', []);
        await expectHeld(page, [], started);
        expect(await sortedStops(page)).toEqual(Array.from({ length: started }, (_, i) => i + 1));
      });
      await test.step('tab hidden', async () => {
        await holdBoth();
        await evidence(page, info, 'before-tab-hidden');
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await evidence(page, info, 'after-tab-hidden');
        await page.evaluate(() => {
          delete (document as { visibilityState?: unknown }).visibilityState;
          delete (document as { hidden?: unknown }).hidden;
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await expectReleasedAndPlayable();
      });
      await test.step('window focus lost', async () => {
        await holdBoth();
        await evidence(page, info, 'before-window-blur');
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await evidence(page, info, 'after-window-blur');
        await expectReleasedAndPlayable();
      });
    });

    test('I a finger held on the edge beside the pads makes no sound and leaves other fingers playing', async ({ page }) => {
      await load(page);
      const input = await session(page);
      const grid = (await pad(page, '3,0').boundingBox())!;
      const edge = { id: 9, x: grid.x - 20, y: grid.y + grid.height / 2 };
      expect(await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return !!element && !element.closest('[data-pad], button, a, input');
      }, edge), 'the edge point is plain background').toBe(true);
      const [a, b] = await contacts(page, ['3,1', '4,6']);

      await touch(input, 'touchStart', [edge]);
      // A resting finger drifts a little; it stays on the edge.
      await touch(input, 'touchMove', [{ ...edge, x: edge.x + 8, y: edge.y + 6 }]);
      await expectHeld(page, [], 0);
      await touch(input, 'touchStart', [edge, a]);
      await expectHeld(page, ['3,1'], 1);
      await touch(input, 'touchEnd', [a]);
      await expectHeld(page, [], 1);
      expect(await stops(page)).toEqual([1]);
      await touch(input, 'touchStart', [edge, b]);
      await expectHeld(page, ['4,6'], 2);
      await touch(input, 'touchEnd', [edge]);
      await expectHeld(page, ['4,6'], 2);
      expect(await stops(page)).toEqual([1]);
      await touch(input, 'touchEnd', []);
      await expectHeld(page, [], 2);
      expect(await stops(page)).toEqual([1, 2]);
    });
  });
}
