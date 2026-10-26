import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import JSZip from 'jszip';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, expectPads, stateTimeout } from './browser';

declare global { interface Window {
  transitionAudio: AudioContext;
  transitionNativeAudioTime?: () => number;
  wakeProbe: { requests: { released: boolean; resolved: boolean }[]; reply: (index: number) => void };
} }

const mode = (page: Page, name: string) => page.getByRole('button', { name: `Play mode: ${name}`, exact: true });
async function open(page: Page, autoPlay: string, wormhole = false, options: { led?: string; endless?: boolean; keySound?: string; leds?: Record<string, string> } = {}) {
  await page.addInitScript(() => {
    const gain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () { window.transitionAudio = this; return gain.call(this); };
  });
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', 'chain=3'));
  zip.file('keySound', options.keySound ?? `1 1 1 tone.wav 1${wormhole ? ' 2' : ''}\n1 1 2 tone.wav\n2 1 1 tone.wav\n3 1 1 tone.wav`);
  zip.remove('keyLED');
  const leds = options.leds ?? { [`1 1 1${options.endless ? ' 0' : ''}`]: options.led ?? 'o 1 2 a 5\nd 1000\nf 1 2\nd 1000\no 1 3 a 9' };
  for (const [name, content] of Object.entries(leds)) zip.file(`keyLED/${name}`, content);
  zip.file('autoPlay', autoPlay);
  await page.goto('/play', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({ name: 'transitions.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // pauseAt also installs the clock, so no host-time deadline can expire in transit.
  await page.clock.pauseAt(new Date('2024-01-01T00:00:00.000Z'));
  // These cases assert virtual timer commands and DOM changes. Keep the audio control clock
  // on the same virtual timeline: page.clock does not freeze native Web Audio rendering.
  // audio-visibility.spec.ts checks the unmodified clock and real output signal separately.
  await page.evaluate(() => {
    const context = window.transitionAudio;
    const nativeTime = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'currentTime')!.get!.bind(context) as () => number;
    window.transitionNativeAudioTime = nativeTime;
    let audioTime = nativeTime();
    let markedAt = performance.now();
    let running = context.state === 'running';
    const update = (nextRunning: boolean) => {
      const now = performance.now();
      if (running) audioTime += (now - markedAt) / 1000;
      markedAt = now;
      running = nextRunning;
      return audioTime;
    };
    Object.defineProperty(context, 'currentTime', { configurable: true, get: () => update(running) });
    const suspend = context.suspend.bind(context);
    context.suspend = async () => {
      update(false);
      await suspend();
    };
    const resume = context.resume.bind(context);
    context.resume = async () => {
      await resume();
      update(context.state === 'running');
    };
  });
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

test('guide next and previous redraw the upcoming pad at the selected position', async ({ page }, info) => {
  const song = Array.from({ length: 60 }, (_, i) => `o 1 ${Math.floor(i / 5) % 2 + 1}\nf 1 ${Math.floor(i / 5) % 2 + 1}\nd 1000`).join('\n');
  await open(page, song);
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(1);
  await page.getByTitle('Skip Next').dispatchEvent('click');
  // A late tick after the seek restarts the song there; the next note's guide follows its 800 ms lead.
  await page.clock.fastForward(200);
  await page.clock.fastForward(200);
  await page.clock.runFor(20);
  await capture(page, info);
  await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(1);
  await page.getByTitle('Skip Next').dispatchEvent('click');
  await page.getByTitle('Skip Next').dispatchEvent('click');
  await page.clock.fastForward(200);
  await page.clock.fastForward(200);
  await page.clock.runFor(20);
  await expect(page.locator('[data-pad="0,0"] .z-\\[25\\]')).toHaveCount(1);
  await page.getByTitle('Skip Previous').dispatchEvent('click');
  await page.clock.fastForward(200);
  await page.clock.fastForward(200);
  await page.clock.runFor(20);
  await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(1);
});

for (const resume of ['button', 'mode']) test(`resuming guide via ${resume} redraws only the next unscanned note`, async ({ page }, info) => {
  await open(page, 'd 1000\no 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 1000\no 2 1\nf 2 1\nd 10000');
  const guide = (position: string) => page.locator(`[data-pad="${position}"] .z-\\[25\\]`);
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(1);
  await page.clock.fastForward(219);
  await page.clock.runFor(16);
  await expect(guide('0,0')).toHaveCount(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  await page.clock.runFor(20);
  await expect(guide('0,0')).toHaveCount(1);
  await page.clock.fastForward(2000);
  await (resume === 'button' ? page.getByRole('button', { name: 'Play', exact: true }) : mode(page, 'Guide')).dispatchEvent('click');
  await page.clock.runFor(1);
  await page.clock.fastForward(199);
  await page.clock.runFor(20);
  const path = info.outputPath('resumed-guide.png');
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach('resumed-guide', { path, contentType: 'image/png' });
  const messages = await page.evaluate(() => window.browserProbe.midi.messages);
  await info.attach('controller-output', { body: JSON.stringify({ physicalHardware: false, messages }), contentType: 'application/json' });
  await expect(guide('0,0')).toHaveCount(0);
  await expect(guide('0,1')).toHaveCount(1);
  await page.clock.fastForward(800);
  await page.clock.runFor(16);
  await expect(guide('0,1')).toHaveCount(0);
});

for (const resume of ['button', 'mode']) for (const extraDelay of [0, 1000]) test(`resuming guide via ${resume} after scanning only a chain preserves the guide with ${extraDelay}ms extra wait`, async ({ page }, info) => {
  await open(page, `d 1000\no 1 1\nf 1 1\nd 1000\nc 2\n${extraDelay ? `d ${extraDelay}\n` : ''}o 1 2\nf 1 2\nd 10000`);
  const guide = page.locator('[data-pad="0,1"] .z-\\[25\\]');
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(1);
  await page.clock.fastForward(1000);
  await page.clock.fastForward(100);
  await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  await page.clock.fastForward(200);
  await (resume === 'button' ? page.getByRole('button', { name: 'Play', exact: true }) : mode(page, 'Guide')).dispatchEvent('click');
  await page.clock.runFor(1);
  await page.clock.fastForward(199);
  await page.getByRole('button', { name: 'Chain 10', exact: true }).dispatchEvent('pointerdown');
  await page.clock.runFor(20);
  if (extraDelay) {
    await page.clock.fastForward(extraDelay);
    await page.clock.runFor(16);
  }
  await info.attach('resumed-after-chain-scan', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await info.attach('controller-output', { body: JSON.stringify({ physicalHardware: false, messages: await page.evaluate(() => window.browserProbe.midi.messages) }), contentType: 'application/json' });
  await expect(guide).toHaveCount(1);
  await page.clock.fastForward(600);
  await page.clock.runFor(16);
  await expect(guide).toHaveCount(1);
  await page.clock.fastForward(100);
  await page.clock.runFor(16);
  await expect(guide).toHaveCount(0);
});

for (const resume of ['button', 'mode']) test(`resuming guide via ${resume} while awaiting a chain keeps its lead time`, async ({ page }, info) => {
  await open(page, 'd 1000\no 1 1\nf 1 1\nd 1000\nc 2\no 1 2\nf 1 2\nd 10000');
  const guide = page.locator('[data-pad="0,1"] .z-\\[25\\]');
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(1);
  await page.clock.fastForward(1000);
  await page.clock.fastForward(200);
  await page.clock.runFor(16);
  await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  await page.clock.fastForward(200);
  await (resume === 'button' ? page.getByRole('button', { name: 'Play', exact: true }) : mode(page, 'Guide')).dispatchEvent('click');
  await page.clock.runFor(1);
  await page.getByRole('button', { name: 'Chain 10', exact: true }).dispatchEvent('pointerdown');
  await page.clock.runFor(20);
  await info.attach('resumed-chain-guide', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await info.attach('controller-output', { body: JSON.stringify({ physicalHardware: false, messages: await page.evaluate(() => window.browserProbe.midi.messages) }), contentType: 'application/json' });
  await expect(guide).toHaveCount(1);
  await page.clock.fastForward(700);
  await page.clock.runFor(16);
  await expect(guide).toHaveCount(1);
  await page.clock.fastForward(100);
  await page.clock.runFor(16);
  await expect(guide).toHaveCount(0);
});

for (const resume of ['button', 'mode']) test(`resuming guide via ${resume} before a step tick keeps the current guide`, async ({ page }, info) => {
  await open(page, 'd 1000\no 1 1\nf 1 1\nd 10000');
  const guide = page.locator('[data-pad="0,0"] .z-\\[25\\]');
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(1);
  await page.clock.fastForward(500);
  await page.clock.runFor(16);
  await expect(guide).toHaveCount(1);
  // The virtual clock stays paused between inputs, so no step scan can run.
  await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  await (resume === 'button' ? page.getByRole('button', { name: 'Play', exact: true }) : mode(page, 'Guide')).dispatchEvent('click');
  await page.clock.runFor(20);
  await info.attach('quick-resumed-guide', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await expect(guide).toHaveCount(1);
  await page.clock.fastForward(400);
  await page.clock.runFor(16);
  await expect(guide).toHaveCount(1);
  await page.clock.fastForward(100);
  await page.clock.runFor(16);
  await expect(guide).toHaveCount(0);
});


for (const resume of ['button', 'mode']) {
  test(`resuming guide via ${resume} after completing a step retains the next chain pad`, async ({ page }, info) => {
    await open(page, 'd 1000\no 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 1000\nc 2\no 1 1\nf 1 1\nd 10000');
    await mode(page, 'Guide').dispatchEvent('click');
    await page.clock.runFor(1); await page.clock.fastForward(1000); await page.clock.fastForward(100);
    await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
    await page.clock.runFor(20);
    await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(1);
    await page.keyboard.press('2');
    await page.clock.runFor(20); await page.clock.fastForward(200);
    await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(0);
    await (resume === 'button' ? page.getByRole('button', { name: 'Play', exact: true }) : mode(page, 'Guide')).dispatchEvent('click');
    await page.clock.runFor(1); await page.clock.fastForward(200);
    await page.getByRole('button', { name: 'Chain 10', exact: true }).dispatchEvent('pointerdown');
    await page.clock.runFor(20);
    await info.attach('next-chain-pad', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    const guide = page.locator('[data-pad="0,0"] .z-\\[25\\]');
    await expect(guide).toHaveCount(1);
    await page.clock.fastForward(700); await page.clock.runFor(16);
    await expect(guide).toHaveCount(1);
    await page.clock.fastForward(100); await page.clock.runFor(16);
    await expect(guide).toHaveCount(0);
  });

  test(`resuming guide via ${resume} after waiting 1500ms for a chain retains its pad`, async ({ page }, info) => {
    await open(page, 'd 1000\no 1 1\nf 1 1\nd 1000\nc 2\no 1 2\nf 1 2\nd 10000');
    await mode(page, 'Guide').dispatchEvent('click');
    await page.clock.runFor(1); await page.clock.fastForward(1000); await page.clock.fastForward(200);
    await page.clock.fastForward(1500);
    await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
    await page.clock.fastForward(200);
    await (resume === 'button' ? page.getByRole('button', { name: 'Play', exact: true }) : mode(page, 'Guide')).dispatchEvent('click');
    // Rendering may delay the first resumed sequencer tick; the chain gate still holds time.
    await page.clock.fastForward(1000);
    await info.attach('chain-prompt-after-resume', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    const chainGuide = page.getByRole('button', { name: 'Chain 10', exact: true });
    for (let i = 0; i < 5; i++) {
      await expect(chainGuide.locator('div.z-10')).toHaveCSS('background-color', 'rgb(139, 195, 74)');
      await page.clock.fastForward(500);
    }
    await page.getByRole('button', { name: 'Chain 10', exact: true }).dispatchEvent('pointerdown');
    await page.clock.runFor(20);
    await info.attach('pad-after-long-chain-wait', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    const guide = page.locator('[data-pad="0,1"] .z-\\[25\\]');
    await expect(guide).toHaveCount(1);
    await page.clock.fastForward(700); await page.clock.runFor(16);
    await expect(guide).toHaveCount(1);
    await page.clock.fastForward(100); await page.clock.runFor(16);
    await expect(guide).toHaveCount(0);
  });
}

for (const pauseMs of [100, 300]) test(`switching paused practice to autoplay keeps the delay after ${pauseMs}ms`, async ({ page }, info) => {
  await open(page, 'o 1 1\nf 1 1\nd 1000\nc 2\no 1 1\nf 1 1\nd 10000');
  await mode(page, 'Guide').dispatchEvent('click');
  // Include the first timer in the authored pause position.
  await page.clock.runFor(1); await page.clock.fastForward(pauseMs - 1);
  await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  await page.clock.fastForward(500);
  await mode(page, 'Auto').dispatchEvent('click');
  await page.clock.fastForward(1);
  await info.attach('autoplay-before-remaining-delay', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(0);
  await page.clock.fastForward(1000 - pauseMs - 2);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(0);
  await page.clock.fastForward(1);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await info.attach('autoplay-after-remaining-delay', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
});

test('switching autoplay to guide never asks for an earlier chain at the same song time', async ({ page }, info) => {
  await open(page, 'o 1 1\nc 2\no 1 2\nd 300\no 1 1\nf 1 1\nd 10000');
  await mode(page, 'Auto').dispatchEvent('click');
  await page.clock.runFor(20);
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(20);
  await info.attach('guide-after-mode-change', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await expect(page.getByRole('button', { name: 'Chain 9', exact: true }).locator('div.z-10')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Chain 10', exact: true }).locator('div.z-10')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
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
  // The later explicit selection remains after the original sound deadline.
  const selected = page.getByRole('button', { name: 'Chain 11', exact: true });
  await expect(selected.locator('div.z-10')).toHaveCount(1);
});


test('interruption cancels a pending sound chain move', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1\nf 1 1', true);
  const first = page.getByRole('button', { name: 'Chain 9', exact: true });
  await first.dispatchEvent('pointerdown'); await page.clock.runFor(16);
  await page.keyboard.press('1'); await page.clock.runFor(50);
  await visibility(page, true); await page.clock.fastForward(5000);
  await visibility(page, false); await page.clock.runFor(1000);
  await expect(first.locator('div.z-10')).toHaveCount(1);
  await info.attach('cancelled-chain-move', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
});

test('clock initialization stays deterministic when its pause command is delayed 200 ms', async ({ page }, info) => {
  const pauseAt = page.clock.pauseAt.bind(page.clock);
  let delayedCommands = 0;
  page.clock.pauseAt = async time => {
    delayedCommands++;
    await delay(200);
    await pauseAt(time);
  };
  await open(page, 'd 10000\no 1 1\nf 1 1');
  const stopped = await page.evaluate(() => ({ date: Date.now(), ticks: performance.now() }));
  await delay(200);
  const stillStopped = await page.evaluate(() => ({ date: Date.now(), ticks: performance.now() }));
  await page.clock.runFor(50);
  const advanced = await page.evaluate(() => ({ date: Date.now(), ticks: performance.now() }));
  await info.attach('delayed-clock-initialization', { body: JSON.stringify({ delayedCommands, stopped, stillStopped, advanced }, null, 2), contentType: 'application/json' });
  expect(delayedCommands).toBe(1);
  expect(stopped.date).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
  expect(stillStopped).toEqual(stopped);
  expect(advanced.date - stopped.date).toBe(50);
  expect(advanced.ticks - stopped.ticks).toBe(50);
});


const packLight = (page: Page) => page.locator('[data-pad="0,1"] .z-10');
async function snapshot(page: Page, info: TestInfo, name: string) {
  await info.attach(`${name}-audio`, { body: JSON.stringify(await page.evaluate(() => ({ starts: window.browserProbe.audio.starts, stops: window.browserProbe.audio.stops }))), contentType: 'application/json' });
  await info.attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
}

test('compatibility: show only the pack chain buttons outside Pro Light Mode', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1');
  await snapshot(page, info, 'three-chain-pack');
  await expect(page.getByRole('button', { name: /^Chain \d+$/ })).toHaveCount(3);
});

test('compatibility: release ends endless lights after changing chain', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1', false, { endless: true, led: 'o 1 2 a 5\nd 1000' });
  await page.keyboard.down('1'); await page.clock.runFor(20);
  await expect(packLight(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Chain 10', exact: true }).dispatchEvent('pointerdown');
  await page.keyboard.up('1'); await page.clock.runFor(20);
  await snapshot(page, info, 'released-on-second-chain');
  await expect(packLight(page)).toHaveCount(0);
});

test('compatibility: pause keeps the remaining half-second before the next note', async ({ page }, info) => {
  await open(page, 'o 1 1\nd 1000\no 1 2\nd 10000\no 1 1');
  await mode(page, 'Auto').dispatchEvent('click');
  await page.clock.runFor(1);
  // The normal 1 ms first tick consumes 1 ms of the requested song time.
  await page.clock.fastForward(499);
  await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  await page.clock.fastForward(3000);
  await page.getByRole('button', { name: 'Play', exact: true }).dispatchEvent('click');
  await page.clock.fastForward(499);
  await snapshot(page, info, 'resumed-before-next-note');
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.clock.runFor(1);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(2);
});

test('compatibility: natural end preserves the last finite light animation', async ({ page }, info) => {
  await open(page, 't 1 1\nd 100\nf 1 2', false, { led: 'o 1 2 a 5\nd 2000\no 1 3 a 9' });
  await mode(page, 'Auto').dispatchEvent('click');
  await page.clock.runFor(150);
  await snapshot(page, info, 'finite-light-after-song');
  await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
  await expect(packLight(page)).toHaveCount(1);
  await page.clock.fastForward(1980); await page.clock.runFor(20);
  await expect(page.locator('[data-pad="0,2"] .z-10')).toHaveCount(1);
});

test('compatibility: step practice leaves the final group available until played', async ({ page }, info) => {
  await open(page, 't 1 1');
  await mode(page, 'Step').dispatchEvent('click');
  await page.clock.runFor(20);
  await snapshot(page, info, 'last-step-awaiting-press');
  await expect(mode(page, 'Step')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-pad="0,0"] .z-\\[25\\]')).toHaveCount(1);
  await page.keyboard.press('1'); await page.clock.runFor(20);
  await expect(mode(page, 'Step')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-pad="0,0"] .z-\\[25\\]')).toHaveCount(0);
});

for (const laterFirst of [false, true]) test(`compatibility: same-pad feedback waits for the last release while each contact releases its effects (later first ${laterFirst})`, async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1', false, { endless: true, led: 'o 1 2 a 5\nd 1000', keySound: '1 1 1 tone.wav 0' });
  await page.getByRole('button', { name: 'Feedback', exact: true }).dispatchEvent('click');
  const target = page.locator('[data-pad="0,0"]');
  const box = (await target.boundingBox())!;
  const pointer = async (type: string, id: number) => {
    await target.dispatchEvent(type, { pointerId: id, pointerType: 'touch', clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true });
    await page.clock.runFor(20);
  };
  await pointer('pointerdown', 101); await pointer('pointerdown', 102);
  await pointer('pointerup', laterFirst ? 102 : 101);
  await snapshot(page, info, 'one-contact-still-held');
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual(laterFirst ? [1, 2] : [1]);
  await expect(packLight(page)).toHaveCount(laterFirst ? 0 : 1);
  await expect(target.locator('img[src="/theme/btn_.png"]')).toHaveCount(1);
  await pointer('pointerup', laterFirst ? 101 : 102);
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 2]);
  await expect(packLight(page)).toHaveCount(0);
  await expect(target.locator('img[src="/theme/btn_.png"]')).toHaveCount(0);
});

test('compatibility: stopping autoplay clears endless lights started on another chain', async ({ page }, info) => {
  await open(page, 'o 1 1\nc 2\nd 10000\no 1 2', false, { endless: true, led: 'o 1 2 a 5\nd 1000' });
  await mode(page, 'Auto').dispatchEvent('click'); await page.clock.runFor(20);
  await expect(packLight(page)).toHaveCount(1);
  await mode(page, 'Auto').dispatchEvent('click'); await page.clock.fastForward(1000); await page.clock.runFor(20);
  await snapshot(page, info, 'stopped-cross-chain-animation');
  await expect(packLight(page)).toHaveCount(0);
});

test('compatibility detail: autoplay wormholes move once before the next explicit chain', async ({ page }, info) => {
  await open(page, 'o 1 1\nd 50\nc 3\nd 1000\no 1 2', true);
  await mode(page, 'Auto').dispatchEvent('click');
  await page.clock.runFor(150);
  await snapshot(page, info, 'autoplay-chain-after-wormhole-deadline');
  await expect(page.getByRole('button', { name: 'Chain 11', exact: true }).locator('div.z-10')).toHaveCount(1);
});

test('compatibility detail: repeated autoplay presses release earlier-chain endless sound', async ({ page }, info) => {
  await open(page, 'o 1 1\nc 2\no 1 1\nd 500\nf 1 1\nd 1000\no 1 2', false, { keySound: '1 1 1 tone.wav 0\n2 1 1 tone.wav' });
  await mode(page, 'Auto').dispatchEvent('click'); await page.clock.runFor(1); await page.clock.fastForward(549);
  await snapshot(page, info, 'released-earlier-chain-sound');
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toContain(1);
});

for (const playerFirst of [true, false]) test(`compatibility detail: releases preserve the other current owner (player first ${playerFirst})`, async ({ page }, info) => {
  await open(page, playerFirst ? 'd 300\no 1 1\nd 700\nf 1 1\nd 1000\no 1 2' : 'o 1 1\nd 300\nf 1 1\nd 1000\no 1 2', false, { endless: true, led: 'o 1 2 a 5\nd 1000', keySound: '1 1 1 tone.wav 0' });
  await mode(page, 'Auto').dispatchEvent('click');
  if (playerFirst) await page.keyboard.down('1');
  await page.clock.runFor(1);
  await page.clock.fastForward(playerFirst ? 499 : 99);
  if (playerFirst) await page.keyboard.up('1');
  else { await page.keyboard.down('1'); await page.clock.fastForward(250); }
  await page.clock.runFor(20);
  await snapshot(page, info, 'current-owner-after-other-release');
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  await expect(packLight(page)).toHaveCount(1);
  if (!playerFirst) { await page.keyboard.up('1'); await page.clock.runFor(20); await expect(packLight(page)).toHaveCount(0); }
});

test('compatibility detail: dropping a new pack closes the previous session', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1');
  await mode(page, 'Auto').dispatchEvent('click');
  await page.keyboard.press('Alt+p');
  await page.keyboard.press('Alt+r');
  await page.clock.runFor(20);
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  zip.file('info', (await zip.file('info')!.async('string')).replace('title=Browser Test Pack', 'title=Replacement').replace('chain=1', 'chain=3'));
  const bytes = Array.from(await zip.generateAsync({ type: 'uint8array' }));
  await page.evaluate(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'replacement.uni', {type:'application/octet-stream'}));
    document.querySelector('[data-pad]')!.dispatchEvent(new DragEvent('drop', {bubbles:true, dataTransfer:transfer}));
  }, bytes);
  await expect(page).toHaveTitle(/^Replacement \|/);
  await page.clock.runFor(20);
  await snapshot(page, info, 'replacement-session');
  await expect(page.getByText('Copied', { exact: true })).toHaveCount(0);
  await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /^Chain \d+$/ })).toHaveCount(3);
  await page.keyboard.press('1'); await page.clock.runFor(20);
  // After replacement, the new recorder starts empty and off; switching it on must not download the old recording.
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.keyboard.press('Alt+r'); await page.clock.runFor(20);
  expect(downloads).toBe(0);
});


test('compatibility detail: stopping a recording exports its text and shows its completion notice', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1');
  await page.keyboard.press('Alt+r');
  await page.clock.runFor(100);
  await page.keyboard.press('1');
  const downloaded = page.waitForEvent('download');
  await page.keyboard.press('Alt+r');
  const download = await downloaded;
  const text = await readFile((await download.path())!, 'utf8');
  await info.attach('recorded-text', { body: text, contentType: 'text/plain' });
  expect(text).toBe('c 1\nd 100\nt 1 1');
  await expect(page.getByText('Copied', { exact: true })).toHaveCount(1);
});

test('clock-controlled transitions keep audio time frozen between timer steps', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1\nf 1 1');
  await page.keyboard.press('Shift');
  await page.evaluate(() => window.transitionAudio.resume());
  const nativeTime = () => page.evaluate(() => window.transitionNativeAudioTime?.() ?? window.transitionAudio.currentTime);
  const initialNativeTime = await nativeTime();
  await expect.poll(nativeTime).toBeGreaterThan(initialNativeTime);
  const snapshot = () => page.evaluate(() => ({
    wallTime: performance.now(), audioTime: window.transitionAudio.currentTime,
    nativeAudioTime: window.transitionNativeAudioTime?.(), state: window.transitionAudio.state,
  }));
  const before = await snapshot();
  await delay(200);
  const frozen = await snapshot();
  await page.clock.runFor(50);
  const advanced = await snapshot();
  await info.attach('controlled-audio-clock', { body: JSON.stringify({ before, frozen, advanced, physicalOutputMeasured: false }, null, 2), contentType: 'application/json' });
  expect(before.state).toBe('running');
  expect(frozen.wallTime).toBe(before.wallTime);
  expect(frozen.audioTime).toBe(before.audioTime);
  expect(advanced.wallTime - before.wallTime).toBe(50);
  expect(advanced.audioTime - before.audioTime).toBeCloseTo(0.05, 9);
});


test('manual interruption waits for Play and discards old lights', async ({ page }, info) => {
  await open(page, 'on 1 1\nd 2000\non 1 2\nd 2000', false, { keySound: '1 1 1 tone.wav 0\n1 1 2 tone.wav 0' });
  await mode(page, 'Auto').dispatchEvent('click'); await page.clock.runFor(100);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(1000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(16);
  await info.attach('returned-before-play', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await info.attach('interruption-audio', { body: JSON.stringify(await page.evaluate(() => window.browserProbe.audio)), contentType: 'application/json' });
  await expect(page.getByTitle('Play', { exact: true })).toBeVisible();
  await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toContain(1);
  await expect(page.locator('[data-pad="0,1"] .z-10')).toHaveCount(0);
  await page.clock.fastForward(10000);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.getByTitle('Play', { exact: true }).dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => window.transitionAudio.state)).toBe('running');
  await page.clock.fastForward(1899);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.clock.runFor(1);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(2);
  await info.attach('resumed-next-command', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
});


test('installation token refresh returns the token fields consumed by the SDK', async ({ page }) => {
  await page.goto('/play', { waitUntil: 'domcontentloaded' });
  const token = await page.evaluate(async () => {
    const response = await fetch('https://firebaseinstallations.googleapis.com/v1/projects/unipad-ci-placeholder/installations/cAAAAAAAAAAAAAAAAAAAAA/authTokens:generate', { method: 'POST' });
    return response.json();
  });
  expect(token.token).toBe('FAKE_INSTALLATION_TOKEN');
  expect(token.expiresIn).toBe('604800s');
});


test('a pack imported while hidden can show fresh lights after returning', async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
  await open(page, 'd 10000\ntouch 1 1');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.keyboard.press('1'); await page.clock.runFor(20);
  await snapshot(page, info, 'fresh-light-after-hidden-import');
  await expect(packLight(page)).toHaveCount(1);
});

test('paused guide finishes after the last manual step', async ({ page }, info) => {
  await open(page, 'o 1 1\nf 1 1\nd 1000\no 2 1\nf 2 1');
  await mode(page, 'Guide').dispatchEvent('click'); await page.clock.runFor(100);
  await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  await page.clock.runFor(5);
  await expect(page.locator('[data-pad="1,0"] .z-\\[25\\]')).toHaveCount(1);
  await page.keyboard.press('q'); await page.clock.runFor(5);
  await snapshot(page, info, 'completed-last-step');
  await expect(mode(page, 'Step')).toHaveAttribute('aria-pressed', 'false');
});

test('returning manual play requests screen wake protection again', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'wakeRequests', { value: 0, writable: true });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      (window as unknown as { wakeRequests: number }).wakeRequests++;
      return { release: async () => {}, addEventListener() {} };
    } } });
  });
  await open(page, 'd 10000\ntouch 1 1');
  const count = () => page.evaluate(() => (window as unknown as { wakeRequests: number }).wakeRequests);
  expect(await count()).toBe(1);
  await visibility(page, true); await page.clock.fastForward(1000); await visibility(page, false);
  await page.keyboard.press('1'); await page.clock.runFor(20);
  await snapshot(page, info, 'manual-wake-protection-after-return');
  expect(await count()).toBe(2);
  await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
});

for (const interruption of ['hidden', 'focus']) for (const playFirst of [true, false]) {
  test(`screen wake protection survives ${interruption} when ${playFirst ? 'Play' : 'the lock reply'} arrives first`, async ({ page }, info) => {
    await page.addInitScript(() => {
      const replies: (() => void)[] = [];
      window.wakeProbe = { requests: [], reply: index => replies[index]() };
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => {
        const state = { released: false, resolved: false };
        const index = window.wakeProbe.requests.push(state) - 1;
        const lock = { async release() { state.released = true; }, addEventListener() {} };
        return new Promise(resolve => {
          replies[index] = () => { state.resolved = true; resolve(lock); };
          if (index === 0) replies[index]();
        });
      } } });
    });
    await open(page, 'd 10000\ntouch 1 1');
    await mode(page, 'Auto').dispatchEvent('click'); await page.clock.runFor(100);
    if (interruption === 'hidden') {
      await visibility(page, true); await page.clock.fastForward(1000); await visibility(page, false);
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.clock.fastForward(1000);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
    const requests = () => page.evaluate(() => window.wakeProbe.requests);
    await expect.poll(async () => (await requests()).length).toBe(2);
    expect((await requests())[0].released).toBe(true);
    if (!playFirst) await page.evaluate(() => window.wakeProbe.reply(1));
    await page.getByRole('button', { name: 'Play', exact: true }).dispatchEvent('click');
    if (playFirst) await page.evaluate(() => window.wakeProbe.reply(1));
    await page.clock.runFor(20);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect.poll(async () => (await requests()).filter(lock => lock.resolved && !lock.released).length).toBe(1);
    await page.evaluate(() => document.dispatchEvent(new Event('pointerdown')));
    expect((await requests()).length).toBe(2);
    await info.attach('screen-wake-response-order', { body: JSON.stringify({ interruption, playFirst, requests: await requests(), physicalLockMeasured: false }), contentType: 'application/json' });
    await snapshot(page, info, 'playing-with-screen-protection');
  });
}

for (const interruption of ['focus', 'dialog']) test(`current device chain light returns after ${interruption}`, async ({ page }, info) => {
  await open(page, 'd 10000\ntouch 1 1');
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.requests.length)).toBeGreaterThan(0);
  await page.clock.runFor(600);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  if (interruption === 'focus') {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; window.dispatchEvent(new Event('focus')); });
  } else {
    await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).dispatchEvent('click');
    await page.clock.runFor(300);
    await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
    await page.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click');
  }
  await page.clock.runFor(20);
  await snapshot(page, info, 'device-chain-after-return');
  const messages = await page.evaluate(() => window.browserProbe.midi.messages);
  await info.attach('device-output', { body: JSON.stringify({ messages, physicalHardware: false }), contentType: 'application/json' });
  expect(messages.some(message => message[0] === 0xb0 && message[1] === 89 && message[2] > 0)).toBe(true);
});

test('an expired installation token refreshes through the local service fixture', async ({ page }, info) => {
  const registration = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.hostname === 'firebaseinstallations.googleapis.com' && url.pathname.endsWith('/installations');
  });
  await page.goto('/play', { waitUntil: 'domcontentloaded' });
  await registration;
  // The real SDK chooses its storage key from the build's public app configuration.
  // Let it register first instead of seeding an unrelated hardcoded application key.
  const readInstallation = () => page.evaluate(() => new Promise<{ key: string; authToken: unknown } | null>((resolve, reject) => {
    const request = indexedDB.open('firebase-installations-database');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('firebase-installations-store')) { db.close(); resolve(null); return; }
      const read = db.transaction('firebase-installations-store').objectStore('firebase-installations-store').openCursor();
      read.onsuccess = () => {
        const cursor = read.result;
        db.close();
        if (cursor && typeof cursor.key !== 'string') { reject(new Error('installation key must be a string')); return; }
        resolve(cursor ? { key: cursor.key as string, authToken: cursor.value.authToken } : null);
      };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
  await expect.poll(async () => (await readInstallation())?.authToken, { timeout: stateTimeout }).toMatchObject({
    token: 'FAKE_INSTALLATION_TOKEN', requestStatus: 2,
  });
  const installation = (await readInstallation())!;
  await info.attach('installation-key-selection', {
    body: JSON.stringify({ usesHardcodedCiKey: installation.key === '[DEFAULT]!1:000000000000:web:fake-ci-placeholder' }),
    contentType: 'application/json',
  });
  await page.evaluate(key => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('firebase-installations-database');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('firebase-installations-store', 'readwrite');
      const store = transaction.objectStore('firebase-installations-store');
      const read = store.get(key);
      read.onsuccess = () => store.put({ ...read.result,
        authToken: { token: 'EXPIRED_FAKE_TOKEN', requestStatus: 2, expiresIn: 0, creationTime: 0 },
      }, key);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), installation.key);
  const refresh = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/authTokens:generate'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await refresh;
  await expect.poll(async () => (await readInstallation())?.authToken, { timeout: stateTimeout }).toMatchObject({
    token: 'FAKE_INSTALLATION_TOKEN', requestStatus: 2, expiresIn: 604800000,
  });
});


for (const via of ['mode', 'button']) {
  test(`playing guide switched to autoplay via ${via}${via === 'button' ? ' before a step tick' : ''} keeps the remaining delay`, async ({ page }, info) => {
    await open(page, 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000');
    await mode(page, 'Guide').dispatchEvent('click');
    await page.clock.runFor(1); await page.clock.fastForward(99);
    if (via === 'button') await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
    await mode(page, 'Auto').dispatchEvent('click');
    await page.clock.runFor(1);
    await info.attach('after-mode-switch', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(0);
    // Include the initial timer in the authored 1000 ms delay.
    await page.clock.fastForward(898);
    expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(0);
    await page.clock.fastForward(1);
    expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  });

  test(`playing autoplay switched to guide via ${via} keeps the next pad deadline`, async ({ page }, info) => {
    await open(page, 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000');
    await mode(page, 'Auto').dispatchEvent('click');
    await page.clock.runFor(1); await page.clock.fastForward(99);
    if (via === 'button') await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
    await mode(page, 'Guide').dispatchEvent('click');
    await page.clock.runFor(1); await page.clock.fastForward(100); await page.clock.runFor(20);
    await info.attach('upcoming-pad-after-mode-switch', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await expect(page.locator('[data-pad="0,0"] .z-\\[25\\]')).toHaveCount(0);
    await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(1);
    await page.clock.fastForward(778);
    await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(1);
    await page.clock.fastForward(1); await page.clock.runFor(20);
    await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(0);
    expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  });
}

for (const pause of ['button', 'mode']) test(`pausing at a chain prompt via ${pause} keeps the requested chain visible`, async ({ page }, info) => {
  await open(page, 'd 1000\nc 2\no 1 2\nf 1 2\nd 10000', false, { led: 'o * 2 a 5\nd 10000' });
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(1); await page.clock.fastForward(200); await page.clock.runFor(20);
  const chain = page.getByRole('button', { name: 'Chain 10', exact: true });
  await info.attach('chain-before-pause', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  if (pause === 'button') await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  else await mode(page, 'Step').dispatchEvent('click');
  await page.clock.runFor(20); await page.clock.fastForward(2000); await page.clock.runFor(20);
  await info.attach('chain-while-paused', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await expect(chain.locator('div.z-10')).toHaveCSS('background-color', 'rgb(139, 195, 74)');
  await chain.dispatchEvent('pointerdown');
  await page.clock.runFor(20);
  await expect(chain.locator('div.z-10')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  await expect(page.locator('[data-pad="0,1"] .z-\\[25\\]')).toHaveCount(1);
});


test('paused chain redraw does not resurrect a consumed timed pad', async ({ page }, info) => {
  await open(page, 'd 1000\no 1 1\nf 1 1\nd 1000\nc 2\no 1 2\nf 1 2\nd 10000');
  await mode(page, 'Guide').dispatchEvent('click');
  await page.clock.runFor(1); await page.clock.fastForward(500); await page.clock.runFor(20);
  await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
  await page.clock.runFor(20);
  const pad = page.locator('[data-pad="0,0"]');
  await page.keyboard.press('1');
  await page.clock.runFor(20);
  await info.attach('next-chain-after-completed-step', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await expect(page.getByRole('button', { name: 'Chain 10', exact: true }).locator('div.z-10')).toHaveCSS('background-color', 'rgb(139, 195, 74)');
  await expect(pad.locator('.z-\\[25\\]')).toHaveCount(0);
});


for (const via of ['mode', 'button']) test(`leaving a timed chain wait for autoplay via ${via} keeps all note gaps`, async ({ page }, info) => {
  await open(page, 'd 1000\nc 2\no 1 1\nf 1 1\nd 500\no 1 1\nf 1 1\nd 500\no 1 1\nf 1 1\nd 10000');
  await mode(page, 'Guide').dispatchEvent('click');
  // Enter the chain gate at song time 200 ms, retaining exactly 800 ms.
  await page.clock.runFor(1); await page.clock.fastForward(199);
  await page.clock.fastForward(5000);
  if (via === 'button') {
    await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
    await page.clock.fastForward(300);
  }
  await mode(page, 'Auto').dispatchEvent('click');
  await page.clock.runFor(1);
  await info.attach('autoplay-before-first-note', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(0);
  await page.clock.fastForward(798);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(0);
  await page.clock.fastForward(1);
  await info.attach('autoplay-at-first-note', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.clock.fastForward(499);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.clock.fastForward(1);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(2);
  await page.clock.fastForward(499);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(2);
  await page.clock.fastForward(1);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(3);
});


for (const via of ['mode', 'button']) for (const gap of [0, 1, 300, 5000]) {
  test(`unpressed step note resumes via ${via} after ${gap}ms`, async ({ page }, info) => {
    // Starting in Auto lets the transport button retain Auto mode when it resumes.
    await open(page, 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 500\no 1 1\nf 1 1\nd 1000');
    await mode(page, 'Auto').dispatchEvent('click');
    await page.clock.runFor(1); await page.clock.fastForward(100);
    if (via === 'button') await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
    else await mode(page, 'Step').dispatchEvent('click');
    if (gap) await page.clock.fastForward(gap);
    await info.attach('before-resume', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await (via === 'button' ? page.getByRole('button', { name: 'Play', exact: true }) : mode(page, 'Auto')).dispatchEvent('click');
    await page.clock.runFor(1);
    await info.attach('after-resume', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    const count = () => page.evaluate(() => window.browserProbe.audio.starts.length);
    // Auto pause does not scan steps; Step mode does. Only a shown note is immediately due.
    const shown = via === 'mode' && gap > 0;
    expect(await count()).toBe(shown ? 2 : 1);
    if (!shown) await page.clock.fastForward(899);
    expect(await count()).toBe(2);
    // The clock is now 1 ms past the second note, so the third one is due 499 ms later.
    await page.clock.fastForward(498); expect(await count()).toBe(2);
    await page.clock.runFor(1); expect(await count()).toBe(3);
    await info.attach('audio-requests', { body: JSON.stringify(await page.evaluate(() => window.browserProbe.audio)), contentType: 'application/json' });
  });
}

test('autoplay from a partially played final step sounds only its unpressed pad', async ({ page }, info) => {
  await open(page, 'o 1 1\no 1 2\nf 1 1\nf 1 2');
  await mode(page, 'Step').dispatchEvent('click');
  await page.clock.runFor(20);
  await page.keyboard.press('1'); await page.clock.runFor(20);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await info.attach('partial-final-before', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await mode(page, 'Auto').dispatchEvent('click'); await page.clock.runFor(20);
  await info.attach('partial-final-after', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(2);
  await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
});


// Each pad lights only itself in the pack color while sounding. The guide light has a higher
// priority, so a pad drawn in the pack color also proves that no practice guide is left on it.
const ownLights = (pads: [number, number][]) => Object.fromEntries(pads.map(([x, y]) => [`1 ${x} ${y}`, `o ${x} ${y} a 5\nd 20000`]));
const packColor = 'rgb(239, 83, 80)';
const guideColor = 'rgb(139, 195, 74)';
const padLight = (page: Page, position: string) => page.locator(`[data-pad="${position}"] div.z-10`);
const padGuide = (page: Page, position: string) => page.locator(`[data-pad="${position}"] .z-\\[25\\]`);
const anyGuide = (page: Page) => page.locator('[data-pad] .z-\\[25\\]');
const soundRequests = (page: Page) => page.evaluate(() => window.browserProbe.audio.starts.length);

for (const [via, pausedMs] of [['mode', 0], ['button', 0], ['button', 3000]] as const) {
  test(`guide after replaying a shown step note via ${via}${pausedMs ? ` after a ${pausedMs}ms pause` : ''} guides only the following note`, async ({ page }, info) => {
    await open(page, 'o 1 1\nd 5000\no 1 2\nd 5000\no 1 3\nd 5000', false, {
      keySound: '1 1 1 tone.wav\n1 1 2 tone.wav\n1 1 3 tone.wav', leds: ownLights([[1, 1], [1, 2], [1, 3]]),
    });
    await mode(page, 'Step').dispatchEvent('click'); await page.clock.runFor(20);
    await expect(padGuide(page, '0,0')).toHaveCount(1);
    await page.keyboard.press('1'); await page.clock.runFor(20);
    await expect(padGuide(page, '0,1')).toHaveCount(1);
    await expect(padLight(page, '0,1')).toHaveCSS('background-color', guideColor);
    expect(await soundRequests(page)).toBe(1);
    await page.clock.fastForward(300);
    // The replayed note belongs to the switch, so later times count from this click.
    await mode(page, 'Auto').dispatchEvent('click'); await page.clock.runFor(20);
    await info.attach('replayed-second-note', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    expect(await soundRequests(page)).toBe(2);
    await expect(padGuide(page, '0,1')).toHaveCount(0);
    await expect(padLight(page, '0,1')).toHaveCSS('background-color', packColor);
    await page.clock.fastForward(1000);
    if (via === 'button') {
      await page.getByRole('button', { name: 'Pause', exact: true }).dispatchEvent('click');
      if (pausedMs) await page.clock.fastForward(pausedMs);
    }
    await mode(page, 'Guide').dispatchEvent('click'); await page.clock.runFor(20);
    await expect(anyGuide(page)).toHaveCount(0);
    // 1040 ms of song time have passed; the third note's 800 ms lead starts 4200 ms after the switch.
    await page.clock.fastForward(3100); await page.clock.runFor(20);
    await expect(anyGuide(page)).toHaveCount(0);
    await page.clock.fastForward(40); await page.clock.runFor(20);
    await info.attach('third-note-guided', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await expect(padGuide(page, '0,1')).toHaveCount(0);
    await expect(padGuide(page, '0,2')).toHaveCount(1);
    await expect(anyGuide(page)).toHaveCount(1);
    await page.clock.fastForward(740); await page.clock.runFor(20);
    await expect(padGuide(page, '0,2')).toHaveCount(1);
    await page.clock.fastForward(20); await page.clock.runFor(20);
    await expect(anyGuide(page)).toHaveCount(0);
    expect(await soundRequests(page)).toBe(2);
  });
}

for (const finalGroup of [false, true]) for (const hiddenFor of [1000, 10000]) {
  test(`autoplay after returning to partial step practice sounds only the unpressed pad after ${hiddenFor} ms, final=${finalGroup}`, async ({ page }, info) => {
    await open(page, `o 1 1\nd 1000\no 1 2\no 2 1${finalGroup ? '' : '\nd 1000\no 2 2\nd 1000'}`, false, {
      keySound: '1 1 1 tone.wav\n1 1 2 tone.wav\n1 2 1 tone.wav\n1 2 2 tone.wav', leds: ownLights([[1, 1], [1, 2], [2, 1], [2, 2]]),
    });
    await mode(page, 'Step').dispatchEvent('click'); await page.clock.runFor(20);
    await page.keyboard.press('1'); await page.clock.runFor(20);
    await expect(padGuide(page, '0,1')).toHaveCount(1);
    await expect(padGuide(page, '1,0')).toHaveCount(1);
    await page.keyboard.press('2'); await page.clock.runFor(20);
    await expect(padGuide(page, '0,1')).toHaveCount(0);
    await expect(padGuide(page, '1,0')).toHaveCount(1);
    expect(await soundRequests(page)).toBe(2);
    await visibility(page, true);
    await page.clock.fastForward(hiddenFor);
    await visibility(page, false);
    await page.clock.runFor(20);
    await expect(anyGuide(page)).toHaveCount(0);
    await expect(page.locator('[data-pad] div.z-10')).toHaveCount(0);
    await page.getByRole('button', { name: 'Play', exact: true }).dispatchEvent('click');
    await page.clock.runFor(20);
    await info.attach('returned-step-guide', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await expect(mode(page, 'Step')).toHaveAttribute('aria-pressed', 'true');
    await expect(padGuide(page, '1,0')).toHaveCount(1);
    await expect(anyGuide(page)).toHaveCount(1);
    await expect(padLight(page, '1,0')).toHaveCSS('background-color', guideColor);
    expect(await soundRequests(page)).toBe(2);
    await mode(page, 'Auto').dispatchEvent('click'); await page.clock.runFor(20);
    await info.attach('replayed-unpressed-pad', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    expect(await soundRequests(page)).toBe(3);
    await expect(padGuide(page, '1,0')).toHaveCount(0);
    await expect(padLight(page, '1,0')).toHaveCSS('background-color', packColor);
    await expect(padLight(page, '0,0')).toHaveCount(0);
    await expect(padLight(page, '0,1')).toHaveCount(0);
    if (finalGroup) {
      await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
    } else {
      // The written 1000 ms gap counts from the switch.
      await page.clock.fastForward(960); await page.clock.runFor(10);
      expect(await soundRequests(page)).toBe(3);
      await page.clock.fastForward(20); await page.clock.runFor(10);
      expect(await soundRequests(page)).toBe(4);
      await expect(padLight(page, '1,1')).toHaveCSS('background-color', packColor);
      await expect(padLight(page, '0,0')).toHaveCount(0);
      await expect(padLight(page, '0,1')).toHaveCount(0);
    }
    await info.attach('audio-requests', { body: JSON.stringify(await page.evaluate(() => window.browserProbe.audio)), contentType: 'application/json' });
  });
}
