import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { PlaybackTicker } from './PlaybackTicker';
import { ManualClock } from './testUtils';

let clock: ManualClock;
beforeEach(() => { clock = new ManualClock(); clock.install(); });
afterEach(() => { clock.uninstall(); });

test('sound and manual lights share a task even when lights registered first', () => {
  const ticker = new PlaybackTicker();
  const events: string[] = [];
  ticker.request(() => events.push('light'), 4, 1);
  ticker.request(() => events.push('sound'), 1, 0);
  clock.tick(200);
  assert.deepEqual(events, ['sound', 'light']);
  assert.equal(clock.scheduled, false);
});

test('recurring sound does not replay or starve lights in a delayed task', () => {
  const ticker = new PlaybackTicker();
  const events: string[] = [];
  const sound = () => { events.push('sound'); ticker.request(sound, 1, 0); };
  const light = () => { events.push('light'); ticker.request(light, 4, 1); };
  ticker.request(light, 4, 1); ticker.request(sound, 1, 0);
  clock.tick(200);
  assert.deepEqual(events, ['sound', 'light']);
  clock.tick(4);
  assert.deepEqual(events, ['sound', 'light', 'sound', 'light']);
});

test('stopping sound preserves a pending manual light and cancelling the last callback clears its timer', () => {
  const ticker = new PlaybackTicker();
  const events: string[] = [];
  const sound = ticker.request(() => events.push('sound'), 1, 0);
  ticker.request(() => events.push('light'), 4, 1);
  ticker.cancel(sound); clock.tick(4);
  assert.deepEqual(events, ['light']);
  const last = ticker.request(() => events.push('cancelled'), 4, 1);
  ticker.cancel(last);
  assert.equal(clock.scheduled, false);
});

test('a callback can cancel another due callback without preventing the next task', () => {
  const ticker = new PlaybackTicker();
  const events: string[] = [];
  const light = ticker.request(() => events.push('cancelled light'), 4, 1);
  ticker.request(() => {
    ticker.cancel(light);
    ticker.request(() => events.push('new light'), 4, 1);
  }, 1, 0);
  clock.tick(4); assert.deepEqual(events, []);
  clock.tick(4); assert.deepEqual(events, ['new light']);
});

test('an exception is reported without stopping the other due runner', () => {
  const ticker = new PlaybackTicker();
  const reported: (() => void)[] = [];
  mock.method(globalThis, 'queueMicrotask', (callback: () => void) => reported.push(callback));
  const error = new Error('invalid playback callback');
  let lit = false;
  ticker.request(() => { throw error; }, 1, 0);
  ticker.request(() => { lit = true; }, 4, 1);
  clock.tick(4);
  assert.equal(lit, true);
  assert.equal(reported.length, 1);
  assert.throws(reported[0], value => value === error);
});
