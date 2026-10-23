import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import JSZip from 'jszip';
import { test, expect, expectPads, stateTimeout } from './browser';

interface AudioSnapshot { soundTime: number; wallTime: number; state: AudioContextState; gain: number }
interface AudioTimeline {
  gain: GainNode | null;
  gainValue: number;
  activation?: Promise<void>;
  signals: { silent: boolean; epochMs: number; soundTime: number }[];
  suspended?: Promise<AudioSnapshot>;
  holdSuspension: boolean;
  releaseSuspension?: () => void;
  context: AudioContext | null;
  events: { type: string; wallTime: number; soundTime?: number; state?: string; gain: number }[];
  frames: { requested: number; fired: number; soundTime?: number }[];
  starts: { soundTime: number; wallTime: number }[];
  lightTimes: number[];
  observer?: MutationObserver;
  hidden?: Promise<{ soundTime: number; wallTime: number; output: number; starts: number; eventWallTime: number; epochMs: number; gain: number }>;
}
declare global { interface Window { audioTimeline: AudioTimeline } }

// Trace DOM snapshots synchronously scan the page and exceeded 200 ms at 4x CPU, stalling the
// real timers under measurement. Retain screenshots, sources and native timeline attachments.
test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: true, sources: true } });

test.beforeEach(async ({ page, browserName }) => {
  if (process.env.E2E_CPU_RATE && browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.E2E_CPU_RATE) });
  }
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const observed = await page.evaluate(() => {
    const timeline = window.audioTimeline;
    return timeline && { starts: timeline.starts, lights: timeline.lightTimes, events: timeline.events, signals: timeline.signals, frames: timeline.frames, state: timeline.context?.state };
  }).catch(() => null);
  await info.attach('failure-timeline', { body: JSON.stringify(observed ?? null, null, 2), contentType: 'application/json' });
});

function longTone(seconds = 8) {
  const samples = 44100 * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(4000 * Math.sin(i * 2 * Math.PI * 220 / 44100)), 44 + i * 2);
  return wav;
}

async function prepare(page: Page, holdSuspension = false) {
  await page.addInitScript(holdSuspension => {
    window.audioTimeline = { context: null, gain: null, gainValue: 1, signals: [], starts: [], lightTimes: [], events: [], frames: [], holdSuspension };
    // Keep control-call observations free of extra native clock reads inside the hide task.
    const mark = (type: string) => window.audioTimeline.events.push({ type, wallTime: performance.now(), gain: window.audioTimeline.gainValue });
    const value = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value')!;
    Object.defineProperty(AudioParam.prototype, 'value', {
      ...value,
      set(this: AudioParam, next: number) {
        const wallTime = performance.now();
        value.set!.call(this, next);
        if (this === window.audioTimeline.gain?.gain) {
          window.audioTimeline.gainValue = next;
          if (next === 0) window.audioTimeline.events.push({ type: 'output-muted', wallTime, gain: next });
        }
      },
    });
    const suspend = AudioContext.prototype.suspend;
    AudioContext.prototype.suspend = function () {
      mark('suspend-call');
      const completed = (async () => {
        if (window.audioTimeline.holdSuspension) await new Promise<void>(resolve => { window.audioTimeline.releaseSuspension = resolve; });
        await suspend.call(this);
        mark('suspend-resolved');
        return { soundTime: this.currentTime, wallTime: performance.now(), state: this.state, gain: window.audioTimeline.gain!.gain.value };
      })();
      window.audioTimeline.suspended = completed;
      return completed.then(() => {});
    };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      mark('resume-call');
      return resume.call(this).then(() => { mark('resume-resolved'); });
    };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => {
      const requested = performance.now();
      return raf.call(window, t => {
        if (window.audioTimeline.starts.length) window.audioTimeline.frames.push({ requested, fired: performance.now(), soundTime: window.audioTimeline.context?.currentTime });
        callback(t);
      });
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this);
      window.audioTimeline.gain = gain;
      return gain;
    };
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
  }, holdSuspension);
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  zip.file('sounds/long.wav', longTone(holdSuspension ? 60 : 8));
  zip.file('keySound', '1 1 1 long.wav 1\n1 1 2 tone.wav 1');
  zip.remove('keyLED');
  zip.file('keyLED/1 1 1', 'o 1 2 a 5\nd 1500\nf 1 2\no 1 3 a 9');
  zip.file('autoPlay', 'o 1 1\nf 1 1\nd 1500\no 1 2\nf 1 2\nd 10000\nf 1 1');
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({ name: 'long-sample.uni', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // A trusted click in the empty margin activates audio without playing a pad. Otherwise a
  // stalled initial audio clock can let two song notes start before the first audible frame.
  await page.evaluate(() => {
    const context = window.audioTimeline.gain!.context as AudioContext;
    window.audioTimeline.context = context;
    document.body.addEventListener('pointerdown', () => {
      window.audioTimeline.activation = context.resume();
    }, { once: true });
  });
  await page.mouse.click(1200, 760);
  await page.evaluate(() => window.audioTimeline.activation!);
  const initialAudioTime = await page.evaluate(() => window.audioTimeline.context!.currentTime);
  await expect.poll(() => page.evaluate(() => window.audioTimeline.context!.currentTime), { timeout: stateTimeout }).toBeGreaterThan(initialAudioTime);
  if (holdSuspension) await page.evaluate(async () => {
    const gain = window.audioTimeline.gain!;
    const context = gain.context as AudioContext;
    // Observe the real output gain on the render thread. A parallel, silent branch leaves the
    // application's analyser and destination unchanged. Message arrival time is not a sample time.
    const code = `class SilenceProbe extends AudioWorkletProcessor {
      constructor() { super(); this.silent = null; }
      process(inputs) {
        const silent = !(inputs[0] || []).some(channel => channel.some(value => value !== 0));
        if (silent !== this.silent) {
          this.silent = silent;
          this.port.postMessage({ silent, epochMs: Date.now(), soundTime: currentTime });
        }
        return true;
      }
    }
    registerProcessor('output-silence-probe', SilenceProbe);`;
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const probe = new AudioWorkletNode(context, 'output-silence-probe');
    probe.port.onmessage = event => { window.audioTimeline.signals.push(event.data); };
    gain.connect(probe);
    probe.connect(context.destination);
  });
  await page.evaluate(() => {
    window.audioTimeline.observer = new MutationObserver(() => {
      if (document.querySelector('[data-pad="0,2"] div.z-10') && window.audioTimeline.lightTimes.length === 0) {
        window.audioTimeline.lightTimes.push(window.audioTimeline.context!.currentTime);
        window.audioTimeline.events.push({ type: 'light-dom', wallTime: performance.now(), soundTime: window.audioTimeline.context!.currentTime, gain: window.audioTimeline.gain!.gain.value });
      }
    });
    window.audioTimeline.observer.observe(document.body, { subtree: true, attributes: true, childList: true });
    // Hide at the first audible frame in the page, before slow automation round trips can
    // let the next note run. Keep audio and timers real throughout the measurement.
    window.audioTimeline.hidden = new Promise(resolve => {
      const hide = new MessageChannel();
      hide.port1.onmessage = ({ data: output }: MessageEvent<number>) => {
        const soundTime = window.audioTimeline.context!.currentTime;
        const eventWallTime = performance.now();
        const epochMs = Date.now();
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        const wallTime = performance.now();
        const gain = window.audioTimeline.gainValue;
        window.audioTimeline.events.push({ type: 'hide-task-return', wallTime, gain });
        resolve({ soundTime, wallTime, output, starts: window.audioTimeline.starts.length, eventWallTime, epochMs, gain });
        hide.port1.close();
        hide.port2.close();
      };
      const hideWhenAudible = () => {
        const light = document.querySelector('[data-pad="0,1"] div.z-10');
        const output = window.browserProbe.audio.outputRms() ?? 0;
        if (window.audioTimeline.starts.length === 1 && output > 0.01 && light && getComputedStyle(light).backgroundColor === 'rgb(239, 83, 80)') {
          // Real visibility events have their own task. Firefox forwards audio control changes
          // only at the end of that task; dispatching inside rAF incorrectly includes the rest
          // of a long rendering task in the measured mute delay.
          hide.port2.postMessage(output);
        } else requestAnimationFrame(hideWhenAudible);
      };
      requestAnimationFrame(hideWhenAudible);
    });
  });
}

test('a long sample, the next note and finite lights share the paused audio timeline', async ({ page }, info) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  const hidden = await page.evaluate(() => window.audioTimeline.hidden!);
  expect(hidden.starts).toBe(1);
  expect(hidden.output).toBeGreaterThan(0.01);
  const suspended = await page.evaluate(() => window.audioTimeline.suspended!);
  // Native suspend acknowledges a render-thread boundary; its clock can advance before that.
  // Check immediate output gating separately and require the acknowledged clock to stay frozen.
  await page.waitForTimeout(2000);
  const frozen = await page.evaluate(() => ({
    events: window.audioTimeline.events,
    state: window.audioTimeline.context!.state,
    soundTime: window.audioTimeline.context!.currentTime,
    wallTime: performance.now(),
    starts: window.audioTimeline.starts,
    lights: window.audioTimeline.lightTimes,
    output: window.browserProbe.audio.outputRms(),
  }));
  await info.attach('hidden-timeline', { body: JSON.stringify({ hidden, suspended, frozen, suspendClockAdvance: suspended.soundTime - hidden.soundTime }, null, 2), contentType: 'application/json' });
  expect(suspended.state).toBe('suspended');
  expect(frozen.state).toBe('suspended');
  expect(frozen.soundTime - suspended.soundTime).toBeLessThan(0.05);
  expect(frozen.starts).toHaveLength(1);
  expect(frozen.lights).toHaveLength(0);
  expect(frozen.output).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.audioTimeline.starts.length), { timeout: stateTimeout }).toBe(2);
  await expect.poll(() => page.evaluate(() => window.audioTimeline.lightTimes.length), { timeout: stateTimeout }).toBe(1);
  const resumed = await page.evaluate(() => ({ starts: window.audioTimeline.starts, lights: window.audioTimeline.lightTimes, events: window.audioTimeline.events, frames: window.audioTimeline.frames }));
  await info.attach('resumed-timeline', { body: JSON.stringify(resumed, null, 2), contentType: 'application/json' });
  await info.attach('returned-with-long-sample', { body: await page.screenshot(), contentType: 'image/png' });
  expect(Math.abs(resumed.starts[1].soundTime - resumed.starts[0].soundTime - 1.5)).toBeLessThan(0.15);
  expect(Math.abs(resumed.lights[0] - resumed.starts[0].soundTime - 1.5)).toBeLessThan(0.15);
  expect(resumed.starts[1].wallTime - resumed.starts[0].wallTime).toBeGreaterThan(3400);
  expect(hidden.gain).toBe(0);
  const request = frozen.events.find(event => event.type === 'output-muted');
  expect(request).toBeDefined();
  expect(request!.gain).toBe(0);
  expect((request!.wallTime - hidden.eventWallTime) / 1000).toBeLessThan(0.05);
});

test('hidden output is silent before native suspension completes', async ({ page }, info) => {
  await prepare(page, true);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  const hidden = await page.evaluate(() => window.audioTimeline.hidden!);
  await info.attach('hidden-output-request', { body: JSON.stringify(hidden, null, 2), contentType: 'application/json' });
  expect(hidden.gain).toBe(0);
  // Hold only the native suspend request. The real source, gain and analyser keep rendering;
  // a suspended-state shortcut in outputRms cannot make this signal check pass.
  await expect.poll(() => page.evaluate(epochMs => {
    const signals = window.audioTimeline.signals;
    return signals.some((event, index) => event.silent && event.epochMs >= epochMs && signals.slice(0, index).some(previous => !previous.silent));
  }, hidden.epochMs), { timeout: stateTimeout }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputRms()), { timeout: stateTimeout }).toBe(0);
  const pending = await page.evaluate(() => ({
    state: window.audioTimeline.context!.state,
    gain: window.audioTimeline.gain!.gain.value,
    signals: window.audioTimeline.signals,
    output: window.browserProbe.audio.outputRms(),
    starts: window.audioTimeline.starts.length,
    events: window.audioTimeline.events,
  }));
  await info.attach('muted-before-native-suspend', { body: JSON.stringify({ hidden, pending, humanListening: false }, null, 2), contentType: 'application/json' });
  const silent = pending.signals.find((event, index) => event.silent && event.epochMs >= hidden.epochMs && pending.signals.slice(0, index).some(previous => !previous.silent))!;
  expect((silent.epochMs - hidden.epochMs) / 1000).toBeLessThan(0.05);
  expect(pending.state).toBe('running');
  expect(pending.gain).toBe(0);
  expect(pending.starts).toBe(1);
  await page.evaluate(() => window.audioTimeline.releaseSuspension!());
  await page.evaluate(() => window.audioTimeline.suspended!);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputRms()), { timeout: stateTimeout }).toBeGreaterThan(0.01);
});
