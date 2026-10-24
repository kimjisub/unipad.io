import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actualFor, loadCorpus } from './conformanceHarness';
const { corpus } = loadCorpus();

test('admission observes the actual input facts and never copies an expected reservation', async () => {
  const c = corpus.cases.find(c => c.id === 'SAFE-C001')!;
  assert.deepEqual(await actualFor({ ...c, expected: { forged: 'not observed' } }, corpus), { cost: '0', exclusion: null });
  const changed = { ...c, files: [{ path: 'operation.json', text: JSON.stringify({ rate: 48000, channels: 2, frames: '48000' }) }] };
  assert.deepEqual(await actualFor(changed, corpus), { cost: '96000', exclusion: null });
});

test('physical admission reads actual bytes rather than the declared fixture result', async () => {
  const c = corpus.cases.find(c => c.id === 'SAFE-F001')!;
  const actual = await actualFor(c, corpus);
  assert.deepEqual(actual, c.expected);
  const changed = { ...c, files: [{ path: c.files[0].path, base64: Buffer.from('not an audio file').toString('base64') }] };
  assert.notDeepEqual(await actualFor(changed, corpus), actual);
});


test('mapping observes the real mapper and changes when its duration input changes', async () => {
  const c = corpus.cases.find(c => c.id === 'MAP-P003')!;
  const actual = await actualFor(c, corpus);
  assert.deepEqual(await actualFor({ ...c, expected: { forged: true } }, corpus), actual);
  const changed = { ...c, files: c.files.map(f => f.path === 'operation.json' ? { path: f.path, text: JSON.stringify({ durations: { 'a.wav': 50, 'b.wav': 900 } }) } : f) };
  assert.notDeepEqual(await actualFor(changed, corpus), actual);
});
