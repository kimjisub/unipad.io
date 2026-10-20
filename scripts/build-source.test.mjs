import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

import { sourceState, recordBuild, assertCurrentBuild } from './build-source.mjs';

const launcher = resolve('e2e/start-server.mjs');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'build-source-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  writeFileSync(join(cwd, '.gitignore'), '.next/\nnode_modules/\nstarted\n');
  writeFileSync(join(cwd, 'source.txt'), 'original\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'test: initial source');
  mkdirSync(join(cwd, '.next'));
  mkdirSync(join(cwd, 'node_modules/next/dist/bin'), { recursive: true });
  writeFileSync(join(cwd, 'node_modules/next/dist/bin/next'), "require('node:fs').writeFileSync('started', 'yes'); process.exit(0);\n");
  return cwd;
}

for (const reason of ['missing', 'different commit']) {
  test(`the launcher rejects a ${reason} build before starting Next`, async t => {
    const cwd = fixture(t);
    const commit = git(cwd, 'rev-parse', 'HEAD');
    if (reason === 'different commit') {
      writeFileSync(join(cwd, '.next/build-source.json'), JSON.stringify({ version: 1, commit: '0'.repeat(40), files: 'old' }));
    }
    const child = spawn(process.execPath, [launcher], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.equal(existsSync(join(cwd, 'started')), false);
    assert.match(stderr, /Run `pnpm build` first/);
    assert.ok(stderr.includes(commit));
    assert.ok(stderr.includes(reason === 'missing' ? 'missing' : '0'.repeat(40)));
  });
}


test('matching source, including a dirty build, can start Next', async t => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, 'source.txt'), 'built with uncommitted changes\n');
  recordBuild(sourceState(cwd), cwd);
  assert.doesNotThrow(() => assertCurrentBuild(cwd));
  const child = spawn(process.execPath, [launcher], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  assert.equal(existsSync(join(cwd, 'started')), true);
});

for (const change of ['commit', 'unstaged', 'staged', 'untracked', 'deleted']) {
  test(`a subsequent ${change} change invalidates a recorded build`, t => {
    const cwd = fixture(t);
    // Start dirty so the check cannot be satisfied by comparing Git status alone.
    writeFileSync(join(cwd, 'source.txt'), 'first edit\n');
    recordBuild(sourceState(cwd), cwd);
    const before = JSON.parse(readFileSync(join(cwd, '.next/build-source.json'), 'utf8'));
    if (change === 'commit') git(cwd, 'commit', '--allow-empty', '-m', 'test: another commit');
    if (change === 'unstaged' || change === 'staged') writeFileSync(join(cwd, 'source.txt'), 'second edit\n');
    if (change === 'staged') git(cwd, 'add', 'source.txt');
    if (change === 'untracked') writeFileSync(join(cwd, 'new source.txt'), 'new input\r\n');
    if (change === 'deleted') rmSync(join(cwd, 'source.txt'));
    assert.throws(() => assertCurrentBuild(cwd), error => {
      assert.match(error.message, /Run `pnpm build` first/);
      assert.ok(error.message.includes(`Built commit: ${before.commit}`));
      assert.ok(error.message.includes(`Current commit: ${git(cwd, 'rev-parse', 'HEAD')}`));
      return true;
    });
    recordBuild(sourceState(cwd), cwd);
    assert.doesNotThrow(() => assertCurrentBuild(cwd));
  });
}

test('ignored build and test output do not invalidate a recorded build', t => {
  const cwd = fixture(t);
  recordBuild(sourceState(cwd), cwd);
  writeFileSync(join(cwd, '.next', 'generated'), 'build output');
  assert.doesNotThrow(() => assertCurrentBuild(cwd));
});

for (const contents of ['{broken', 'null', '{}', '{"version":2}']) {
  test(`an invalid source record fails closed: ${contents}`, t => {
    const cwd = fixture(t);
    writeFileSync(join(cwd, '.next/build-source.json'), contents);
    assert.throws(() => assertCurrentBuild(cwd), /Run `pnpm build` first/);
  });
}

test('a source change during the build cannot receive a valid record', t => {
  const cwd = fixture(t);
  const before = sourceState(cwd);
  writeFileSync(join(cwd, 'source.txt'), 'changed during build');
  assert.throws(() => recordBuild(before, cwd), /Source changed during the build/);
  assert.equal(existsSync(join(cwd, '.next/build-source.json')), false);
});
