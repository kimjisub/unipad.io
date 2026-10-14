import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { AutoPlayRunner } from './AutoPlayRunner';
import { parseUniPack } from './parser';
import { PlayerHolds } from './PlayerHolds';
import { AUTO_PLAY_INPUT, SoundEngine } from './SoundEngine';
import { INFO_2X2_2CHAIN, ManualClock, SILENT_WAV, packZip } from './testUtils';

interface Source { pad: string; stopped: boolean; scheduledEnd: boolean }

/**
 * Web Audio as far as SoundEngine uses it; each source records the pad named by `startingPad` and
 * whether it was stopped at once or only given an end time.
 */
function installAudio(sources: Source[]): { startingPad: (x: number, y: number) => void; restore: () => void } {
  let pad = '';
  class Context {
    state = 'running';
    destination = {};
    currentTime = 0;
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async decodeAudioData() { return { duration: 0.1 }; }
    createBufferSource() {
      const source: Source = { pad, stopped: false, scheduledEnd: false };
      sources.push(source);
      return {
        buffer: null, loop: false, onended: null, connect() {}, start() {},
        stop(when?: number) { if (when === undefined) source.stopped = true; else source.scheduledEnd = true; },
      };
    }
    close() {}
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  return {
    startingPad: (x, y) => { pad = `${x},${y}`; },
    restore: () => {
      if (original) Object.defineProperty(globalThis, 'AudioContext', original);
      else Reflect.deleteProperty(globalThis, 'AudioContext');
    },
  };
}

describe('PlayerHolds', () => {
  let clock: ManualClock;
  let sources: Source[];
  let audio: ReturnType<typeof installAudio>;

  beforeEach(() => {
    clock = new ManualClock();
    clock.install();
    sources = [];
    audio = installAudio(sources);
  });

  afterEach(() => {
    audio.restore();
    clock.uninstall();
  });

  /**
   * A 2 x 2 pack: pad 0,0 loops endlessly, 1,0 repeats three times and 1,1 plays once, all pressed by
   * autoPlay and held for a second; 0,1 loops endlessly for the player. The pads are wired as the play
   * screen wires them, and turning autoPlay off releases every pad the player is not holding.
   */
  async function playScreen() {
    const pack = await parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN,
      keySound: '1 1 1 a.wav 0\n1 1 2 a.wav 0\n1 2 1 a.wav 4\n1 2 2 a.wav\n',
      autoPlay: 'o 1 1\no 2 1\no 2 2\nd 1000\nf 1 1\nf 2 1\nf 2 2\n',
      'sounds/a.wav': SILENT_WAV,
    }));
    const engine = new SoundEngine(pack, () => 0, () => {});
    await engine.load();
    const holds = new PlayerHolds();
    const soundOn = (x: number, y: number, input: string) => { audio.startingPad(x, y); engine.soundOn(x, y, input); };
    const runner = new AutoPlayRunner(pack, {
      onStart() {}, onEnd() {}, onProgressUpdate() {}, onChainChange() {},
      onPadTouchOn: (x, y) => { holds.autoPlayPressed(x, y); soundOn(x, y, AUTO_PLAY_INPUT); },
      onPadTouchOff: (x, y) => engine.soundOff(x, y, AUTO_PLAY_INPUT),
      onGuidePadOn() {}, onGuidePadOff() {}, onGuideLedUpdate() {}, onGuideChainOn() {}, onRemoveGuide() {},
    }, () => 0, () => {}, () => {}, () => {});
    return {
      playerPress: (x: number, y: number) => { holds.press(x, y); soundOn(x, y, 'player'); },
      playerRelease: (x: number, y: number) => { engine.soundOff(x, y, holds.release(x, y) ? undefined : 'player'); },
      startAutoPlay: () => { runner.launch(); clock.tick(1); },
      turnAutoPlayOff: () => { runner.stop(); holds.releaseOthers(2, 2, (x, y) => engine.soundOff(x, y)); },
    };
  }
  const state = (pad: string) => sources.filter((s) => s.pad === pad).map((s) => (s.stopped ? 'stopped' : s.scheduledEnd ? 'ends by itself' : 'sounding'));

  test('turning autoPlay off stops the endless loop it held and keeps the player\'s, the repeat and the one-shot', async () => {
    const screen = await playScreen();
    screen.playerPress(0, 1);
    screen.startAutoPlay();
    assert.deepEqual([state('0,0'), state('0,1'), state('1,0'), state('1,1')], [['sounding'], ['sounding'], ['ends by itself'], ['sounding']]);

    screen.turnAutoPlayOff();
    assert.deepEqual([state('0,0'), state('0,1'), state('1,0'), state('1,1')], [['stopped'], ['sounding'], ['ends by itself'], ['sounding']]);

    screen.playerRelease(0, 1);
    assert.deepEqual(state('0,1'), ['stopped']);
  });

  test('a pad the player also holds keeps sounding when autoPlay is turned off', async () => {
    const screen = await playScreen();
    screen.playerPress(0, 0);
    screen.startAutoPlay();
    // autoPlay's press restarts the pad's loop; the player still holds the pad.
    assert.deepEqual(state('0,0'), ['stopped', 'sounding']);

    screen.turnAutoPlayOff();
    assert.deepEqual(state('0,0'), ['stopped', 'sounding']);

    screen.playerRelease(0, 0);
    assert.deepEqual(state('0,0'), ['stopped', 'stopped']);
  });

  test('a pad stays held until every input holding it lets go', () => {
    const holds = new PlayerHolds();
    holds.press(1, 1);
    holds.press(1, 1);
    holds.release(1, 1);
    assert.equal(holds.isHeld(1, 1), true);
    holds.release(1, 1);
    assert.equal(holds.isHeld(1, 1), false);
    // A release with nothing held (an input that was cleared) leaves no debt for the next press.
    holds.release(1, 1);
    holds.press(1, 1);
    holds.release(1, 1);
    assert.equal(holds.isHeld(1, 1), false);
  });

  test('the last release of a held pad autoPlay stopped over releases autoPlay\'s press too', () => {
    const holds = new PlayerHolds();
    holds.press(0, 0);
    holds.press(0, 0);
    holds.press(0, 1);
    holds.releaseOthers(2, 2, () => {});
    assert.equal(holds.release(0, 0), false);
    assert.equal(holds.release(0, 0), true);
    // autoPlay pressing the pad again takes its press back from the player's release.
    holds.autoPlayPressed(0, 1);
    assert.equal(holds.release(0, 1), false);
    // A pad held only after autoPlay stopped is the player's alone.
    holds.press(1, 1);
    assert.equal(holds.release(1, 1), false);
  });

  test('releaseOthers visits every pad of the grid except the held ones', () => {
    const holds = new PlayerHolds();
    holds.press(0, 1);
    const released: string[] = [];
    holds.releaseOthers(2, 2, (x, y) => released.push(`${x},${y}`));
    assert.deepEqual(released, ['0,0', '1,0', '1,1']);
    holds.clear();
    released.length = 0;
    holds.releaseOthers(2, 2, (x, y) => released.push(`${x},${y}`));
    assert.deepEqual(released, ['0,0', '0,1', '1,0', '1,1']);
  });
});
