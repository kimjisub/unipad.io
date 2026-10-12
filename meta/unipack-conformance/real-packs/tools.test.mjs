// Tests of the real-pack tooling: a pack folder hashes like a corpus case, the comparison tells same,
// different and failed apart and names the odd platform, the summary carries no title, a kept copy is
// reused only when the server serves the same file, and unzipping unwraps like the apps' import.
//   node --test meta/unipack-conformance/real-packs/tools.test.mjs (part of `pnpm test`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { fingerprint } from '../lib.mjs';
import { comparePacks, partsOf, summarize, verdictOf } from './compare.mjs';
import { describePack, folderFingerprint, listPacks } from './packs.mjs';
import { sameAsServer, unzipPack } from './store.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'real-packs-selftest-'));

const PACK = {
  loaded: true,
  info: { title: 'Secret Title', producerName: 'Someone', buttonX: 8, buttonY: 8, chain: 1, squareButton: true },
  sounds: [{ c: 0, x: 0, y: 0, queue: [{ file: 'a.wav', loop: 0, wormhole: -1 }] }],
  keyLedExist: true,
  leds: [{ c: 0, x: 0, y: 0, queue: [{ loop: 1, events: [['on', 0, 0, 'ffff0000', 5], ['delay', 10]] }] }],
  autoPlay: [['on', 0, 0, 0, 0], ['delay', 100], ['off', 0, 0, 0]],
  errors: ['keySound:missing-file'],
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const three = (android, ios = android, web = android) => ({ android: { actual: android }, ios: { actual: ios }, web: { actual: web } });

test('a pack folder hashes to the corpus fingerprint of the same files', () => {
  const dir = scratch();
  try {
    const files = [{ path: 'info', text: 'title=x' }, { path: 'sounds/a b.wav', text: 'RIFF' }, { path: 'keyLED/1 1 1', text: 'o 1 1 a 5' }];
    for (const f of files) {
      mkdirSync(join(dir, f.path, '..'), { recursive: true });
      writeFileSync(join(dir, f.path), f.text);
    }
    assert.equal(folderFingerprint(dir), fingerprint(files, {}));
    writeFileSync(join(dir, 'keyLED/1 1 1'), 'o 1 1 a 6');
    assert.notEqual(folderFingerprint(dir), fingerprint(files, {}));
    assert.deepEqual(describePack(dir), { files: 3, bytes: 20, keySoundLines: null, autoPlayLines: null, keyLedFiles: 1, soundFiles: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('three identical results are the same', () => {
  assert.deepEqual(verdictOf(three(PACK)), { verdict: 'same', differing: [] });
});

test('a part one platform reads differently is named, with that platform', () => {
  const web = copy(PACK);
  web.errors.push('keyLed:format');
  web.leds[0].queue[0].events.pop();
  assert.deepEqual(verdictOf(three(PACK, PACK, web)), { verdict: 'different', differing: ['keyLed', 'errors'], odd: { keyLed: 'web', errors: 'web' } });
  const ios = copy(PACK);
  ios.autoPlay = null;
  web.autoPlay = [];
  assert.equal(verdictOf(three(PACK, ios, web)).odd.autoPlay, 'all-three');
});

test('a refused pack differs from a loaded one, and a missing or thrown result is a failure', () => {
  assert.deepEqual(verdictOf(three(PACK, { loaded: false })).differing, ['loaded', 'info', 'keySound', 'keyLed', 'autoPlay', 'errors']);
  const failed = verdictOf({ android: { actual: PACK }, ios: { error: 'no result' }, web: { error: 'TypeError: x' } });
  assert.deepEqual(failed, { verdict: 'failed', failed: { ios: 'no result', web: 'TypeError: x' } });
  assert.equal(partsOf({ loaded: false }).info, null);
});

test('the summary counts without naming the pack', () => {
  const summary = summarize(PACK);
  assert.ok(!JSON.stringify(summary).includes('Secret') && !JSON.stringify(summary).includes('Someone'));
  assert.equal(summary.keySoundEntries, 1);
  assert.equal(summary.keyLedFiles, 1);
  assert.equal(summary.keyLedEvents, 2);
  assert.equal(summary.autoPlayCommands, 3);
  assert.deepEqual(summary.autoPlayByKind, { on: 1, delay: 1, off: 1 });
  assert.deepEqual(summary.errors, { 'keySound:missing-file': 1 });
});

test('comparePacks reads each platform file and refuses one written for another pack', () => {
  const dir = scratch();
  try {
    for (const p of ['android', 'ios', 'web']) mkdirSync(join(dir, p));
    writeFileSync(join(dir, 'android', 'p1.json'), JSON.stringify({ platform: 'android', id: 'p1', actual: PACK }));
    writeFileSync(join(dir, 'ios', 'p1.json'), JSON.stringify({ platform: 'ios', id: 'p2', actual: PACK }));
    writeFileSync(join(dir, 'web', 'p1.json'), JSON.stringify({ platform: 'web', id: 'p1', error: 'Error: boom\n  at x' }));
    const [row] = comparePacks({ resultsDir: dir, ids: ['p1'] });
    assert.deepEqual(row.failed, { ios: 'the file says ios/p2', web: 'Error: boom' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listPacks keeps only id-like folders and refuses an unknown id', () => {
  const dir = scratch();
  try {
    for (const name of ['store_0001', 'store_-0001', '.hidden', '-flag']) mkdirSync(join(dir, name));
    assert.deepEqual(listPacks(dir).map((p) => p.id), ['store_-0001', 'store_0001']);
    assert.throws(() => listPacks(dir, ['store_0002']), /no pack folder for store_0002/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a kept copy is reused only when the server serves a file of the same size and ETag', () => {
  const served = { status: 200, size: 10, etag: '"a"' };
  assert.equal(sameAsServer(10, undefined, served), true);
  assert.equal(sameAsServer(10, { etag: '"a"' }, served), true);
  assert.equal(sameAsServer(10, { etag: '"b"' }, served), false);
  assert.equal(sameAsServer(11, undefined, served), false);
  assert.equal(sameAsServer(10, undefined, { status: 404, size: 10 }), false);
});

test('unzipping unwraps single top folders past __MACOSX and refuses an entry outside the folder', async () => {
  const dir = scratch();
  try {
    const zip = new JSZip();
    zip.file('Pack/Pack/info', 'title=x');
    zip.file('Pack/Pack/keySound', '');
    zip.file('__MACOSX/Pack/._info', 'x');
    writeFileSync(join(dir, 'a.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
    assert.deepEqual(await unzipPack(join(dir, 'a.zip'), join(dir, 'out')), { ok: true, files: 3, unwrapped: 2 });
    assert.deepEqual(readdirSync(join(dir, 'out')).sort(), ['info', 'keySound']);

    const bad = new JSZip();
    bad.file('info', 'title=x');
    bad.file('../escape', 'x');
    writeFileSync(join(dir, 'b.zip'), await bad.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(unzipPack(join(dir, 'b.zip'), join(dir, 'out2', 'inner')), /outside the pack folder/);
    assert.deepEqual(readdirSync(dir).sort(), ['a.zip', 'b.zip', 'out', 'out2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
