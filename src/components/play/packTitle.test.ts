import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playMenuTitle } from './packTitle';

test('an empty title is shown as Untitled', () => {
  assert.equal(playMenuTitle(''), 'Untitled');
});

test('a pack title is shown as is', () => {
  assert.equal(playMenuTitle('Fur Elise'), 'Fur Elise');
  assert.equal(playMenuTitle(' '), ' ');
});
