import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './browser';
import { duration, loadInputPack } from './input-fixture';

const screens = [
  { name: 'compact phone', viewport: { width: 667, height: 320 } },
  { name: 'phone', viewport: { width: 844, height: 390 } },
  { name: 'tablet', viewport: { width: 1180, height: 820 } },
  { name: 'laptop', viewport: { width: 1280, height: 800 } },
];
const bounds = (page: Page) => page.locator('[data-pad]').evaluateAll(elements => elements.map(element => {
  const rect = element.getBoundingClientRect();
  return { position: element.getAttribute('data-pad')!, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}));
const lit = (page: Page) => page.locator('[data-pad]:has(img[src="/theme/btn_.png"])')
  .evaluateAll(elements => elements.map(element => element.getAttribute('data-pad')));
async function record(page: Page, info: TestInfo, name: string) {
  await info.attach(`${name}-screen`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await info.attach(`${name}-geometry-and-input`, {
    body: JSON.stringify({ pads: await bounds(page), audio: await page.evaluate(() => window.browserProbe.audio),
      events: await page.evaluate(() => window.inputBoundaryEvents) }, null, 2),
    contentType: 'application/json',
  });
}

for (const screen of screens) {
  for (const shape of [{ rows: 8, cols: 8 }, { rows: 3, cols: 4 }]) {
    test.describe(`${screen.name}: ${shape.cols}x${shape.rows}`, () => {
      test.use({ viewport: screen.viewport });
      test('square and rectangular pads fit and play every bottom and right edge', async ({ page }, info) => {
        for (const square of [true, false]) {
          await loadInputPack(page, shape.rows, shape.cols, square);
          await expect.poll(async () => (await bounds(page))[0].width).toBeGreaterThan(1);
          const label = square ? 'square' : 'rectangular';
          await record(page, info, `${label}-before-input`);
          for (const r of await bounds(page)) {
            expect(r.x, `${label} ${r.position} left edge`).toBeGreaterThanOrEqual(0);
            expect(r.y, `${label} ${r.position} top edge`).toBeGreaterThanOrEqual(0);
            expect(r.x + r.width, `${label} ${r.position} right edge`).toBeLessThanOrEqual(screen.viewport.width);
            expect(r.y + r.height, `${label} ${r.position} bottom edge`).toBeLessThanOrEqual(screen.viewport.height);
          }
          const lastRow = shape.rows - 1;
          const lastCol = shape.cols - 1;
          const locations = [
            { position: '0,0', x: 0, y: 0 },
            { position: `0,${lastCol}`, x: 1, y: 0 },
            ...Array.from({ length: shape.cols }, (_, col) => ({ position: `${lastRow},${col}`, x: col === 0 ? 0 : 1, y: 1 })),
            ...Array.from({ length: shape.rows - 1 }, (_, row) => ({ position: `${row},${lastCol}`, x: 1, y: 0.5 })),
          ];
          for (const [index, location] of locations.entries()) {
            const r = (await bounds(page)).find(r => r.position === location.position)!;
            // Native mouse input two CSS pixels inside the outer edges; never scroll a pad.
            const point = { x: r.x + 2 + (r.width - 4) * location.x, y: r.y + 2 + (r.height - 4) * location.y };
            expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-pad]')?.getAttribute('data-pad'), point)).toBe(location.position);
            await page.mouse.move(point.x, point.y);
            await page.mouse.down();
            await expect.poll(() => lit(page)).toEqual([location.position]);
            const audio = await page.evaluate(() => window.browserProbe.audio);
            expect(audio.starts).toHaveLength(index + 1);
            expect(audio.starts[index].duration).toBeCloseTo(duration(shape.rows, shape.cols, location.position), 4);
            expect(audio.starts[index].loop).toBe(true);
            await page.mouse.up();
            await expect.poll(() => lit(page)).toEqual([]);
            await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual(Array.from({ length: index + 1 }, (_, i) => i + 1));
          }
          const events = await page.evaluate(() => window.inputBoundaryEvents.filter(event => event.type === 'pointerdown'));
          expect(events).toHaveLength(locations.length);
          expect(events.every(event => event.trusted && event.pointerType === 'mouse')).toBe(true);
          await record(page, info, `${label}-after-release`);
        }
      });
    });
  }
}
