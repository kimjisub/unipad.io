import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertReachable, hitReport, settled } from '../src/components/play/hitTarget.testUtils.mjs';

// The CDP size regressions (src/components/play/*.browser.mjs) refuse to press a control whose
// centre is not its own. These cases check what such a failure leaves behind for diagnosis.
// The menu's Quit button sits where the 800x300 landscape player draws it: centre (660.5, 272).
const quit = `document.querySelector('button[aria-label="Quit"]')`;
const menu = (buttonTop: number, cover = '') => `<body style="margin:0">
  <div role="dialog" style="position:fixed;left:560px;top:20px;width:220px;height:280px">
    <button aria-label="Quit" style="position:absolute;left:40px;top:${buttonTop - 20}px;width:121px;height:44px">Quit</button>
  </div>${cover}</body>`;
const cover = '<div data-test-cover="bottom strip" style="position:fixed;left:0;right:0;bottom:0;height:60px;z-index:10;background:rgba(0,0,0,.6)"></div>';

test.use({ viewport: { width: 800, height: 300 } });

async function cdp(page: Page) {
  const session = await page.context().newCDPSession(page);
  const run = async (expression: string) => {
    const { result, exceptionDetails } = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
    return result.value;
  };
  const command = (method: string, params?: object) => session.send(method as 'Page.captureScreenshot', params);
  return { run, command };
}

async function failureFiles(dir: string) {
  const names = (await readdir(dir)).sort();
  const json = names.find(name => name.endsWith('.json'));
  expect(json, `a record in ${names.join(', ')}`).toBeDefined();
  const record = JSON.parse(await readFile(join(dir, json!), 'utf8'));
  return { names, record };
}

let dir = '';
test.beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'unreachable-target-')); });
test.afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test('a control covered by another element fails with what covers it, where, and a screenshot', async ({ page }) => {
  await page.setContent(menu(250, cover));
  const { run, command } = await cdp(page);
  const report = await run(hitReport(quit));

  const failure = await assertReachable({ report, target: quit, label: 'Quit', dir, run, command }).then(() => null, (error: Error) => error);
  expect(failure?.message).toMatch(/^Target clipped or covered: Quit\n/);
  // The log alone names the covering element, even when the files are lost.
  expect(failure?.message).toContain('"data-test-cover": "bottom strip"');

  const { names, record } = await failureFiles(dir);
  expect(record.report).toMatchObject({
    reachable: false,
    point: { x: 660.5, y: 272 },
    target: { tag: 'button', attributes: { 'aria-label': 'Quit' }, rect: { left: 600, top: 250, width: 121, height: 44 } },
    hit: { tag: 'div', attributes: { 'data-test-cover': 'bottom strip' }, rect: { left: 0, top: 240, width: 800, height: 60 } },
    viewport: { width: 800, height: 300 },
  });
  expect(record.report.stack.slice(0, 2)).toEqual(['div[data-test-cover="bottom strip"]', 'button[aria-label="Quit"]']);
  // Read again after the screenshot; the cover has not moved, so it still fails the same way.
  expect(record.afterScreenshot).toMatchObject({ reachable: false, hit: { tag: 'div' } });

  const png = names.find(name => name.endsWith('.png'));
  expect(record.screenshot).toBe(join(dir, png!));
  const image = await readFile(record.screenshot);
  expect(image.subarray(1, 4).toString()).toBe('PNG');
  expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([800, 300]);
});

test('a control whose centre is below the screen fails with no element at that point', async ({ page }) => {
  await page.setContent(menu(320));
  const { run, command } = await cdp(page);
  const report = await run(hitReport(quit));

  await expect(assertReachable({ report, target: quit, label: 'Quit', dir, run, command })).rejects.toThrow(/^Target clipped or covered: Quit\n/);
  const { record } = await failureFiles(dir);
  expect(record.report).toMatchObject({ reachable: false, point: { x: 660.5, y: 342 }, hit: null, stack: [], viewport: { height: 300 } });
});

test('a reachable control passes and leaves no files', async ({ page }) => {
  await page.setContent(menu(250));
  const { run, command } = await cdp(page);
  const report = await run(hitReport(quit));

  expect(report).toMatchObject({ reachable: true, point: { x: 660.5, y: 272 }, hit: { tag: 'button' } });
  await assertReachable({ report, target: quit, label: 'Quit', dir, run, command });
  expect(await readdir(dir)).toEqual([]);
});

test('a caller that also checks clipping reads the target again with its own check', async ({ page }) => {
  await page.setContent(menu(250));
  const { run, command } = await cdp(page);
  const clipped = { reachable: false, clip: { bottom: 260 } };

  const failure = await assertReachable({ report: clipped, target: quit, label: 'Quit', dir, run, command, reread: async () => clipped })
    .then(() => null, (error: Error) => error);
  expect(failure?.message).toMatch(/^Target clipped or covered: Quit\n/);
  // Without its own check, the second reading would see the button's centre and call it reachable.
  const { record } = await failureFiles(dir);
  expect(record.afterScreenshot).toEqual(clipped);
});

// The menu slides in from the right (OptionPanel's slide-in-right). The size regressions press
// Quit only after `settled` is true, rather than after a fixed delay.
const slidingMenu = (duration: string, inner = '') => `<body style="margin:0">
  <style>
    @keyframes slide-in { from { transform: translateX(280px); } to { transform: translateX(0); } }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  <div role="dialog" style="position:fixed;right:0;top:0;bottom:0;width:280px;animation:slide-in ${duration} ease-out">
    <div><button aria-label="Quit" style="position:absolute;left:40px;top:230px;width:121px;height:44px">Quit${inner}</button></div>
  </div></body>`;

test('a control is not settled while its menu is still sliding in, and is once the slide ends', async ({ page }) => {
  // A slide far longer than the test's own time limit, so every reading below happens mid-slide
  // however slowly the page runs; the test then ends the slide itself instead of waiting for it.
  await page.setContent(slidingMenu('600s'));
  expect(await page.evaluate(settled(quit))).toBe(false);
  // A press now would miss: the centre is still off to the right of where the button comes to rest.
  const moving = await page.evaluate(hitReport(quit)) as { point: { x: number } };
  expect(moving.point.x).toBeGreaterThan(620.5);

  await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
  expect(await page.evaluate(settled(quit))).toBe(true);
  expect(await page.evaluate(hitReport(quit))).toMatchObject({ reachable: true, point: { x: 620.5, y: 252 } });
});

test('an animation inside the control does not hold the wait, and a missing control is never settled', async ({ page }) => {
  await page.setContent(slidingMenu('0s', '<span style="display:inline-block;animation:spin 1s linear infinite">.</span>'));
  expect(await page.evaluate(settled(quit))).toBe(true);
  expect(await page.evaluate(settled(`document.querySelector('button[aria-label="Close"]')`))).toBe(false);
});
