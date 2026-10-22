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
