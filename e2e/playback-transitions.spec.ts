import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, expectPads } from './browser';

declare global { interface Window { transitionAudio: AudioContext } }

const mode = (page: Page, name: string) => page.getByRole('button', { name: `Play mode: ${name}`, exact: true });
async function open(page: Page, autoPlay: string, wormhole = false) {
  await page.addInitScript(() => {
    const gain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () { window.transitionAudio = this; return gain.call(this); };
  });
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', 'chain=3'));
  zip.file('keySound', `1 1 1 tone.wav 1${wormhole ? ' 2' : ''}\n1 1 2 tone.wav\n2 1 1 tone.wav\n3 1 1 tone.wav`);
  zip.remove('keyLED');
  zip.file('keyLED/1 1 1', 'o 1 2 a 5\nd 1000\nf 1 2\nd 1000\no 1 3 a 9');
  zip.file('autoPlay', autoPlay);
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({ name: 'transitions.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
}
async function visibility(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await expect.poll(() => page.evaluate(() => window.transitionAudio.state)).toBe(hidden ? 'suspended' : 'running');
}
async function capture(page: Page, info: TestInfo) {
  const path = info.outputPath('returned.png');
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach('returned', { path, contentType: 'image/png' });
}

test('returning to autoplay preserves its remaining delay and finite lights', async ({ page }, info) => {
  await open(page, 'o 1 1\nf 1 1\nd 1000\nc 2\no 1 1\nf 1 1\nd 1000\nc 3\no 1 1\nf 1 1\nd 10000');
  await mode(page, 'Auto').dispatchEvent('click');
  await page.clock.runFor(100);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await visibility(page, true);
  await page.clock.fastForward(5000);
  await visibility(page, false);
  await page.clock.runFor(16);
  await capture(page, info);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await expect(page.locator('[data-pad="0,1"] .z-10')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  // A late foreground tick must still honor the remaining delay, without hundreds of fake ticks.
  await page.clock.fastForward(884);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(2);
});

test('guide next and previous redraw the upcoming pad at the selected position', async ({ page }, info) => {
  const song = Array.from({ length: 60 }, (_, i) => `o 1 ${Math.floor(i / 5) % 2 + 1}\nf 1 ${Math.floor(i / 5) % 2 + 1}\nd 1000`).join('\n');
  await open(page, song);
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(1);
  await page.getByTitle('Skip Next').dispatchEvent('click');
  await page.clock.fastForward(200);
  await page.clock.runFor(20);
  await capture(page, info);
  await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(1);
  await page.getByTitle('Skip Next').dispatchEvent('click');
  await page.getByTitle('Skip Next').dispatchEvent('click');
  await page.clock.fastForward(200);
  await page.clock.runFor(20);
  await expect(page.locator('[data-pad="0,0"] .z-\\[25\\]')).toHaveCount(1);
  await page.getByTitle('Skip Previous').dispatchEvent('click');
  await page.clock.fastForward(200);
  await page.clock.runFor(20);
  await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(1);
});

test('a chain button choice cancels an earlier sound wormhole', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1\nf 1 1', true);
  // Key input starts the sound; a direct pointer event selects the chain on the paused clock.
  await page.keyboard.press('1');
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.clock.runFor(50);
  await page.getByRole('button', { name: 'Chain 11', exact: true }).dispatchEvent('pointerdown');
  await page.clock.runFor(100);
  await capture(page, info);
  // Circle 11 is playable chain 3; its selection light survives the wormhole deadline.
  const selected = page.getByRole('button', { name: 'Chain 11', exact: true });
  await expect(selected.locator('div.z-10')).toHaveCount(1);
});


test('a sound wormhole keeps its remaining delay across a hidden tab', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1\nf 1 1', true);
  const first = page.getByRole('button', { name: 'Chain 9', exact: true });
  await first.dispatchEvent('pointerdown'); await page.clock.runFor(16);
  await expect(first.locator('div.z-10')).toHaveCount(1);
  await page.keyboard.press('1');
  await page.clock.runFor(50);
  await visibility(page, true); await page.clock.fastForward(5000);
  await info.attach('hidden-wormhole', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(first.locator('div.z-10')).toHaveCount(1);
  await visibility(page, false); await page.clock.runFor(49);
  await info.attach('before-wormhole-deadline', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(first.locator('div.z-10')).toHaveCount(1);
  await page.clock.runFor(17);
  await expect(page.getByRole('button', { name: 'Chain 10', exact: true }).locator('div.z-10')).toHaveCount(1);
  await info.attach('resumed-wormhole', { body: await page.screenshot(), contentType: 'image/png' });
});
