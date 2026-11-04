import { test, expect, type Page } from '@playwright/test';
import { hitReport, still } from '../src/components/play/hitTarget.testUtils.mjs';

// The CDP size regressions (src/components/play/*.browser.mjs) wait for `still` before pressing a
// control in a list that moves by itself, as the store list does when it scrolls to the chosen pack.
// A list of twelve 80px rows in a 300px scrolling area; only the last row has a button.
const list = `<body style="margin:0">
  <div id="list" style="height:300px;overflow-y:auto">
    ${Array.from({ length: 12 }, (_, i) => `<div data-row="${i}" style="height:80px;display:flex;align-items:center;justify-content:flex-end">${
      i === 11 ? '<button style="width:93px;height:28px;margin-right:16px">Play</button>' : ''}</div>`).join('')}
  </div>
  <script>
    window.clicks = [];
    document.querySelector('[data-row="11"]').addEventListener('click', () => clicks.push('row'));
    document.querySelector('button').addEventListener('click', () => clicks.push('play'));
    // Scrolls to the end over the given time, as smooth scrolling to a selected row does.
    window.glide = ms => {
      const area = document.getElementById('list'), end = area.scrollHeight - area.clientHeight, start = performance.now();
      const step = now => { area.scrollTop = end * Math.min(1, (now - start) / ms); if (now - start < ms) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
  </script></body>`;
const play = `document.querySelector('button')`;

test.use({ viewport: { width: 390, height: 300 } });

const centre = async (page: Page) => (await page.evaluate(hitReport(play)) as { point: { x: number; y: number } }).point;

test('a press released after the list has moved goes to the row, not to the pressed button', async ({ page }) => {
  await page.setContent(list);
  await page.evaluate(() => { const area = document.getElementById('list')!; area.scrollTop = area.scrollHeight; });
  const { x, y } = await centre(page);

  await page.mouse.move(x, y);
  await page.mouse.down();
  // 30px moves the 28px button off the pointer while the 80px row stays under it.
  await page.evaluate(() => { document.getElementById('list')!.scrollTop -= 30; });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { clicks: string[] }).clicks)).toEqual(['row']);
});

test('a button is not still while its list scrolls, and a press once it is still reaches it', async ({ page }) => {
  await page.setContent(list);
  await page.evaluate(() => (window as unknown as { glide: (ms: number) => void }).glide(1500));
  expect(await page.evaluate(still(play))).toBe(false);

  await expect.poll(() => page.evaluate(still(play)), { timeout: 5000 }).toBe(true);
  const { x, y } = await centre(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { clicks: string[] }).clicks)).toEqual(['play', 'row']);
});

// The store's rows enter from 6px lower and transparent; a busy page can show a row at that first
// frame for longer than `still` waits, with no animation started yet.
test('a button in a row that is fading in, or not yet started, is not still until the row has entered', async ({ page }) => {
  await page.setContent(list.replace('<body style="margin:0">', `<body style="margin:0">
    <style>@keyframes enter { from { opacity: 0; transform: translateY(6px); } }</style>`));
  await page.evaluate(() => { const area = document.getElementById('list')!; area.scrollTop = area.scrollHeight; });
  const row = await page.$('[data-row="11"]');

  await row!.evaluate(e => { e.style.opacity = '0'; });
  expect(await page.evaluate(still(play))).toBe(false);

  await row!.evaluate(e => { e.style.opacity = ''; e.style.animation = 'enter 1500ms ease-out'; });
  expect(await page.evaluate(still(play))).toBe(false);
  await expect.poll(() => page.evaluate(still(play)), { timeout: 5000 }).toBe(true);
});

test('a missing control is never still', async ({ page }) => {
  await page.setContent(list);
  expect(await page.evaluate(still(`document.querySelector('[aria-label="Close"]')`))).toBe(false);
});
