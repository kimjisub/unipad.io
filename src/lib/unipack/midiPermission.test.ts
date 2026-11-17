// Chrome asks for MIDI devices and for their control (SysEx) in one prompt. What still works after
// each answer, and what the connection reports so the page can say it.
//
// Compiled by tsc before running, like the other unipack *.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGO_FUNCTION_KEY, MidiConnection, type LaunchpadProfile } from './MidiConnection';

type Refusal = 'none' | 'control' | 'all' | 'other';

/** The spec's name for a refusal, and the one Chrome actually uses. */
const REFUSAL_NAMES = ['SecurityError', 'NotAllowedError'];

function refused(name: string) {
  return Object.assign(new Error('refused'), { name });
}

/** One controller on `profile`, behind a browser whose person answered the prompt with `refusal`. */
function browser(t: { after(fn: () => void): void }, refusal: Refusal, portName = 'Launchpad X MIDI', refusalName = 'NotAllowedError') {
  const requests: Array<MIDIOptions | undefined> = [];
  const sent: number[][] = [];
  const input = { name: portName, onmidimessage: null as ((event: { data: Uint8Array }) => void) | null };
  const output = { name: portName, send: (data: number[]) => { sent.push([...data]); } };
  const access = { inputs: new Map([['in', input]]), outputs: new Map([['out', output]]), onstatechange: null };
  const requestMIDIAccess = async (options?: MIDIOptions) => {
    requests.push(options);
    if (refusal === 'other') throw refused('AbortError');
    if (refusal === 'all' || (refusal === 'control' && options?.sysex)) throw refused(refusalName);
    return access;
  };
  for (const [key, value] of Object.entries({
    navigator: { requestMIDIAccess },
    window: { setTimeout: (fn: () => void) => { fn(); return 1; }, clearTimeout: () => {} },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  const pads: Array<[number, number, boolean]> = [];
  const functions: number[] = [];
  const connect = (profile: LaunchpadProfile = 'auto') => {
    const midi = new MidiConnection();
    const result = midi.connect({
      onPadTouch: (x, y, pressed) => pads.push([x, y, pressed]),
      onChainTouch: () => {},
      onFunctionKey: key => functions.push(key),
    }, { profile });
    return { midi, result };
  };
  const emit = (data: number[]) => input.onmidimessage?.({ data: new Uint8Array(data) });
  return { requests, sent, pads, functions, connect, emit };
}

const sysex = (messages: number[][]) => messages.filter(message => message[0] === 0xf0);

for (const refusalName of REFUSAL_NAMES) test(`a refused device control prompt (${refusalName}) connects again without it, and pads and plain lights still work`, async t => {
  const device = browser(t, 'control', undefined, refusalName);
  const { midi, result } = device.connect();
  assert.equal(await result, 'connectedWithoutSysEx');
  assert.deepEqual(device.requests, [{ sysex: true }, { sysex: false }]);
  assert.equal(midi.getStatus().connected, true);
  assert.equal(midi.getStatus().resolvedProfile, 'launchpad_x');

  device.emit([0x90, 81, 100]);
  device.emit([0x80, 81, 0]);
  assert.deepEqual(device.pads, [[0, 0, true], [0, 0, false]]);

  midi.sendPadLed(0, 0, 5);
  assert.deepEqual(device.sent.at(-1), [0x90, 81, 5]);
  assert.deepEqual(sysex(device.sent), [], 'no mode switch is sent where it would be refused');
});

test('without device control the Launchpad Pro keeps its pad lights and leaves its side LED alone', async t => {
  const device = browser(t, 'control', 'Launchpad Pro Standalone Port');
  const { midi, result } = device.connect('launchpad_pro');
  assert.equal(await result, 'connectedWithoutSysEx');
  midi.sendFunctionKeyLed(LOGO_FUNCTION_KEY, 5);
  midi.sendPadLed(0, 0, 5);
  assert.deepEqual(sysex(device.sent), []);
  assert.deepEqual(device.sent.at(-1), [0x90, 81, 5]);
});

test('an allowed prompt still switches the model into its lighting mode', async t => {
  const device = browser(t, 'none');
  const { result } = device.connect();
  assert.equal(await result, 'connected');
  assert.deepEqual(device.requests, [{ sysex: true }]);
  assert.deepEqual(sysex(device.sent), [
    [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x10, 0x00, 0xf7],
    [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x01, 0xf7],
  ]);
});

for (const refusalName of REFUSAL_NAMES) test(`refused MIDI devices (${refusalName}) are reported as refused, not as a missing device`, async t => {
  const device = browser(t, 'all', undefined, refusalName);
  const { midi, result } = device.connect();
  assert.equal(await result, 'denied');
  assert.deepEqual(device.requests, [{ sysex: true }, { sysex: false }]);
  assert.equal(midi.getStatus().connected, false);
});

test('a failure that is not a refusal is not asked again', async t => {
  const device = browser(t, 'other');
  const { result } = device.connect();
  assert.equal(await result, 'failed');
  assert.deepEqual(device.requests, [{ sysex: true }]);
});
