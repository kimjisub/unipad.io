import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderFingerprint } from './packs.mjs';

const script = fileURLToPath(new URL('./prepare.mjs', import.meta.url));

test('preparing text-only packs adds empty sound references only when requested, preserving the source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'real-pack-prepare-'));
  try {
    const source = join(dir, 'source');
    const pack = join(source, 'p1');
    mkdirSync(join(pack, 'KeyLED', 'empty'), { recursive: true });
    mkdirSync(join(pack, 'Sounds'), { recursive: true });
    writeFileSync(join(pack, 'info'), 'title=Private title\n');
    writeFileSync(join(pack, 'KeySound'), '1 1 1 kick.wav\r\n1 1 2 KICK.wav\r1 1 3 nested/snare.wav\n1 1 4 kept.wav\n1 1\n1 1 1 ../escape.wav\n1 1 1 /absolute.wav\n1 1 1 bad\\path.wav\n');
    writeFileSync(join(pack, 'Sounds', 'kept.wav'), 'keep these bytes');
    const before = folderFingerprint(pack);
    const run = (...args) => spawnSync(process.execPath, [script, '--packs', source, ...args], { encoding: 'utf8' });
    const work = join(dir, 'work');
    let result = run('--work', work);
    assert.equal(result.status, 0, result.stderr);
    const copy = join(work, 'packs', 'p1');
    assert.equal(folderFingerprint(copy), before);
    assert.equal(existsSync(join(copy, 'Sounds', 'kick.wav')), false);
    for (const platform of ['android', 'ios', 'web']) {
      mkdirSync(join(work, 'results', platform), { recursive: true });
      writeFileSync(join(work, 'results', platform, 'p1.json'), 'stale');
    }
    result = run('--work', work, '--empty-sounds');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(copy, 'Sounds', 'kick.wav')).length, 0);
    assert.equal(readFileSync(join(copy, 'Sounds', 'nested', 'snare.wav')).length, 0);
    assert.equal(readFileSync(join(copy, 'Sounds', 'kept.wav'), 'utf8'), 'keep these bytes');
    assert.equal(existsSync(join(copy, 'escape.wav')), false);
    assert.equal(existsSync(join(copy, 'KeyLED', 'empty')), true);
    assert.equal(folderFingerprint(pack), before);
    const manifest = JSON.parse(readFileSync(join(work, 'prepared.json'), 'utf8'));
    assert.deepEqual(manifest.packs, [{ id: 'p1', sourceFingerprint: before, fingerprint: folderFingerprint(copy), emptySounds: { created: 2, existing: 2, unsafeReferences: 3 } }]);
    assert.equal(JSON.stringify(manifest).includes('Private title'), false);
    for (const platform of ['android', 'ios', 'web']) assert.equal(existsSync(join(work, 'results', platform, 'p1.json')), false);
    result = run('--work', join(dir, 'anonymous'), '--empty-sounds', '--anonymous-ids');
    assert.equal(result.status, 0, result.stderr);
    const anonymous = JSON.parse(readFileSync(join(dir, 'anonymous', 'prepared.json'), 'utf8'));
    assert.match(anonymous.packs[0].id, /^pack_[0-9a-f]{64}$/);
    assert.equal(existsSync(join(dir, 'anonymous', 'packs', anonymous.packs[0].id, 'info')), true);
    assert.equal(anonymous.packs[0].sourceFingerprint, before);
    symlinkSync(source, join(dir, 'source-alias'), 'dir');
    result = run('--work', join(dir, 'source-alias'), '--empty-sounds');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /overlap/);
    result = run('--work', source, '--empty-sounds');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /overlap/);
    assert.equal(folderFingerprint(pack), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preparation rejects overlapping folders with different letter case', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'real-pack-case-'));
  try {
    const source = join(dir, 'Src');
    const alias = join(dir, 'src');
    mkdirSync(join(source, 'p1'), { recursive: true });
    writeFileSync(join(source, 'p1', 'info'), 'title=t\n');
    if (!existsSync(alias)) {
      t.skip('requires a case-insensitive file system');
      return;
    }
    const before = folderFingerprint(source);
    for (const [input, work] of [[source, alias], [alias, source], [source, join(alias, 'work')]]) {
      const result = spawnSync(process.execPath, [script, '--packs', input, '--work', work, '--empty-sounds'], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, 'case aliases must not bypass the overlap guard');
      assert.match(result.stderr, /overlap/);
      assert.equal(folderFingerprint(source), before);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
