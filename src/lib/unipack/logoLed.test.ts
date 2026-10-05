// keyLED `l` lines address the Launchpad logo. iOS (#10) reads them as circle index 32, just past the 32
// round buttons, and sends that index to the logo; the web player used to skip them.
//
// Compiled by tsc before running, like the other unipack *.test.ts: unipack imports its modules without
// extensions, which node's type stripping cannot load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseUniPack } from './parser';
import { LedRunner } from './LedRunner';
import { Channel, ChannelManager } from './ChannelManager';
import { LaunchpadProfile, MidiConnection } from './MidiConnection';
import { LAUNCHPAD_ARGB } from './colors';
import type { LedEvent, UniPackData } from './types';

const LOGO = 32;

async function parseKeyLed(keyLed: string): Promise<UniPackData> {
  const zip = new JSZip();
  zip.file('info', 'title=Test\nproducerName=Tester\nbuttonX=8\nbuttonY=8\nchain=1');
  zip.file('keySound', '1 1 1 a.wav');
  zip.file('sounds/a.wav', new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  zip.file('keyLed/1 1 1', keyLed);
  return parseUniPack(await zip.generateAsync({ type: 'arraybuffer' }));
}

const hex = (n: number) => (n >>> 0).toString(16);

function describe(event: LedEvent): string {
  switch (event.type) {
    case 'on': return `on ${event.x},${event.y} color=${hex(event.color)} vel=${event.velocity}`;
    case 'off': return `off ${event.x},${event.y}`;
    case 'delay': return `delay ${event.delay}`;
    case 'chain': return `chain ${event.chain}`;
  }
}

const events = (pack: UniPackData) => pack.ledAnimationTable![0][0][0]![0].ledEvents.map(describe);
const auto = (velocity: number) => `color=${hex(LAUNCHPAD_ARGB[velocity])} vel=${velocity}`;
const formatErrors = (pack: UniPackData) => pack.errors.filter((e) => e.includes('format is incorrect'));

test('logo lines become circle index 32 in every iOS form', async () => {
  const pack = await parseKeyLed([
    'o l FF0000',
    'o l a 5',
    'on l auto 9',
    'o l 0 00FF00',
    'o l 0 a 13',
    'o l 0 0000FF 21',
    'f l',
    'off l',
  ].join('\n'));

  assert.deepEqual(formatErrors(pack), []);
  assert.deepEqual(events(pack), [
    'on -1,32 color=ffff0000 vel=4',
    `on -1,32 ${auto(5)}`,
    `on -1,32 ${auto(9)}`,
    'on -1,32 color=ff00ff00 vel=4',
    `on -1,32 ${auto(13)}`,
    'on -1,32 color=ff0000ff vel=21',
    'off -1,32',
    'off -1,32',
  ]);
});

test('round LED numbers outside the ring never reach the logo index', async () => {
  // `mc 33` used to become circle index 32 too; now that 32 lights the logo it must not.
  const pack = await parseKeyLed(['o mc 32 a 3', 'o mc 33 a 3', 'o * 0 a 3', 'f mc 33', 'f mc 32'].join('\n'));

  assert.deepEqual(formatErrors(pack), []);
  assert.deepEqual(events(pack), [`on -1,31 ${auto(3)}`, 'off -1,31']);
});

test('malformed logo lines are reported and skipped like other lines', async () => {
  const pack = await parseKeyLed(['o l', 'o l ZZZZZZ', 'o l a 200', 'o l 0 a 5 9', 'o l a 5'].join('\n'));

  assert.deepEqual(events(pack), [`on -1,32 ${auto(5)}`]);
  assert.equal(formatErrors(pack).length, 4);
});

test('pad and round lines parse as before', async () => {
  const pack = await parseKeyLed([
    'o 1 1 FF0000',
    'o 8 8 a 5',
    'o 2 3 00FF00 7',
    'o * 1 a 72',
    'o mc 9 0000FF',
    'd 100',
    'f 1 1',
    'f * 1',
    'c 2',
  ].join('\n'));

  assert.deepEqual(formatErrors(pack), []);
  assert.deepEqual(events(pack), [
    'on 0,0 color=ffff0000 vel=4',
    `on 7,7 ${auto(5)}`,
    'on 1,2 color=ff00ff00 vel=7',
    `on -1,0 ${auto(72)}`,
    'on -1,8 color=ff0000ff vel=4',
    'delay 100',
    'off 0,0',
    'off -1,0',
    'chain 1',
  ]);
});

/** A MidiConnection for [profile] whose one output port records every message it is sent, as hex. */
function connectedTo(profile: LaunchpadProfile): { midi: MidiConnection; sent: string[] } {
  const sent: string[] = [];
  const midi = new MidiConnection();
  midi.setProfile(profile);
  const port = { send: (message: number[]) => { sent.push(message.map((b) => b.toString(16).padStart(2, '0')).join(' ')); } };
  (midi as unknown as { outputs: unknown[] }).outputs = [port];
  return { midi, sent };
}

const sentFor = (profile: LaunchpadProfile, send: (midi: MidiConnection) => void) => {
  const { midi, sent } = connectedTo(profile);
  send(midi);
  return sent;
};

test('Launchpad X, Mini MK3 and Pro MK3 light the logo with CC 99', () => {
  // Their programmer's references name the logo CC 99 (X and Mini MK3 layouts, Pro MK3 "Logo (CC 99)").
  for (const profile of ['launchpad_x', 'launchpad_mini_mk3', 'launchpad_pro_mk3'] as const) {
    assert.deepEqual(sentFor(profile, (m) => m.sendFunctionKeyLed(LOGO, 5)), ['b0 63 05'], profile);
    assert.deepEqual(sentFor(profile, (m) => m.sendFunctionKeyLed(LOGO, 0)), ['b0 63 00'], profile);
  }
});

test('Launchpad Pro lights its side LED with the light-LED SysEx', () => {
  // Launchpad Pro programmer's reference: the side LED is index 99 (63h), reachable only by SysEx 0Ah.
  assert.deepEqual(sentFor('launchpad_pro', (m) => m.sendFunctionKeyLed(LOGO, 5)), ['f0 00 20 29 02 10 0a 63 05 f7']);
  assert.deepEqual(sentFor('launchpad_pro', (m) => m.sendFunctionKeyLed(LOGO, 0)), ['f0 00 20 29 02 10 0a 63 00 f7']);
  assert.deepEqual(sentFor('launchpad_pro', (m) => m.sendFunctionKeyLed(LOGO, 200)), ['f0 00 20 29 02 10 0a 63 7f f7']);
});

test('devices without an addressable logo send nothing for it', () => {
  for (const profile of ['launchpad_s', 'launchpad_mk2', 'matrix', 'midifighter', 'master_keyboard', 'none'] as const) {
    assert.deepEqual(sentFor(profile, (m) => m.sendFunctionKeyLed(LOGO, 5)), [], profile);
  }
  for (const profile of ['launchpad_x', 'launchpad_pro'] as const) {
    assert.deepEqual(sentFor(profile, (m) => m.sendFunctionKeyLed(LOGO + 1, 5)), [], profile);
  }
});

test('round buttons are sent as before', () => {
  assert.deepEqual(sentFor('launchpad_x', (m) => m.sendFunctionKeyLed(0, 5)), ['b0 5b 05']);
  assert.deepEqual(sentFor('launchpad_pro_mk3', (m) => m.sendFunctionKeyLed(31, 5)), ['b0 50 05']);
});

test('clearing every LED turns the logo off', () => {
  for (const profile of ['launchpad_x', 'launchpad_mini_mk3', 'launchpad_pro_mk3'] as const) {
    assert.ok(sentFor(profile, (m) => m.clearAllLeds()).includes('b0 63 00'), profile);
  }
  assert.ok(sentFor('launchpad_pro', (m) => m.clearAllLeds()).includes('f0 00 20 29 02 10 0a 63 00 f7'));
});

/**
 * From the pack file to the bytes a Launchpad receives. The parser, LED runner, channel manager and
 * MIDI connection are the real ones; the listener sends a circle LED the way useUniPadEngine does, the
 * logo from its channel so it stays dark outside Pro light mode (Android and iOS).
 */
async function playOnLaunchpad(keyLed: string, proLightMode = true, profile: LaunchpadProfile = 'launchpad_x') {
  let pending: (() => void) | null = null;
  let now = 1000;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout: (fn: () => void) => { pending = fn; return 1; }, clearTimeout: () => { pending = null; } },
  });
  test.mock.method(performance, 'now', () => now);

  const pack = await parseKeyLed(keyLed);
  const cm = new ChannelManager(8, 8);
  cm.setCirIgnore(Channel.LED, !proLightMode);
  const { midi, sent } = connectedTo(profile);
  const runner = new LedRunner(pack, {
    onPadLedTurnOn: (x, y, color, velocity) => { cm.add(x, y, Channel.LED, color, velocity); midi.sendPadLed(x, y, velocity); },
    onPadLedTurnOff: (x, y) => { cm.remove(x, y, Channel.LED); midi.sendPadLed(x, y, 0); },
    onChainLedTurnOn: (c, color, velocity) => {
      cm.add(-1, c, Channel.LED, color, velocity);
      midi.sendFunctionKeyLed(c, c === LOGO ? (cm.get(-1, c)?.code ?? 0) : velocity);
    },
    onChainLedTurnOff: (c) => { cm.remove(-1, c, Channel.LED); midi.sendFunctionKeyLed(c, 0); },
  }, () => 0, () => {});
  const tick = (ms: number) => { now += ms; const fn = pending; pending = null; fn?.(); };

  runner.launch();
  runner.eventOn(0, 0);
  // The first tick only takes the press in; the second plays it.
  tick(4);
  tick(4);
  return { runner, midi, sent, tick };
}

test('a logo line reaches the Launchpad and turns off again', async (t) => {
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  const { sent, tick } = await playOnLaunchpad('o l a 5\nd 100\nf l');
  assert.deepEqual(sent, ['b0 63 05']);

  tick(100);
  assert.deepEqual(sent, ['b0 63 05', 'b0 63 00']);
});

test('pad and round lines still reach their own buttons', async (t) => {
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  const { sent } = await playOnLaunchpad('o 1 1 a 3\no mc 1 a 9\no l a 5');
  assert.deepEqual(sent, ['90 51 03', 'b0 5b 09', 'b0 63 05']);
});

test('invalid pad coordinates neither light nor clear pads, round LEDs or the logo', async (t) => {
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  const { runner, sent, tick } = await playOnLaunchpad([
    'o 1b 1 FF0000',
    'on 0 1 a 7',
    'o 9 1 a 7',
    'o 1 1 a 3',
    'o mc 1 a 9',
    'o l a 5',
    'f 1b 1',
    'off 0 1',
    'f 0 33',
    'd 100',
    'f 1 1',
    'f mc 1',
    'f l',
  ].join('\n'));

  assert.deepEqual(sent, ['90 51 03', 'b0 5b 09', 'b0 63 05']);
  tick(100);
  assert.deepEqual(sent, ['90 51 03', 'b0 5b 09', 'b0 63 05', '80 51 00', 'b0 5b 00', 'b0 63 00']);
  runner.stop();
});

test('round LED 33 does not light the logo', async (t) => {
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  const { sent } = await playOnLaunchpad('o mc 33 a 5');
  assert.deepEqual(sent, []);
});

test('stopping the LEDs turns a lit logo off', async (t) => {
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  const { runner, sent } = await playOnLaunchpad('o l a 5');
  sent.length = 0;

  runner.stop();

  assert.deepEqual(sent, ['b0 63 00']);
});

test('the logo stays dark outside Pro light mode, like Android and iOS', async (t) => {
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  const { sent } = await playOnLaunchpad('o l a 5', false);
  assert.deepEqual(sent, ['b0 63 00']);
});

const LOGO_BYTES = {
  launchpad_x: { on: 'b0 63 05', off: 'b0 63 00' },
  launchpad_pro: { on: 'f0 00 20 29 02 10 0a 63 05 f7', off: 'f0 00 20 29 02 10 0a 63 00 f7' },
} as const;

/** What leaving the pack does to the LEDs: useUniPadEngine stops the runner, then releases the connection. */
function leavePack(runner: LedRunner, midi: MidiConnection, sent: string[]) {
  sent.length = 0;
  runner.stop();
  midi.release();
  const afterRelease = sent.length;
  midi.sendPadLed(0, 0, 5);
  assert.equal(sent.length, afterRelease, 'nothing reaches the Launchpad once the connection is released');
}

test('leaving after an animation has finished turns its logo and pads off', async (t) => {
  // An animation that ends without `f l` leaves the logo lit; the runner no longer tracks it, so stopping
  // the runner alone sent nothing and the logo stayed on after Quit.
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  for (const profile of ['launchpad_x', 'launchpad_pro'] as const) {
    const { runner, midi, sent, tick } = await playOnLaunchpad('o 1 5 a 5\no mc 9 a 9\no l a 5', true, profile);
    assert.ok(sent.includes(LOGO_BYTES[profile].on), profile);
    tick(4);

    leavePack(runner, midi, sent);

    assert.ok(sent.includes(LOGO_BYTES[profile].off), profile);
    assert.deepEqual(sent, sentFor(profile, (m) => m.clearAllLeds()), profile);
  }
});

test('leaving while an animation is still playing turns its logo off', async (t) => {
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  for (const profile of ['launchpad_x', 'launchpad_pro'] as const) {
    const { runner, midi, sent } = await playOnLaunchpad('o 1 6 a 5\no l a 5\nd 5000\nf 1 6\nf l', true, profile);

    leavePack(runner, midi, sent);

    const cleared = sentFor(profile, (m) => m.clearAllLeds());
    assert.ok(sent.includes(LOGO_BYTES[profile].off), profile);
    assert.deepEqual(sent.slice(-cleared.length), cleared, profile);
  }
});

test('leaving on a Launchpad without a logo clears its pads without error', async (t) => {
  t.after(() => { test.mock.restoreAll(); Reflect.deleteProperty(globalThis, 'window'); });
  for (const profile of ['launchpad_mk2', 'launchpad_s'] as const) {
    const { runner, midi, sent, tick } = await playOnLaunchpad('o 1 5 a 5\no l a 5', true, profile);
    tick(4);

    leavePack(runner, midi, sent);

    assert.deepEqual(sent, sentFor(profile, (m) => m.clearAllLeds()), profile);
  }
});
