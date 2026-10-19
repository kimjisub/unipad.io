import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verdict } from './grammar-results.mjs';

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
