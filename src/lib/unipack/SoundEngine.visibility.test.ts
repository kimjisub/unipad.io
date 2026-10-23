import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SoundEngine } from './SoundEngine';
import { parseWithLeds } from './testUtils';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('hidden output stays muted through pending suspension, volume changes and resumption', async t => {
  const suspension = deferred();
  const resumption = deferred();
  const gain = { value: 1 };
  class Context {
    state = 'running'; destination = {};
    createGain() { return { gain, connect() {} }; }
    async suspend() { await suspension.promise; this.state = 'suspended'; }
    async resume() { await resumption.promise; this.state = 'running'; }
    close() { this.state = 'closed'; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });
  const engine = new SoundEngine(await parseWithLeds({}), () => 0, () => {});
  t.after(() => engine.destroy());
  engine.setVolume(3);
  const hidden = engine.setSuspended(true);
  assert.equal(gain.value, 0, 'mute before the native suspend promise completes');
  assert.equal(engine.context.state, 'running');
  engine.setVolume(5);
  assert.equal(engine.getVolume(), 5, 'keep the chosen volume separately from visibility muting');
  assert.equal(gain.value, 0, 'a hidden volume change must not unmute output');
  suspension.resolve(); await hidden;
  const visible = engine.setSuspended(false);
  assert.equal(gain.value, 0, 'keep output muted until native resumption finishes');
  engine.setVolume(2);
  assert.equal(gain.value, 0, 'a volume change during resumption must stay muted');
  resumption.resolve(); await visible;
  assert.equal(gain.value, 2 / 7);
});

test('a stale resume cannot unmute a tab that was hidden again', async t => {
  const pending = deferred();
  const gain = { value: 1 };
  class Context {
    state = 'running'; destination = {};
    createGain() { return { gain, connect() {} }; }
    async suspend() { this.state = 'suspended'; }
    async resume() { await pending.promise; this.state = 'running'; }
    close() { this.state = 'closed'; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });
  const engine = new SoundEngine(await parseWithLeds({}), () => 0, () => {});
  t.after(() => engine.destroy());
  engine.setVolume(4);
  await engine.setSuspended(true);
  const resume = engine.setSuspended(false);
  await engine.setSuspended(true);
  pending.resolve(); await resume;
  assert.equal(gain.value, 0);
  assert.equal(engine.getVolume(), 4);
});
