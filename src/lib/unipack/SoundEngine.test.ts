import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, mock, test, type TestContext } from 'node:test';
import { parseUniPack } from './parser';
import { SoundEngine } from './SoundEngine';
import { INFO_2X2_2CHAIN, SILENT_WAV, packZip } from './testUtils';

const corpus = 'meta/unipack-conformance/chain-release-v1';
interface Start { playbackId: string; inputId: string; chain: number; pad: number[]; file: string; plays: string | number }
interface Step {
  atMs: number;
  input: { kind: string; inputId?: string; pad?: number[]; chain?: number };
  expected: { chain: number; starts: Start[]; releaseStops: string[]; naturalEnds: string[]; active: string[]; pressedInputs: string[] };
}
const cases: { id: string; pack: string; steps: Step[] }[] = JSON.parse(readFileSync(`${corpus}/expectations.json`, 'utf8')).cases;

function stubGlobal(t: TestContext, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
}

class Source {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  endAt = Infinity;
  active = false;
  constructor(private clock: () => number, private stops: Source[]) {}
  connect() {}
  start() { this.active = true; if (!this.loop) this.endAt = this.clock() + 100; }
  stop(at?: number) {
    if (at !== undefined) { this.endAt = Math.round(at * 1_000_000) / 1000; return; }
    this.stops.push(this);
    this.active = false;
    this.onended?.();
  }
}

for (const scenario of cases) {
  test(`${scenario.id}: shared chain-release-v1 playback expectations`, async t => {
    let now = 0;
    let chain = 0;
    const nodes: Source[] = [];
    const stops: Source[] = [];
    const timers: { at: number; callback: () => void }[] = [];
    t.mock.method(globalThis, 'setTimeout', ((callback: () => void, delay: number) => {
      timers.push({ at: now + delay, callback });
      return 1;
    }) as unknown as typeof setTimeout);
    class Context {
      state = 'running';
      destination = {};
      get currentTime() { return now / 1000; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      async decodeAudioData() { return { duration: 0.1 }; }
      createBufferSource() { const node = new Source(() => now, stops); nodes.push(node); return node; }
      close() {}
    }
    stubGlobal(t, 'AudioContext', Context);
    const bytes = readFileSync(`${corpus}/packs/${scenario.pack}.uni`);
    const pack = await parseUniPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.deepEqual(pack.errors, []);
    const engine = new SoundEngine(pack, () => chain, c => { chain = c; });
    await engine.load();
    // Input lifetime filtering matches PadGrid: cancellation removes a pointer, so an old
    // pointerup/lostpointercapture cannot release a later pointer at the same coordinate.
    const inputs = new Map<string, { pad: number[]; held: boolean }>();
    const labels = new Map<Source, string>();
    let observedNodes = 0;
    let observedStops = 0;
    try {
      for (const step of scenario.steps) {
        now = step.atMs;
        for (const timer of timers.filter(timer => timer.at <= now)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.callback();
        }
        const naturalEnds: string[] = [];
        for (const node of nodes) {
          if (node.active && node.endAt <= now) {
            node.active = false;
            node.onended?.();
            naturalEnds.push(labels.get(node)!);
          }
        }
        const input = step.input;
        if (input.kind === 'press') {
          inputs.set(input.inputId!, { pad: input.pad!, held: true });
          engine.soundOn(input.pad![0] - 1, input.pad![1] - 1);
        } else if (input.kind === 'chain-button') {
          chain = input.chain! - 1;
          for (let x = 0; x < pack.info.buttonX; x++) for (let y = 0; y < pack.info.buttonY; y++) engine.soundPushToNum(chain, x, y, 0);
        } else if (input.kind === 'release' || input.kind === 'cancel') {
          const press = inputs.get(input.inputId!)!;
          if (press.held) { press.held = false; engine.soundOff(press.pad[0] - 1, press.pad[1] - 1); }
        }
        const started = nodes.slice(observedNodes);
        assert.equal(started.length, step.expected.starts.length, `${scenario.id} ${now}ms starts`);
        started.forEach((node, i) => {
          const expected = step.expected.starts[i];
          labels.set(node, expected.playbackId);
          assert.equal(chain + 1, expected.chain);
          const sounds = pack.soundTable[expected.chain - 1][expected.pad[0] - 1][expected.pad[1] - 1]!;
          assert.equal(node.buffer, sounds.find(sound => sound.file === expected.file)!.audioBuffer);
          assert.equal(node.loop, expected.plays !== 1);
          assert.equal(node.endAt, expected.plays === 'infinite' ? Infinity : now + Number(expected.plays) * 100);
        });
        observedNodes = nodes.length;
        const actual = {
          chain: chain + 1,
          releaseStops: stops.slice(observedStops).map(node => labels.get(node)),
          naturalEnds,
          active: nodes.filter(node => node.active).map(node => labels.get(node)),
          pressedInputs: [...inputs].filter(([, press]) => press.held).map(([id]) => id),
        };
        const expected = step.expected;
        assert.deepEqual(actual, { chain: expected.chain, releaseStops: expected.releaseStops, naturalEnds: expected.naturalEnds, active: expected.active, pressedInputs: expected.pressedInputs }, `${scenario.id} ${now}ms ${input.kind}`);
        observedStops = stops.length;
      }
      if (scenario.id === 'CR-006') {
        await t.test('late onended and duplicate release preserve the newer source', () => {
          engine.soundOn(0, 0);
          const older = nodes.at(-1)!;
          engine.soundOn(0, 0);
          const newer = nodes.at(-1)!;
          older.onended?.();
          assert.equal(newer.active, true);
          engine.soundOff(0, 0);
          assert.equal(newer.active, false);
          assert.equal(stops.at(-1), newer);
          const count = stops.length;
          engine.soundOff(0, 0);
          assert.equal(stops.length, count);
        });
      }
    } finally { engine.destroy(); }
  });
}

describe('SoundEngine', () => {
  /** A well-formed file the fake decoder refuses, as a browser refuses a codec it lacks. */
  const UNDECODABLE = Uint8Array.from([...SILENT_WAV.subarray(0, 44), 0x42, 0x41]);

  /** A pack whose sounds decode as the fake context says, with every source it starts. */
  async function engineFor(t: TestContext, keySound: string) {
    let chain = 0;
    const sources: Source[] = [];
    const stops: Source[] = [];
    const timers: (() => void)[] = [];
    mock.method(globalThis, 'setTimeout', ((callback: () => void) => { timers.push(callback); return 1; }) as unknown as typeof setTimeout);
    class Context {
      state = 'running';
      destination = {};
      currentTime = 0;
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      async decodeAudioData(data: ArrayBuffer) {
        if (new Uint8Array(data).at(-1) === UNDECODABLE.at(-1)) throw new Error('EncodingError');
        return { duration: 0.1 };
      }
      createBufferSource() { const node = new Source(() => 0, stops); sources.push(node); return node; }
      close() {}
    }
    stubGlobal(t, 'AudioContext', Context);
    const pack = await parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN,
      keySound,
      'sounds/a.wav': SILENT_WAV,
      'sounds/b.wav': SILENT_WAV,
      'sounds/bad.wav': UNDECODABLE,
    }));
    assert.deepEqual(pack.errors, []);
    const engine = new SoundEngine(pack, () => chain, (c) => { chain = c; });
    const failed = await engine.load();
    return {
      engine, sources, stops, failed,
      get chain() { return chain; },
      set chain(c: number) { chain = c; },
      runTimers() { timers.splice(0).forEach((callback) => callback()); },
      played: () => sources.map((s) => pack.soundTable.flat(2).flat().find((sound) => sound?.audioBuffer === s.buffer)?.file),
    };
  }

  afterEach(() => mock.restoreAll());

  test('a sound that cannot be decoded is silent and the pad moves on to its next sound', async t => {
    const sound = await engineFor(t, '1 1 1 bad.wav\n1 1 1 a.wav');
    assert.deepEqual(sound.failed.failures.map(({ file, reason }) => [file, reason]), [['sounds/bad.wav', 'decode']]);
    sound.engine.soundOn(0, 0);
    assert.deepEqual(sound.played(), []);
    sound.engine.soundOn(0, 0);
    assert.deepEqual(sound.played(), ['sounds/a.wav']);
    sound.engine.soundOn(0, 0);
    assert.equal(sound.sources.length, 1, 'the third press is the silent first sound again');
  });

  test('a sound that cannot be decoded still follows its wormhole', async t => {
    const sound = await engineFor(t, '1 1 1 bad.wav 1 2\n2 1 1 b.wav');
    sound.engine.soundOn(0, 0);
    sound.runTimers();
    assert.equal(sound.chain, 1);
    sound.engine.soundOn(0, 0);
    assert.deepEqual(sound.played(), ['sounds/b.wav']);
  });

  test('a release stops the endless sound its own press started when another input pressed the pad in another chain', async t => {
    const sound = await engineFor(t, '1 1 1 a.wav 0\n2 1 1 b.wav 0');
    sound.engine.soundOn(0, 0, 'pointer-1');
    const first = sound.sources[0];
    sound.chain = 1;
    sound.engine.soundOn(0, 0, 'pointer-2');
    const second = sound.sources[1];
    sound.engine.soundOff(0, 0, 'pointer-1');
    assert.deepEqual(sound.stops, [first]);
    assert.equal(second.active, true);
    sound.engine.soundOff(0, 0, 'pointer-2');
    assert.deepEqual(sound.stops, [first, second]);
  });

  test('a release without an input releases every press of the pad', async t => {
    const sound = await engineFor(t, '1 1 1 a.wav 0\n2 1 1 b.wav 0');
    sound.engine.soundOn(0, 0, 'pointer-1');
    sound.chain = 1;
    sound.engine.soundOn(0, 0, 'key-KeyA');
    sound.engine.soundOff(0, 0);
    assert.deepEqual(sound.stops, sound.sources);
  });
});

test('audio session', async t => {
  const bytes = readFileSync(`${corpus}/packs/${cases[0].pack}.uni`);
  const pack = await parseUniPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  let typeAtContextCreation: string | undefined;
  let contexts = 0;
  let session: { type: string } | undefined;
  class Context {
    state = 'running';
    destination = {};
    constructor() { typeAtContextCreation = session?.type; contexts++; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    close() {}
  }
  stubGlobal(t, 'AudioContext', Context);
  const create = () => new SoundEngine(pack, () => 0, () => {}).destroy();

  await t.test('is set to playback before the context exists, so the silent switch does not mute pads', st => {
    session = { type: 'auto' };
    stubGlobal(st, 'navigator', { audioSession: session });
    create();
    assert.equal(typeAtContextCreation, 'playback');
    assert.equal(session.type, 'playback');
  });

  await t.test('is left alone where the browser has no audio session', st => {
    session = undefined;
    const browser = {};
    stubGlobal(st, 'navigator', browser);
    assert.doesNotThrow(create);
    assert.deepEqual(browser, {});
  });

  await t.test('a refused type still creates the engine', st => {
    session = undefined;
    stubGlobal(st, 'navigator', { get audioSession() { return { set type(_: string) { throw new Error('refused'); } }; } });
    st.mock.method(console, 'warn', () => {});
    const before = contexts;
    assert.doesNotThrow(create);
    assert.equal(contexts, before + 1);
  });
});
