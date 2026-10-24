import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { actualFor, loadCorpus, REAL, type CorpusCase } from './conformanceHarness';

const { corpus } = loadCorpus();
const original = corpus.cases.find(c => c.id === 'KS-G602')!;
const identityCase = { ...original, soundIdentity: true, files: original.files.map(file => file.path === 'keySound' ? { path: 'keySound', text: '1 1 1 소리.wav' } : file) } as CorpusCase;
const expectedHash = createHash('sha256').update(Buffer.from(corpus.assets['tone-440'].base64, 'base64')).digest('hex');
function firstSound(actual: Awaited<ReturnType<typeof actualFor>>) {
  const parsed = actual as { sounds: { queue: Record<string, unknown>[] }[] };
  return parsed.sounds[0].queue[0];
}

test('sound identity records the selected archive entry and hashes its actual bytes', async () => {
  const actual = await actualFor(identityCase, corpus);
  assert.deepEqual(firstSound(actual), { archiveEntry: 'sounds/소리.wav', sha256: expectedHash, loop: 0, wormhole: -1 });
});

test('sound identity cannot hide overwritten bytes behind the expected archive name', async () => {
  const actual = await actualFor(identityCase, corpus, { ...REAL, parse: async zip => {
    const pack = await REAL.parse(zip);
    const selected = pack.soundTable[0][0][0]![0].file;
    pack.soundFiles.set(selected, new Uint8Array([1, 2, 3]).buffer);
    return pack;
  } });
  const result = firstSound(actual);
  assert.equal(result.archiveEntry, 'sounds/소리.wav');
  assert.equal(result.sha256, createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'));
  assert.notEqual(result.sha256, expectedHash);
});
