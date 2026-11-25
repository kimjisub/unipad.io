import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUniPack } from './parser';
import { INFO_2X2_2CHAIN, SILENT_WAV, packZip } from './testUtils';
import type { AutoPlayElement } from './types';

const on = (y: number, currChain: number, num = 0): AutoPlayElement => ({ type: 'on', x: 0, y, currChain, num });
const off = (y: number, currChain: number): AutoPlayElement => ({ type: 'off', x: 0, y, currChain });
const delay = (delay: number): AutoPlayElement => ({ type: 'delay', delay });
const chain = (c: number): AutoPlayElement => ({ type: 'chain', c });
async function parse(autoPlay: string, keySound = '1 1 1 a.wav 1 2\n1 1 2 voice.wav\n2 1 2 drum.wav') {
  return parseUniPack(await packZip({
    info: INFO_2X2_2CHAIN, keySound, autoPlay,
    ...Object.fromEntries(['a.wav', 'voice.wav', 'drum.wav'].map(name => [`sounds/${name}`, SILENT_WAV])),
  }));
}

for (const mapped of [true, false]) test(`100 ms song-time wormhole keeps an early ${mapped ? 'voice' : 'unmapped pad'} on its original chain`, async () => {
  const pack = await parse('on 1 1\nd 1\ntouch 1 2\nd 199', mapped ? undefined : '1 1 1 a.wav 1 2\n2 1 2 drum.wav');
  assert.deepEqual(pack.errors, []);
  assert.deepEqual(pack.autoPlay!.elements, [on(0, 0), delay(1), on(1, 0), off(1, 0), delay(99), chain(1), delay(100)]);
});

test('99 ms uses the original queue; exactly 100 ms uses the destination queue', async () => {
  const pack = await parse('on 1 1\nd 99\ntouch 1 2\nd 1\ntouch 1 2\nd 150');
  assert.deepEqual(pack.autoPlay!.elements, [on(0, 0), delay(99), on(1, 0), off(1, 0), delay(1), chain(1), on(1, 1), off(1, 1), delay(150)]);
});

test('splitting a delay preserves total song time', async () => {
  const pack = await parse('on 1 1\nd 250\ntouch 1 2');
  assert.deepEqual(pack.autoPlay!.elements, [on(0, 0), delay(100), chain(1), delay(150), on(1, 1), off(1, 1)]);
});

test('same-time reservations keep press order and reset queues only when applied', async () => {
  const pack = await parse('on 1 1\non 1 1\nd 100\non 1 1', '1 1 1 a.wav 1 2\n1 1 1 voice.wav 1 1\n2 1 1 drum.wav');
  assert.deepEqual(pack.autoPlay!.elements, [on(0, 0), on(0, 0, 1), delay(100), chain(1), chain(0), on(0, 0), chain(1)]);
});

test('explicit chain cancels pending switches; due switches precede an explicit chain', async () => {
  assert.deepEqual((await parse('on 1 1\nd 50\nc 1\nd 200')).autoPlay!.elements, [on(0, 0), delay(50), chain(0), delay(200)]);
  assert.deepEqual((await parse('on 1 1\nd 100\nc 1')).autoPlay!.elements, [on(0, 0), delay(100), chain(1), chain(0)]);
});

test('normal end applies every remaining switch without an extra wait', async () => {
  assert.deepEqual((await parse('touch 1 1\ntouch 1 1')).autoPlay!.elements, [on(0, 0), off(0, 0), on(0, 0, 1), off(0, 0), chain(1), chain(1)]);
});

test('invalid lines and empty pads never accelerate a pending switch', async () => {
  const pack = await parse('on 1 1\nd 1\nc 99\nunknown\ntouch 2 2\nd 199', '1 1 1 a.wav 1 2');
  assert.deepEqual(pack.autoPlay!.elements, [on(0, 0), delay(1), { type: 'on', x: 1, y: 1, currChain: 0, num: 0 }, { type: 'off', x: 1, y: 1, currChain: 0 }, delay(99), chain(1), delay(100)]);
  assert.equal(pack.errors.length, 2);
});


test('negative waits retain their contribution to song time', async () => {
  const pack = await parse('on 1 1\nd -50\nd 100\ntouch 1 2\nd 50');
  assert.deepEqual(pack.autoPlay!.elements, [on(0, 0), delay(-50), delay(100), on(1, 0), off(1, 0), delay(50), chain(1)]);
});

for (const reversedTime of [false, true]) for (const drainInDelay of [false, true]) {
  test(`large switch backlog keeps deadline and press order, reversedTime=${reversedTime}, drainInDelay=${drainInDelay}`, async () => {
    const count = 30000;
    const input = Array(count).fill(reversedTime ? 'on 1 1\nd -1' : 'on 1 1').join('\n');
    const pack = await parse(input + (drainInDelay ? `\nd ${count + 200}` : ''), '1 1 1 a.wav 1 2\n1 1 1 voice.wav 1 1');
    assert.deepEqual(pack.errors, []);
    const elements = pack.autoPlay!.elements;
    const presses = elements.filter(e => e.type === 'on');
    const switches = elements.filter(e => e.type === 'chain');
    assert.equal(presses.length, count); assert.equal(switches.length, count);
    for (let i = 0; i < count; i++) {
      assert.equal(presses[i].currChain, 0); assert.equal(presses[i].num, i);
      const order = reversedTime ? count - 1 - i : i;
      assert.equal(switches[i].c, order % 2 === 0 ? 1 : 0);
    }
    const songTime = elements.reduce((ms, e) => ms + (e.type === 'delay' ? e.delay : 0), 0);
    assert.equal(songTime, (reversedTime ? -count : 0) + (drainInDelay ? count + 200 : 0));
  });
}

test('an explicit chain discards a large backlog before later delays', async () => {
  const pack = await parse(Array(30000).fill('on 1 1').join('\n') + '\nc 1\nd 200');
  assert.deepEqual(pack.errors, []);
  assert.deepEqual(pack.autoPlay!.elements.filter(e => e.type === 'chain'), [chain(0)]);
});
