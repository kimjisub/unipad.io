import assert from 'node:assert/strict';
import { afterEach, test, mock } from 'node:test';
import { Recorder } from './Recorder';

afterEach(() => mock.restoreAll());

test('recording writes short chain commands and times only presses and chain moves', () => {
  let now = 1000;
  mock.method(performance, 'now', () => now);
  const recorder = new Recorder();
  recorder.start(1);
  now += 100; recorder.recordOn(0, 1);
  now += 30; recorder.recordOff(0, 1);
  now += 70; recorder.recordChain(2);
  now += 150; recorder.recordOn(1, 0);
  recorder.stop();
  assert.equal(recorder.exportAsAutoPlay(), 'c 2\nd 100\nt 1 2\nd 100\nc 3\nd 150\nt 2 1');
});
