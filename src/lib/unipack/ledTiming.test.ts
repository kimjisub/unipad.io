import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { compareLedCommands, denseTimingVerdict, timelineMeasurementLimit, intendedTimeline, peakPerSecond, stallExplains, summarizeLatency, type LedCommand } from './ledTiming';
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

  test('ends a finite animation after a pass that takes no time, as LedRunner does', async () => {
    const pack = await packWith('o 1 1\nd 10\nd 10\n', { '1 1 1 3': 'o 1 2 a 5\nf 1 2\n' });

    const animation = intendedTimeline(pack).commands.filter((c) => c.x === 0 && c.y === 1 && c.ms === 0);

    // Starting autoplay redraws every pad twice; the animation then sends one pass, not three.
    assert.deepEqual(lines(animation), ['0 pad 0,1=0', '0 pad 0,1=0', '0 pad 0,1=5', '0 pad 0,1=0']);
  });

  test('ends a delayless animation repeated 2147483647 times right away', async () => {
    const pack = await packWith('o 1 1\nd 10\nd 10\n', { '1 1 1 2147483647': 'o 1 2 a 5\nf 1 2\n' });
    const run = spawnSync(process.execPath, ['-e', `
      const { intendedTimeline } = require(process.argv[1]);
      const fs = require('node:fs');
      console.log(JSON.stringify(intendedTimeline(JSON.parse(fs.readFileSync(0, 'utf8')))));
    `, require.resolve('./ledTiming')], { input: JSON.stringify(pack), encoding: 'utf8', timeout: 5000 });
    assert.equal(run.status, 0, String(run.error ?? run.stderr));
    const timeline = JSON.parse(run.stdout);
    assert.equal(timeline.commands.filter((c: LedCommand) => c.x === 0 && c.y === 1 && c.code !== 0).length, 1);
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


describe('denseTimingVerdict', () => {
  const result = { reordered: 0, missing: 0, extra: 0 };
  test('passes a complete ordered run whatever the stall', () => {
    assert.equal(denseTimingVerdict(result, false), 'pass');
    assert.equal(denseTimingVerdict(result, true), 'pass');
  });
  test('fails reorders and missing commands that no stall explains', () => {
    assert.equal(denseTimingVerdict({ ...result, missing: 673 }, false), 'fail');
    assert.equal(denseTimingVerdict({ ...result, reordered: 4 }, false), 'fail');
  });
  test('leaves differences a stall explains inconclusive', () => {
    assert.equal(denseTimingVerdict({ ...result, reordered: 18, missing: 2066 }, true), 'inconclusive');
  });
  test('still fails extra commands regardless of timer stalls', () => {
    assert.equal(denseTimingVerdict({ reordered: 4, missing: 10, extra: 1 }, true), 'fail');
  });
});

describe('stallExplains', () => {
  // Pad 1,1 pressed every 315 ms and flashing itself every millisecond for 40 ms, as in the dense pack of
  // e2e/led-timing.spec.ts. A Chromium run of that pack recorded 673 of 25,458 commands missing, with the
  // page's timers stalled for up to 376.3 ms: on pad 0,0 the second animation's first step arrived at
  // 660.7 ms instead of 315 ms, the third press turned the pad off at 666.4 ms and the rest of the second
  // animation never came; on pad 0,7 two passes of one animation arrived and the other eight did not.
  const pass = 'o 1 1 a 5\nd 1\no 1 1 a 5\nd 1\no 1 1 a 21\nd 1\nf 1 1\nd 1\n';
  const padTimeline = async () => intendedTimeline(await packWith(
    `${'o 1 1\nd 2\nf 1 1\nd 313\n'.repeat(4)}d 400\nf 2 2\n`, { '1 1 1 1': pass.repeat(10) },
  )).commands.filter((c) => c.x === 0 && c.y === 0);
  /** Pad 0,0's commands: two redraws, four animations of 40 steps, two redraws. */
  const step = (animation: number, index: number) => 2 + animation * 40 + index;
  const off = (ms: number): LedCommand => ({ ms, x: 0, y: 0, code: 0 });
  const later = (commands: LedCommand[], by: number) => commands.map((c) => ({ ...c, ms: c.ms + by }));
  /** A 4 ms timer's ticks through the run, none between `stall`'s two times. */
  const ticks = (stall?: [number, number]) => Array.from({ length: 560 }, (_, i) => i * 4)
    .filter((t) => !stall || t <= stall[0] || t >= stall[1]);

  test('dates each step by the next press of its pad', async () => {
    const want = await padTimeline();
    assert.equal(want.length, 2 + 4 * 40 + 2);
    assert.deepEqual([want[step(0, 0)].cutMs, want[step(2, 39)].cutMs, want[step(3, 0)].cutMs], [315, 945, Infinity]);
    assert.equal(want[0].animation, undefined);
  });

  test('accepts LEDs that match exactly', async () => {
    const want = await padTimeline();
    assert.equal(stallExplains(want, later(want, 100), ticks()), true);
  });

  test('explains the recorded pad 0,0: a late animation the next press cut off while it had the pad lit', async () => {
    const want = await padTimeline();
    const got = [...want.slice(0, step(1, 0)), { ...want[step(1, 0)], ms: 660.7 }, off(666.4), ...later(want.slice(step(2, 0)), 40)];
    assert.equal(stallExplains(want, got, ticks([284, 660])), true);
    // Without the off the press sends, or with it in the tick of the last step, the cut is not what LedRunner does.
    assert.equal(stallExplains(want, got.filter((c) => c.ms !== 666.4), ticks([284, 660])), false);
    assert.equal(stallExplains(want, got.map((c) => (c.ms === 666.4 ? { ...c, ms: 660.7 } : c)), ticks([284, 660])), false);
  });

  test('does not explain an animation cut off long after its steps were due', async () => {
    const want = await padTimeline();
    // The second animation started on time, so its next step was due 300 ms before the press that cut it.
    const got = [...want.slice(0, step(1, 1)), off(666.4), ...later(want.slice(step(2, 0)), 40)];
    assert.equal(stallExplains(want, got, ticks()), false);
    assert.equal(stallExplains(want, got, ticks([1000, 1376.3])), false);
  });

  test('explains the recorded pad 0,7: a late animation cut off between passes, with nothing lit to turn off', async () => {
    const want = await padTimeline();
    const got = [...want.slice(0, step(1, 0)), ...later(want.slice(step(1, 0), step(1, 8)), 335.1), ...later(want.slice(step(2, 0)), 40)];
    assert.equal(stallExplains(want, got, ticks([284, 650])), true);
  });

  /** Pad 0,0's third and fourth animations, started in one tick: in each of these ticks, this many steps of
   *  the third, then this many of the fourth. */
  const sideBySide = (want: LedCommand[], sent: [number, number, number][]) => {
    const [third, fourth] = [want.slice(step(2, 0), step(3, 0)), want.slice(step(3, 0), step(4, 0))];
    let [a, b] = [0, 0];
    return sent.flatMap(([ms, fromThird, fromFourth]) => {
      const steps = [...third.slice(a, a + fromThird), ...fourth.slice(b, b + fromFourth)];
      [a, b] = [a + fromThird, b + fromFourth];
      return steps.map((c) => ({ ...c, ms }));
    });
  };

  test('explains the recorded pad 2,6: two presses in one tick after a stall, their animations side by side', async () => {
    const want = await padTimeline();
    // Another Chromium run stalled the page's timers from 2630.5 to 3244.4 ms, past pad 2,6's next press at
    // 2945 ms. Its two animations then arrived in these ticks (here less 2000 ms).
    const recorded: [number, number, number][] = [
      [1244.4, 1, 1], [1256.6, 12, 0], [1257, 0, 12], [1273.2, 16, 0], [1293.2, 0, 16], [1308.4, 11, 0], [1309.1, 0, 11],
    ];
    const got = [...want.slice(0, step(2, 0)), ...sideBySide(want, recorded), ...later(want.slice(-2), 28.2)];
    assert.equal(stallExplains(want, got, ticks([630.5, 1244.4])), true);
    // Without a stall the third animation started before the next press, which would have ended it.
    assert.equal(stallExplains(want, got, ticks()), false);
    // A step missing, or two out of order, while they play side by side.
    assert.equal(stallExplains(want, got.filter((_, i) => i !== step(2, 20)), ticks([630.5, 1244.4])), false);
    const swapped = [...got];
    [swapped[step(2, 4)], swapped[step(2, 5)]] = [swapped[step(2, 5)], swapped[step(2, 4)]];
    assert.equal(stallExplains(want, swapped, ticks([630.5, 1244.4])), false);
  });

  test('explains the recorded pad 1,0: side by side, an off for a pad the other animation turned off sends nothing', async () => {
    const want = await padTimeline();
    // A run with the timers stalled past pad 1,0's next press (here less 1270 ms): the third animation's
    // last step turned the pad off at 1112.5 ms, so the fourth's off right after it was not sent.
    const recorded: [number, number, number][] = [
      [1068.3, 1, 1], [1074.2, 5, 0], [1074.4, 0, 5], [1090.9, 17, 0], [1091.4, 0, 17], [1112.5, 17, 0], [1112.8, 0, 17],
    ];
    const played = sideBySide(want, recorded);
    const unsent = played.findIndex((c) => c.ms === 1112.8);
    assert.equal(played[unsent - 1].code, 0);
    assert.equal(played[unsent].code, 0);
    const got = [...want.slice(0, step(2, 0)), ...played.filter((_, i) => i !== unsent), ...want.slice(-2)];
    assert.equal(stallExplains(want, got, ticks([600, 1068.3])), true);
    // That off cannot arrive: the pad was already off.
    assert.equal(stallExplains(want, [...want.slice(0, step(2, 0)), ...played, ...want.slice(-2)], ticks([600, 1068.3])), false);
  });

  test('does not explain a hole inside an animation that kept playing, even after a stall elsewhere', async () => {
    const want = await padTimeline();
    // Four steps make one pass, so by their codes the hole looks like the last pass cut off.
    const got = [...want.slice(0, step(1, 10)), ...want.slice(step(1, 14))];
    assert.equal(stallExplains(want, got, ticks()), false);
    assert.equal(stallExplains(want, got, ticks([1000, 1376.3])), false);
  });

  test('does not explain a step missing from an animation sent all at once after a stall', async () => {
    const want = await padTimeline();
    // LedRunner caught up with the whole second animation in one tick, one step short: the rest arrived
    // in that same tick, so no press came between them.
    const drained = want.slice(step(1, 0), step(2, 0)).map((c) => ({ ...c, ms: 660.7 }));
    const got = [...want.slice(0, step(1, 0)), ...drained.slice(0, 20), ...drained.slice(21), ...later(want.slice(step(2, 0)), 40)];
    assert.equal(stallExplains(want, got, ticks([284, 660])), false);
  });

  test('does not explain steps out of order', async () => {
    const want = await padTimeline();
    const got = [...want];
    [got[step(1, 2)], got[step(1, 3)]] = [{ ...got[step(1, 3)], ms: 317 }, { ...got[step(1, 2)], ms: 318 }];
    assert.equal(stallExplains(want, got, ticks([284, 660])), false);
  });

  test('explains the final redraw overtaking the last steps only when the timers stalled until it', async () => {
    const want = await padTimeline();
    // The 31st step of the last animation was due at 975 ms, the redraw at 1660 ms.
    const got = [...want.slice(0, step(3, 30)), ...later(want.slice(-2), 0.5), ...later(want.slice(step(3, 30), -2), 686)];
    assert.equal(stallExplains(want, got, ticks([976, 1660])), true);
    assert.equal(stallExplains(want, got, ticks()), false);
  });
});

describe('timelineMeasurementLimit', () => {
  test('excludes LED chain changes that the intended timeline does not follow', async () => {
    const timeline = intendedTimeline(await packWith('o 1 1\nd 100\nf 1 1\n', {
      '1 1 1 1': 'o 1 1 a 5\nc 2\nd 10\nf 1 1\n',
    }));
    assert.ok(timeline.ledChainEvents > 0);
    assert.match(timelineMeasurementLimit(timeline) ?? '', /chain changes/);
  });
  test('allows finite timelines without LED chain changes', async () => {
    const timeline = intendedTimeline(await packWith('o 1 1\nd 100\nf 1 1\n', {
      '1 1 1 1': 'o 1 1 a 5\nd 10\nf 1 1\n',
    }));
    assert.equal(timelineMeasurementLimit(timeline), undefined);
    assert.match(timelineMeasurementLimit({ ...timeline, unreleasedEndlessAnimations: 1 }) ?? '', /endless/);
    assert.match(timelineMeasurementLimit({ ...timeline, delaylessEndlessAnimations: 1 }) ?? '', /endless/);
  });
});
