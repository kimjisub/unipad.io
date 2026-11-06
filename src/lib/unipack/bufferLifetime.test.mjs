import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseArrayBuffer } from './bufferLifetime.ts';

test('a failed memory release preserves the readable buffer without failing the caller', () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  Object.defineProperty(bytes, 'transfer', { value: () => { throw new TypeError('Buffer cannot be transferred'); } });
  assert.doesNotThrow(() => releaseArrayBuffer(bytes));
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
});
