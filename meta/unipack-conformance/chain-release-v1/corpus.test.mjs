import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { parseUniPack } from '../../../src/lib/unipack/parser.ts';
import { artifacts, checkArtifacts, tone } from './generate.mjs';

const root = new URL('./', import.meta.url);

test('separate chain-release corpus supplies the six approved groups', async () => {
  const expected = JSON.parse(await readFile(new URL('expectations.json', root), 'utf8'));
  assert.equal(expected.suite, 'chain-release-v1');
  assert.deepEqual(expected.cases.map(c => c.id), ['CR-001', 'CR-002', 'CR-003', 'CR-004', 'CR-005', 'CR-006']);
  assert.equal(expected.evidenceLevel, 'authored-expectations-not-platform-results');
});

test('authored timelines agree with pack mappings, ownership, sequence and sample deadlines', async () => {
  const { cases } = JSON.parse(await readFile(new URL('expectations.json', root), 'utf8'));
  for (const scenario of cases) {
    const bytes = await readFile(new URL(`packs/${scenario.pack}.uni`, root));
    const pack = await parseUniPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const active = new Map();
    const pressed = new Map();
    const sequences = new Map();
    let chain = 1;
    let pendingChain = null;
    let previousTime = -1;
    for (const { atMs, input, expected } of scenario.steps) {
      assert.ok(atMs >= previousTime);
      previousTime = atMs;
      const naturalEnds = [];
      for (const [id, playback] of active) {
        if (playback.endMs <= atMs) { naturalEnds.push(id); active.delete(id); }
      }
      if (pendingChain && pendingChain.atMs <= atMs) { chain = pendingChain.chain; pendingChain = null; }
      const releaseStops = [];
      if (input.kind === 'press') {
        assert.ok(!pressed.has(input.inputId));
        const [x, y] = input.pad;
        const key = `${chain}/${x}/${y}`;
        const sounds = pack.soundTable[chain - 1][x - 1][y - 1];
        const index = sequences.get(key) ?? 0;
        const sound = sounds[index % sounds.length];
        sequences.set(key, index + 1);
        assert.equal(expected.starts.length, 1);
        const [declared] = expected.starts;
        assert.deepEqual(declared, {
          playbackId: declared.playbackId, inputId: input.inputId, chain, pad: input.pad,
          file: sound.file, plays: sound.loop === -1 ? 'infinite' : sound.loop + 1,
        });
        assert.ok(!active.has(declared.playbackId));
        active.set(declared.playbackId, { inputId: input.inputId, infinite: sound.loop === -1,
          endMs: sound.loop === -1 ? Infinity : atMs + (sound.loop + 1) * 100 });
        pressed.set(input.inputId, declared.playbackId);
        if (sound.wormhole !== -1) pendingChain = { atMs: atMs + 100, chain: sound.wormhole + 1 };
      } else {
        assert.deepEqual(expected.starts, []);
        if (input.kind === 'chain-button') chain = input.chain;
        else if (input.kind === 'release' || input.kind === 'cancel') {
          const id = pressed.get(input.inputId);
          if (active.get(id)?.infinite) { releaseStops.push(id); active.delete(id); }
          pressed.delete(input.inputId);
        } else assert.equal(input.kind, 'checkpoint');
      }
      const label = `${scenario.id}@${atMs} ${input.kind}`;
      assert.equal(expected.chain, chain, label);
      assert.deepEqual(expected.releaseStops, releaseStops, label);
      assert.deepEqual(expected.naturalEnds, naturalEnds, label);
      assert.deepEqual(expected.active, [...active.keys()], label);
      assert.deepEqual(expected.pressedInputs, [...pressed.keys()], label);
    }
    assert.equal(active.size, 0, `${scenario.id} cleans up all playback`);
    assert.equal(pressed.size, 0, `${scenario.id} cleans up all inputs`);
  }
});

test('generation is deterministic and committed artifacts match exactly', async () => {
  assert.equal(await checkArtifacts(), 11);
  const first = await artifacts();
  const second = await artifacts();
  for (const [path, bytes] of first) assert.ok(bytes.equals(second.get(path)), path);
  for (const [name, frequency] of Object.entries({ a: 440, b: 660, c: 880 })) {
    assert.ok((await readFile(new URL(`sources/sounds/${name}.wav`, root))).equals(tone(frequency)));
  }
});

test('a damaged pack, changed expectation or changed audio is rejected', async () => {
  const scratch = process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? process.env.PAPERCLIP_SCRATCH_DIR;
  assert.ok(scratch, 'Use the run-owned Paperclip scratch directory');
  const folder = await mkdtemp(join(scratch, 'chain-release-'));
  const directory = pathToFileURL(folder + '/');
  try {
    await cp(root, directory, { recursive: true });
    for (const path of ['packs/manual.uni', 'expectations.json', 'sources/sounds/a.wav']) {
      const original = await readFile(new URL(path, directory));
      await writeFile(new URL(path, directory), Buffer.concat([original, Buffer.from('damage')]));
      await assert.rejects(checkArtifacts(directory), /Generated bytes differ/);
      await writeFile(new URL(path, directory), original);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('both distributable packs open without parser warnings and contain real PCM audio', async () => {
  for (const name of ['manual', 'delayed']) {
    const bytes = await readFile(new URL(`packs/${name}.uni`, root));
    const pack = await parseUniPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.deepEqual(pack.errors, []);
    assert.equal(pack.info.chain, 2);
    assert.equal(pack.soundCount, 9);
    assert.deepEqual(pack.soundTable[0][2][0].map(s => s.loop), [-1, 0, 2]);
    assert.equal(pack.soundTable[0][0][0][0].wormhole, name === 'delayed' ? 1 : -1);
    for (const data of pack.soundFiles.values()) {
      const wav = Buffer.from(data);
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.readUInt32LE(40), 8820);
      assert.equal(wav.readUInt32LE(24), 44100);
      assert.ok(wav.subarray(44).some(b => b !== 0));
    }
  }
});
