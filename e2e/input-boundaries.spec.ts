import type { Page, TestInfo } from '@playwright/test';
import { test, expect, stateTimeout } from './browser';
import { chain2, lit, pad, point, touch, touchScreens } from './touch';
import { duration, loadInputPack } from './input-fixture';

test.use({ hasTouch: true });
const audio = (page: Page) => page.evaluate(() => window.browserProbe.audio);
const events = (page: Page) => page.evaluate(() => window.inputBoundaryEvents);
const ends = ['pointerup', 'pointercancel', 'lostpointercapture'];
async function held(page: Page, positions: string[], requested: string[], chain = 1) {
  await expect.poll(() => lit(page), { timeout: stateTimeout }).toEqual([...positions].sort());
  const record = await audio(page);
  expect(record.starts).toHaveLength(requested.length);
  record.starts.forEach((start, i) => {
    expect(start.loop).toBe(true);
    expect(start.duration).toBeCloseTo(duration(8, 8, requested[i], chain), 4);
  });
}
async function stopped(page: Page, ids: number[]) {
  await expect.poll(async () => (await audio(page)).stops.toSorted((a, b) => a - b), { timeout: stateTimeout }).toEqual(ids);
}
const json = (info: TestInfo, name: string, data: unknown) =>
  info.attach(name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
async function evidence(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await json(info, `${name}-pointer-events`, await events(page));
  await json(info, `${name}-requests`, await audio(page));
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
    // Out from the laptop size and back, then on to phone landscape so the release happens in another layout.
    const trip = [...screens, ...screens.toReversed().slice(1, -1)];
    for (const [step, screen] of trip.entries()) {
      await test.step(screen.name, async () => {
        await page.setViewportSize({ width: screen.width, height: screen.height });
        // The existing grid remains mounted under the portrait overlay and keeps capture.
        await held(page, ['2,2'], ['2,2']);
        await stopped(page, []);
        await evidence(page, info, `${mode}-${step}-${screen.name.replaceAll(' ', '-')}`);
      });
    }
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
    const downs = (await events(page)).filter(e => e.type === 'pointerdown' && e.target?.includes(','));
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
      // The background finger really went down: one trusted touch outside every pad and control.
      const downs = async () => (await events(page)).filter(e => e.type === 'pointerdown');
      await expect.poll(downs, { timeout: stateTimeout }).toHaveLength(1);
      const [margin] = await downs();
      expect(margin).toMatchObject({ pointerType: 'touch', trusted: true, target: null });
      const marginEnds = async () => (await events(page)).filter(e => e.pointerId === margin.pointerId && ends.includes(e.type));
      await held(page, [], []);
      const chainBox = (await chain2(page).boundingBox())!;
      const chain = { id: 2, x: chainBox.x + chainBox.width / 2, y: chainBox.y + chainBox.height / 2 };
      await touch(input, 'touchStart', [edge, chain]);
      await touch(input, 'touchEnd', [chain]);
      await expect(chain2(page).locator('div[style*="background-color"]')).toHaveCount(1);
      await held(page, [], []);
      const afterChain = await events(page);
      // Exactly one control press, on chain 2, from a second trusted finger.
      expect(afterChain.filter(e => e.type === 'pointerdown' && e.target !== null && !e.target.includes(',')))
        .toMatchObject([{ target: 'Chain 10', pointerType: 'touch', trusted: true }]);
      expect(afterChain.filter(e => e.type === 'pointerdown' && e.target === 'Chain 10')[0].pointerId).not.toBe(margin.pointerId);
      expect(afterChain.filter(e => e.type === 'pointerup')).toHaveLength(1);
      expect(await marginEnds()).toEqual([]);
      await evidence(page, info, 'background-held-chain-selected');
      // The background contact is still down while a new chain's pad sounds.
      const next = await point(page, '7,7', 3);
      await touch(input, 'touchStart', [edge, next]);
      await held(page, ['7,7'], ['7,7'], 2);
      await touch(input, 'touchEnd', [next]);
      await held(page, [], ['7,7'], 2);
      await stopped(page, [1]);
      expect(await marginEnds(), 'background finger stays down until the last touchEnd').toEqual([]);
      await touch(input, 'touchEnd', []);
      await expect.poll(async () => (await marginEnds()).map(e => e.type), { timeout: stateTimeout }).toContain('pointerup');
      await held(page, [], ['7,7'], 2);
      await stopped(page, [1]);
      await evidence(page, info, 'margin-and-pad-released');
    });
  });
}
