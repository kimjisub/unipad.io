import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { grammarRecord, verdict } from './grammar-results.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('an item requires all mapped tests, a successful process and a known environment', () => {
  const names = ['marked UTF-8', 'unmarked UTF-8', 'CP949'];
  const passed = names.map(name => ({ name, status: 'passed' }));
  assert.equal(verdict(names, passed, 0, true), 'confirmed');
  assert.equal(verdict(names, passed.slice(1), 0, true), 'unconfirmed');
  for (const status of ['skipped', 'failed', 'interrupted', 'unconfirmed']) {
    assert.equal(verdict(names, [...passed.slice(1), { name: names[0], status }], 0, true), 'unconfirmed');
  }
  assert.equal(verdict(names, passed, 1, true), 'unconfirmed');
  assert.equal(verdict(names, passed, null, true), 'unconfirmed');
  assert.equal(verdict(names, passed, 0, false), 'unconfirmed');
  assert.equal(verdict(names, [...passed, passed[0]], 0, true), 'unconfirmed');
});

test('the grammar edition and revision come from GRAMMAR.md, the revision being its SHA-256', () => {
  const bytes = readFileSync(new URL('../meta/unipack-conformance/GRAMMAR.md', import.meta.url));
  assert.deepEqual(grammarRecord(), { version: 'G4', revision: sha256(bytes) });
  const next = bytes.toString('utf8').replace(/^# UniPack grammar, edition G4\n/, '# UniPack grammar, edition G5\n');
  assert.notEqual(next, bytes.toString('utf8'));
  assert.deepEqual(grammarRecord(Buffer.from(next)), { version: 'G5', revision: sha256(Buffer.from(next)) });
  assert.notEqual(grammarRecord(Buffer.from(next)).revision, grammarRecord().revision);
});
