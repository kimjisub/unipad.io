// Changing the Launchpad model while connected, in the order Android's MidiConnection.driver setter
// and iOS's MidiManager.driver didSet use: lights off in the old model's layout, the new model's mode
// switch, then the status listener (which redraws the board and shows the model).
//
// Compiled by tsc before running, like the other unipack *.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MidiConnection, type LaunchpadProfile, type MidiControllerListener } from './MidiConnection';

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const MINI_MK3_INIT = ['f0 00 20 29 02 0d 10 00 f7', 'f0 00 20 29 02 0d 0e 01 f7'];
const X_INIT = ['f0 00 20 29 02 0c 10 00 f7', 'f0 00 20 29 02 0c 0e 01 f7'];
const isSysEx = (entry: string) => entry.startsWith('f0');

/** `window.setTimeout` that runs only when the test flushes, in due-time order. */
function installTimers(t: { after: (fn: () => void) => void }): { flush: () => void } {
  let nextId = 1;
  let timers: Array<{ id: number; at: number; fn: () => void }> = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: (fn: () => void, delay = 0) => { const id = nextId++; timers.push({ id, at: delay, fn }); return id; },
      clearTimeout: (id: number) => { timers = timers.filter((timer) => timer.id !== id); },
    },
  });
  t.after(() => { Reflect.deleteProperty(globalThis, 'window'); });
  return {
    flush: () => {
      while (timers.length > 0) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        timers.shift()!.fn();
      }
    },
  };
}

/** A browser whose MIDI access has one input and, unless [withOutput] is false, one output; the log
 *  records what the output is sent and, as `status:<model>`, each status the connection reports. */
async function connect(
  t: { after: (fn: () => void) => void },
  options: { profile?: LaunchpadProfile; withOutput?: boolean } = {},
) {
  const timers = installTimers(t);
  const log: string[] = [];
  const pads: Array<[number, number]> = [];
  const input = { name: 'Launchpad X Test Input', onmidimessage: null as ((e: { data: Uint8Array }) => void) | null };
  const output = { name: 'Launchpad X Test Output', send: (message: number[]) => { log.push(hex(message)); } };
  const access = {
    inputs: new Map([['in', input]]),
    outputs: new Map(options.withOutput === false ? [] : [['out', output]]),
    onstatechange: null,
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { requestMIDIAccess: async () => access },
  });
  t.after(() => { Reflect.deleteProperty(globalThis, 'navigator'); });

  const listener: MidiControllerListener = {
    onPadTouch: (x, y, pressed) => { if (pressed) pads.push([x, y]); },
    onChainTouch: () => {},
    onFunctionKey: () => {},
  };
  const midi = new MidiConnection();
  await midi.connect(listener, {
    profile: options.profile,
    onStatusChange: (status) => { log.push(`status:${status.resolvedProfile}`); },
  });
  timers.flush();
  log.length = 0;
  const press = (note: number) => input.onmidimessage?.({ data: new Uint8Array([0x90, note, 127]) });
  return { midi, log, pads, press, flush: timers.flush };
}

test('a model change turns the old lights off, switches the mode, then reports the new model', async (t) => {
  const { midi, log, flush } = await connect(t);

  midi.setProfile('launchpad_mini_mk3');
  assert.ok(log.length > 0, 'the old lights are turned off at once');
  assert.ok(!log.some(isSysEx), 'the mode switch waits its turn');
  assert.ok(!log.some((entry) => entry.startsWith('status:')), 'nothing is redrawn before the mode switch');
  // Note off for the X's top-left pad and CC 0 for its first round button and logo.
  assert.ok(log.includes('80 51 00'));
  assert.ok(log.includes('b0 5b 00'));
  assert.ok(log.includes('b0 63 00'));

  const cleared = log.length;
  flush();
  assert.deepEqual(log.slice(cleared), [...MINI_MK3_INIT, 'status:launchpad_mini_mk3']);
  assert.equal(midi.getStatus().resolvedProfile, 'launchpad_mini_mk3');
});

test('changing the model again before the mode switch is sent sends only the last choice', async (t) => {
  const { midi, log, flush } = await connect(t);

  midi.setProfile('launchpad_mini_mk3');
  midi.setProfile('auto');
  flush();

  assert.deepEqual(log.filter(isSysEx), X_INIT);
  assert.deepEqual(log.filter((entry) => entry.startsWith('status:')), ['status:launchpad_x']);
});

test('disconnecting cancels a mode switch still waiting to be sent', async (t) => {
  const { midi, log, flush } = await connect(t);

  midi.setProfile('launchpad_mini_mk3');
  midi.disconnect();
  flush();

  assert.ok(!log.some(isSysEx));
});

test('a connection with no output goes back to the Auto layout when Auto is chosen again', async (t) => {
  const { midi, log, pads, press } = await connect(t, { profile: 'launchpad_x', withOutput: false });

  midi.setProfile('auto');
  assert.deepEqual(log, ['status:none']);
  // Note 11 is the bottom-left pad of the X layout but the top-left pad of the Auto layout with no
  // output, as after connecting on Auto.
  press(11);
  assert.deepEqual(pads, [[0, 0]]);
});

test('choosing a model after disconnecting reports nothing and leaves no model in use', async (t) => {
  const { midi, log, flush } = await connect(t);

  midi.disconnect();
  midi.setProfile('launchpad_mini_mk3');
  flush();

  assert.deepEqual(log, []);
  assert.equal(midi.getStatus().resolvedProfile, 'none');
  assert.equal(midi.getStatus().requestedProfile, 'launchpad_mini_mk3');
});

test('choosing a model in a browser without Web MIDI reports nothing and leaves no model in use', async (t) => {
  const timers = installTimers(t);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  t.after(() => { Reflect.deleteProperty(globalThis, 'navigator'); });
  const statuses: string[] = [];
  const midi = new MidiConnection();
  const listener: MidiControllerListener = { onPadTouch: () => {}, onChainTouch: () => {}, onFunctionKey: () => {} };
  assert.equal(await midi.connect(listener, { onStatusChange: (status) => { statuses.push(status.resolvedProfile); } }), false);

  midi.setProfile('launchpad_mini_mk3');
  timers.flush();

  assert.deepEqual(statuses, []);
  assert.equal(midi.getStatus().resolvedProfile, 'none');
});
