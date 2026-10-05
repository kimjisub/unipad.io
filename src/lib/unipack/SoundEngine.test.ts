import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseUniPack } from './parser';
import { SoundEngine } from './SoundEngine';

const corpus = 'meta/unipack-conformance/chain-release-v1';
interface Start { playbackId: string; inputId: string; chain: number; pad: number[]; file: string; plays: string | number }
interface Step {
  atMs: number;
  input: { kind: string; inputId?: string; pad?: number[]; chain?: number };
  expected: { chain: number; starts: Start[]; releaseStops: string[]; naturalEnds: string[]; active: string[]; pressedInputs: string[] };
}
const cases: { id: string; pack: string; steps: Step[] }[] = JSON.parse(readFileSync(`${corpus}/expectations.json`, 'utf8')).cases;

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
    const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
    t.after(() => {
      if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext);
      else Reflect.deleteProperty(globalThis, 'AudioContext');
    });
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
