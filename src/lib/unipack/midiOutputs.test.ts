// Several devices connected on Auto Detect: as Android's MultiplexDriver sends to every pad with its own
// driver, each recognised Launchpad gets the lights in its own model's layout.
//
// Compiled by tsc before running, like the other unipack *.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MidiConnection, type MidiControllerListener } from './MidiConnection';

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

function withImmediateTimers(t: { after: (fn: () => void) => void }) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout: (fn: () => void) => { fn(); return 1; }, clearTimeout: () => {} },
  });
  t.after(() => { Reflect.deleteProperty(globalThis, 'window'); });
}

/** A connection on Auto Detect with one output port per name, in that order; `sent` records, per
 *  name, what lights reach it after the mode switch. */
function attachedTo(names: string[]) {
  const sent: Record<string, string[]> = Object.fromEntries(names.map((name) => [name, []]));
  const midi = new MidiConnection();
  (midi as unknown as { outputs: unknown[] }).outputs = names.map((name) => ({
    name,
    send: (message: number[]) => { sent[name].push(hex(message)); },
  }));
  midi.setProfile('auto');
  for (const name of names) sent[name].length = 0;
  return { midi, sent };
}

const LAUNCHPAD_X = 'Launchpad X LPX MIDI';
// The Launchpad S layout puts pad x,y at note x * 16 + y; its red-green codes for palette 3 and 5 are 63 and 2.
const LAUNCHPAD_MINI = 'Launchpad Mini';
const KEYBOARD = 'Master Keyboard';
// Pad 0,0 lit 3 and round button 0 (top row, CC 91 on the X, CC 104 on the S) lit 5.
const X_LIGHTS = ['90 51 03', 'b0 5b 05'];
const MINI_LIGHTS = ['90 00 3f', 'b0 68 02'];

for (const [first, second] of [[LAUNCHPAD_X, KEYBOARD], [KEYBOARD, LAUNCHPAD_X], [LAUNCHPAD_X, LAUNCHPAD_MINI], [LAUNCHPAD_MINI, LAUNCHPAD_X]]) {
  test(`with ${first} listed before ${second}, each gets the lights in its own layout`, (t) => {
    withImmediateTimers(t);
    const { midi, sent } = attachedTo([first, second]);

    midi.sendPadLed(0, 0, 3);
    midi.sendFunctionKeyLed(0, 5);

    assert.deepEqual(sent[LAUNCHPAD_X], X_LIGHTS);
    if (sent[LAUNCHPAD_MINI]) assert.deepEqual(sent[LAUNCHPAD_MINI], MINI_LIGHTS);
    if (sent[KEYBOARD]) assert.deepEqual(sent[KEYBOARD], [], 'a master keyboard plays lights as notes');
  });
}

test('turning the lights off clears each Launchpad in its own layout', (t) => {
  withImmediateTimers(t);
  const { midi, sent } = attachedTo([LAUNCHPAD_X, LAUNCHPAD_MINI]);

  midi.clearAllLeds();

  for (const name of [LAUNCHPAD_X, LAUNCHPAD_MINI]) {
    const alone = attachedTo([name]);
    alone.midi.clearAllLeds();
    assert.ok(alone.sent[name].length > 0, name);
    assert.deepEqual(sent[name], alone.sent[name], name);
  }
});

for (const names of [[LAUNCHPAD_X, KEYBOARD], [KEYBOARD, LAUNCHPAD_X]]) {
  test(`with ${names.join(' then ')}, the Launchpad is the model shown and its presses are read in its layout`, (t) => {
    withImmediateTimers(t);
    const { midi } = attachedTo(names);
    assert.equal(midi.getStatus().resolvedProfile, 'launchpad_x');

    const pads: string[] = [];
    const listener: MidiControllerListener = {
      onPadTouch: (x, y, pressed) => { if (pressed) pads.push(`${x},${y}`); },
      onChainTouch: () => {},
      onFunctionKey: () => {},
    };
    (midi as unknown as { listener: MidiControllerListener }).listener = listener;
    (midi as unknown as { handleMessage(e: { data: number[] }): void }).handleMessage({ data: [0x90, 81, 127] });
    assert.deepEqual(pads, ['0,0']);
  });
}

test('a model picked by hand lights every output in that model', (t) => {
  withImmediateTimers(t);
  const { midi, sent } = attachedTo([LAUNCHPAD_MINI, KEYBOARD]);
  midi.setProfile('launchpad_x');
  for (const name of [LAUNCHPAD_MINI, KEYBOARD]) sent[name].length = 0;

  midi.sendPadLed(0, 0, 3);
  midi.sendFunctionKeyLed(0, 5);

  assert.deepEqual(sent[LAUNCHPAD_MINI], X_LIGHTS);
  assert.deepEqual(sent[KEYBOARD], X_LIGHTS);
});
