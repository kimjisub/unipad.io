import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { test, expect } from './browser';
import { pad, point, pressed, touch, touchScreens, type Contact } from './touch';

test.use({ hasTouch: true });
// The right strip uses circle slots 9/10 for pack chains 1/2 (offset 8).
const chain2 = (page: Page) => page.getByRole('button', { name: 'Chain 10', exact: true });

async function load(page: Page, pack = 'manual') {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve(`meta/unipack-conformance/chain-release-v1/packs/${pack}.uni`));
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded.length)).toBe(3);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}
async function tapChain(page: Page, session: CDPSession, held: Contact[]) {
  const box = await chain2(page).boundingBox();
  if (!box) throw new Error('Missing chain');
  const chainContact = { id: 9, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touch(session, 'touchStart', [...held, chainContact]);
  // CDP touchEnd lists the contacts to end; [] ends every remaining contact.
  await touch(session, 'touchEnd', [chainContact]);
  await expect(chain2(page).locator('div[style*="background-color"]')).toHaveCount(1);
}
async function evidence(page: Page, info: TestInfo, name: string) {
  const screenshot = info.outputPath(`${name}.png`);
  const audio = info.outputPath(`${name}-audio.json`);
  await page.screenshot({ path: screenshot });
  await writeFile(audio, JSON.stringify(await page.evaluate(() => window.browserProbe.audio), null, 2));
  await info.attach(name, { path: screenshot, contentType: 'image/png' });
  await info.attach(`${name}-audio`, { path: audio, contentType: 'application/json' });
}

// Also multi-touch item H (a loop held while another finger changes chain); see multi-touch.spec.ts.
for (const screen of touchScreens) {
  test.describe(`${screen.name}: H, basic feature 3: chain release and multiple screen contacts`, () => {
    test.use({ viewport: screen.viewport });

    test('CR-001 original loop releases after a second finger changes chain', async ({ page, context }, info) => {
      await load(page);
      const session = await context.newCDPSession(page);
      const a = await point(page, '0,0', 1);
      const b = await point(page, '1,0', 2);
      await touch(session, 'touchStart', [a]);
      await tapChain(page, session, [a]);
      await expect(pressed(page, '0,0')).toBeVisible();
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([]);
      await touch(session, 'touchStart', [a, b]);
      await expect(pressed(page, '0,0')).toBeVisible();
      await expect(pressed(page, '1,0')).toBeVisible();
      await evidence(page, info, 'held-after-chain-change');
      await touch(session, 'touchEnd', [a]);
      await expect(pressed(page, '0,0')).toHaveCount(0);
      await expect(pressed(page, '1,0')).toBeVisible();
      await evidence(page, info, 'original-released-other-held');
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      await expect(chain2(page).locator('div[style*="background-color"]')).toHaveCount(1);
      await touch(session, 'touchEnd', []);
      await expect(pressed(page, '1,0')).toHaveCount(0);
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 2]);
    });

    test('CR-003 simultaneous contacts preserve the unreleased loop and feedback', async ({ page, context }) => {
      await load(page);
      const session = await context.newCDPSession(page);
      const a = await point(page, '0,0', 1);
      const b = await point(page, '1,0', 2);
      await touch(session, 'touchStart', [a, b]);
      await expect(pressed(page, '0,0')).toBeVisible();
      await expect(pressed(page, '1,0')).toBeVisible();
      await tapChain(page, session, [a, b]);
      await touch(session, 'touchEnd', [a]);
      await expect(pressed(page, '0,0')).toHaveCount(0);
      await expect(pressed(page, '1,0')).toBeVisible();
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      await touch(session, 'touchEnd', []);
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 2]);
    });

    test('CR-002 release retains the pack-delayed chain change', async ({ page, context }) => {
      await load(page, 'delayed');
      const session = await context.newCDPSession(page);
      const a = await point(page, '0,0', 1);
      await touch(session, 'touchStart', [a]);
      await expect(chain2(page).locator('div[style*="background-color"]')).toHaveCount(1);
      await expect(pressed(page, '0,0')).toBeVisible();
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([]);
      await touch(session, 'touchEnd', []);
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      await expect(chain2(page).locator('div[style*="background-color"]')).toHaveCount(1);
    });

    test('CR-004 canceled pointer and its late duplicate cannot release a new press', async ({ page }) => {
      await load(page);
      // Synthetic pointer events exercise the real PadGrid cancel/lost-capture path for one
      // contact only; Chromium touchCancel cancels every contact in the native touch batch.
      async function pointer(type: string, id: number, position = '0,0') {
        await pad(page, position).evaluate((element, event) => {
          const box = element.getBoundingClientRect();
          element.dispatchEvent(new PointerEvent(event.type, { bubbles: true, pointerId: event.id, pointerType: 'touch', clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
        }, { type, id });
      }
      await pointer('pointerdown', 11);
      await chain2(page).dispatchEvent('pointerdown');
      await pointer('pointerdown', 12, '1,0');
      await pointer('pointercancel', 11);
      await expect(pressed(page, '0,0')).toHaveCount(0);
      await expect(pressed(page, '1,0')).toBeVisible();
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      await page.getByRole('button', { name: 'Chain 9', exact: true }).dispatchEvent('pointerdown');
      await pointer('pointerdown', 13);
      await pointer('pointerup', 11);
      await pointer('lostpointercapture', 11);
      await expect(pressed(page, '0,0')).toBeVisible();
      expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(3);
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      await pointer('pointerup', 13);
      await pointer('pointerup', 12, '1,0');
      expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 3, 2]);
      await expect(pressed(page, '0,0')).toHaveCount(0);
      await expect(pressed(page, '1,0')).toHaveCount(0);
    });
  });
}
