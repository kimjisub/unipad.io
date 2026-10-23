import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { test, expect, expectPads, stateTimeout } from './browser';

interface AudioTimeline {
  context: AudioContext | null;
  starts: { soundTime: number; wallTime: number }[];
  lightTimes: number[];
  observer?: MutationObserver;
  hidden?: Promise<{ soundTime: number; wallTime: number; output: number; starts: number }>;
}
declare global { interface Window { audioTimeline: AudioTimeline } }

function longTone() {
  const samples = 44100 * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(4000 * Math.sin(i * 2 * Math.PI * 220 / 44100)), 44 + i * 2);
  return wav;
}

test('a long sample, the next note and finite lights share the paused audio timeline', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.audioTimeline = { context: null, starts: [], lightTimes: [] };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const node = create.call(this);
      window.audioTimeline.context = this;
      const start = node.start.bind(node);
      node.start = (...args) => {
        window.audioTimeline.starts.push({ soundTime: this.currentTime, wallTime: performance.now() });
        start(...args);
      };
      return node;
    };
  });
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  zip.file('sounds/long.wav', longTone());
  zip.file('keySound', '1 1 1 long.wav 1\n1 1 2 tone.wav 1');
  zip.remove('keyLED');
  zip.file('keyLED/1 1 1', 'o 1 2 a 5\nd 1500\nf 1 2\no 1 3 a 9');
  zip.file('autoPlay', 'o 1 1\nf 1 1\nd 1500\no 1 2\nf 1 2\nd 10000\nf 1 1');
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({ name: 'long-sample.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.evaluate(() => {
    window.audioTimeline.observer = new MutationObserver(() => {
      if (document.querySelector('[data-pad="0,2"] div.z-10') && window.audioTimeline.lightTimes.length === 0) {
        window.audioTimeline.lightTimes.push(window.audioTimeline.context!.currentTime);
      }
    });
    window.audioTimeline.observer.observe(document.body, { subtree: true, attributes: true, childList: true });
    // Hide at the first audible frame in the page, before slow automation round trips can
    // let the next note run. Keep audio and timers real throughout the measurement.
    window.audioTimeline.hidden = new Promise(resolve => {
      const hideWhenAudible = () => {
        const light = document.querySelector('[data-pad="0,1"] div.z-10');
        const output = window.browserProbe.audio.outputRms() ?? 0;
        if (window.audioTimeline.starts.length === 1 && output > 0.01 && light && getComputedStyle(light).backgroundColor === 'rgb(239, 83, 80)') {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
          resolve({ soundTime: window.audioTimeline.context!.currentTime, wallTime: performance.now(), output, starts: window.audioTimeline.starts.length });
        } else requestAnimationFrame(hideWhenAudible);
      };
      requestAnimationFrame(hideWhenAudible);
    });
  });
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  const hidden = await page.evaluate(() => window.audioTimeline.hidden!);
  expect(hidden.starts).toBe(1);
  expect(hidden.output).toBeGreaterThan(0.01);
  // Real audio time and the real audio device keep running unless the application suspends them.
  await page.waitForTimeout(2000);
  const frozen = await page.evaluate(() => ({
    state: window.audioTimeline.context!.state,
    soundTime: window.audioTimeline.context!.currentTime,
    wallTime: performance.now(),
    starts: window.audioTimeline.starts,
    lights: window.audioTimeline.lightTimes,
    output: window.browserProbe.audio.outputRms(),
  }));
  await info.attach('hidden-timeline', { body: JSON.stringify({ hidden, frozen }, null, 2), contentType: 'application/json' });
  expect(frozen.state).toBe('suspended');
  expect(frozen.soundTime - hidden.soundTime).toBeLessThan(0.05);
  expect(frozen.starts).toHaveLength(1);
  expect(frozen.lights).toHaveLength(0);
  expect(frozen.output).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.audioTimeline.starts.length), { timeout: stateTimeout }).toBe(2);
  await expect.poll(() => page.evaluate(() => window.audioTimeline.lightTimes.length), { timeout: stateTimeout }).toBe(1);
  const resumed = await page.evaluate(() => ({ starts: window.audioTimeline.starts, lights: window.audioTimeline.lightTimes }));
  await info.attach('resumed-timeline', { body: JSON.stringify(resumed, null, 2), contentType: 'application/json' });
  expect(Math.abs(resumed.starts[1].soundTime - resumed.starts[0].soundTime - 1.5)).toBeLessThan(0.15);
  expect(Math.abs(resumed.lights[0] - resumed.starts[0].soundTime - 1.5)).toBeLessThan(0.15);
  expect(resumed.starts[1].wallTime - resumed.starts[0].wallTime).toBeGreaterThan(3400);
  await info.attach('returned-with-long-sample', { body: await page.screenshot(), contentType: 'image/png' });
});
