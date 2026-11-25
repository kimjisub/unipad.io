import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refreshOriginalAutoPlay } from './storedAutoPlay';
import { parseUniPack, readLegacyAutoPlaySnapshot } from './parser';
import { INFO_2X2_2CHAIN, SILENT_WAV, packZip } from './testUtils';
import type { AutoPlayElement } from './types';

const legacy: AutoPlayElement[] = [{ type: 'on', x: 0, y: 0, currChain: 0, num: 0 }, { type: 'chain', c: 1 }];
const original: AutoPlayElement[] = [legacy[0], { type: 'delay', delay: 100 }, legacy[1]];
const custom: AutoPlayElement[] = [{ type: 'delay', delay: 700 }, legacy[0]];

for (const swapped of [false, true]) test(`refresh recognizes an original on either side without rewriting custom data, swapped=${swapped}`, () => {
  const saved = swapped ? { current: legacy, backup: custom } : { current: custom, backup: legacy };
  const copy = structuredClone(saved);
  const result = refreshOriginalAutoPlay(saved, original, legacy);
  assert.equal(result.current, swapped ? original : custom);
  assert.equal(result.backup, swapped ? custom : original);
  assert.equal(result.timingVersion, 1); assert.deepEqual(saved, copy);
});

test('unknown or already-versioned custom snapshots stay intact', () => {
  const other: AutoPlayElement[] = [{ type: 'delay', delay: 400 }];
  const result = refreshOriginalAutoPlay({ current: custom, backup: other }, original, legacy);
  assert.equal(result.current, custom); assert.equal(result.backup, other);
  const versioned = { current: legacy, backup: custom, timingVersion: 1 as const };
  assert.equal(refreshOriginalAutoPlay(versioned, original, legacy), versioned);
});

test('snapshot recognition compares element values independently of property insertion order', () => {
  const reordered: AutoPlayElement[] = [{ y: 0, num: 0, currChain: 0, x: 0, type: 'on' }, { c: 1, type: 'chain' }];
  assert.equal(refreshOriginalAutoPlay({ current: custom, backup: reordered }, original, legacy).backup, original);
});

test('legacy snapshot reconstruction is only an identity check and leaves current song-time parsing intact', async () => {
  const bytes = await packZip({ info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav 1 2\n2 1 2 a.wav',
    'sounds/a.wav': SILENT_WAV, autoPlay: 'touch 1 1\nd -10\non 1 2\nd 200',
  });
  const pack = await parseUniPack(bytes);
  const before = structuredClone(pack.autoPlay);
  assert.deepEqual((await readLegacyAutoPlaySnapshot(bytes, pack))?.elements, [
    legacy[0], { type: 'off', x: 0, y: 0, currChain: 0 }, legacy[1],
    { type: 'delay', delay: -10 }, { type: 'on', x: 0, y: 1, currChain: 1, num: 0 }, { type: 'delay', delay: 200 },
  ]);
  assert.deepEqual(pack.autoPlay, before);
  assert.deepEqual(pack.autoPlay?.elements.filter(e => e.type === 'chain'), [legacy[1]]);
});
