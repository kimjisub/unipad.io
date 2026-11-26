import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refreshOriginalAutoPlay, restoreOriginalChainOrigins } from './storedAutoPlay';
import { chainOrigin, saveChainOrigins } from './autoPlayChainOrigin';
import { autoPlayMap } from './AutoPlayMapper';
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

test('an exact saved song-time original recovers provenance in memory for remapping and restore', async () => {
  const pack = await parseUniPack(await packZip({ info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav 1 2\n2 1 2 a.wav',
    'sounds/a.wav': SILENT_WAV, autoPlay: 'd 1000\ntouch 1 1\nd 500\ntouch 1 2',
  }));
  for (const chain of pack.soundTable) for (const column of chain) for (const sounds of column) for (const sound of sounds ?? []) sound.audioBuffer = { duration: 0.5 } as AudioBuffer;
  const saved = structuredClone(pack.autoPlay!.elements);
  const before = structuredClone(saved);
  restoreOriginalChainOrigins(saved, pack.autoPlay!.elements);
  assert.deepEqual(saved, before);
  assert.equal(saveChainOrigins(saved).find(e => e.type === 'chain')?.fromSound, true);
  const mapped = await new Promise<import('./types').AutoPlay>((resolve, reject) => autoPlayMap({ elements: saved }, pack.soundTable, {
    onStart() {}, onGetWorkSize() {}, onProgress() {}, onDone: resolve, onError: reject,
  }));
  let time = 0;
  assert.deepEqual(mapped.elements.flatMap(e => { if (e.type === 'delay') time += e.delay; return e.type === 'chain' ? [time] : []; }), [1100]);
  const custom = structuredClone(saved); custom.unshift({ type: 'delay', delay: 50 });
  restoreOriginalChainOrigins(custom, pack.autoPlay!.elements);
  assert.equal(chainOrigin(custom.find(e => e.type === 'chain')!), undefined);
  const marked = structuredClone(saved);
  const choice = marked.find(e => e.type === 'chain')!; choice.fromSound = false;
  restoreOriginalChainOrigins(marked, pack.autoPlay!.elements);
  assert.equal(chainOrigin(choice), false);
  const suppressed = structuredClone(saved);
  suppressed.find(e => e.type === 'on')!.wormholeCancelled = true;
  restoreOriginalChainOrigins(suppressed, pack.autoPlay!.elements);
  assert.equal(chainOrigin(suppressed.find(e => e.type === 'chain')!), undefined);
});
