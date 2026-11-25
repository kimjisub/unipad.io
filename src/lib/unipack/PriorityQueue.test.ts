import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PriorityQueue } from './PriorityQueue';

for (const sameTime of [false, true]) test(`large priority queue preserves time and tie order with bounded work, sameTime=${sameTime}`, () => {
  const count = 30000;
  let comparisons = 0;
  const compare = (a: { at: number; order: number }, b: { at: number; order: number }) => a.at - b.at || a.order - b.order;
  const queue = new PriorityQueue((a: { at: number; order: number }, b) => { comparisons++; return compare(a, b); });
  const input = Array.from({ length: count }, (_, order) => ({ at: sameTime ? 100 : 100 - order % 997, order }));
  for (const item of [...input].reverse()) queue.push(item);
  const expected = input.sort(compare);
  for (const item of expected) {
    assert.deepEqual(queue.peek(), item);
    assert.deepEqual(queue.pop(), item);
  }
  assert.equal(queue.pop(), undefined);
  assert.ok(comparisons < 4 * count * Math.ceil(Math.log2(count)), `backlog work grew beyond n log n: ${comparisons}`);
  queue.push({ at: 1, order: 0 }); queue.clear();
  assert.equal(queue.peek(), undefined);
  queue.push({ at: -10, order: 1 });
  assert.deepEqual(queue.pop(), { at: -10, order: 1 });
});
