// Run with: node --test src/lib/analytics/usageEvents.test.mjs
// The sink is a recorder, so no event reaches Firebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayUsageTracker, UsageEvent, UsageParam } from './usageEvents.ts';

function recordingTracker() {
  const events = [];
  const tracker = new PlayUsageTracker((name, params) => events.push({ name, params }));
  return { tracker, events };
}

test('uses the standard event names', () => {
  assert.deepEqual(Object.values(UsageEvent).sort(), ['autoplay_start', 'pack_load', 'pad_press']);
});

test('pack_load tells success and failure apart', () => {
  const { tracker, events } = recordingTracker();
  tracker.packLoadSucceeded();
  tracker.packLoadFailed();
  assert.deepEqual(events, [
    { name: 'pack_load', params: { result: 'success' } },
    { name: 'pack_load', params: { result: 'failure' } },
  ]);
});

test('a pack that plays with some sounds failed is a failed load whose presses still count', () => {
  const { tracker, events } = recordingTracker();
  tracker.packLoadPartlyFailed();
  tracker.padPressed('screen');
  tracker.autoplayStarted();
  assert.deepEqual(events, [
    { name: 'pack_load', params: { result: 'failure' } },
    { name: 'pad_press', params: { input_source: 'screen' } },
    { name: 'autoplay_start', params: undefined },
  ]);
});

test('pad_press is sent once per loaded pack', () => {
  const { tracker, events } = recordingTracker();
  tracker.packLoadSucceeded();
  tracker.padPressed('screen');
  tracker.padPressed('screen');
  tracker.padPressed('screen');
  assert.equal(events.filter((e) => e.name === 'pad_press').length, 1);

  tracker.packLoadSucceeded();
  tracker.padPressed('screen');
  tracker.padPressed('screen');
  assert.equal(events.filter((e) => e.name === 'pad_press').length, 2);
});

for (const source of ['screen', 'keyboard', 'midi']) {
  test(`pad_press records a first ${source} press with its input source only`, () => {
    const { tracker, events } = recordingTracker();
    tracker.packLoadSucceeded();
    tracker.padPressed(source);
    assert.deepEqual(events.filter((e) => e.name === 'pad_press'), [
      { name: 'pad_press', params: { input_source: source } },
    ]);
  });
}

test('presses from another input after the first one are not recorded', () => {
  const { tracker, events } = recordingTracker();
  tracker.packLoadSucceeded();
  tracker.padPressed('midi');
  tracker.padPressed('screen');
  tracker.padPressed('keyboard');
  tracker.padPressed('midi');
  assert.deepEqual(events.filter((e) => e.name === 'pad_press'), [
    { name: 'pad_press', params: { input_source: 'midi' } },
  ]);

  tracker.packLoadSucceeded();
  tracker.padPressed('screen');
  tracker.padPressed('midi');
  assert.deepEqual(events.filter((e) => e.name === 'pad_press').map((e) => e.params), [
    { input_source: 'midi' },
    { input_source: 'screen' },
  ]);
});

test('autoplay does not count as a pad press', () => {
  const { tracker, events } = recordingTracker();
  tracker.packLoadSucceeded();
  tracker.autoplayStarted();
  assert.deepEqual(events.map((e) => e.name), ['pack_load', 'autoplay_start']);
});

test('autoplay_start is sent once per loaded pack', () => {
  const { tracker, events } = recordingTracker();
  tracker.packLoadSucceeded();
  tracker.autoplayStarted();
  tracker.autoplayStarted();
  assert.equal(events.filter((e) => e.name === 'autoplay_start').length, 1);
});

test('nothing but pack_load is sent without a loaded pack', () => {
  const { tracker, events } = recordingTracker();
  tracker.padPressed('screen');
  tracker.autoplayStarted();
  tracker.packLoadFailed();
  tracker.padPressed('midi');
  tracker.autoplayStarted();
  tracker.packLoadSucceeded();
  tracker.unloaded();
  tracker.padPressed('keyboard');
  tracker.autoplayStarted();
  assert.deepEqual(events.map((e) => e.name), ['pack_load', 'pack_load']);
});

test('parameters stay within the allowed categorical values', () => {
  const allowedValues = {
    [UsageParam.result]: ['success', 'failure'],
    [UsageParam.inputSource]: ['screen', 'keyboard', 'midi'],
  };
  const keysByEvent = { pack_load: ['result'], pad_press: ['input_source'], autoplay_start: [] };
  assert.deepEqual(Object.values(UsageParam).sort(), Object.keys(allowedValues).sort());
  for (const source of allowedValues[UsageParam.inputSource]) {
    const { tracker, events } = recordingTracker();
    tracker.packLoadFailed();
    tracker.packLoadSucceeded();
    tracker.padPressed(source);
    tracker.autoplayStarted();
    for (const { name, params } of events) {
      assert.deepEqual(Object.keys(params ?? {}), keysByEvent[name]);
      for (const [key, value] of Object.entries(params ?? {})) {
        assert.ok(allowedValues[key].includes(value), `unexpected value ${value} for ${key}`);
      }
    }
  }
});
