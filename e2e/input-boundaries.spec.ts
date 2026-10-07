import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './browser';
import { pad, point, touch } from './touch';
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
