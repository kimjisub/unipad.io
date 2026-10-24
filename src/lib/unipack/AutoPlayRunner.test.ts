import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { AutoPlayRunner } from './AutoPlayRunner';
import { parseUniPack } from './parser';
import { NO_WORMHOLE, UniPackData } from './types';
import { INFO_2X2_2CHAIN, ManualClock, SILENT_WAV, packZip } from './testUtils';

type Mode = 'autoPlay' | 'guidePlay' | 'stepPractice';

/**
 * Runs a pack's autoPlay in one of the play screen's modes with a player who presses every guided
 * pad and every guided chain button the pack has. Chain changes are clamped like the engine's
 * setChain, and a pressed pad's wormhole moves the chain 100 ms later like SoundEngine.soundOn.
 */
function play(pack: UniPackData, mode: Mode, clock: ManualClock, maxTicks = 2000) {
  let chain = 0;
  let ended = false;
  const guidedChains: number[] = [];
  const pending: (() => void)[] = [];
  const later: { at: number; run: () => void }[] = [];
  const setChain = (c: number) => { chain = Math.max(0, Math.min(c, pack.info.chain - 1)); };
  const touch = (x: number, y: number) => {
    const sound = pack.soundTable[chain]?.[x]?.[y]?.[0];
    if (sound && sound.wormhole !== NO_WORMHOLE) later.push({ at: clock.now + 100, run: () => setChain(sound.wormhole) });
  };

  const runner = new AutoPlayRunner(pack, {
    onStart: () => {},
    onPadTouchOn: touch,
    onPadTouchOff: () => {},
    onChainChange: setChain,
    onGuidePadOn: (x, y) => pending.push(() => {
      if (mode === 'stepPractice') runner.stepPadPressed(x, y);
      touch(x, y);
    }),
    onGuidePadOff: () => {},
    onGuideLedUpdate: () => {},
    onGuideChainOn: (c) => {
      guidedChains.push(c);
      if (c >= 0 && c < pack.info.chain) pending.push(() => setChain(c));
    },
    onRemoveGuide: () => {},
    onProgressUpdate: () => {},
    onEnd: () => { ended = true; },
  }, () => chain, setChain, () => {}, () => {});

  runner.practiceGuide = mode !== 'autoPlay';
  runner.stepMode = mode === 'stepPractice';
  runner.playmode = mode !== 'stepPractice';
  runner.launch();
  for (let i = 0; i < maxTicks && !ended; i++) {
    clock.tick(5);
    for (const action of pending.splice(0)) action();
    for (const due of later.filter((l) => l.at <= clock.now)) {
      later.splice(later.indexOf(due), 1);
      due.run();
    }
  }
  return { ended, chain, guidedChains };
}

describe('AutoPlayRunner', () => {
  let clock: ManualClock;

  beforeEach(() => {
    clock = new ManualClock();
    clock.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('resuming a timed guide redraws it after clearing the paused screen', async () => {
    const pack = await parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav', 'sounds/a.wav': SILENT_WAV, autoPlay: 'd 1000\no 1 1\nf 1 1\nd 10000',
    }));
    const screen = new Map<string, number>();
    const leds = new Map<string, number>();
    const runner = new AutoPlayRunner(pack, {
      onStart() {}, onEnd() {}, onProgressUpdate() {}, onChainChange() {}, onPadTouchOn() {}, onPadTouchOff() {}, onGuideChainOn() {},
      onGuidePadOn: (x, y, at) => { screen.set(`${x},${y}`, at); },
      onGuidePadOff: (x, y) => { screen.delete(`${x},${y}`); },
      onGuideLedUpdate: (x, y, velocity) => { leds.set(`${x},${y}`, velocity); },
      onRemoveGuide: () => { screen.clear(); },
    }, () => 0, () => {}, () => {}, () => {});
    runner.practiceGuide = true;
    runner.launch();
    clock.tick(1); clock.tick(200);
    assert.equal(screen.get('0,0'), 2001);
    runner.pause();
    screen.clear();
    clock.tick(2000);
    runner.play();
    clock.tick(1);
    assert.equal(screen.get('0,0'), 4001, 'screen and hardware retain the same shifted deadline');
    assert.ok(leds.get('0,0')! > 0);
    clock.tick(798);
    assert.equal(screen.get('0,0'), 4001);
    clock.tick(1);
    assert.equal(screen.has('0,0'), false);
    assert.equal(leds.get('0,0'), 0);
    runner.stop();
  });

  test('step resume distinguishes consumed pads from chain-only scans and rewound groups', async () => {
    const pack = await parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav', 'sounds/a.wav': SILENT_WAV,
      autoPlay: 'd 1000\no 1 1\nf 1 1\nd 1000\nc 2\no 1 2\nf 1 2\nd 1000\nc 1\no 2 1\nd 10000',
    }));
    let chain = 0;
    const runner = new AutoPlayRunner(pack, {
      onStart() {}, onEnd() {}, onProgressUpdate() {}, onChainChange() {}, onPadTouchOn() {}, onPadTouchOff() {},
      onGuidePadOn() {}, onGuidePadOff() {}, onGuideLedUpdate() {}, onRemoveGuide() {}, onGuideChainOn() {},
    }, () => chain, () => {}, () => {}, () => {});
    runner.practiceGuide = true;
    runner.launch();
    clock.tick(1); clock.tick(1000); clock.tick(100);
    runner.pause();
    const pausedProgress = runner.progress;
    runner.stepMode = true;
    clock.tick(200);
    assert.equal(runner.hasScannedStepPads, false, 'a chain prompt has not consumed any pad');
    assert.equal(runner.leaveStepPractice(), false);
    assert.equal(runner.progress, pausedProgress, 'chain-only lines must be restored for timed playback');
    runner.stepMode = true;
    clock.tick(1);
    chain = 1;
    clock.tick(1);
    assert.equal(runner.hasScannedStepPads, true);
    chain = 0;
    clock.tick(1);
    assert.equal(runner.hasScannedStepPads, false, 'rewinding the only pad group leaves no consumed pads');
    chain = 1;
    clock.tick(1);
    runner.stepPadPressed(0, 1);
    clock.tick(1);
    assert.equal(runner.hasScannedStepPads, true, 'a completed group still counts while awaiting the next chain');
    const scannedProgress = runner.progress;
    assert.equal(runner.leaveStepPractice(), true);
    assert.equal(runner.progress, scannedProgress - 2, 'keep consumed pads, but restore the delay and chain-only scan before the next pad');
    assert.equal(runner.hasScannedStepPads, false);
    runner.stop();
  });

  test('resync ignores earlier notes even when they share the resumed song time', async () => {
    const pack = await parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav', 'sounds/a.wav': SILENT_WAV,
      autoPlay: 'o 1 1\nc 2\no 1 2\nd 1000\no 2 1\nd 10000',
    }));
    const chains: number[] = [];
    const runner = new AutoPlayRunner(pack, {
      onStart() {}, onEnd() {}, onProgressUpdate() {}, onChainChange() {}, onPadTouchOn() {}, onPadTouchOff() {},
      onGuidePadOn() {}, onGuidePadOff() {}, onGuideLedUpdate() {}, onRemoveGuide() {},
      onGuideChainOn: c => { chains.push(c); },
    }, () => 1, () => {}, () => {}, () => {});
    runner.practiceGuide = true;
    runner.launch();
    runner.progressOffset(2);
    clock.tick(1);
    assert.deepEqual(chains, [], 'a consumed note must not ask to return to its old chain');
    assert.ok(runner.progress > 2, 'the note at the resumed position must advance');
    runner.stop();
  });

  test('late ticks report the scheduled press and release times', async () => {
    const pack = await parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav', 'sounds/a.wav': SILENT_WAV,
      autoPlay: 'o 1 1\nf 1 1\nd 10\no 1 1\nd 10\nf 1 1\nd 100',
    }));
    const events: [string, number][] = [];
    const runner = new AutoPlayRunner(pack, {
      onStart() {}, onEnd() {}, onProgressUpdate() {}, onChainChange() {},
      onPadTouchOn: (_x, _y, at) => { events.push(['on', at]); },
      onPadTouchOff: (_x, _y, at) => { events.push(['off', at]); },
      onGuidePadOn() {}, onGuidePadOff() {}, onGuideLedUpdate() {}, onGuideChainOn() {}, onRemoveGuide() {},
    }, () => 0, () => {}, () => {}, () => {});
    runner.launch();
    clock.tick(0);
    clock.tick(25);
    assert.deepEqual(events, [['on', 1000], ['off', 1000], ['on', 1010], ['off', 1020]]);
    runner.stop();
  });

  // Starting autoplay re-renders the play screen before the first timer runs, so the first note can
  // play hundreds of milliseconds after the start was requested.
  const twoNotes = async () => parseUniPack(await packZip({
    info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav\n1 1 2 a.wav', 'sounds/a.wav': SILENT_WAV,
    autoPlay: 'o 1 1\nf 1 1\nd 1500\no 1 2\nf 1 2\nd 100',
  }));
  const noteTimes = (pack: UniPackData) => {
    const presses: { playedAt: number; pressedAt: number }[] = [];
    const runner = new AutoPlayRunner(pack, {
      onStart() {}, onEnd() {}, onProgressUpdate() {}, onChainChange() {}, onPadTouchOff() {},
      onPadTouchOn: (_x, _y, pressedAt) => { presses.push({ playedAt: clock.now, pressedAt }); },
      onGuidePadOn() {}, onGuidePadOff() {}, onGuideLedUpdate() {}, onGuideChainOn() {}, onRemoveGuide() {},
    }, () => 0, () => {}, () => {}, () => {});
    return { runner, presses };
  };

  test('the song clock starts when the first note plays, not when a late first tick was requested', async () => {
    const { runner, presses } = noteTimes(await twoNotes());
    runner.launch();
    clock.tick(300);
    while (presses.length < 2 && clock.scheduled) clock.tick(1);

    assert.deepEqual(presses, [{ playedAt: 1300, pressedAt: 1300 }, { playedAt: 2800, pressedAt: 2800 }]);
    runner.stop();
  });

  test('a seek before the first tick keeps its song position when the clock starts', async () => {
    const { runner, presses } = noteTimes(await twoNotes());
    runner.launch();
    runner.progressOffset(3);
    clock.tick(300);

    assert.deepEqual(presses, [{ playedAt: 1300, pressedAt: 1300 }]);
    runner.stop();
  });

  test('a launch while hidden starts the song clock on the first visible tick', async () => {
    const { runner, presses } = noteTimes(await twoNotes());
    runner.setSuspended(true);
    runner.launch();
    clock.tick(2000);
    runner.setSuspended(false);
    clock.tick(300);
    while (presses.length < 2 && clock.scheduled) clock.tick(1);

    assert.deepEqual(presses, [{ playedAt: 3300, pressedAt: 3300 }, { playedAt: 4800, pressedAt: 4800 }]);
    runner.stop();
  });

  test('resuming from a pause starts the song clock when the next note plays', async () => {
    const { runner, presses } = noteTimes(await twoNotes());
    runner.launch();
    runner.pause();
    clock.tick(1);
    clock.tick(10);
    runner.play();
    clock.tick(300);
    while (presses.length < 2 && clock.scheduled) clock.tick(1);

    assert.deepEqual(presses, [{ playedAt: 1311, pressedAt: 1311 }, { playedAt: 2811, pressedAt: 2811 }]);
    runner.stop();
  });

  test('a short pause during a wait preserves the remaining delay', async () => {
    const { runner, presses } = noteTimes(await twoNotes());
    runner.launch();
    clock.tick(1);
    clock.tick(499);
    runner.pause();
    clock.tick(100);
    runner.play();
    clock.tick(300);
    while (presses.length < 2 && clock.scheduled) clock.tick(1);

    assert.deepEqual(presses, [{ playedAt: 1001, pressedAt: 1001 }, { playedAt: 2601, pressedAt: 2601 }]);
    runner.stop();
  });

  test('hiding while paused excludes hidden time exactly once when playback resumes', async () => {
    const { runner, presses } = noteTimes(await twoNotes());
    runner.launch();
    clock.tick(1);
    clock.tick(499);
    runner.pause();
    clock.tick(100);
    runner.setSuspended(true);
    clock.tick(5000);
    runner.setSuspended(false);
    clock.tick(100);
    runner.play();
    clock.tick(300);
    while (presses.length < 2 && clock.scheduled) clock.tick(1);

    assert.deepEqual(presses, [{ playedAt: 1001, pressedAt: 1001 }, { playedAt: 7701, pressedAt: 7701 }]);
    runner.stop();
  });

  // The line after a note is often a release or the first of several waits, due well before the next
  // note; resuming before that line must not hold the song back as if the next note were due.
  const pausedPlay = async (autoPlay: string, pauses: { atNote: number; afterMs: number; forMs: number }[]) => {
    const pack = await parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav\n1 1 2 a.wav\n1 2 1 a.wav', 'sounds/a.wav': SILENT_WAV, autoPlay,
    }));
    const { runner, presses } = noteTimes(pack);
    runner.launch();
    clock.tick(1);
    for (const { atNote, afterMs, forMs } of pauses) {
      while (presses.length < atNote && clock.scheduled) clock.tick(1);
      clock.tick(afterMs);
      runner.pause();
      clock.tick(forMs);
      runner.play();
      clock.tick(300);
    }
    while (presses.length < 3 && clock.scheduled) clock.tick(1);
    runner.stop();
    return presses.map((p) => p.playedAt);
  };
  const releasedNotes = 'o 1 1\nd 100\nf 1 1\nd 1400\no 1 2\nd 100\nf 1 2\nd 1400\no 2 1\nd 100';

  test('a short pause before a release keeps the next note at its written time', async () => {
    assert.deepEqual(await pausedPlay(releasedNotes, [{ atNote: 1, afterMs: 49, forMs: 30 }]), [1001, 2531, 4031]);
  });

  test('a pause right after a later note keeps the note after it at its written time', async () => {
    assert.deepEqual(await pausedPlay(releasedNotes, [{ atNote: 2, afterMs: 0, forMs: 100 }]), [1001, 2501, 4101]);
  });

  test('a short pause in the first of two waits keeps the next note at its written time', async () => {
    const splitWait = 'o 1 1\nd 500\nd 1000\no 1 2\nd 1500\no 2 1\nd 100';
    assert.deepEqual(await pausedPlay(splitWait, [{ atNote: 1, afterMs: 399, forMs: 30 }]), [1001, 2531, 4031]);
  });

  test('a guide shown before a pause keeps its remaining lead when a late tick resumes the song', async () => {
    const pack = await parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav\n1 1 2 a.wav\n1 2 1 a.wav', 'sounds/a.wav': SILENT_WAV,
      autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 300\no 2 1\nf 2 1\nd 100',
    }));
    const guideOff: [number, number, number][] = [];
    const runner = new AutoPlayRunner(pack, {
      onStart() {}, onEnd() {}, onProgressUpdate() {}, onChainChange() {}, onPadTouchOn() {}, onPadTouchOff() {},
      onGuidePadOn() {}, onGuideLedUpdate() {}, onGuideChainOn() {}, onRemoveGuide() {},
      onGuidePadOff: (x, y) => { guideOff.push([x, y, clock.now]); },
    }, () => 0, () => {}, () => {}, () => {});
    runner.practiceGuide = true;
    runner.launch();
    for (let i = 0; i < 901; i++) clock.tick(1);
    runner.pause();
    clock.tick(200);
    runner.play();
    clock.tick(300);
    while (guideOff.length < 3 && clock.scheduled) clock.tick(1);

    // Pausing freezes song time at 900. The late resume tick reaches the second note after its
    // remaining 100 ms, then keeps the written 300 ms gap to the third note.
    assert.deepEqual(guideOff, [[0, 0, 1001], [0, 1, 2401], [1, 0, 2701]]);
    runner.stop();
  });

  test('a seek while playing starts the song clock when the note it seeks to plays', async () => {
    const { runner, presses } = noteTimes(await twoNotes());
    runner.launch();
    clock.tick(1);
    runner.progressOffset(-3);
    clock.tick(300);
    while (presses.length < 3 && clock.scheduled) clock.tick(1);

    assert.deepEqual(presses, [
      { playedAt: 1001, pressedAt: 1001 },
      { playedAt: 1301, pressedAt: 1301 },
      { playedAt: 2801, pressedAt: 2801 },
    ]);
    runner.stop();
  });

  // The second chain is reached only through the wormhole of pad (1, 1) on the first.
  const wormholePack = async (wormhole: string) => parseUniPack(await packZip({
    info: INFO_2X2_2CHAIN,
    keySound: `1 1 1 a.wav 1 ${wormhole}\n2 1 1 a.wav`,
    'sounds/a.wav': SILENT_WAV,
    autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 1\nf 1 1',
  }));

  for (const wormhole of ['2', '3', '40']) {
    for (const mode of ['autoPlay', 'guidePlay', 'stepPractice'] as const) {
      test(`${mode} plays to the end through a wormhole of ${wormhole} on a two-chain pack`, async () => {
        const result = play(await wormholePack(wormhole), mode, clock);

        assert.equal(result.ended, true, `still waiting; guided chains ${JSON.stringify(result.guidedChains)}`);
        assert.equal(result.chain, 1);
        assert.ok(result.guidedChains.every((c) => c === 1), JSON.stringify(result.guidedChains));
      });
    }
  }
});
