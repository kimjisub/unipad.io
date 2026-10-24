// Launchpads running CoreFW (github.com/anthonyhfm/launchpad-core-firmware) keep the stock product name
// but name their two ports "<model> (DAW)" and "<model> (MIDI)", and play in the firmware's own
// drum-rack layout on channel 1 instead of the stock programmer layout.
//
// Compiled by tsc before running, like the other unipack *.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MidiConnection, type MidiControllerListener } from './MidiConnection';

// src/utils/layout.rs at v1.2.1 (8bab7cbbe400a26176ebd5246aad7cd4a0fde320): programmer position
// (row * 10 + column, row 1 at the bottom) to the note the firmware plays and lights in performance mode.
const XY_DR = [
  0, 116, 117, 118, 119, 120, 121, 122, 123, 0, 115, 36, 37, 38, 39, 68, 69, 70, 71, 107, 114,
  40, 41, 42, 43, 72, 73, 74, 75, 106, 113, 44, 45, 46, 47, 76, 77, 78, 79, 105, 112, 48, 49, 50,
  51, 80, 81, 82, 83, 104, 111, 52, 53, 54, 55, 84, 85, 86, 87, 103, 110, 56, 57, 58, 59, 88, 89,
  90, 91, 102, 109, 60, 61, 62, 63, 92, 93, 94, 95, 101, 108, 64, 65, 66, 67, 96, 97, 98, 99,
  100, 26, 28, 29, 30, 31, 32, 33, 34, 35, 27, 0, 12, 13, 14, 15, 16, 17, 18, 19, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Programmer position of pad (x, y): x is the row from the top, y the column from the left. */
const padXy = (x: number, y: number) => (8 - x) * 10 + (y + 1);

/** Programmer position of round button f: top row left to right, right column top to bottom,
 *  bottom row right to left, left column bottom to top. */
function roundXy(f: number): number {
  if (f < 8) return 91 + f;
  if (f < 16) return (8 - (f - 8)) * 10 + 9;
  if (f < 24) return 8 - (f - 16);
  return (f - 24 + 1) * 10;
}

const LOGO_XY = 99;

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const noteOn = (note: number, velocity: number) => hex([0x90, note, velocity]);

/** A connection left on Auto Detect with one output port named [portName]; it records what it sends. */
function attachedTo(portName: string): { midi: MidiConnection; sent: string[] } {
  const sent: string[] = [];
  const midi = new MidiConnection();
  const port = { name: portName, send: (message: number[]) => { sent.push(hex(message)); } };
  (midi as unknown as { outputs: unknown[] }).outputs = [port];
  midi.setProfile('auto');
  return { midi, sent };
}

function withImmediateTimers(t: { after: (fn: () => void) => void }) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout: (fn: () => void) => { fn(); return 1; }, clearTimeout: () => {} },
  });
  t.after(() => { Reflect.deleteProperty(globalThis, 'window'); });
}

const resolved = (portName: string) => attachedTo(portName).midi.getStatus().resolvedProfile;

// What Chrome shows depends on the OS: Linux puts the product name in front of the port name and cuts
// it at 31 characters, macOS shows a display name joining the two.
const COREFW_PORTS: Array<[string, string]> = [
  ['LPX (MIDI)', 'launchpad_corefw'],
  ['LPX (DAW)', 'launchpad_corefw'],
  ['MINI MK3 (MIDI)', 'launchpad_corefw'],
  ['PRO MK3 (MIDI)', 'launchpad_corefw'],
  ['PRO (MIDI)', 'launchpad_corefw'],
  ['MK2 (MIDI)', 'launchpad_corefw'],
  ['LPS (MIDI)', 'launchpad_corefw_rg'],
  ['MINI (MIDI)', 'launchpad_corefw_rg'],
  ['MINI (DAW)', 'launchpad_corefw_rg'],
  ['Launchpad X LPX (MIDI)', 'launchpad_corefw'],
  ['Launchpad Mini MK3 MINI MK3 (MIDI)'.slice(0, 31), 'launchpad_corefw'],
  ['Launchpad Pro MK3 PRO MK3 (MIDI)'.slice(0, 31), 'launchpad_corefw'],
  ['Launchpad Pro PRO (MIDI)', 'launchpad_corefw'],
  ['Launchpad MK2 MK2 (MIDI)', 'launchpad_corefw'],
  ['Launchpad S LPS (MIDI)', 'launchpad_corefw_rg'],
  ['Launchpad Mini MINI (MIDI)', 'launchpad_corefw_rg'],
];

test('CoreFW port names resolve to the CoreFW profile', (t) => {
  withImmediateTimers(t);
  for (const [name, profile] of COREFW_PORTS) {
    assert.equal(resolved(name), profile, name);
  }
});

test('stock firmware port names resolve as before', (t) => {
  withImmediateTimers(t);
  const stock: Array<[string, string]> = [
    // Android Chrome names every port after the product, so CoreFW cannot be told apart there either.
    ['Launchpad X', 'launchpad_x'],
    ['LPX MIDI Out', 'launchpad_x'],
    ['Launchpad X LPX MIDI', 'launchpad_x'],
    ['MIDIOUT2 (LPX MIDI)', 'launchpad_x'],
    ['LPMiniMK3 MIDI', 'launchpad_mini_mk3'],
    ['Launchpad Mini MK3', 'launchpad_mini_mk3'],
    ['LPProMK3 MIDI', 'launchpad_pro_mk3'],
    ['Launchpad Pro MK3', 'launchpad_pro_mk3'],
    ['Launchpad MK2', 'launchpad_mk2'],
    ['MIDIOUT2 (Launchpad MK2)', 'launchpad_mk2'],
    ['Launchpad Pro', 'launchpad_pro'],
    ['MIDIOUT2 (Launchpad Pro)', 'launchpad_pro'],
    ['Launchpad Pro (Port 2)', 'launchpad_pro'],
    ['Launchpad S', 'launchpad_s'],
    ['Launchpad Mini', 'launchpad_s'],
    ['Midi Fighter 64', 'midifighter'],
    ['Mystrix', 'matrix'],
    ['Master Keyboard', 'master_keyboard'],
    ['IAC Driver Bus 1', 'master_keyboard'],
  ];
  for (const [name, profile] of stock) {
    assert.equal(resolved(name), profile, name);
  }
});

test('a CoreFW Launchpad gets no stock mode switch', (t) => {
  // v1.2.1 reads any 9-byte Novation SysEx whose 8th byte is 0 as "go to performance mode" and ignores
  // the stock programmer-mode switch, so the stock init only risked moving it out of a mode the user set.
  withImmediateTimers(t);
  for (const [name] of COREFW_PORTS) {
    assert.deepEqual(attachedTo(name).sent, [], name);
  }
  assert.notDeepEqual(attachedTo('Launchpad X').sent, [], 'the stock X still gets its programmer-mode switch');
});

test('CoreFW pads light the notes of the firmware layout on channel 1', (t) => {
  withImmediateTimers(t);
  const { midi, sent } = attachedTo('LPX (MIDI)');
  const expected: string[] = [];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      midi.sendPadLed(x, y, 5);
      expected.push(noteOn(XY_DR[padXy(x, y)], 5));
    }
  }
  assert.deepEqual(sent, expected);
  assert.equal(new Set(sent).size, 64);
});

test('CoreFW round buttons, chains and the logo light the notes of the firmware layout', (t) => {
  withImmediateTimers(t);
  const { midi, sent } = attachedTo('PRO MK3 (MIDI)');
  const expected: string[] = [];
  for (let f = 0; f < 32; f++) {
    midi.sendFunctionKeyLed(f, 9);
    expected.push(noteOn(XY_DR[roundXy(f)], 9));
  }
  for (let c = 0; c < 24; c++) {
    midi.sendChainLed(c, 9);
    expected.push(noteOn(XY_DR[roundXy(c + 8)], 9));
  }
  midi.sendFunctionKeyLed(32, 9);
  expected.push(noteOn(XY_DR[LOGO_XY], 9));
  assert.deepEqual(sent, expected);
});

test('CoreFW turns an LED off with note-on velocity zero on channel 1', (t) => {
  withImmediateTimers(t);
  const { midi, sent } = attachedTo('MK2 (MIDI)');
  midi.sendPadLed(7, 0, 0);
  midi.sendFunctionKeyLed(0, 0);
  assert.deepEqual(sent, [hex([0x90, XY_DR[11], 0]), hex([0x90, XY_DR[91], 0])]);
});

test('CoreFW S and Mini get the red-green colour codes of the stock Launchpad S', (t) => {
  withImmediateTimers(t);
  for (const name of ['LPS (MIDI)', 'MINI (MIDI)']) {
    const coreFw = attachedTo(name);
    const stock = attachedTo('Launchpad S');
    for (const velocity of [3, 5, 21, 72, 127]) {
      coreFw.midi.sendPadLed(0, 0, velocity);
      stock.midi.sendPadLed(0, 0, velocity);
    }
    assert.deepEqual(coreFw.sent.map((m) => m.slice(-2)), stock.sent.map((m) => m.slice(-2)), name);
    assert.ok(coreFw.sent.every((m) => m.startsWith(`90 ${XY_DR[padXy(0, 0)].toString(16)}`)), name);
  }
  // The RGB models keep the pack's palette index.
  const x = attachedTo('LPX (MIDI)');
  x.midi.sendPadLed(0, 0, 21);
  assert.deepEqual(x.sent, [noteOn(XY_DR[padXy(0, 0)], 21)]);
});

test('clearing a CoreFW Launchpad turns off every pad, round button and the logo', (t) => {
  withImmediateTimers(t);
  const { midi, sent } = attachedTo('LPX (MIDI)');
  midi.clearAllLeds();
  const off = new Set(sent);
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) assert.ok(off.has(hex([0x90, XY_DR[padXy(x, y)], 0])), `pad ${x},${y}`);
  }
  for (let f = 0; f < 32; f++) assert.ok(off.has(hex([0x90, XY_DR[roundXy(f)], 0])), `round ${f}`);
  assert.ok(off.has(hex([0x90, XY_DR[LOGO_XY], 0])), 'logo');
});

test('CoreFW presses reach the pad, round button and chain under the finger', (t) => {
  withImmediateTimers(t);
  const { midi } = attachedTo('LPX (MIDI)');
  const heard: string[] = [];
  const listener: MidiControllerListener = {
    onPadTouch: (x, y, pressed) => heard.push(`pad ${x},${y} ${pressed}`),
    onChainTouch: (c) => heard.push(`chain ${c}`),
    onFunctionKey: (f) => heard.push(`f ${f}`),
  };
  (midi as unknown as { listener: MidiControllerListener }).listener = listener;
  const receive = (data: number[]) =>
    (midi as unknown as { handleMessage(e: { data: number[] }): void }).handleMessage({ data });

  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      heard.length = 0;
      receive([0x90, XY_DR[padXy(x, y)], 100]);
      receive([0x80, XY_DR[padXy(x, y)], 0]);
      assert.deepEqual(heard, [`pad ${x},${y} true`, `pad ${x},${y} false`], `pad ${x},${y}`);
    }
  }
  for (let f = 0; f < 32; f++) {
    heard.length = 0;
    receive([0x90, XY_DR[roundXy(f)], 100]);
    assert.deepEqual(heard, f < 8 ? [`f ${f}`] : [`chain ${f - 8}`, `f ${f}`], `round ${f}`);
  }
});
