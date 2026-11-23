import type { Page, TestInfo } from '@playwright/test';
import { test, expect, stateTimeout } from './browser';
import { duration, loadInputPack } from './input-fixture';
import { rotatePrompt } from './touch';

const screens = [
  { name: 'compact phone', viewport: { width: 667, height: 320 } },
  { name: 'phone', viewport: { width: 844, height: 390 } },
  { name: 'tablet', viewport: { width: 1180, height: 820 } },
  { name: 'laptop', viewport: { width: 1280, height: 800 } },
  // Portrait tablets play directly, so every pad is pressed, not only the outer edges.
  { name: 'smallest portrait tablet', viewport: { width: 600, height: 960 }, everyPad: true },
  { name: 'iPad mini portrait', viewport: { width: 744, height: 1133 }, everyPad: true },
  { name: 'portrait tablet', viewport: { width: 834, height: 1210 }, everyPad: true },
  { name: 'large portrait tablet', viewport: { width: 1032, height: 1244 }, everyPad: true },
];
const bounds = (page: Page) => page.locator('[data-pad]').evaluateAll(elements => elements.map(element => {
  const rect = element.getBoundingClientRect();
  return { position: element.getAttribute('data-pad')!, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}));
// A press shows within a frame or two; the default first retry after 100 ms adds up over every edge press.
const poll = { intervals: [16, 32, 64, 100], timeout: stateTimeout };
// 0 and 1 are a pad's outer edges, so the grid's border pads are pressed near the border.
const edgeOffset = (index: number, last: number) => index === 0 ? 0 : index === last ? 1 : 0.5;
const playback = (page: Page) => page.evaluate(() => ({
  lit: Array.from(document.querySelectorAll('[data-pad]:has(img[src="/theme/btn_.png"])'),
    pad => pad.getAttribute('data-pad')!).sort(),
  starts: window.browserProbe.audio.starts,
  stops: window.browserProbe.audio.stops,
  press: window.inputBoundaryEvents.findLast(event => event.type === 'pointerdown'),
}));
async function record(page: Page, info: TestInfo, name: string) {
  await info.attach(`${name}-geometry-and-input`, {
    body: JSON.stringify({ platform: process.platform, audioProcess: process.env.E2E_FIREFOX_AUDIO_PROCESS ?? 'page',
      pads: await bounds(page), audio: await page.evaluate(() => window.browserProbe.audio),
      events: await page.evaluate(() => window.inputBoundaryEvents) }, null, 2),
    contentType: 'application/json',
  });
  await info.attach(`${name}-screen`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
}

// Teardown has its own budget, so a timed-out press still leaves the received input and geometry.
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await record(page, info, 'failed-input');
});

// Each test decodes a two-chain pack and presses up to 17 edge pads, or every pad on portrait tablets, with trusted mouse input. On a busy
// shared machine one browser round trip can take 300 ms, which put the 8x8 tests at 20-28 s of the 30 s default.
test.describe.configure({ timeout: 60_000 });

for (const screen of screens) {
  for (const shape of [{ rows: 8, cols: 8 }, { rows: 3, cols: 4 }]) {
    test.describe(`${screen.name}: ${shape.cols}x${shape.rows}`, () => {
      test.use({ viewport: screen.viewport });
      for (const square of [true, false]) {
        const label = square ? 'square' : 'rectangular';
        test(`${label} pads fit and play ${screen.everyPad ? 'every pad' : 'every bottom and right edge'}`, async ({ page }, info) => {
          test.slow(!!screen.everyPad);
          await loadInputPack(page, shape.rows, shape.cols, square);
          expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }))).toEqual({
            ...screen.viewport, reducedMotion: false,
          });
          await expect.poll(async () => (await bounds(page))[0].width, poll).toBeGreaterThan(1);
          await expect(rotatePrompt(page)).toBeHidden();
          await record(page, info, `${label}-before-input`);
          // Pressing a pad never moves the layout; the hit test below still checks each point at press time.
          const pads = await bounds(page);
          for (const r of pads) {
            expect(r.x, `${label} ${r.position} left edge`).toBeGreaterThanOrEqual(0);
            expect(r.y, `${label} ${r.position} top edge`).toBeGreaterThanOrEqual(0);
            expect(r.x + r.width, `${label} ${r.position} right edge`).toBeLessThanOrEqual(screen.viewport.width);
            expect(r.y + r.height, `${label} ${r.position} bottom edge`).toBeLessThanOrEqual(screen.viewport.height);
          }
          const lastRow = shape.rows - 1;
          const lastCol = shape.cols - 1;
          const locations = screen.everyPad ? pads.map(({ position }) => {
            const [row, col] = position.split(',').map(Number);
            return { position, x: edgeOffset(col, lastCol), y: edgeOffset(row, lastRow) };
          }) : [
            { position: '0,0', x: 0, y: 0 },
            { position: `0,${lastCol}`, x: 1, y: 0 },
            ...Array.from({ length: shape.cols }, (_, col) => ({ position: `${lastRow},${col}`, x: col === 0 ? 0 : 1, y: 1 })),
            ...Array.from({ length: shape.rows - 1 }, (_, row) => ({ position: `${row},${lastCol}`, x: 1, y: 0.5 })),
          ];
          for (const [index, location] of locations.entries()) {
            const r = pads.find(r => r.position === location.position)!;
            // Native mouse input two CSS pixels inside the outer edges; never scroll a pad.
            const point = { x: r.x + 2 + (r.width - 4) * location.x, y: r.y + 2 + (r.height - 4) * location.y };
            expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-pad]')?.getAttribute('data-pad'), point)).toBe(location.position);
            await page.mouse.move(point.x, point.y);
            await page.mouse.down();
            let audio: Awaited<ReturnType<typeof playback>>;
            await expect.poll(async () => {
              audio = await playback(page);
              return { lit: audio.lit, starts: audio.starts.length };
            }, poll).toEqual({ lit: [location.position], starts: index + 1 });
            // Firefox rounds native mouse coordinates down to whole CSS pixels. Check what the app
            // actually received as well as its lights and audio, so a browser offset is explicit.
            expect(Math.abs(audio!.press!.clientX - point.x)).toBeLessThan(1);
            expect(Math.abs(audio!.press!.clientY - point.y)).toBeLessThan(1);
            expect(audio!.press!.hitPad).toBe(location.position);
            expect(audio!.starts).toHaveLength(index + 1);
            expect(audio!.starts[index].duration).toBeCloseTo(duration(shape.rows, shape.cols, location.position), 4);
            expect(audio!.starts[index].loop).toBe(true);
            await page.mouse.up();
            await expect.poll(async () => {
              const state = await playback(page);
              return { lit: state.lit, stops: state.stops };
            }, poll).toEqual({ lit: [], stops: Array.from({ length: index + 1 }, (_, i) => i + 1) });
          }
          const events = await page.evaluate(() => window.inputBoundaryEvents.filter(event => event.type === 'pointerdown'));
          expect(events).toHaveLength(locations.length);
          expect(events.every(event => event.trusted && event.pointerType === 'mouse')).toBe(true);
          await record(page, info, `${label}-after-release`);
        });
      }
    });
  }
}

test('the rotate prompt covers the pads only below the tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 834 });
  await loadInputPack(page);
  await expect(rotatePrompt(page)).toBeVisible();
  await page.setViewportSize({ width: 599, height: 960 });
  await expect(rotatePrompt(page)).toBeVisible();
  await page.setViewportSize({ width: 600, height: 960 });
  await expect(rotatePrompt(page)).toBeHidden();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(rotatePrompt(page)).toBeHidden();
});
