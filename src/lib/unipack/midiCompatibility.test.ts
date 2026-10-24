import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MidiConnection, type LaunchpadProfile } from './MidiConnection';

async function connection(t: { after(fn: () => void): void }, names = ['Launchpad X MIDI'], profile: LaunchpadProfile = 'auto', inputNames = names) {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sent = names.map(() => [] as number[][]);
  const inputs = inputNames.map(name => ({ name, onmidimessage: null as ((event: { data: Uint8Array }) => void) | null }));
  const outputs = names.map((name, i) => ({ name, send: (data: number[]) => sent[i].push([...data]) }));
  const access = { inputs: new Map(inputs.map((input, i) => [String(i), input])), outputs: new Map(outputs.map((output, i) => [String(i), output])), onstatechange: null as (() => void) | null };
  for (const [key, value] of Object.entries({
    navigator: { requestMIDIAccess: async () => access },
    window: { setTimeout: (fn: () => void, delay = 0) => { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id; }, clearTimeout: (id: number) => timers.delete(id) },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  const advance = (to: number) => {
    while (timers.size) {
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (timer.at > to) break;
      timers.delete(id); now = timer.at; timer.fn();
    }
    now = to;
  };
  const pads: Array<[number, number, boolean]> = [];
  const functions: number[] = [];
  const redraws: number[] = [];
  const statuses: number[] = [];
  const releases: Array<boolean | undefined> = [];
  const held = new Set<string>();
  const midi = new MidiConnection();
  await midi.connect({
    onPadTouch: (x, y, pressed) => {
      pads.push([x, y, pressed]);
      if (pressed) held.add(`${x},${y}`); else held.delete(`${x},${y}`);
    },
    onChainTouch: () => {}, onFunctionKey: key => functions.push(key),
    ...{ onResync: () => redraws.push(now) },
  }, { profile, onStatusChange: status => {
    statuses.push(now);
    releases.push((status as typeof status & { releaseHeldPads?: boolean }).releaseHeldPads);
    if (status.releaseHeldPads !== false) held.clear();
  } });
  const emit = (data: number[], i = 0) => inputs[i].onmidimessage?.({ data: new Uint8Array(data) });
  return { midi, sent, pads, functions, redraws, statuses, releases, advance, emit, access, held };
}

for (const profile of ['launchpad_s', 'launchpad_mk2', 'launchpad_pro', 'launchpad_x', 'launchpad_mini_mk3', 'launchpad_pro_mk3', 'launchpad_corefw', 'launchpad_corefw_rg', 'matrix', 'midifighter'] as const) {
  test(`${profile} drops lights outside the hardware grid`, async t => {
    const { midi, sent, advance } = await connection(t, undefined, profile);
    advance(1000); sent[0].length = 0;
    for (const [x, y] of [[8, 0], [0, 8], [-1, 0], [0, -1], [64, 64]]) midi.sendPadLed(x, y, 5);
    assert.deepEqual(sent[0], []);
    midi.sendPadLed(0, 0, 5); midi.sendPadLed(7, 7, 5);
    assert.equal(sent[0].length, 2, 'both corners of existing packs still light');
  });
}

test('unknown keyboards use the drum-rack pad layout without receiving light notes', async t => {
  const { midi, emit, pads, sent, advance } = await connection(t, ['Unknown controller']);
  advance(1000);
  emit([0x90, 36, 100]); emit([0x80, 36, 0]); emit([0x90, 99, 100]); emit([0x90, 11, 100]);
  assert.deepEqual(pads, [[7, 0, true], [7, 0, false], [0, 7, true]]);
  midi.sendPadLed(0, 0, 5); midi.sendFunctionKeyLed(0, 5);
  assert.deepEqual(sent[0], []);
});

test('the original Launchpad uses its documented XY grid and red-green LEDs', async t => {
  for (const name of ['Launchpad', 'Launchpad MIDI 1', 'Novation Launchpad', 'Novation Launchpad MIDI 1']) {
    await t.test(name, async t => {
      const { midi, emit, pads, functions, sent, advance } = await connection(t, [name]);
      advance(1000);
      assert.equal(midi.getStatus().resolvedProfile, 'launchpad_s');
      emit([0x90, 0, 127]); emit([0x90, 0, 0]); emit([0x90, 119, 127]); emit([0xb0, 104, 127]);
      assert.deepEqual(pads, [[0, 0, true], [0, 0, false], [7, 7, true]]);
      assert.deepEqual(functions, [0]);
      midi.sendPadLed(0, 0, 3); midi.sendPadLed(7, 7, 3); midi.sendFunctionKeyLed(0, 3);
      assert.deepEqual(sent[0], [[0x90, 0, 63], [0x90, 119, 63], [0xb0, 104, 63]]);
    });
  }
});

test('Launchpad Open uses performance init and drum-rack lights on channel 16', async t => {
  const { midi, sent, advance, emit, pads, functions } = await connection(t, ['Launchpad Open']);
  advance(1000);
  assert.equal(midi.getStatus().resolvedProfile, 'launchpad_pro_cfw');
  assert.deepEqual(sent[0], [[0xf0, 0, 0x20, 0x29, 2, 0x10, 0x21, 1, 0xf7], [0xf0, 0, 0x20, 0x29, 2, 0x10, 0x0e, 0, 0xf7]]);
  sent[0].length = 0;
  midi.sendPadLed(0, 0, 5); midi.sendFunctionKeyLed(0, 5); midi.sendFunctionKeyLed(32, 5);
  assert.deepEqual(sent[0], [[0x9f, 64, 5], [0x9f, 28, 5], [0x9f, 27, 5]]);
  emit([0x9f, 64, 100]); emit([0x8f, 64, 0]); emit([0xbf, 28, 100]);
  assert.deepEqual(pads, [[0, 0, true], [0, 0, false]]);
  assert.deepEqual(functions, [0]);
});

for (const profile of ['launchpad_s', 'launchpad_corefw_rg'] as const) {
  test(`${profile} clamps palette values before red-green conversion`, async t => {
    const { midi, sent, advance } = await connection(t, undefined, profile);
    advance(1000); sent[0].length = 0;
    for (const velocity of [127, 200]) { midi.sendPadLed(0, 0, velocity); midi.sendFunctionKeyLed(0, velocity); }
    assert.deepEqual(sent[0].slice(0, 2), sent[0].slice(2));
    assert.ok(sent[0].every(message => message[2] > 0));
  });
}

test('connection status is immediate while lights wait for mode setup and settling', async t => {
  const { sent, statuses, redraws, releases, advance, midi } = await connection(t);
  assert.deepEqual(statuses, [0]);
  assert.deepEqual(releases, [true]);
  midi.sendPadLed(0, 0, 5);
  assert.deepEqual(sent[0], [], 'drawing before mode setup cannot reach the controller');
  advance(0); assert.equal(sent[0].length, 1);
  advance(50); assert.equal(sent[0].length, 2);
  advance(549); assert.deepEqual(redraws, []);
  advance(550); assert.deepEqual(redraws, [550]);
  assert.deepEqual(statuses, [0], 'settling redraws without another hold-clearing status');
  midi.sendPadLed(0, 0, 5);
  assert.deepEqual(sent[0].at(-1), [0x90, 81, 5]);
});

for (const changeModel of [false, true]) {
  test(`a pad pressed during ${changeModel ? 'a model change' : 'connection'} stays held after mode settling`, async t => {
    const { midi, held, emit, advance } = await connection(t);
    if (changeModel) {
      advance(1000);
      emit([0x90, 81, 100]);
      midi.setProfile('launchpad_mini_mk3');
      assert.equal(held.size, 0, 'the previous mapping is released before accepting new presses');
    }
    emit([0x90, 81, 100]);
    assert.ok(held.has('0,0'), 'the input is received before the lights are ready');
    advance(changeModel ? 1550 : 550);
    assert.ok(held.has('0,0'), 'settling must redraw lights without releasing the new press');
    emit([0x80, 81, 0]);
    assert.equal(held.size, 0, 'the actual note-off still releases the pad');
  });
}

test('removing an input during mode settling releases its held pads immediately', async t => {
  const { held, emit, advance, access } = await connection(t);
  emit([0x90, 81, 100]);
  advance(200);
  access.inputs.delete('0'); access.onstatechange?.();
  assert.equal(held.size, 0);
});

for (const [name, model, ports] of [
  ['LPX MIDI', 'launchpad_x', 2],
  ['LPMiniMK3 MIDI', 'launchpad_mini_mk3', 2],
  ['LPProMK3 MIDI', 'launchpad_pro_mk3', 3],
] as const) {
  for (const profile of ['auto', model] as const) {
    test(`${profile} keeps Windows aliases of one ${name} on one lighting output`, async t => {
      const outputs = Array.from({ length: ports }, (_, i) => i === 0 ? name : `MIDIOUT${i + 1} (${name})`);
      const inputs = Array.from({ length: ports }, (_, i) => i === 0 ? name : `MIDIIN${i + 1} (${name})`);
      const { midi, sent, advance } = await connection(t, outputs, profile, inputs);
      advance(1000);
      const modeSwitches = sent.map(messages => messages.length);
      const lightingIndex = model === 'launchpad_pro_mk3' ? 0 : 1;
      assert.equal(midi.getStatus().outputName, outputs[lightingIndex], 'use the documented Windows interface');
      for (const messages of sent) messages.length = 0;
      midi.sendPadLed(0, 0, 5);
      assert.deepEqual({ modeSwitches, lights: sent }, {
        modeSwitches: outputs.map((_, i) => i === lightingIndex ? 2 : 0),
        lights: outputs.map((_, i) => i === lightingIndex ? [[0x90, 81, 5]] : []),
      }, 'non-lighting interfaces, including the Pro MK3 DIN output, receive no mode switches or lights');
    });
  }
}

for (const profile of ['auto', 'launchpad_x'] as const) {
  test(`${profile} sends lights only to the controller's MIDI port`, async t => {
    const { midi, sent, advance } = await connection(t, ['Launchpad X DAW', 'Launchpad X DIN', 'Launchpad X MIDI', 'Microsoft GS Wavetable Synth'], profile);
    advance(1000);
    assert.deepEqual(sent.map(messages => messages.length), [0, 0, 2, 0], 'mode switches use the same port as lights');
    sent.forEach(messages => { messages.length = 0; });
    midi.sendPadLed(0, 0, 5);
    assert.deepEqual(sent, [[], [], [[0x90, 81, 5]], []]);
  });
}

for (const profile of ['auto', 'launchpad_x'] as const) {
  test(`${profile} keeps both controllers with identically named ports`, async t => {
    const names = ['Launchpad X LPX MIDI Out', 'Launchpad X LPX MIDI Out'];
    const { midi, sent, advance } = await connection(t, names, profile, ['Launchpad X LPX MIDI In', 'Launchpad X LPX MIDI In']);
    advance(1000);
    const initialized = sent.map(messages => messages.length);
    sent.forEach(messages => { messages.length = 0; });
    midi.sendPadLed(0, 0, 5);
    assert.deepEqual(sent, [[[0x90, 81, 5]], [[0x90, 81, 5]]]);
    assert.deepEqual(initialized, [2, 2], 'both physical controllers receive mode setup');
    midi.sendFunctionKeyLed(0, 5);
    assert.deepEqual(sent[0], sent[1], 'round lights also reach both controllers');
    sent.forEach(messages => { messages.length = 0; });
    midi.clearAllLeds();
    assert.ok(sent[0].length > 0);
    assert.deepEqual(sent[0], sent[1], 'both controllers clear their lights');
  });

  test(`${profile} still selects one performance output when one controller exposes aliases`, async t => {
    const { midi, sent, advance } = await connection(t, ['Launchpad X LPX', 'Launchpad X LPX DAW', 'Launchpad X LPX MIDI Out', 'Launchpad X LPX MIDI Out 1'], profile, ['Launchpad X LPX MIDI In', 'Launchpad X LPX DAW', 'MIDIIN3 (Launchpad X LPX)']);
    advance(1000);
    assert.deepEqual(sent.map(messages => messages.length), [0, 0, 2, 0]);
    sent.forEach(messages => { messages.length = 0; });
    midi.sendPadLed(0, 0, 5);
    assert.deepEqual(sent, [[], [], [[0x90, 81, 5]], []]);
  });
}

for (const profile of ['auto', 'launchpad_pro'] as const) {
  for (const devices of [1, 2]) {
    test(`${profile} lights only Standalone on ${devices} original Pro device${devices === 1 ? '' : 's'}`, async t => {
      const names = Array.from({ length: devices }, () => ['Launchpad Pro Live Port', 'Launchpad Pro Standalone Port', 'Launchpad Pro MIDI Port']).flat();
      const { midi, sent, advance } = await connection(t, names, profile);
      advance(1000);
      const initialized = sent.map(messages => messages.length);
      sent.forEach(messages => { messages.length = 0; });
      midi.sendPadLed(0, 0, 5);
      assert.deepEqual(sent.map(messages => messages.length), names.map(name => name.includes('Standalone') ? 1 : 0));
      assert.deepEqual(initialized, names.map(name => name.includes('Standalone') ? 2 : 0), 'no mode messages reach Live or the external MIDI jack');
      sent.forEach(messages => { messages.length = 0; });
      midi.clearAllLeds();
      assert.deepEqual(sent.map(messages => messages.length > 0), names.map(name => name.includes('Standalone')));
    });
  }
}

test('hot-plugging an identical controller initializes only the added device', async t => {
  const { midi, access, sent, advance } = await connection(t, ['Launchpad X LPX MIDI Out'], 'auto', ['Launchpad X LPX MIDI In']);
  advance(1000); sent[0].length = 0;
  const added: number[][] = [];
  access.inputs.set('second', { name: 'Launchpad X LPX MIDI In', onmidimessage: null });
  access.outputs.set('second', { name: 'Launchpad X LPX MIDI Out', send: data => added.push([...data]) });
  access.onstatechange?.(); advance(2000);
  assert.equal(added.length, 2, 'the second identical controller receives its own initialization');
  assert.deepEqual(sent[0], [], 'the first controller stays in its current mode');
  midi.sendPadLed(0, 0, 5);
  assert.deepEqual(sent[0].at(-1), [0x90, 81, 5]);
  assert.deepEqual(added.at(-1), [0x90, 81, 5]);
  sent[0].length = 0; added.length = 0;
  access.inputs.delete('0'); access.outputs.delete('0'); access.onstatechange?.(); advance(3000);
  midi.sendPadLed(0, 0, 5);
  assert.deepEqual(sent[0], []);
  assert.deepEqual(added, [[0x90, 81, 5]], 'removing the first device preserves the second mode and lights');
});

test('none sends no initialization, pad, ring, logo or clear messages', async t => {
  const { midi, sent, advance, emit, pads } = await connection(t, undefined, 'none');
  advance(1000);
  midi.sendPadLed(0, 0, 5); midi.sendFunctionKeyLed(0, 5); midi.sendFunctionKeyLed(32, 5); midi.clearAllLeds();
  emit([0x90, 81, 100]);
  assert.deepEqual(sent[0], []);
  assert.deepEqual(pads, []);
});

test('light-off is note-on velocity zero, preserving the device channel', async t => {
  const { midi, sent, advance } = await connection(t, undefined, 'midifighter');
  advance(1000); sent[0].length = 0;
  midi.sendPadLed(0, 0, 5); midi.sendPadLed(0, 0, 0);
  assert.deepEqual(sent[0], [[0x92, 64, 5], [0x92, 64, 0]]);
});

test('Pro Live-mode notification requests a redraw without selecting a chain', async t => {
  const { advance, emit, redraws } = await connection(t, ['Launchpad Pro']);
  advance(1000);
  redraws.length = 0;
  emit([0xf0, 0, 0x20, 0x29, 2, 0x10, 0x2e, 0, 0xf7]);
  assert.deepEqual(redraws, [1000]);
  emit([0xf0, 0, 0x20, 0x29, 2, 0x10, 0x2f, 3, 0xf7]);
  assert.deepEqual(redraws, [1000], 'other mode notifications do not redraw');
});

test('an unrelated hot-plug does not switch an existing controller mode or report a replacement', async t => {
  const { access, advance, sent, statuses } = await connection(t);
  advance(1000); sent[0].length = 0; statuses.length = 0;
  access.outputs.set('synth', { name: 'Synthesizer', send: () => 0 });
  access.onstatechange?.(); advance(2000);
  assert.deepEqual(sent[0], []);
  assert.deepEqual(statuses, []);
});

test('adding an input redraws without releasing existing holds, removing it releases them', async t => {
  const { access, advance, releases } = await connection(t);
  advance(1000); releases.length = 0;
  access.inputs.set('other', { name: 'Another keyboard', onmidimessage: null });
  access.onstatechange?.();
  assert.deepEqual(releases, [false]);
  releases.length = 0;
  access.inputs.delete('other'); access.onstatechange?.();
  assert.deepEqual(releases, [true]);
});


for (const [name, lightingPort, ports] of [
  ['LPX MIDI', 2, 2], ['LPMiniMK3 MIDI', 2, 2], ['LPProMK3 MIDI', 1, 3],
  ['Launchpad Pro', 2, 3],
] as const) {
  for (const reverse of [false, true]) {
    test(`${name} selects Windows interface ${lightingPort} with outputs ${reverse ? 'reversed' : 'in order'}`, async t => {
      const names = Array.from({ length: ports }, (_, i) => i === 0 ? name : `MIDIOUT${i + 1} (${name})`);
      const inputs = names.map(n => n.replace('MIDIOUT', 'MIDIIN'));
      if (reverse) names.reverse();
      const { midi, sent, advance } = await connection(t, names, 'auto', inputs);
      advance(1000);
      const selected = lightingPort === 1 ? name : `MIDIOUT${lightingPort} (${name})`;
      assert.equal(midi.getStatus().outputName, selected);
      assert.deepEqual(sent.map(messages => messages.length), names.map(n => n === selected ? 2 : 0));
      sent.forEach(messages => { messages.length = 0; });
      midi.sendPadLed(0, 0, 5);
      assert.deepEqual(sent, names.map(n => n === selected ? [[0x90, 81, 5]] : []));
    });
  }
}

for (const removed of ['0', '1']) {
  for (const inputFirst of [true, false]) {
    test(`removing identical controller ${removed} with ${inputFirst ? 'input' : 'output'} first preserves the remaining mode`, async t => {
      const { midi, sent, advance, access } = await connection(t, ['Launchpad X MIDI Out', 'Launchpad X MIDI Out'], 'auto', ['Launchpad X MIDI In', 'Launchpad X MIDI In']);
      advance(1000); sent.forEach(messages => { messages.length = 0; });
      const remaining = removed === '0' ? 1 : 0;
      (inputFirst ? access.inputs : access.outputs).delete(removed); access.onstatechange?.();
      midi.sendPadLed(0, 0, 5);
      assert.deepEqual(sent[remaining], [[0x90, 81, 5]], 'no gap after the first port event');
      sent.forEach(messages => { messages.length = 0; });
      (inputFirst ? access.outputs : access.inputs).delete(removed); access.onstatechange?.();
      advance(1100);
      midi.sendPadLed(0, 0, 5);
      assert.deepEqual(sent[remaining], [[0x90, 81, 5]], 'no new mode switch or 500 ms blackout');
      assert.deepEqual(sent[Number(removed)], []);
    });
  }
}

test('a manually identified unknown DAW-named controller receives lights, but a known DAW port does not', async t => {
  const { midi, sent, advance } = await connection(t, ['Unknown controller DAW', 'Launchpad X DAW', 'Microsoft GS Wavetable Synth'], 'launchpad_x');
  advance(1000);
  assert.deepEqual(sent.map(messages => messages.length), [2, 0, 0]);
  sent.forEach(messages => { messages.length = 0; });
  midi.sendPadLed(0, 0, 5);
  assert.deepEqual(sent, [[[0x90, 81, 5]], [], []]);
});

for (const reversed of [false, true]) {
  test(`numbered original Pro interfaces select only Standalone (${reversed ? 'reverse' : 'forward'})`, async t => {
    // Synthetic labels: Linux's actual labels still require hardware confirmation.
    const names = [1, 2, 3].map(n => `Launchpad Pro MIDI ${n}`);
    if (reversed) names.reverse();
    const { midi, sent, advance } = await connection(t, names);
    advance(1000);
    assert.deepEqual(sent.map(messages => messages.length), names.map(n => n.endsWith('2') ? 2 : 0));
    sent.forEach(messages => { messages.length = 0; });
    midi.sendPadLed(0, 0, 5);
    assert.deepEqual(sent, names.map(n => n.endsWith('2') ? [[0x90, 81, 5]] : []));
  });
}


test('a manual layout does not change the hardware lighting interface', async t => {
  const { midi, sent, advance } = await connection(t, ['MIDIOUT2 (LPProMK3 MIDI)', 'LPProMK3 MIDI', 'MIDIOUT3 (LPProMK3 MIDI)'], 'launchpad_x');
  advance(1000);
  assert.deepEqual(sent.map(messages => messages.length), [0, 2, 0]);
  sent.forEach(messages => { messages.length = 0; });
  midi.sendPadLed(0, 0, 5);
  assert.deepEqual(sent, [[], [[0x90, 81, 5]], []]);
});

test('an unknown DAW-named controller stays unlit on automatic detection', async t => {
  const { midi, sent, advance } = await connection(t, ['Unknown controller DAW']);
  advance(1000); midi.sendPadLed(0, 0, 5);
  assert.deepEqual(sent, [[]]);
});
