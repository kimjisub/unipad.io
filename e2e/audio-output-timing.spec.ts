import type { Page, TestInfo } from '@playwright/test';
import { test, expect, expectAudioOutputRunning, stateTimeout } from './browser';
import { openBasicWith } from './basic-pack';

/**
 * Records what the pack's audio output actually sends to the speakers, with no request answered for
 * the browser, and checks that basic.uni's tone sounds when its song or a press says it should.
 *
 * basic.uni's autoplay presses pads 1 1, 2 1 and 1 1 again at 1.0 s, 4.2 s and 7.4 s, each sounding its
 * 100 ms tone, and ends at 7.6 s. Times are the output's own clock, so a busy machine only delays them
 * together.
 */
interface OutputRecord {
  /** Output clock times (s) where the signal rose after at least 50 ms of silence. */
  onsets: number[];
  /** How long each sounded (s). */
  lengths: number[];
  /** The output clock now. */
  now: () => number;
  /** The output clock at the latest press (pointer down or click) on the page. */
  pressedAt: number;
  /** The recorder is listening to the pack's output. */
  ready: boolean;
}

declare global {
  interface Window { outputRecord: OutputRecord }
}

/**
 * Finds the tones on the audio rendering thread, timed by the rendering clock itself. A ScriptProcessorNode
 * hands its samples to the page's main thread and dates them by when that thread got to them, so on a busy
 * machine one unbroken tone could read as two with a silent gap between them.
 */
const recorderModule = `registerProcessor('output-record', class extends AudioWorkletProcessor {
  sounding = false;
  quietSince = 0;
  start = 0;
  process([input]) {
    const samples = input[0];
    const frames = samples ? samples.length : 128;
    for (let i = 0; i < frames; i++) {
      const time = (currentFrame + i) / sampleRate;
      if (samples && Math.abs(samples[i]) > 0.01) {
        if (!this.sounding && time - this.quietSince >= 0.05) { this.port.postMessage({ onset: time }); this.start = time; }
        this.sounding = true;
        this.quietSince = time;
      } else if (this.sounding && time - this.quietSince >= 0.05) {
        this.sounding = false;
        this.port.postMessage({ length: this.quietSince - this.start });
      }
    }
    return true;
  }
});`;

async function recordOutput(page: Page) {
  await page.addInitScript(module => {
    const record: OutputRecord = { onsets: [], lengths: [], now: () => 0, pressedAt: 0, ready: false };
    window.outputRecord = record;
    for (const type of ['pointerdown', 'click'] as const) {
      window.addEventListener(type, () => { record.pressedAt = record.now(); }, { capture: true });
    }
    const moduleUrl = URL.createObjectURL(new Blob([module], { type: 'text/javascript' }));
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...rest: number[]) {
      if (this instanceof GainNode && destination === this.context.destination) {
        // A tap beside the app's final gain: it sees every sample sent to the speakers, and the recorder
        // behind it sends only silence on. The recorder joins once its module has loaded; open() waits.
        const context = this.context as AudioContext;
        const tap = context.createGain();
        Reflect.apply(connect, this, [tap]);
        record.now = () => context.currentTime;
        void context.audioWorklet.addModule(moduleUrl).then(() => {
          const recorder = new AudioWorkletNode(context, 'output-record');
          recorder.port.onmessage = ({ data }: MessageEvent<{ onset: number } | { length: number }>) => {
            if ('onset' in data) record.onsets.push(data.onset);
            else record.lengths.push(data.length);
          };
          Reflect.apply(connect, tap, [recorder]);
          Reflect.apply(connect, recorder, [destination]);
          record.ready = true;
        });
      }
      return Reflect.apply(connect, this, [destination, ...rest]);
    } as typeof connect;
  }, recorderModule);
}

const mode = (page: Page, name: 'Auto' | 'Guide' | 'Step') => page.getByRole('button', { name: `Play mode: ${name}`, exact: true });
const onsets = (page: Page) => page.evaluate(() => window.outputRecord.onsets);
const pressedAt = (page: Page) => page.evaluate(() => window.outputRecord.pressedAt);

/** Presses `label` from inside the page `ms` after the `count`th tone, and returns the output clock then. */
const pressAfterTone = (page: Page, label: string, count: number, ms: number) => page.evaluate(({ label, count, ms }) =>
  new Promise<number>(resolve => {
    const wait = () => {
      if (window.outputRecord.onsets.length < count) return void requestAnimationFrame(wait);
      setTimeout(() => {
        (document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click();
        resolve(window.outputRecord.now());
      }, ms);
    };
    wait();
  }), { label, count, ms });

async function open(page: Page) {
  await recordOutput(page);
  await openBasicWith(page, {});
  await expectAudioOutputRunning(page);
  await expect.poll(() => page.evaluate(() => window.outputRecord.ready), { message: 'the output recorder did not start' }).toBe(true);
}

async function attachRecord(page: Page, info: TestInfo, marks: Record<string, number>) {
  const record = await page.evaluate(() => ({ onsets: window.outputRecord.onsets, lengths: window.outputRecord.lengths }));
  await info.attach('output-record.json', { body: JSON.stringify({ ...record, marks }, null, 2), contentType: 'application/json' });
  return record;
}

/** The song ended by itself: the mode turned off. */
const expectEnded = (page: Page) => expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false', { timeout: stateTimeout });

test.describe('what the speakers receive', () => {
  test.setTimeout(60_000);

  test('Auto sounds the song at its times and ends by itself', async ({ page }, info) => {
    await open(page);
    const before = (await onsets(page)).length;
    await mode(page, 'Auto').click();
    const pressed = await pressedAt(page);
    await expect.poll(async () => (await onsets(page)).length, { timeout: stateTimeout }).toBeGreaterThanOrEqual(before + 3);
    await expectEnded(page);
    await page.waitForTimeout(1000);
    const { onsets: all, lengths } = await attachRecord(page, info, { pressed });
    const [first, second, third] = all.slice(before);
    expect(all, 'three tones, none after the end').toHaveLength(before + 3);
    expect(first - pressed, 'first tone 1 s after the press, plus the time the output takes to start').toBeGreaterThan(0.9);
    expect(first - pressed).toBeLessThan(2.5);
    expect(Math.abs(second - first - 3.2), 'the song’s 3.2 s between tones').toBeLessThan(0.25);
    expect(Math.abs(third - second - 3.2), 'the song’s 3.2 s between tones').toBeLessThan(0.25);
    for (const length of lengths.slice(before)) expect(length, 'each tone is short').toBeLessThan(0.5);
  });

  test('Pause holds the song and Play continues it where it stopped', async ({ page }, info) => {
    await open(page);
    const before = (await onsets(page)).length;
    await mode(page, 'Auto').click();
    // Paused 1 s after the first tone and played 3 s later: the second tone, due 2.2 s after the
    // pause, must wait for Play.
    const paused = await pressAfterTone(page, 'Pause', before + 1, 1000);
    const resumed = await pressAfterTone(page, 'Play', before + 1, 3000);
    expect((await onsets(page)).filter(time => time > paused && time < resumed), 'nothing sounds while paused').toEqual([]);
    await expect.poll(async () => (await onsets(page)).length, { timeout: stateTimeout }).toBeGreaterThanOrEqual(before + 3);
    await expectEnded(page);
    const { onsets: all } = await attachRecord(page, info, { paused, resumed });
    const [first, second, third] = all.slice(before);
    expect(all, 'three tones, none after the end').toHaveLength(before + 3);
    // Due 2.2 s after Play (3.2 s after the first tone, 1 s of it before the pause), plus the time the
    // output takes to start again.
    const late = second - (resumed + 3.2 - (paused - first));
    expect(late, 'the second tone comes after Play, at its place in the song').toBeGreaterThan(-0.25);
    expect(late).toBeLessThan(2);
    expect(Math.abs(third - second - 3.2), 'the song’s 3.2 s after the pause').toBeLessThan(0.25);
  });

  test('turning Auto off stops the song', async ({ page }, info) => {
    await open(page);
    const before = (await onsets(page)).length;
    await mode(page, 'Auto').click();
    await expect.poll(async () => (await onsets(page)).length, { timeout: stateTimeout }).toBe(before + 1);
    await mode(page, 'Auto').click();
    await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(8000);
    await attachRecord(page, info, {});
    expect(await onsets(page), 'no later tone').toHaveLength(before + 1);
  });

  for (const name of ['Guide', 'Step'] as const) {
    test(`${name} sounds the pad when it is pressed, and nothing by itself`, async ({ page }, info) => {
      await open(page);
      const before = (await onsets(page)).length;
      await mode(page, name).click();
      await expect(mode(page, name)).toHaveAttribute('aria-pressed', 'true');
      // The first press the song asks for is at 1 s; the mode waits for the player instead.
      await page.waitForTimeout(2500);
      expect(await onsets(page), 'nothing sounds by itself').toHaveLength(before);
      const box = (await page.locator('[data-pad="0,0"]').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const pressed = await pressedAt(page);
      await expect.poll(async () => (await onsets(page)).length, { timeout: stateTimeout }).toBeGreaterThanOrEqual(before + 1);
      await page.mouse.up();
      await page.waitForTimeout(500);
      const { onsets: all } = await attachRecord(page, info, { pressed });
      expect(all, 'one tone for one press').toHaveLength(before + 1);
      expect(all[before] - pressed, 'the tone follows the press').toBeGreaterThanOrEqual(-0.05);
      expect(all[before] - pressed).toBeLessThan(0.5);
    });
  }
});
