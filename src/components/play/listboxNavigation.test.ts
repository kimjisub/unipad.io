import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listboxTargetIndex } from './listboxNavigation';

test('arrow keys step through the options and wrap around the ends', () => {
  assert.equal(listboxTargetIndex('ArrowDown', 0, 3), 1);
  assert.equal(listboxTargetIndex('ArrowDown', 2, 3), 0);
  assert.equal(listboxTargetIndex('ArrowUp', 2, 3), 1);
  assert.equal(listboxTargetIndex('ArrowUp', 0, 3), 2);
});

test('with no active option, down starts at the first option and up at the last', () => {
  assert.equal(listboxTargetIndex('ArrowDown', -1, 3), 0);
  assert.equal(listboxTargetIndex('ArrowUp', -1, 3), 2);
});

test('Home and End jump to the first and last option', () => {
  assert.equal(listboxTargetIndex('Home', 1, 3), 0);
  assert.equal(listboxTargetIndex('End', 1, 3), 2);
  assert.equal(listboxTargetIndex('End', -1, 3), 2);
});

test('other keys and empty lists do not move', () => {
  assert.equal(listboxTargetIndex('Enter', 1, 3), null);
  assert.equal(listboxTargetIndex(' ', 1, 3), null);
  assert.equal(listboxTargetIndex('Home', -1, 0), null);
});
