import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MidiConnection, type LaunchpadProfile } from './MidiConnection';

async function connect(t: { after: (fn: () => void) => void }, names: string[], profile: LaunchpadProfile = 'auto') {
  const inputs = names.map(name => ({ name, onmidimessage: null as ((event: { data: Uint8Array }) => void) | null }));
  const access = { inputs: new Map(inputs.map((input, i) => [String(i), input])), outputs: new Map(), onstatechange: null as (() => void) | null };
  for (const [key, value] of Object.entries({ navigator: { requestMIDIAccess: async () => access }, window: { clearTimeout: () => {} } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  const pads: Array<[number, number, boolean]> = [];
  const functions: number[] = [];
  const midi = new MidiConnection();
  await midi.connect({ onPadTouch: (x, y, pressed) => pads.push([x, y, pressed]), onChainTouch: () => {}, onFunctionKey: key => functions.push(key) }, { profile });
  const emit = (index: number, data: number[]) => inputs[index].onmidimessage?.({ data: new Uint8Array(data) });
  return { midi, inputs, access, pads, functions, emit };
}

for (const reverse of [false, true]) {
  test(`Auto decodes presses, releases and round buttons per input with X ${reverse ? 'last' : 'first'}`, async t => {
    const devices = [{ name: 'LPX MIDI In', note: 81, round: 91 }, { name: 'Launchpad Mini', note: 0, round: 104 }, { name: 'Launchpad Mini MK3 MINI MK3 (MIDI)', note: 64, round: 28 }];
    if (reverse) devices.reverse();
    const { pads, functions, emit } = await connect(t, devices.map(d => d.name));
    for (const [i, device] of devices.entries()) {
      emit(i, [0x90, device.note, 127]);
      emit(i, [0x80, device.note, 0]);
      emit(i, [0x90, device.note, 127]);
      emit(i, [0x90, device.note, 0]);
      emit(i, [device.round === 28 ? 0x90 : 0xb0, device.round, 127]);
    }
    assert.deepEqual(pads, devices.flatMap(() => [[0, 0, true], [0, 0, false], [0, 0, true], [0, 0, false]]));
    assert.deepEqual(functions, [0, 0, 0]);
  });
}

test('a manual model applies to every input and changing back to Auto restores each input layout', async t => {
  const { midi, pads, emit } = await connect(t, ['Launchpad X', 'Launchpad Mini'], 'launchpad_s');
  for (const i of [0, 1]) emit(i, [0x90, 0, 127]);
  assert.deepEqual(pads, [[0, 0, true], [0, 0, true]]);
  pads.length = 0;
  midi.setProfile('auto');
  emit(0, [0x90, 81, 127]);
  emit(1, [0x90, 0, 127]);
  assert.deepEqual(pads, [[0, 0, true], [0, 0, true]]);
});

test('unknown input names use the master keyboard layout while recognised inputs keep their own', async t => {
  const { pads, emit } = await connect(t, ['Unknown controller', 'Launchpad X']);
  emit(0, [0x90, 36, 127]);
  emit(1, [0x90, 11, 127]);
  assert.deepEqual(pads, [[7, 0, true], [7, 0, true]]);
});

test('a newly connected input gets its own layout and disconnect removes its listener', async t => {
  const { midi, inputs, access, pads, emit } = await connect(t, ['Launchpad X']);
  const added = { name: 'Launchpad Mini', onmidimessage: null as typeof inputs[number]['onmidimessage'] };
  inputs.push(added);
  access.inputs.set('new', added);
  access.onstatechange?.();
  emit(1, [0x90, 0, 127]);
  assert.deepEqual(pads, [[0, 0, true]]);
  midi.disconnect();
  assert.ok(inputs.every(input => input.onmidimessage === null));
});
