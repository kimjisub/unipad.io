// Run with: node --test src/lib/analytics/usageEvents.test.mjs
// The sink is a recorder, so no event reaches Firebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayUsageTracker, UsageEvent, UsageParam } from './usageEvents.ts';

const FORBIDDEN_VALUE = /pack|title|\.zip|https?:|\/|launchpad|midi|user|device/i;

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

test('pad_press is sent once per loaded pack', () => {
  const { tracker, events } = recordingTracker();
  tracker.packLoadSucceeded();
  tracker.padPressed();
  tracker.padPressed();
  tracker.padPressed();
  assert.equal(events.filter((e) => e.name === 'pad_press').length, 1);

  tracker.packLoadSucceeded();
  tracker.padPressed();
  tracker.padPressed();
  assert.equal(events.filter((e) => e.name === 'pad_press').length, 2);
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
  tracker.padPressed();
  tracker.autoplayStarted();
  tracker.packLoadFailed();
  tracker.padPressed();
  tracker.autoplayStarted();
  tracker.packLoadSucceeded();
  tracker.unloaded();
  tracker.padPressed();
  tracker.autoplayStarted();
  assert.deepEqual(events.map((e) => e.name), ['pack_load', 'pack_load']);
});

test('parameters stay within the allowed categorical values', () => {
  const { tracker, events } = recordingTracker();
  tracker.packLoadFailed();
  tracker.packLoadSucceeded();
  tracker.padPressed();
  tracker.autoplayStarted();
  const allowedKeys = new Set(Object.values(UsageParam));
  for (const { params } of events) {
    for (const [key, value] of Object.entries(params ?? {})) {
      assert.ok(allowedKeys.has(key), `unexpected parameter ${key}`);
      assert.ok(['success', 'failure'].includes(value), `unexpected value ${value}`);
      assert.doesNotMatch(String(value), FORBIDDEN_VALUE);
    }
  }
});
