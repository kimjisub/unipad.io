import { readFile } from 'node:fs/promises';
import { cpus, loadavg, release } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './browser';
import { parseUniPack } from '../src/lib/unipack/parser';
import {
  compareLedCommands, intendedTimeline, isPad, OVERTAKE_MS, peakPerSecond, summarizeLatency,
  type IntendedTimeline, type LedCommand,
} from '../src/lib/unipack/ledTiming';

// Whether the LED commands autoplay sends to the launchpad keep the pack's order and leave none out,
// on the real clock through the real play screen: autoplay, LedRunner, the play screen's channels and
// MidiConnection, ending at a virtual Launchpad X output. LedRunner's command reaches output.send in the
// same synchronous call (the play screen draws it and sends it with no queue between), so the time
// output.send receives it is also when the player made it. Latency is printed, not asserted: it depends
// on the machine and its load. Only pads are compared; round buttons and the logo show pack lights on
// the launchpad only in Pro light mode, so their messages are counted and left out.

interface Run {
  /** The command reaching output.send, ms after the Auto button was clicked. */
  sent: LedCommand[];
  roundMessages: number;
  /** Wall time from the click to the last command, and the page's main-thread work in it (ms): tasks
   *  and scripts as wall time, cpuMs as CPU time, which a busy machine does not inflate. */
  wallMs: number;
  taskMs: number;
  scriptMs: number;
  cpuMs: number;
  /** The longest span of three ticks of a 4 ms timer the page runs beside LedRunner's (ms): how long a
   *  press could wait, on this machine, for LedRunner to start its animation and play the last step. */
  timerSpanMs: number;
}

declare global {
  interface Window { ledTiming: { sent: number[]; ticks: number[]; autoStart: number | null } }
}

// Store packs play their sounds; nothing should reach the speakers of the machine running the tests.
test.use({ launchOptions: { args: ['--mute-audio'] } });

/** LedRunner's tick, which the probe timer copies to see how late the page's timers ran. */
const TICK_MS = 4;

/**
 * Records each MIDI message the player hands the virtual output, with when it was handed over, and the
 * ticks of a timer as frequent as LedRunner's: a machine that leaves the page no CPU delays both alike.
 */
async function recordMidiOutput(page: Page) {
  await page.addInitScript((tickMs) => {
    const sent: number[] = [];
    const ticks: number[] = [];
    window.ledTiming = { sent, ticks, autoStart: null };
    const tick = () => {
      ticks.push(performance.now());
      setTimeout(tick, tickMs);
    };
    setTimeout(tick, tickMs);
    const wrapped = new WeakSet<object>();
    const request = navigator.requestMIDIAccess.bind(navigator);
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async (options: MIDIOptions) => {
        const access = await request(options);
        for (const output of access.outputs.values()) {
          if (wrapped.has(output)) continue;
          wrapped.add(output);
          const send = output.send.bind(output);
          output.send = (data: number[] | Uint8Array, timestamp?: number) => {
            sent.push(performance.now(), data[0], data[1] ?? 0, data[2] ?? 0);
            // The shared probe already supplied the virtual output. Keep only this timestamped
            // recording during playback instead of allocating a second copy of every message.
            if (window.ledTiming.autoStart === null) send(data, timestamp);
          };
        }
        return access;
      },
    });
  }, TICK_MS);
}

/** LedRunner starts an animation on its second tick after the press and plays a step on the first tick at or after its time. */
function longestTimerSpan(ticks: readonly number[], from: number, to: number): number {
  let longest = 0;
  for (let i = 0; i + 3 < ticks.length; i++) {
    if (ticks[i + 3] < from || ticks[i] > to) continue;
    longest = Math.max(longest, ticks[i + 3] - ticks[i]);
  }
  return longest;
}

/** Launchpad X programmer layout: pad x,y (row from the top, column) is note (8 - x) * 10 + y + 1. */
function padOfNote(note: number): { x: number; y: number } | null {
  const row = Math.floor(note / 10);
  const column = note % 10;
  if (row < 1 || row > 8 || column < 1 || column > 8) return null;
  return { x: 8 - row, y: column - 1 };
}

async function playAutoPlay(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }, timeline: IntendedTimeline): Promise<Run> {
  await recordMidiOutput(page);
  await page.goto('/play');
  test.skip(!await page.evaluate(() => window.browserProbe.midi.supported), 'Not applicable: this browser has no native Web MIDI API');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(file);
  await expect(page.locator('[data-pad]')).toHaveCount(64, { timeout: 120_000 });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // The Launchpad X mode switch, then the redraw of every LED once the connection reports itself.
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages), { timeout: 30_000 })
    .toContainEqual([0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x0e, 1, 0xf7]);
  await page.waitForFunction(() => {
    const { sent } = window.ledTiming;
    return sent.length > 0 && performance.now() - sent[sent.length - 4] > 500;
  }, undefined, { timeout: 30_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

  const auto = page.getByRole('button', { name: 'Play mode: Auto', exact: true });
  // Captured before the play screen's own handler, which starts autoplay in the same dispatch.
  await page.evaluate(() => {
    window.browserProbe.midi.messages.length = 0;
    window.ledTiming.sent.length = 0;
    window.ledTiming.ticks.length = 0;
    window.addEventListener('click', () => { window.ledTiming.autoStart = performance.now(); }, { capture: true, once: true });
  });
  const before = await metrics();
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await expect(auto).toHaveAttribute('aria-pressed', 'false', { timeout: timeline.autoPlayLengthMs + 60_000 });
  const lastT0 = timeline.commands.at(-1)?.ms ?? 0;
  await waitForMidiQuiet(page, lastT0);

  const after = await metrics();
  const { sent, ticks, autoStart } = await page.evaluate(() => window.ledTiming);
  const run: Run = {
    sent: [], roundMessages: 0,
    wallMs: sent.length ? sent[sent.length - 4] - autoStart! : 0,
    taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
    scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    cpuMs: (after.ThreadTime - before.ThreadTime) * 1000,
    timerSpanMs: longestTimerSpan(ticks, autoStart!, autoStart! + lastT0),
  };
  for (let i = 0; i < sent.length; i += 4) {
    const [time, status, note, velocity] = sent.slice(i, i + 4);
    const kind = status & 0xf0;
    const pad = kind === 0x90 || kind === 0x80 ? padOfNote(note) : null;
    if (pad) run.sent.push({ ms: time - autoStart!, ...pad, code: kind === 0x90 ? velocity : 0 });
    else if (kind === 0xb0) run.roundMessages++;
  }
  return run;
}

/** Wait past the intended tail and for a full quiet second after the last actual send. A continuing
 * stream times out explicitly instead of being read partway through and called missing commands. */
async function waitForMidiQuiet(page: Page, lastT0: number) {
  await page.waitForFunction((lastIntended) => {
    const { sent, autoStart } = window.ledTiming;
    const lastSent = sent.length ? sent[sent.length - 4] : autoStart!;
    return performance.now() - Math.max(autoStart! + lastIntended, lastSent) >= 1000;
  }, lastT0, { timeout: Math.max(60_000, lastT0 + 30_000) });
}

test('records late tail commands until the MIDI output has gone quiet', async ({ page }) => {
  await page.goto('/play');
  await page.evaluate(() => {
    const sent: number[] = [];
    window.ledTiming = { sent, ticks: [], autoStart: performance.now() };
    const send = () => sent.push(performance.now(), 0x90, 81, 5);
    send();
    setTimeout(send, 900);
    setTimeout(send, 1800);
  });
  await waitForMidiQuiet(page, 0);
  expect(await page.evaluate(() => window.ledTiming.sent.length / 4)).toBe(3);
});

const ms = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '-');

function report(name: string, timeline: IntendedTimeline, run: Run, browserVersion: string) {
  const intendedPads = timeline.commands.filter(isPad);
  const result = compareLedCommands(intendedPads, run.sent);
  const latency = summarizeLatency(result.latencies);
  const lastT0 = timeline.commands.at(-1)?.ms ?? 0;
  const text = [
    `LED timing: ${name}`,
    `  pack: ${timeline.commands.length} commands (${intendedPads.length} on pads) over ${lastT0} ms, ` +
      `${ms(lastT0 ? (timeline.commands.length * 1000) / lastT0 : 0)}/s average, ${peakPerSecond(timeline.commands)}/s at peak` +
      `${timeline.delaylessEndlessAnimations ? `, ${timeline.delaylessEndlessAnimations} endless animations without delay` : ''}` +
      `${timeline.unreleasedEndlessAnimations ? `, ${timeline.unreleasedEndlessAnimations} unreleased endless animations truncated at autoplay end` : ''}` +
      `${timeline.ledChainEvents ? `, ${timeline.ledChainEvents} chain changes in LED files (not followed)` : ''}`,
    `  pack -> output.send (pads): expected ${result.expected}, arrived ${result.arrived}, matched ${result.matched}, ` +
      `reordered ${result.reordered}, missing ${result.missing}, extra ${result.extra}, ` +
      `overtaken by more than ${OVERTAKE_MS} ms ${result.overtaken}; round and logo messages left out ${run.roundMessages}`,
    `  T2-T0 ms: median ${ms(latency.median)}, p95 ${ms(latency.p95)}, max ${ms(latency.max)}, ` +
      `build-up ${ms(latency.buildUpPerMinute)} ms/min, median by tenth ${latency.medianByTenth.map(ms).join(' ')}`,
    `  page main thread: tasks ${ms(run.taskMs)} ms, scripts ${ms(run.scriptMs)} ms, CPU ${ms(run.cpuMs)} ms ` +
      `in ${ms(run.wallMs)} ms from the click to the last command; ` +
      `longest span of three ${TICK_MS} ms timer ticks ${ms(run.timerSpanMs)} ms`,
    `  Chromium ${browserVersion}, Node ${process.version}, ${process.platform} ${release()} ${process.arch}, ` +
      `${cpus().length} cores, load average ${loadavg()[0].toFixed(1)}`,
    ...result.differences.map((d) => `  differs: ${d}`),
  ].join('\n');
  return { result, latency, text };
}

async function record(testInfo: TestInfo, name: string, text: string, summary: object) {
  console.log(text);
  await testInfo.attach(`${name}.txt`, { body: text, contentType: 'text/plain' });
  await testInfo.attach(`${name}.json`, { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
}

/** A 10 ms silent mono WAV: the parser needs a keySound, and nothing here should be heard. */
function silentWav(): Buffer {
  const samples = 441;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

const DENSE_PADS = 63;
const DENSE_PRESS_GAP_MS = 5;
/** Four 1 ms steps a pass. */
const DENSE_PASSES = 10;
const DENSE_ANIMATION_MS = DENSE_PASSES * 4;
/** How long a pad's animation may start late before its next press ends it with steps still to play. */
const DENSE_SLACK_MS = DENSE_PADS * DENSE_PRESS_GAP_MS - DENSE_ANIMATION_MS;

/**
 * 63 pads pressed 5 ms apart for ten rounds, each flashing itself every millisecond for 40 ms
 * (repeating a colour, as packs do), the left column also lighting a round LED, and one endless animation
 * released halfway: about 8,000 commands a second at peak. No two animations touch the same LED within
 * a few ticks of each other, and autoplay ends 200 ms after the last one (a last delay is not waited
 * for, so a release follows it), so the order of every LED is fixed.
 */
async function densePack(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('info', 'title=LED Timing Test Pack\nproducerName=UniPad Tests\nbuttonX=8\nbuttonY=8\nchain=1\nsquareButton=true\n');
  zip.file('keySound', '1 1 1 tone.wav\n');
  zip.file('sounds/tone.wav', silentWav());
  const pads: [number, number][] = [];
  for (let x = 1; x <= 8; x++) {
    for (let y = 1; y <= 8; y++) {
      if (x === 8 && y === 8) continue;
      pads.push([x, y]);
      const pass = `o ${x} ${y} a 5\nd 1\no ${x} ${y} a 5\nd 1\no ${x} ${y} a 21\nd 1\nf ${x} ${y}\nd 1\n`;
      const [roundOn, roundOff] = y === 1 ? [`o mc ${x} a 9\n`, `f mc ${x}\n`] : ['', ''];
      zip.file(`keyLED/1 ${x} ${y} 1`, roundOn + pass.repeat(DENSE_PASSES) + roundOff);
    }
  }
  expect(pads).toHaveLength(DENSE_PADS);
  zip.file('keyLED/1 8 8 0', 'o 8 8 a 13\nd 60000\n');
  let autoPlay = 'o 8 8\n';
  for (let round = 0; round < 10; round++) {
    for (const [x, y] of pads) autoPlay += `o ${x} ${y}\nd 2\nf ${x} ${y}\nd ${DENSE_PRESS_GAP_MS - 2}\n`;
    if (round === 4) autoPlay += 'f 8 8\n';
  }
  zip.file('autoPlay', `${autoPlay}d 200\nf 1 1\n`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('a dense pack\'s LED commands reach the launchpad output in the pack\'s order with nothing missing', async ({ page, browser }, testInfo) => {
  test.slow();
  const buffer = await densePack();
  const timeline = intendedTimeline(await parseUniPack(new Uint8Array(buffer).buffer));
  expect(peakPerSecond(timeline.commands), 'commands a second at peak').toBeGreaterThan(5000);

  const run = await playAutoPlay(page, { name: 'led-timing.zip', mimeType: 'application/zip', buffer }, timeline);
  const { result, latency, text } = report('in-repo dense pack', timeline, run, browser.version());
  await record(testInfo, 'dense-pack', text, { ...result, latencies: undefined, latency, ...run, sent: undefined });

  expect(result.reordered, text).toBe(0);
  expect(result.extra, text).toBe(0);
  // LedRunner times each animation from the tick that first plays it, and a press ends its pad's earlier
  // animation at once. When the page's timers stalled for longer than the pack leaves, a missing command
  // is what any device stalling that long shows, so the run cannot tell a fault in the player from it.
  test.skip(result.missing > 0 && run.timerSpanMs > DENSE_SLACK_MS,
    `Inconclusive: ${result.missing} commands missing after the page's timers stalled for ` +
    `${ms(run.timerSpanMs)} ms, more than the ${DENSE_SLACK_MS} ms the pack leaves between a pad's animation and its next press`);
  expect(result.missing, text).toBe(0);
  expect(result.matched).toBe(timeline.commands.filter(isPad).length);
});

// Store packs: LED_TIMING_PACKS names a folder of store zips (they stay out of the repository), and
// LED_TIMING_MEASURE the pack codes to play, e.g.
//   LED_TIMING_PACKS=/path/to/zips LED_TIMING_MEASURE=_TRNDSTTR,_Warrior_Song pnpm test:e2e --project=chromium e2e/led-timing.spec.ts
// Each plays as long as its autoplay (1.5 to 3 minutes). Reordered or missing commands fail the test.
// Extra messages are reported, not asserted: the ideal timeline does not reproduce LedRunner's pending
// additions when a pad is pressed twice inside one tick, or its pending removal's extra off command.
const packsFolder = process.env.LED_TIMING_PACKS;
const measured = (process.env.LED_TIMING_MEASURE ?? '').split(',').map((code) => code.trim()).filter(Boolean);

if (!packsFolder || measured.length === 0) {
  test('store packs', () => {
    test.skip(true, 'Measured only when LED_TIMING_PACKS and LED_TIMING_MEASURE name store packs');
  });
} else {
  for (const code of measured) {
    test(`${code}: LED commands reach the launchpad output in the pack's order with nothing missing`, async ({ page, browser }, testInfo) => {
      const folder = resolve(packsFolder);
      const path = join(folder, `${code}.zip`);
      const data = await readFile(path);
      const pack = await parseUniPack(new Uint8Array(data).buffer);
      expect([pack.info.buttonX, pack.info.buttonY], 'an 8x8 pack, as the Launchpad X layout addresses').toEqual([8, 8]);
      const timeline = intendedTimeline(pack);
      test.skip(timeline.unreleasedEndlessAnimations > 0 || timeline.delaylessEndlessAnimations > 0,
        'Inconclusive: the pack has endless animations with no finite measurable tail');
      test.setTimeout(timeline.autoPlayLengthMs + 300_000);

      const run = await playAutoPlay(page, path, timeline);
      const { result, latency, text } = report(code, timeline, run, browser.version());
      await record(testInfo, code, text, { ...result, latencies: undefined, latency, ...run, sent: undefined });

      expect(result.reordered, text).toBe(0);
      expect(result.missing, text).toBe(0);
    });
  }
}
