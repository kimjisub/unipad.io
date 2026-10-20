// Tests of the real-pack tooling: a pack folder hashes like a corpus case, the comparison tells same,
// different and failed apart and names the odd platform, the summary carries no title, a kept copy is
// reused only when the server serves the same file, and unzipping unwraps like the apps' import.
// store.mjs and compare.mjs are also run as commands, against a file server on 127.0.0.1.
//   node --test meta/unipack-conformance/real-packs/tools.test.mjs (part of `pnpm test`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { fingerprint, fingerprintOf } from '../lib.mjs';
import { comparePacks, partsOf, summarize, verdictOf } from './compare.mjs';
import { describePack, folderFingerprint, listPacks, packEntries } from './packs.mjs';
import { bringPack, sameAsServer, unzipPack } from './store.mjs';

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

test('empty directories change the input fingerprint without becoming files', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'info'), 'title=x');
    const absent = folderFingerprint(dir);
    mkdirSync(join(dir, 'keyLED'));
    const empty = folderFingerprint(dir);
    assert.notEqual(empty, absent);
    assert.deepEqual(describePack(dir), { files: 1, bytes: 7, keySoundLines: null, autoPlayLines: null, keyLedFiles: 0, soundFiles: 0 });
    rmSync(join(dir, 'keyLED'), { recursive: true });
    mkdirSync(join(dir, 'sounds'));
    assert.notEqual(folderFingerprint(dir), empty);
    assert.notEqual(folderFingerprint(dir), absent);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nested empty directories contribute their full paths to the input fingerprint', () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, 'keyLED', 'nested'), { recursive: true });
    const nested = folderFingerprint(dir);
    rmSync(join(dir, 'keyLED', 'nested'), { recursive: true });
    assert.notEqual(folderFingerprint(dir), nested);
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
    assert.deepEqual(readdirSync(dir).sort(), ['a.zip', 'b.zip', 'out']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// No explicit folder records: JSZip can discard a bad file before the old path check sees it.
for (const names of [
  ['../info'],
  ['info', '../info'],
  ['../info', 'info'],
  ['nested/../info', 'info'],
  ['info', './info'],
  ['info', 'nested//info'],
  ['info', '/info'],
  ['info', 'nested/../'],
]) {
  test(`unzipping rejects original non-canonical paths before creating output (${names.join(', ')})`, async () => {
    const dir = scratch();
    try {
      const zip = new JSZip();
      for (const [i, name] of names.entries()) {
        zip.file(name, `buttonX=${i === 0 ? 8 : 4}`, { createFolders: false });
      }
      const source = join(dir, 'input.zip');
      const out = join(dir, 'out');
      writeFileSync(source, await zip.generateAsync({ type: 'nodebuffer' }));
      await assert.rejects(unzipPack(source, out), /original path|outside the pack folder/);
      assert.equal(existsSync(out), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('unzipping rejects duplicate archive entries before JSZip overwrites one', async () => {
  const dir = scratch();
  try {
    const zip = new JSZip();
    zip.file('info', 'buttonX=8', { createFolders: false });
    zip.file('infX', 'buttonX=4', { createFolders: false });
    // Replace the equal-length name in both ZIP headers; JSZip's writer cannot emit duplicates.
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    for (let i = bytes.indexOf('infX'); i !== -1; i = bytes.indexOf('infX', i + 4)) bytes.write('info', i);
    const source = join(dir, 'input.zip');
    writeFileSync(source, bytes);
    await assert.rejects(unzipPack(source, join(dir, 'out')), /duplicate archive path/);
    assert.equal(existsSync(join(dir, 'out')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid original path records failed unzip, removes old input and results, and is not compared', async () => {
  const dir = scratch();
  try {
    const zip = new JSZip();
    zip.file('info', 'buttonX=8', { createFolders: false });
    zip.file('../info', 'buttonX=4', { createFolders: false });
    writeFileSync(join(dir, 'p.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
    mkdirSync(join(dir, 'packs', 'store_0001'), { recursive: true });
    writeFileSync(join(dir, 'packs', 'store_0001', 'info'), 'buttonX=8');
    for (const platform of ['android', 'ios', 'web']) {
      mkdirSync(join(dir, 'results', platform), { recursive: true });
      writeFileSync(join(dir, 'results', platform, 'store_0001.json'), JSON.stringify({ platform, id: 'store_0001', actual: PACK }));
    }
    const record = await bringPack({ key: '0001', item: { code: 'p', URL: 'https://example.invalid/p.zip' }, archive: dir, work: dir, heads: {}, offline: true });
    assert.equal(record.copy.action, 'reused-unchecked');
    assert.equal(record.unzip.ok, false);
    assert.match(record.unzip.error, /original path/);
    assert.equal(existsSync(join(dir, 'packs', 'store_0001')), false);
    for (const platform of ['android', 'ios', 'web']) assert.equal(existsSync(join(dir, 'results', platform, 'store_0001.json')), false);
    const [row] = comparePacks({ resultsDir: join(dir, 'results'), ids: ['store_0001'], stages: { packs: [record] } });
    assert.equal(row.verdict, 'not-read');
    assert.equal(row.stages.unzip, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A kept zip of one small pack in `archive` as `<code>.zip`, and a stand-in for the file server. */
async function keptCopy(archive, code) {
  const zip = new JSZip();
  zip.file('info', 'title=x');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(join(archive, `${code}.zip`), bytes);
  return bytes;
}

test('a failed download leaves the record of the served file alone, so the next run downloads again', async () => {
  const dir = scratch();
  try {
    const archive = join(dir, 'archive');
    mkdirSync(archive);
    const bytes = await keptCopy(archive, 'p');
    const heads = { p: { size: bytes.length, etag: '"old"' } };
    const served = { status: 200, size: bytes.length, etag: '"new"' };
    let downloads = 0;
    const net = { head: async () => served, download: async () => { downloads++; throw new Error('HTTP 503'); } };
    const item = { URL: 'https://example.invalid/p.zip', code: 'p' };

    const first = await bringPack({ key: '0001', item, archive, work: dir, heads, net });
    assert.equal(first.copy.action, 'download-failed');
    assert.equal(first.unzip, null);
    assert.deepEqual(heads.p, { size: bytes.length, etag: '"old"' });
    const second = await bringPack({ key: '0001', item, archive, work: dir, heads, net });
    assert.equal(second.copy.action, 'download-failed');
    assert.equal(downloads, 2);

    const reused = await bringPack({ key: '0001', item, archive, work: dir, heads: {}, net });
    assert.equal(reused.copy.action, 'reused');
    assert.equal(reused.unzip.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a pack not unzipped in this run keeps no folder from an earlier run, and compare does not read it', async () => {
  const dir = scratch();
  try {
    const archive = join(dir, 'archive');
    mkdirSync(archive);
    await keptCopy(archive, 'p');
    const item = { URL: 'https://example.invalid/p.zip', code: 'p' };
    const ok = { head: async (url) => ({ status: 200, size: readFileSync(join(archive, 'p.zip')).length, etag: null, url }), download: async () => 0 };
    const gone = { head: async () => ({ status: 404, size: null, etag: null }), download: async () => 0 };

    await bringPack({ key: '0001', item, archive, work: dir, heads: {}, net: ok });
    assert.ok(existsSync(join(dir, 'packs', 'store_0001', 'info')));
    const record = await bringPack({ key: '0001', item, archive, work: dir, heads: {}, net: gone });
    assert.equal(record.copy.action, 'not-served');
    assert.equal(existsSync(join(dir, 'packs', 'store_0001')), false);

    const results = join(dir, 'results');
    for (const p of ['android', 'ios', 'web']) {
      mkdirSync(join(results, p), { recursive: true });
      writeFileSync(join(results, p, 'store_0001.json'), JSON.stringify({ platform: p, id: 'store_0001', actual: PACK }));
    }
    const [row] = comparePacks({ resultsDir: results, ids: ['store_0001'], stages: { packs: [record] } });
    assert.deepEqual(row, { id: 'store_0001', verdict: 'not-read', stages: { head: 404, copy: 'not-served', unzip: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a list code that is not a plain file name is never used as a path', async () => {
  const dir = scratch();
  try {
    const net = { head: async () => { throw new Error('asked the server'); }, download: async () => { throw new Error('downloaded'); } };
    const record = await bringPack({ key: '0001', item: { URL: 'https://example.invalid/x.zip', code: '../x' }, archive: dir, work: dir, heads: {}, net });
    assert.equal(record.copy.action, 'invalid-code');
    assert.equal((await bringPack({ key: '0002', item: null, archive: dir, work: dir, heads: {}, net })).copy.action, 'no-url');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a broken result file fails that pack only, and a pack without a title still summarizes', () => {
  const dir = scratch();
  try {
    for (const p of ['android', 'ios', 'web']) mkdirSync(join(dir, p));
    const untitled = copy(PACK);
    delete untitled.info.title;
    for (const p of ['android', 'ios']) writeFileSync(join(dir, p, 'p1.json'), JSON.stringify({ platform: p, id: 'p1', actual: untitled }));
    writeFileSync(join(dir, 'web', 'p1.json'), '{"platform":"web",');
    const [row] = comparePacks({ resultsDir: dir, ids: ['p1'] });
    assert.equal(row.verdict, 'failed');
    assert.match(row.failed.web, /^unreadable result/);
    assert.equal(typeof row.summary.android.info.titleHash, 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('results of an earlier version of a pack are removed whenever input is prepared', async () => {
  const dir = scratch();
  try {
    const archive = join(dir, 'archive');
    mkdirSync(archive);
    const bytes = await keptCopy(archive, 'p');
    const item = { URL: 'https://example.invalid/p.zip', code: 'p' };
    const results = join(dir, 'results');
    const resultOf = (p) => join(results, p, 'store_0001.json');
    const writeResults = () => {
      for (const p of ['android', 'ios', 'web']) {
        mkdirSync(join(results, p), { recursive: true });
        writeFileSync(resultOf(p), JSON.stringify({ platform: p, id: 'store_0001', actual: PACK }));
      }
    };
    const same = { head: async () => ({ status: 200, size: bytes.length, etag: '"a"' }), download: async () => { throw new Error('downloaded'); } };
    const changed = { head: async () => ({ status: 200, size: bytes.length + 1, etag: '"b"' }), download: async (url, target) => { await keptCopy(archive, 'p'); return readFileSync(target).length; } };

    writeResults();
    assert.equal((await bringPack({ key: '0001', item, archive, work: dir, heads: {}, net: same })).copy.action, 'reused');
    assert.ok(['android', 'ios', 'web'].every((p) => !existsSync(resultOf(p))));
    writeResults();
    assert.equal((await bringPack({ key: '0001', item, archive, work: dir, heads: {}, offline: true })).copy.action, 'reused-unchecked');
    assert.ok(['android', 'ios', 'web'].every((p) => !existsSync(resultOf(p))));

    writeResults();
    const downloaded = await bringPack({ key: '0001', item, archive, work: dir, heads: {}, net: changed });
    assert.equal(downloaded.copy.action, 'downloaded');
    assert.equal(downloaded.unzip.ok, true);
    assert.ok(['android', 'ios', 'web'].every((p) => !existsSync(resultOf(p))));
    const [row] = comparePacks({ resultsDir: results, ids: ['store_0001'], stages: { packs: [downloaded] } });
    assert.deepEqual(row.failed, { android: 'no result', ios: 'no result', web: 'no result' });

    writeResults();
    const gone = { head: async () => ({ status: 404, size: null, etag: null }), download: async () => 0 };
    assert.equal((await bringPack({ key: '0001', item, archive, work: dir, heads: {}, net: gone })).copy.action, 'not-served');
    assert.ok(['android', 'ios', 'web'].every((p) => !existsSync(resultOf(p))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a list key that is not a plain folder name removes nothing', async () => {
  const dir = scratch();
  try {
    const work = join(dir, 'a', 'b', 'work');
    mkdirSync(work, { recursive: true });
    writeFileSync(join(dir, 'keep'), 'x');
    const net = { head: async () => { throw new Error('asked the server'); }, download: async () => { throw new Error('downloaded'); } };
    const item = { URL: 'https://example.invalid/x.zip', code: 'x' };
    for (const key of ['../../..', '../../../keep', 'a/b']) {
      const record = await bringPack({ key, item, archive: dir, work, heads: {}, net });
      assert.equal(record.copy.action, 'invalid-key');
    }
    assert.equal(readFileSync(join(dir, 'keep'), 'utf8'), 'x');
    assert.ok(existsSync(work));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const offline of [false, true]) {
  test(`a list id switched to a different kept copy cannot reuse earlier results (${offline ? 'offline' : 'online'})`, async () => {
    const dir = scratch();
    try {
      const archive = join(dir, 'archive');
      const results = join(dir, 'results');
      const packs = join(dir, 'packs');
      mkdirSync(archive);
      const sizes = {};
      for (const [code, width] of [['first', 8], ['second', 4]]) {
        const zip = new JSZip();
        zip.file('info', `title=x\nbuttonX=${width}`);
        const bytes = await zip.generateAsync({ type: 'nodebuffer' });
        writeFileSync(join(archive, `${code}.zip`), bytes);
        sizes[code] = bytes.length;
      }
      const heads = {};
      const prepare = (code) => bringPack({
        key: '0001', item: { URL: `https://example.invalid/${code}.zip`, code },
        archive, work: dir, heads, offline,
        net: {
          head: async () => ({ status: 200, size: sizes[code], etag: `"${code}"` }),
          download: async () => { throw new Error('downloaded a kept copy'); },
        },
      });
      const first = await prepare('first');
      assert.equal(first.unzip.ok, true);
      assert.match(readFileSync(join(packs, 'store_0001', 'info'), 'utf8'), /buttonX=8/);
      for (const platform of ['android', 'ios', 'web']) {
        mkdirSync(join(results, platform), { recursive: true });
        for (const id of ['store_0001', 'store_0002']) {
          writeFileSync(join(results, platform, `${id}.json`), JSON.stringify({ platform, id, actual: PACK }));
        }
      }
      const [before] = comparePacks({ resultsDir: results, ids: ['store_0001'], packsDir: packs });
      assert.equal(before.verdict, 'same');
      assert.equal(before.summary.web.info.buttonX, 8);

      const second = await prepare('second');
      assert.equal(second.copy.action, offline ? 'reused-unchecked' : 'reused');
      assert.equal(second.unzip.ok, true);
      assert.match(readFileSync(join(packs, 'store_0001', 'info'), 'utf8'), /buttonX=4/);
      const [after] = comparePacks({ resultsDir: results, ids: ['store_0001'], packsDir: packs, stages: { packs: [second] } });
      assert.notEqual(after.fingerprint, before.fingerprint);
      assert.equal(after.verdict, 'failed');
      assert.deepEqual(after.failed, { android: 'no result', ios: 'no result', web: 'no result' });
      for (const platform of ['android', 'ios', 'web']) {
        assert.equal(existsSync(join(results, platform, 'store_0001.json')), false);
        assert.equal(existsSync(join(results, platform, 'store_0002.json')), true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

/** A one-file pack zipped, its `info` holding `title`. */
async function zipOf(title) {
  const zip = new JSZip();
  zip.file('info', `title=${title}`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A file server for `bytes` at /p.zip on 127.0.0.1 whose HEAD reports `headSize`. */
async function serve(bytes, headSize = bytes.length) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-length': req.method === 'HEAD' ? headSize : bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}/p.zip`;
  const close = () => new Promise((done) => { server.closeAllConnections(); server.close(done); });
  return { url, close };
}

const tool = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/** Runs store.mjs over a list of one pack (key 0001, code p) and reads what it wrote. */
async function runStore(dir, url, archive) {
  const list = join(dir, 'list.json');
  writeFileSync(list, JSON.stringify({ '0001': { code: 'p', URL: url } }));
  const work = join(dir, 'work');
  const args = [tool('store.mjs'), '--archive', archive, '--work', work, '--list', list];
  const exit = await promisify(execFile)(process.execPath, args).then(() => 0, (error) => error.code);
  return { exit, stages: readJson(join(work, 'stages.json')), heads: readJson(join(archive, 'heads.json')) };
}

test('store.mjs makes a missing archive folder and still writes heads.json and stages.json', async () => {
  const dir = scratch();
  const bytes = await zipOf('x');
  const server = await serve(bytes);
  try {
    const archive = join(dir, 'new', 'archive');
    const { exit, stages, heads } = await runStore(dir, server.url, archive);
    assert.equal(exit, 0);
    assert.equal(stages.summary.downloaded, 1);
    assert.equal(stages.summary.unzipped, 1);
    assert.equal(heads.p.size, bytes.length);
    assert.deepEqual(readFileSync(join(archive, 'p.zip')), bytes);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store.mjs counts a HEAD that got no answer apart from a pack the server does not serve', async () => {
  const dir = scratch();
  try {
    const server = await serve(Buffer.alloc(0));
    await server.close();
    const archive = join(dir, 'archive');
    mkdirSync(archive);
    const { exit, stages } = await runStore(dir, server.url, archive);
    assert.equal(exit, 0);
    assert.equal(stages.packs[0].head.status, null);
    assert.equal(stages.packs[0].copy.action, 'head-failed');
    assert.equal(stages.summary.headFailed, 1);
    assert.equal(stages.summary.notServed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store.mjs discards a download whose size is not what HEAD reported, and keeps the old copy', async () => {
  const dir = scratch();
  const served = await zipOf('a longer, newer title');
  const server = await serve(served, served.length + 1);
  try {
    const archive = join(dir, 'archive');
    mkdirSync(archive);
    const kept = await zipOf('old');
    writeFileSync(join(archive, 'p.zip'), kept);
    const { exit, stages, heads } = await runStore(dir, server.url, archive);
    assert.equal(exit, 0);
    assert.equal(stages.packs[0].copy.action, 'download-failed');
    assert.match(stages.packs[0].copy.error, new RegExp(`received ${served.length} bytes, HEAD reported ${served.length + 1}`));
    assert.equal(stages.packs[0].unzip, null);
    assert.deepEqual(heads, {});
    assert.deepEqual(readFileSync(join(archive, 'p.zip')), kept);
    assert.deepEqual(readdirSync(archive).sort(), ['heads.json', 'p.zip']);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a result file with a null error or without actual fails that pack only', () => {
  const dir = scratch();
  try {
    for (const p of ['android', 'ios', 'web']) {
      mkdirSync(join(dir, p));
      writeFileSync(join(dir, p, 'p2.json'), JSON.stringify({ platform: p, id: 'p2', actual: PACK }));
    }
    writeFileSync(join(dir, 'android', 'p1.json'), JSON.stringify({ platform: 'android', id: 'p1', error: null }));
    writeFileSync(join(dir, 'ios', 'p1.json'), JSON.stringify({ platform: 'ios', id: 'p1' }));
    writeFileSync(join(dir, 'web', 'p1.json'), JSON.stringify({ platform: 'web', id: 'p1', actual: PACK }));
    const [p1, p2] = comparePacks({ resultsDir: dir, ids: ['p1', 'p2'] });
    assert.deepEqual(p1.failed, { android: 'the runner failed with error null', ios: 'the result has no actual' });
    assert.equal(p2.verdict, 'same');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compare.mjs with --stages refuses an --only id that the run did not list', () => {
  const dir = scratch();
  try {
    const stages = join(dir, 'stages.json');
    writeFileSync(stages, JSON.stringify({ packs: [{ id: 'store_0001', copy: { action: 'not-served' }, unzip: null }] }));
    const run = (only) => spawnSync(process.execPath, [tool('compare.mjs'), '--results', dir, '--stages', stages, '--only', only], { encoding: 'utf8' });
    assert.equal(run('store_0001').status, 0);
    const unknown = run('store_0001,store_0009');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /not in the stages: store_0009/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the corpus, the real-pack tools and the web harness hash with one fingerprint function', async () => {
  const shared = await import('../../../src/lib/unipack/fingerprint.mts');
  assert.equal(fingerprintOf, shared.fingerprintOf);
  const harness = readFileSync(new URL('../../../src/lib/unipack/conformanceHarness.ts', import.meta.url), 'utf8');
  assert.match(harness, /import \{ fingerprintOf \} from '\.\/fingerprint\.mjs';/);
  assert.doesNotMatch(harness, /createHash\('sha256'\)\.update\(Buffer/);
});

test('a pack is described and fingerprinted from one walk of its folder', () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, 'Sounds'));
    mkdirSync(join(dir, 'keyLED'));
    writeFileSync(join(dir, 'KeySound'), '1 1 1 a.wav\n\n1 1 2 b.wav\n');
    writeFileSync(join(dir, 'Sounds', 'a.wav'), 'RIFF');
    writeFileSync(join(dir, 'keyLED', '1 1 1'), 'o 1 1 a 5');
    const entries = packEntries(dir);
    const before = folderFingerprint(dir);
    // Files added after the walk are not seen: the counts come from the walk, not from another one.
    writeFileSync(join(dir, 'Sounds', 'b.wav'), 'RIFF');
    writeFileSync(join(dir, 'autoPlay'), 'c 1');
    assert.deepEqual(describePack(dir, entries), { files: 3, bytes: 38, keySoundLines: 2, autoPlayLines: null, keyLedFiles: 1, soundFiles: 1 });
    assert.equal(folderFingerprint(dir, entries), before);
    assert.deepEqual(describePack(dir), { files: 5, bytes: 45, keySoundLines: 2, autoPlayLines: 1, keyLedFiles: 1, soundFiles: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
