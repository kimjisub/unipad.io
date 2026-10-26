// Run with: pnpm test:unipack
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeChain, ledPushToNum, SoundQueues } from './chainChange';
import { INFO_2X2_2CHAIN, packZip, parseWithLeds, SILENT_WAV } from './testUtils';
import { parseUniPack } from './parser';

/** The sound queue moves a chain change asks for, as `c x y num`. */
function recordingQueues(): { queues: SoundQueues; moves: string[] } {
  const moves: string[] = [];
  return { queues: { soundPushToNum: (c, x, y, num) => { moves.push(`${c} ${x} ${y} ${num}`); } }, moves };
}

test('a chain change is clamped into the pack and a value that is no integer changes nothing', async () => {
  const pack = await parseUniPack(await packZip({ info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav', 'sounds/a.wav': SILENT_WAV }));
  const { queues, moves } = recordingQueues();
  assert.equal(changeChain(pack, 8, queues), 1);
  assert.equal(changeChain(pack, -3, queues), 0);
  assert.equal(changeChain(pack, 1, queues), 1);
  assert.equal(changeChain(pack, Number.NaN, queues), null);
  assert.equal(changeChain(pack, 0.5, queues), null);
  assert.deepEqual(moves, [
    '1 0 0 0', '1 0 1 0', '1 1 0 0', '1 1 1 0',
    '0 0 0 0', '0 0 1 0', '0 1 0 0', '0 1 1 0',
    '1 0 0 0', '1 0 1 0', '1 1 0 0', '1 1 1 0',
  ]);
});

test('a chain change sets every pad of that chain back to its first LED animation, and leaves other chains', async () => {
  const pack = await parseWithLeds({ '1 1 1': 'o 1 1 FF0000', '1 1 1 1': 'o 1 1 00FF00', '2 1 1': 'o 1 1 0000FF', '2 1 1 1': 'o 1 1 FFFFFF' });
  const first = (c: number) => pack.ledAnimationTable![c][0][0]![0].num;
  ledPushToNum(pack, 0, 0, 0, 1);
  ledPushToNum(pack, 1, 0, 0, 1);
  assert.equal(first(0), 1);
  assert.equal(first(1), 1);
  assert.equal(changeChain(pack, 0, null), 0);
  assert.equal(first(0), 0);
  assert.equal(first(1), 1);
  ledPushToNum(pack, 0, 0, 0, 3);
  assert.equal(first(0), 1);
});
