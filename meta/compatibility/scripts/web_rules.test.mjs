import assert from 'node:assert/strict';
import test from 'node:test';
import { checksOf, isLocalRequest } from './web_rules.mjs';

const profile = { first: [1280, 800] };
const checks = (padPress, rotate) => checksOf(profile, { packOpened: { pads: 64 }, padPress, rotate });

test('initial sound needs a start and a running context', () => {
  for (const contextState of ['suspended', 'closed', 'interrupted', undefined]) {
    assert.equal(checks({ soundStarts: 1, contextState }).sound, false, contextState);
  }
  assert.equal(checks({ soundStarts: 0, contextState: 'running' }).sound, false);
  assert.equal(checks({ soundStarts: 1, contextState: 'running' }).sound, true);
});

test('sound after rotation needs new starts and a running context', () => {
  const rotate = { pressedAfterRotate: true, soundStartsBefore: 1, soundStartsAfter: 2,
    contextStateAfterRotate: 'running', padsAfter: { pads: 64 } };
  for (const contextStateAfterRotate of ['suspended', 'closed', 'interrupted', undefined]) {
    assert.equal(checks({}, { ...rotate, contextStateAfterRotate }).sound, false);
  }
  assert.equal(checks({}, { ...rotate, soundStartsAfter: 1 }).sound, false);
  assert.equal(checks({}, { ...rotate, pressedAfterRotate: false }).sound, false);
  assert.equal(checks({}, rotate).sound, true);
});

test('requests must have the same server origin', () => {
  const base = 'http://localhost:3688';
  for (const url of ['http://localhost:36880/x', 'http://localhost:3688@outside.example/x',
    'https://localhost:3688/x', 'http://outside.example/x', 'not a URL',
    'blob:http://outside.example/id']) assert.equal(isLocalRequest(url, base), false, url);
  for (const url of ['http://localhost:3688/x', 'http://localhost:3688',
    'blob:http://localhost:3688/id', 'data:audio/wav;base64,AAAA']) {
    assert.equal(isLocalRequest(url, base), true, url);
  }
  assert.equal(isLocalRequest('http://localhost:3688/other', base + '/play'), true);
});
