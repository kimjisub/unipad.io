import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import JSZip from 'jszip';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, expectPads } from './browser';

declare global { interface Window { transitionAudio: AudioContext; transitionNativeAudioTime?: () => number } }

const mode = (page: Page, name: string) => page.getByRole('button', { name: `Play mode: ${name}`, exact: true });
async function open(page: Page, autoPlay: string, wormhole = false, options: { led?: string; endless?: boolean; keySound?: string } = {}) {
  await page.addInitScript(() => {
    const gain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () { window.transitionAudio = this; return gain.call(this); };
  });
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', 'chain=3'));
  zip.file('keySound', options.keySound ?? `1 1 1 tone.wav 1${wormhole ? ' 2' : ''}\n1 1 2 tone.wav\n2 1 1 tone.wav\n3 1 1 tone.wav`);
  zip.remove('keyLED');
  zip.file(`keyLED/1 1 1${options.endless ? ' 0' : ''}`, options.led ?? 'o 1 2 a 5\nd 1000\nf 1 2\nd 1000\no 1 3 a 9');
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
  // The song clock starts on the sequencer's first tick, 1 ms after the click.
  await page.clock.fastForward(884);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);
  await page.clock.fastForward(1);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(2);
});

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

for (const resume of ['button', 'mode']) test(`resuming guide via ${resume} after scanning only a chain preserves the guide`, async ({ page }, info) => {
  await open(page, 'd 1000\no 1 1\nf 1 1\nd 1000\nc 2\no 1 2\nf 1 2\nd 10000');
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


test('a sound wormhole keeps its remaining delay across a hidden tab', async ({ page }, info) => {
  await open(page, 'd 10000\no 1 1\nf 1 1', true);
  const first = page.getByRole('button', { name: 'Chain 9', exact: true });
  await first.dispatchEvent('pointerdown'); await page.clock.runFor(16);
  await expect(first.locator('div.z-10')).toHaveCount(1);
  await page.keyboard.press('1');
  await page.clock.runFor(50);
  await visibility(page, true); await page.clock.fastForward(5000);
  await info.attach('hidden-wormhole', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await expect(first.locator('div.z-10')).toHaveCount(1);
  await visibility(page, false); await page.clock.runFor(49);
  await info.attach('before-wormhole-deadline', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await expect(first.locator('div.z-10')).toHaveCount(1);
  await page.clock.runFor(17);
  await expect(page.getByRole('button', { name: 'Chain 10', exact: true }).locator('div.z-10')).toHaveCount(1);
  await info.attach('resumed-wormhole', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
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
  // The first note starts the song clock; pause after exactly half a second of song time.
  await page.clock.fastForward(500);
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

for (const laterFirst of [false, true]) test(`compatibility: same-pad contacts wait for the last release (later first ${laterFirst})`, async ({ page }, info) => {
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
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  await expect(packLight(page)).toHaveCount(1);
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
