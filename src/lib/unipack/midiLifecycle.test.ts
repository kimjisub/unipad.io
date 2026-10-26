import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MidiConnection } from './MidiConnection';

test('releasing a pending connection prevents its late permission result from reattaching', async t => {
  let allow!: (access: MIDIAccess) => void;
  const permission = new Promise<MIDIAccess>(resolve => { allow = resolve; });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: () => permission } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
  const input = { name: 'Launchpad X', onmidimessage: null };
  const access = { inputs: new Map([['input', input]]), outputs: new Map(), onstatechange: null };
  const midi = new MidiConnection();
  const connecting = midi.connect({ onPadTouch() {}, onChainTouch() {}, onFunctionKey() {} });
  midi.release();
  allow(access as unknown as MIDIAccess);
  assert.equal(await connecting, false);
  assert.equal(input.onmidimessage, null);
  assert.equal(access.onstatechange, null);
});
