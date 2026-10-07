import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './browser';
import { pad, point, touch, touchScreens } from './touch';
import { duration, loadInputPack } from './input-fixture';

test.use({ hasTouch: true });
const chain2 = (page: Page) => page.getByRole('button', { name: 'Chain 10', exact: true });
const audio = (page: Page) => page.evaluate(() => window.browserProbe.audio);
const lit = (page: Page) => page.locator('[data-pad]:has(img[src="/theme/btn_.png"])')
  .evaluateAll(pads => pads.map(p => (p as HTMLElement).dataset.pad!).sort());
async function held(page: Page, positions: string[], requested: string[], chain = 1, rows = 8, cols = 8) {
  await expect.poll(() => lit(page)).toEqual([...positions].sort());
  const record = await audio(page);
  expect(record.starts).toHaveLength(requested.length);
  record.starts.forEach((start, i) => {
    expect(start.loop).toBe(true);
    expect(start.duration).toBeCloseTo(duration(rows, cols, requested[i], chain), 4);
  });
}
async function stopped(page: Page, ids: number[]) {
  await expect.poll(async () => (await audio(page)).stops.toSorted((a, b) => a - b)).toEqual(ids);
}
async function evidence(page: Page, info: TestInfo, name: string) {
  const screenshot = info.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot });
  await info.attach(name, { path: screenshot, contentType: 'image/png' });
  await info.attach(`${name}-pointer-events`, {
    body: JSON.stringify(await page.evaluate(() => window.inputBoundaryEvents), null, 2), contentType: 'application/json',
  });
  await info.attach(`${name}-requests`, {
    body: JSON.stringify(await audio(page), null, 2), contentType: 'application/json',
  });
}
const screens = [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'tablet', width: 1180, height: 820 },
  { name: 'laptop', width: 1280, height: 800 },
];

for (const mode of ['mouse', 'touch'] as const) {
  test(`${mode}: held input survives viewport round trips and releases after layout changes`, async ({ page, context, browserName }, info) => {
    test.skip(mode === 'touch' && browserName !== 'chromium', 'WebKit has no CDP session or multi-contact touch API; mouse resize runs separately.');
    await loadInputPack(page);
    const input = mode === 'touch' ? await context.newCDPSession(page) : null;
    const finger = await point(page, '2,2', 1);
    if (input) await touch(input, 'touchStart', [finger]);
    else { await page.mouse.move(finger.x, finger.y); await page.mouse.down(); }
    await held(page, ['2,2'], ['2,2']);
    await stopped(page, []);
    await evidence(page, info, `${mode}-before-resize`);
    for (const [step, screen] of [...screens, ...screens.toReversed()].entries()) {
      await test.step(screen.name, async () => {
        await page.setViewportSize({ width: screen.width, height: screen.height });
        // The existing grid remains mounted under the portrait overlay and keeps capture.
        await held(page, ['2,2'], ['2,2']);
        await stopped(page, []);
        await evidence(page, info, `${mode}-${step}-${screen.name.replaceAll(' ', '-')}`);
      });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    if (input) await touch(input, 'touchEnd', []); else await page.mouse.up();
    await held(page, [], ['2,2']);
    await stopped(page, [1]);
    const next = await point(page, '7,7', 2);
    if (input) await touch(input, 'touchStart', [next]);
    else { await page.mouse.move(next.x, next.y); await page.mouse.down(); }
    await held(page, ['7,7'], ['2,2', '7,7']);
    if (input) await touch(input, 'touchEnd', []); else await page.mouse.up();
    await held(page, [], ['2,2', '7,7']);
    await stopped(page, [1, 2]);
    await evidence(page, info, `${mode}-released-after-resize`);
  });
}

test('mouse: press, drag to a neighbour, release and click a different chain', async ({ page }, info) => {
  await loadInputPack(page);
  const a = await point(page, '2,2', 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await held(page, ['2,2'], ['2,2']);
  const b = await point(page, '2,3', 1);
  await page.mouse.move(b.x, b.y);
  await held(page, ['2,3'], ['2,2', '2,3']);
  await stopped(page, [1]);
  await page.mouse.up();
  await held(page, [], ['2,2', '2,3']);
  await stopped(page, [1, 2]);
  await chain2(page).click();
  await expect(chain2(page).locator('div[style*="background-color"]')).toHaveCount(1);
  await pad(page, '7,7').click();
  const record = await audio(page);
  expect(record.starts).toHaveLength(3);
  expect(record.starts[2].duration).toBeCloseTo(duration(8, 8, '7,7', 2), 4);
  await expect.poll(() => lit(page)).toEqual([]);
  await stopped(page, [1, 2, 3]);
  await evidence(page, info, 'mouse-chain-released');
});

for (const order of ['mouse then touch', 'touch then mouse']) {
  test(`mixed: ${order}, release the second input before the first`, async ({ page, context, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'WebKit only exposes tap(), which cannot keep a touch down alongside a mouse; CDP is Chromium-only.');
    await loadInputPack(page);
    const input = await context.newCDPSession(page);
    const mouse = await point(page, '2,2', 1);
    const finger = await point(page, '5,5', 2);
    const mouseDown = async () => { await page.mouse.move(mouse.x, mouse.y); await page.mouse.down(); };
    const mouseFirst = order.startsWith('mouse');
    const requested = mouseFirst ? ['2,2', '5,5'] : ['5,5', '2,2'];
    if (mouseFirst) await mouseDown(); else await touch(input, 'touchStart', [finger]);
    await held(page, [requested[0]], [requested[0]]);
    await stopped(page, []);
    if (mouseFirst) await touch(input, 'touchStart', [finger]); else await mouseDown();
    await held(page, ['2,2', '5,5'], requested);
    const downs = await page.evaluate(() => window.inputBoundaryEvents.filter(e => e.type === 'pointerdown' && e.target?.includes(',')));
    expect(downs.map(e => e.pointerType)).toEqual(mouseFirst ? ['mouse', 'touch'] : ['touch', 'mouse']);
    expect(downs.every(e => e.trusted)).toBe(true);
    expect(new Set(downs.map(e => e.pointerId)).size).toBe(2);
    await stopped(page, []);
    await evidence(page, info, `both-held-${mouseFirst ? 'mouse-first' : 'touch-first'}`);
    if (mouseFirst) await touch(input, 'touchEnd', []); else await page.mouse.up();
    await held(page, [requested[0]], requested);
    await stopped(page, [2]);
    await evidence(page, info, 'second-released-first-held');
    if (mouseFirst) await page.mouse.up(); else await touch(input, 'touchEnd', []);
    await held(page, [], requested);
    await stopped(page, [1, 2]);
    await evidence(page, info, 'both-released');
  });
}

for (const screen of touchScreens) {
  test.describe(`${screen.name}: margin input`, () => {
    test.use({ viewport: screen.viewport });
    test('background touch held while another finger selects a chain makes no pad request', async ({ page, context, browserName }, info) => {
      test.skip(browserName !== 'chromium', 'WebKit tap() cannot keep the background finger down during a second touch; CDP is unavailable.');
      await loadInputPack(page);
      const input = await context.newCDPSession(page);
      const box = (await pad(page, '3,0').boundingBox())!;
      const edge = { id: 1, x: box.x - 20, y: box.y + box.height / 2 };
      expect(await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return !!el && !el.closest('[data-pad], button, a, input');
      }, edge), 'background contact is outside every pad and control').toBe(true);
      await touch(input, 'touchStart', [edge]);
      await held(page, [], []);
      const chainBox = (await chain2(page).boundingBox())!;
      const chain = { id: 2, x: chainBox.x + chainBox.width / 2, y: chainBox.y + chainBox.height / 2 };
      await touch(input, 'touchStart', [edge, chain]);
      await touch(input, 'touchEnd', [chain]);
      await expect(chain2(page).locator('div[style*="background-color"]')).toHaveCount(1);
      await held(page, [], []);
      const events = await page.evaluate(() => window.inputBoundaryEvents);
      expect(events.filter(e => e.type === 'pointerdown' && e.target === 'Chain 10')).toHaveLength(1);
      expect(events.filter(e => e.type === 'pointerup')).toHaveLength(1);
      await evidence(page, info, 'background-held-chain-selected');
      // The background contact is still down while a new chain's pad sounds.
      const next = await point(page, '7,7', 3);
      await touch(input, 'touchStart', [edge, next]);
      await held(page, ['7,7'], ['7,7'], 2);
      await touch(input, 'touchEnd', [next]);
      await held(page, [], ['7,7'], 2);
      await stopped(page, [1]);
      await touch(input, 'touchEnd', []);
      await held(page, [], ['7,7'], 2);
      await stopped(page, [1]);
      await evidence(page, info, 'margin-and-pad-released');
    });
  });
}

const shapes = [{ rows: 3, cols: 4 }, { rows: 8, cols: 8 }];
const shapeScreens = [
  { name: 'compact phone', viewport: { width: 667, height: 320 } },
  { name: 'phone', viewport: { width: 844, height: 390 } },
  { name: 'laptop', viewport: { width: 1280, height: 800 } },
];
const geometry = (page: Page) => page.locator('[data-pad]').evaluateAll(elements => elements.map(element => {
  const r = element.getBoundingClientRect();
  return { position: (element as HTMLElement).dataset.pad!, x: r.x, y: r.y, width: r.width, height: r.height };
}));
for (const screen of shapeScreens) {
  for (const shape of shapes) {
    test.describe(`${screen.name}: ${shape.cols}x${shape.rows} pad geometry`, () => {
      test.use({ viewport: screen.viewport });
      test('compare square and rectangular pads, checking changed edges and corners', async ({ page }, info) => {
        await loadInputPack(page, shape.rows, shape.cols, true);
        // Wait for the measured stage to settle, rather than reading its initial zero size.
        await expect.poll(async () => (await pad(page, '0,0').boundingBox())?.width ?? 0).toBeGreaterThan(1);
        const square = await geometry(page);
        await evidence(page, info, 'square-pad-layout');
        await loadInputPack(page, shape.rows, shape.cols, false);
        await expect.poll(async () => (await pad(page, '0,0').boundingBox())?.width ?? 0).toBeGreaterThan(1);
        const rectangular = await geometry(page);
        const changed = rectangular.some((r, i) => Math.abs(r.width - square[i].width) > 0.5 || Math.abs(r.height - square[i].height) > 0.5);
        await info.attach('pad-geometry', { body: JSON.stringify({ viewport: screen.viewport, square, rectangular, changed }, null, 2), contentType: 'application/json' });
        await evidence(page, info, 'rectangular-pad-layout');
        if (!changed) {
          info.annotations.push({ type: 'applicability', description: 'No rendered size difference at this viewport; rectangular edge comparison is not applicable.' });
          return;
        }
        // Every cell, including the last row/column, must fit and be hit-testable.
        // Never scroll a clipped pad into view: playback is a fixed stage.
        for (const r of rectangular) {
          expect(r.x, `${r.position} left edge`).toBeGreaterThanOrEqual(0);
          expect(r.y, `${r.position} top edge`).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width, `${r.position} right edge`).toBeLessThanOrEqual(screen.viewport.width);
          expect(r.y + r.height, `${r.position} bottom edge`).toBeLessThanOrEqual(screen.viewport.height);
          expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-pad]')?.getAttribute('data-pad'),
            { x: r.x + r.width / 2, y: r.y + r.height / 2 }), `${r.position} visible cell`).toBe(r.position);
        }
        const lastRow = shape.rows - 1;
        const lastCol = shape.cols - 1;
        const perimeter = [
          { position: `0,${Math.floor(lastCol / 2)}`, x: 0.5, y: 0 },
          { position: `${lastRow},${Math.floor(lastCol / 2)}`, x: 0.5, y: 1 },
          { position: `${Math.floor(lastRow / 2)},0`, x: 0, y: 0.5 },
          { position: `${Math.floor(lastRow / 2)},${lastCol}`, x: 1, y: 0.5 },
          { position: '0,0', x: 0, y: 0 },
          { position: `0,${lastCol}`, x: 1, y: 0 },
          { position: `${lastRow},0`, x: 0, y: 1 },
          { position: `${lastRow},${lastCol}`, x: 1, y: 1 },
        ];
        const requested: string[] = [];
        for (const location of perimeter) {
          const r = (await pad(page, location.position).boundingBox())!;
          // Two CSS pixels inside each outer edge/corner, avoiding adjacent cells.
          const x = r.x + 2 + (r.width - 4) * location.x;
          const y = r.y + 2 + (r.height - 4) * location.y;
          await page.mouse.move(x, y);
          await page.mouse.down();
          requested.push(location.position);
          await held(page, [location.position], requested, 1, shape.rows, shape.cols);
          await page.mouse.up();
          await held(page, [], requested, 1, shape.rows, shape.cols);
          await stopped(page, requested.map((_, i) => i + 1));
        }
        await evidence(page, info, 'rectangular-edges-released');
      });
    });
  }
}
