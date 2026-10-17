import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { compareLedCommands, intendedTimeline, peakPerSecond, summarizeLatency, type LedCommand } from './ledTiming';
import { parseUniPack } from './parser';
import { INFO_2X2_2CHAIN, KEYSOUND_1_1_1, packZip, SILENT_WAV } from './testUtils';

async function packWith(autoPlay: string, leds: Record<string, string>) {
  const files: Record<string, string | Uint8Array> = {
    info: INFO_2X2_2CHAIN, keySound: KEYSOUND_1_1_1, 'sounds/a.wav': SILENT_WAV, autoPlay,
  };
  for (const [name, content] of Object.entries(leds)) files[`keyLed/${name}`] = content;
  return parseUniPack(await packZip(files));
}

const lines = (commands: LedCommand[]) => commands.map((c) => `${c.ms} ${c.x === -1 ? 'round' : 'pad'} ${c.x === -1 ? c.y : `${c.x},${c.y}`}=${c.code}`);
const repaint = (ms: number) => [`${ms} pad 0,0=0`, `${ms} pad 0,1=0`, `${ms} pad 1,0=0`, `${ms} pad 1,1=0`];

describe('intendedTimeline', () => {
  test('follows LedRunner ownership, shutdown on a second press and release of endless animations', async () => {
    const pack = await packWith('o 1 1\nd 5\no 2 1\nd 10\no 1 1\nd 100\nf 2 1\n', {
      '1 1 1 1': 'o 1 1 a 5\nd 10\no 2 2 a 7\nd 10\nf 1 1\nf 2 2\n',
      '1 2 1 0': 'o 2 2 a 9\nd 100\n',
    });

    const timeline = intendedTimeline(pack);

    assert.deepEqual(lines(timeline.commands), [
      // Starting autoplay redraws every pad twice.
      ...repaint(0), ...repaint(0),
      '0 pad 0,0=5',
      '5 pad 1,1=9',
      // The first pad's animation takes (1,1) over, so its own off applies later and the endless one's does not.
      '10 pad 1,1=7',
      // Pressing the first pad again ends its animation and turns off everything it lit.
      '15 pad 0,0=0', '15 pad 1,1=0',
      '15 pad 0,0=5',
      '25 pad 1,1=7',
      '35 pad 0,0=0', '35 pad 1,1=0',
      '105 pad 1,1=9',
      // Releasing the second pad ends its endless animation; then autoplay ends and redraws every pad twice.
      '115 pad 1,1=0',
      ...repaint(115), ...repaint(115),
    ]);
    assert.equal(timeline.autoPlayLengthMs, 115);
    assert.equal(timeline.delaylessEndlessAnimations, 0);
  });

  test('bounds an endless animation left on a previous chain', async () => {
    const pack = await packWith('o 1 1\nd 10\nc 2\nd 10\nf 1 1\nd 10\n', {
      '1 1 1 0': 'o 1 1 a 5\nd 20\nf 1 1\nd 20\n',
    });
    const run = spawnSync(process.execPath, ['-e', `
      const { intendedTimeline } = require(process.argv[1]);
      const fs = require('node:fs');
      console.log(JSON.stringify(intendedTimeline(JSON.parse(fs.readFileSync(0, 'utf8')))));
    `, require.resolve('./ledTiming')], { input: JSON.stringify(pack), encoding: 'utf8', timeout: 5000 });
    assert.equal(run.status, 0, String(run.error ?? run.stderr));
    const timeline = JSON.parse(run.stdout);
    assert.equal(timeline.autoPlayLengthMs, 20);
    assert.equal(timeline.unreleasedEndlessAnimations, 1);
    assert.ok(timeline.commands.every((c: LedCommand) => c.ms <= 20));
  });

  test('ends autoplay at its last element without waiting for a delay there', async () => {
    const pack = await packWith('o 1 1\nd 10\nd 50\n', { '1 1 1 1': 'o 1 1 a 5\nd 30\nf 1 1\n' });

    const timeline = intendedTimeline(pack);

    assert.equal(timeline.autoPlayLengthMs, 10);
    assert.deepEqual(lines(timeline.commands), [...repaint(0), ...repaint(0), '0 pad 0,0=5', ...repaint(10), ...repaint(10), '30 pad 0,0=0']);
  });

  test('plays the animation autoplay names on a pad with several and leaves the pack as it was', async () => {
    const pack = await packWith('o 1 1\nd 10\no 1 1\nd 10\n', {
      '1 1 1 1 a': 'o 1 1 a 5\n',
      '1 1 1 1 b': 'o 1 1 a 9\n',
    });
    const queue = () => pack.ledAnimationTable?.[0]?.[0]?.[0]?.map((a) => a.num);
    const before = queue();

    const pads = intendedTimeline(pack).commands.filter((c) => c.x === 0 && c.y === 0 && c.code !== 0).map((c) => c.code);

    assert.deepEqual(pads, [5, 9]);
    assert.deepEqual(queue(), before);
  });

  test('counts round LEDs as their own targets and leaves out pads outside the grid', async () => {
    const pack = await packWith('o 1 1\nd 10\n', { '1 1 1 1': 'o mc 1 a 5\no 3 3 a 5\nd 5\nf mc 1\n' });

    const animation = intendedTimeline(pack).commands.filter((c) => c.code !== 0 || c.x === -1);

    assert.deepEqual(lines(animation), ['0 round 0=5', '5 round 0=0']);
  });
});

describe('compareLedCommands', () => {
  const at = (ms: number, x: number, code: number): LedCommand => ({ ms, x, y: 0, code });

  test('matches every command of an identical sequence and measures its lag', () => {
    const expected = [at(0, 0, 5), at(10, 0, 0), at(10, 1, 7)];
    const result = compareLedCommands(expected, expected.map((c) => ({ ...c, ms: c.ms + 3 })));
    assert.deepEqual([result.matched, result.reordered, result.missing, result.extra, result.overtaken], [3, 0, 0, 0, 0]);
    assert.deepEqual(result.latencies.map((l) => l.ms), [3, 3, 3]);
    assert.deepEqual(result.differences, []);
  });

  test('tells reordered, missing and extra commands apart on each LED', () => {
    const result = compareLedCommands(
      [at(0, 0, 5), at(1, 0, 7), at(0, 1, 5), at(5, 1, 0), at(0, 2, 5)],
      [at(2, 0, 7), at(3, 0, 5), at(2, 1, 5), at(2, 2, 5), at(4, 2, 3)],
    );
    assert.deepEqual([result.reordered, result.missing, result.extra], [1, 1, 1]);
    assert.equal(result.differences.length, 3);
  });

  test('compares long differing sequences without counting a deletion as thousands of reorders', () => {
    const expected = Array.from({ length: 5000 }, (_, i) => at(i, 0, i % 127));
    // Both ends differ, so trimming equal prefixes and suffixes cannot avoid the large comparison.
    const arrived = [...expected.slice(1), at(5000, 0, 127)];
    const result = compareLedCommands(expected, arrived);
    assert.deepEqual([result.matched, result.reordered, result.missing, result.extra], [4999, 0, 1, 1]);
    const swapped = compareLedCommands(expected, [expected[4999], ...expected.slice(1, -1), expected[0]]);
    assert.deepEqual([swapped.matched, swapped.reordered, swapped.missing, swapped.extra], [4998, 2, 0, 0]);
  });

  test('counts a command that arrives after one meant well after it', () => {
    const result = compareLedCommands([at(0, 0, 5), at(20, 1, 5)], [at(21, 1, 5), at(22, 0, 5)]);
    assert.equal(result.overtaken, 1);
    assert.equal(result.reordered, 0);
  });
});

describe('summaries', () => {
  test('peak per second counts the busiest 1000 ms', () => {
    const commands = [0, 400, 800, 999, 1000, 1999].map((ms) => ({ ms, x: 0, y: 0, code: 5 }));
    assert.equal(peakPerSecond(commands), 4);
  });

  test('latency summary gives nearest-rank percentiles and the build-up per minute', () => {
    const latencies = Array.from({ length: 100 }, (_, i) => ({ t0: i * 600, ms: 10 + i * 0.1 }));
    const summary = summarizeLatency(latencies);
    assert.equal(summary.median, 10 + 49 * 0.1);
    assert.equal(summary.p95, 10 + 94 * 0.1);
    assert.equal(summary.max, 10 + 99 * 0.1);
    assert.ok(Math.abs(summary.buildUpPerMinute - 10) < 1e-9);
    assert.equal(summary.medianByTenth.length, 10);
  });
});
