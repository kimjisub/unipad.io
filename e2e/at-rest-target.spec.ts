import { test, expect, type Page } from '@playwright/test';
import { hitReport, notAtRest } from '../src/components/play/hitTarget.testUtils.mjs';

// The CDP size regressions (src/components/play/*.browser.mjs) press a control in a list that moves
// by itself, as the store list does when it scrolls to the chosen pack, only once `notAtRest` is null.
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
const toEnd = (page: Page) => page.evaluate(() => { const area = document.getElementById('list')!; area.scrollTop = area.scrollHeight; });
const atRest = (page: Page) => expect.poll(() => page.evaluate(notAtRest(play)), { timeout: 5000 }).toBeNull();

test.use({ viewport: { width: 390, height: 300 } });

const centre = async (page: Page) => (await page.evaluate(hitReport(play)) as { point: { x: number; y: number } }).point;

test('a press released after the list has moved goes to the row, not to the pressed button', async ({ page }) => {
  await page.setContent(list);
  await toEnd(page);
  const { x, y } = await centre(page);

  await page.mouse.move(x, y);
  await page.mouse.down();
  // 30px moves the 28px button off the pointer while the 80px row stays under it.
  await page.evaluate(() => { document.getElementById('list')!.scrollTop -= 30; });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { clicks: string[] }).clicks)).toEqual(['row']);
});

test('a button is not at rest while its list scrolls, and a press once it is reaches it', async ({ page }) => {
  await page.setContent(list);
  await page.evaluate(() => (window as unknown as { glide: (ms: number) => void }).glide(1500));
  expect(await page.evaluate(notAtRest(play))).toMatch(/^(scrolled: div#list|moved)$/);

  await atRest(page);
  const { x, y } = await centre(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { clicks: string[] }).clicks)).toEqual(['play', 'row']);
});

// The store scrolls to the chosen pack with scrollIntoView({ behavior: 'smooth' }); the browser
// runs that scroll itself and the page sees its progress only at drawn frames.
test('a button is not at rest while the browser scrolls it into view, and is once it is in view', async ({ page }) => {
  await page.setContent(list);
  // Started in the same evaluation as the check, so the scroll cannot end before the check begins.
  expect(await page.evaluate(`(document.querySelector('[data-row="11"]').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), ${notAtRest(play)})`))
    .toMatch(/^(scrolled: div#list|moved)$/);

  await atRest(page);
  expect(await page.evaluate(() => { const area = document.getElementById('list')!; return area.scrollHeight - area.clientHeight - area.scrollTop; })).toBeLessThan(1);
});

// Two readings a timer apart see the same place here, although the button was away in between.
test('a scroll that comes back to the same place during the wait is not rest', async ({ page }) => {
  await page.setContent(list);
  await toEnd(page);
  // The scroll event of toEnd arrives at the next drawn frame; without this it alone would pass the test.
  await atRest(page);
  const waiting = page.evaluate(notAtRest(play, { ms: 600, frames: 3 }));
  await page.evaluate(async () => {
    const area = document.getElementById('list')!;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await frame(); area.scrollTop -= 30; await frame(); await frame(); area.scrollTop += 30;
  });
  expect(await waiting).toBe('scrolled: div#list');
  await atRest(page);
});

// The store's rows enter from 6px lower and transparent; a busy page can show a row at that first
// frame for longer than the wait, with no animation started yet.
test('a button in a row that is fading in, or not yet started, is not at rest until the row has entered', async ({ page }) => {
  await page.setContent(list.replace('<body style="margin:0">', `<body style="margin:0">
    <style>@keyframes enter { from { opacity: 0; transform: translateY(6px); } }</style>`));
  await toEnd(page);
  const row = await page.$('[data-row="11"]');

  await row!.evaluate(e => { e.style.opacity = '0'; });
  expect(await page.evaluate(notAtRest(play))).toBe('faded: div[data-row="11"] opacity 0');

  await row!.evaluate(e => { e.style.opacity = ''; e.style.animation = 'enter 1500ms ease-out'; });
  expect(await page.evaluate(notAtRest(play))).toMatch(/^(faded|animating): div\[data-row="11"\]/);
  await atRest(page);
});

test('a missing control is never at rest', async ({ page }) => {
  await page.setContent(list);
  expect(await page.evaluate(notAtRest(`document.querySelector('[aria-label="Close"]')`))).toBe('missing');
});
