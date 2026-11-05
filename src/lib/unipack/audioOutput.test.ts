import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { prepareAudioContext } from './audioOutput';
import { SoundEngine } from './SoundEngine';
import { parseWithLeds } from './testUtils';

const later = (ms = 0) => new Promise<void>(done => setTimeout(done, ms));

/**
 * Safari on iPhone and iPad: a context starts only inside a tap, and until then its resume stays
 * pending. Once started in a tap it resumes without one, a little later as the device starts.
 */
function installWebKitContext(t: TestContext, options: { lateStateChange?: boolean } = {}) {
  const made: WebKitContext[] = [];
  const page = { tapping: false };
  class WebKitContext {
    state: AudioContextState = 'suspended';
    started = false;
    suspending = false;
    destination = {};
    onstatechange: (() => void) | null = null;
    constructor() { made.push(this); }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async resume() {
      if (!this.started && !page.tapping) return new Promise<void>(() => {});
      if (this.started) await later(5);
      this.started = true;
      this.state = 'running';
      this.onstatechange?.();
    }
    async suspend() {
      this.suspending = true;
      await later(1);
      this.suspending = false;
      this.state = 'suspended';
      // The state change event is a task of its own, delivered after the promise's reactions.
      if (options.lateStateChange) setTimeout(() => this.onstatechange?.(), 0);
      else this.onstatechange?.();
    }
    close() { this.state = 'closed'; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: WebKitContext });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });
  const tap = (action: () => void) => { page.tapping = true; action(); page.tapping = false; };
  return { made, tap };
}

test('a pack opened by a tap plays from its first press although its sounds were set up after the tap', async t => {
  const { made, tap } = installWebKitContext(t);
  tap(prepareAudioContext);
  await later(10);
  assert.equal(made.length, 1);
  assert.equal(made[0].state, 'suspended', 'the started context waits suspended while the file is read');

  const engine = new SoundEngine(await parseWithLeds({}), () => 0, () => {});
  t.after(() => engine.destroy());
  await later(20);
  assert.equal(made.length, 1, 'the pack plays through the context the tap started');
  assert.equal(engine.context.state, 'running', 'running before the first press, without another tap');
});

test('a pack taking the context while it is being parked does not report an interruption', async t => {
  const { made, tap } = installWebKitContext(t, { lateStateChange: true });
  const pack = await parseWithLeds({});
  tap(prepareAudioContext);
  while (!made[0].suspending) await Promise.resolve();
  assert.equal(made[0].state, 'running', 'parking has started but not finished');

  const engine = new SoundEngine(pack, () => 0, () => {});
  t.after(() => engine.destroy());
  let interruptions = 0;
  engine.onInterrupted = () => { interruptions++; };
  await later(20);
  assert.equal(interruptions, 0, 'the parking suspension is ours, not an interruption');
  assert.equal(engine.context.state, 'running');
});
