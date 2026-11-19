import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('meta/store-deploy/scripts/op-bootstrap.sh');
const RATE_LIMITED = '[ERROR] 2026/11/19 20:25:00 Too many requests. Your client has been rate-limited. Try again in 3600 seconds';

// The script finds the app repositories four levels up, so it runs from a copy beside fake
// app folders, with a fake `op` that fails `vault list` or `item get` with the given message.
function run(t, platform, { vaultError = '', itemError = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'op-bootstrap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, 'web/meta/store-deploy/scripts');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(root, 'unipad-android'));
  mkdirSync(join(root, 'unipad-ios'));
  copyFileSync(script, join(scripts, 'op-bootstrap.sh'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'op'), [
    '#!/bin/sh',
    'case "$1 $2" in',
    '  "vault list") [ -z "$FAKE_VAULT_ERROR" ] && exit 0; echo "$FAKE_VAULT_ERROR" >&2; exit 1 ;;',
    '  "item get") [ -z "$FAKE_ITEM_ERROR" ] && exit 0; echo "$FAKE_ITEM_ERROR" >&2; exit 1 ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'op'), 0o755);
  return spawnSync('bash', [join(scripts, 'op-bootstrap.sh'), platform, 'deploy'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_VAULT_ERROR: vaultError, FAKE_ITEM_ERROR: itemError },
  });
}

test('a rate-limited vault probe is reported as a request limit, not a locked app', t => {
  const result = run(t, 'android', { vaultError: RATE_LIMITED });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /request limit/);
  assert.match(result.stderr, /Too many requests/);
  assert.doesNotMatch(result.stderr, /Unlock/);
});

test('a vault probe that fails for another reason keeps the sign-in hint and shows the CLI message', t => {
  const result = run(t, 'ios', { vaultError: '[ERROR] You are not currently signed in.' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unlock the 1Password desktop app/);
  assert.match(result.stderr, /not currently signed in/);
  assert.doesNotMatch(result.stderr, /request limit/);
});

for (const platform of ['android', 'ios']) {
  test(`a rate-limited ${platform} item read is not reported as a missing item`, t => {
    const result = run(t, platform, { itemError: RATE_LIMITED });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /request limit/);
    assert.match(result.stderr, /Too many requests/);
    assert.doesNotMatch(result.stderr, /not found/);
  });

  test(`a missing ${platform} item still explains how to create it`, t => {
    const result = run(t, platform, { itemError: `[ERROR] "UniPad" isn't an item in the "Deploy" vault.` });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not found/);
    assert.match(result.stderr, /isn't an item/);
  });
}
